package fr.maif.otoroshi.daikoku.utils

import akka.http.scaladsl.util.FastFuture
import akka.stream.Materializer
import akka.stream.scaladsl.{Flow, Sink, Source}
import akka.{Done, NotUsed}
import cats.Monad
import cats.data.{EitherT, OptionT}
import cats.implicits.catsSyntaxOptionId
import controllers.AppError
import controllers.AppError._
import fr.maif.otoroshi.daikoku.ctrls.PaymentClient
import fr.maif.otoroshi.daikoku.domain.TeamPermission.Administrator
import fr.maif.otoroshi.daikoku.domain.UsagePlan._
import fr.maif.otoroshi.daikoku.domain._
import fr.maif.otoroshi.daikoku.env.Env
import fr.maif.otoroshi.daikoku.logger.AppLogger
import fr.maif.otoroshi.daikoku.utils.Cypher.encrypt
import fr.maif.otoroshi.daikoku.utils.StringImplicits._
import fr.maif.otoroshi.daikoku.utils.future.EnhancedObject
import jobs.{ApiKeyStatsJob, OtoroshiVerifierJob}
import org.joda.time.DateTime
import play.api.i18n.MessagesApi
import play.api.libs.json._
import play.api.mvc.Result
import play.api.mvc.Results.Ok

import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

class ApiService(env: Env,
                 otoroshiClient: OtoroshiClient,
                 messagesApi: MessagesApi,
                 translator: Translator,
                 apiKeyStatsJob: ApiKeyStatsJob,
                 otoroshiSynchronisator: OtoroshiVerifierJob,
                 paymentClient: PaymentClient) {

  implicit val ec: ExecutionContext = env.defaultExecutionContext
  implicit val ev: Env = env
  implicit val me: MessagesApi = messagesApi
  implicit val tr: Translator = translator

  def getListFromStringMap(key: String,
                      metadata: Map[String, String]): Set[String] = {
    metadata.get(key)
      .map(_.split('|').toSeq.map(_.trim).toSet)
      .getOrElse(Set.empty)
  }

  def mergeStringMapValue(key: String,
                     meta1: Map[String, String],
                     meta2: Map[String, String]): String = {
    val list1 = getListFromStringMap(key, meta1)
    val list2 = getListFromStringMap(key, meta2)
    (list1 ++ list2).mkString(" | ")
  }

  def createOtoroshiApiKey(user: User, api: Api, plan: UsagePlan, team: Team, tenant: Tenant,
                           integrationToken: String,
                           customMetadata: Option[JsObject] = None,
                           customMaxPerSecond: Option[Long] = None,
                           customMaxPerDay: Option[Long] = None,
                           customMaxPerMonth: Option[Long] = None,
                           customReadOnly: Option[Boolean] = None,
                           maybeOtoroshiApiKey: Option[OtoroshiApiKey] = None) = {

    val otoroshiApiKey = maybeOtoroshiApiKey.getOrElse(OtoroshiApiKey(
      clientId = IdGenerator.token(32),
      clientSecret = IdGenerator.token(64),
      clientName = s"daikoku-api-key-${api.humanReadableId}-${
        plan.customName
          .getOrElse(plan.typeName)
          .urlPathSegmentSanitized
      }-${team.humanReadableId}-${System.currentTimeMillis()}-${api.currentVersion.value}"))

    val createdAt = DateTime.now().toString()
    val ctx = Map(
      "user.id" -> user.id.value,
      "user.name" -> user.name,
      "user.email" -> user.email,
      "api.id" -> api.id.value,
      "api.name" -> api.name,
      "team.id" -> team.id.value,
      "team.name" -> team.name,
      "tenant.id" -> tenant.id.value,
      "tenant.name" -> tenant.name,
      "createdAt" -> createdAt,
      "client.id" -> otoroshiApiKey.clientId,
      "client.name" -> otoroshiApiKey.clientName
    ) ++ team.metadata.map(t => ("team.metadata." + t._1, t._2)) ++ user.metadata
      .map(
        t => ("user.metadata." + t._1, t._2)
      )

    val processedMetadata = plan
      .otoroshiTarget
      .map(_.processedMetadata(ctx))
      .getOrElse(Map.empty[String, String]) ++ customMetadata
      .flatMap(_.asOpt[Map[String, String]])
      .getOrElse(Map.empty[String, String])

    val processedTags = plan.otoroshiTarget
      .map(_.processedTags(ctx))
      .getOrElse(Set.empty[String])

    val apiKey = ActualOtoroshiApiKey(
      clientId = otoroshiApiKey.clientId,
      clientSecret = otoroshiApiKey.clientSecret,
      clientName = otoroshiApiKey.clientName,
      authorizedEntities = plan.otoroshiTarget.flatMap(_.authorizedEntities).getOrElse(AuthorizedEntities()),
      throttlingQuota = 1000,
      dailyQuota = RemainingQuotas.MaxValue,
      monthlyQuota = RemainingQuotas.MaxValue,
      allowClientIdOnly =
        plan.otoroshiTarget.exists(_.apikeyCustomization.clientIdOnly),
      readOnly = customReadOnly.getOrElse(plan.otoroshiTarget.exists(_.apikeyCustomization.readOnly)),
      constrainedServicesOnly = plan.otoroshiTarget.exists(
        _.apikeyCustomization.constrainedServicesOnly),
      tags = processedTags,
      restrictions = plan.otoroshiTarget
        .map(_.apikeyCustomization.restrictions)
        .getOrElse(ApiKeyRestrictions()),
      metadata = Map(
        "daikoku_created_by" -> user.email,
        "daikoku_created_from" -> "daikoku",
        "daikoku_created_at" -> createdAt,
        "daikoku_created_with_id" -> api.id.value,
        "daikoku_created_with" -> api.name,
        "daikoku_created_for_team_id" -> team.id.value,
        "daikoku_created_for_team" -> team.name,
        "daikoku_created_on_tenant" -> tenant.id.value,
        "daikoku_integration_token" -> integrationToken,
        "daikoku__metadata" -> processedMetadata.keys.mkString(" | "),
        "daikoku__tags" -> processedTags.mkString(" | ")
      ) ++ processedMetadata,
      rotation = plan.autoRotation.map(enabled => ApiKeyRotation(enabled = enabled))
    )

    plan match {
      case p: FreeWithQuotas =>
        apiKey.copy(
          throttlingQuota = customMaxPerSecond.getOrElse(p.maxPerSecond),
          dailyQuota = customMaxPerDay.getOrElse(p.maxPerDay),
          monthlyQuota = customMaxPerMonth.getOrElse(p.maxPerMonth))
      case p: QuotasWithLimits =>
        apiKey.copy(
          throttlingQuota = customMaxPerSecond.getOrElse(p.maxPerSecond),
          dailyQuota = customMaxPerDay.getOrElse(p.maxPerDay),
          monthlyQuota = customMaxPerMonth.getOrElse(p.maxPerMonth))
      case _ => apiKey
    }
  }

  def subscribeToApi(tenant: Tenant,
                     user: User,
                     api: Api,
                     plan: UsagePlan,
                     team: Team,
                     parentSubscriptionId: Option[ApiSubscriptionId] = None,
                     customMetadata: Option[JsObject] = None,
                     customMaxPerSecond: Option[Long] = None,
                     customMaxPerDay: Option[Long] = None,
                     customMaxPerMonth: Option[Long] = None,
                     customReadOnly: Option[Boolean] = None,
                     adminCustomName: Option[String] = None,
                     thirdPartySubscriptionInformations: Option[ThirdPartySubscriptionInformations]): Future[Either[AppError, ApiSubscription]] = {
    def createKey(api: Api, plan: UsagePlan, team: Team, authorizedEntities: AuthorizedEntities, parentSubscriptionId: Option[ApiSubscriptionId])(
      implicit otoroshiSettings: OtoroshiSettings
    ): Future[Either[AppError, ApiSubscription]] = {
      import cats.implicits._

      EitherT(parentSubscriptionId match {
        case None =>
          val error: Future[Either[AppError, (Option[ApiSubscription], Option[OtoroshiApiKey])]] = FastFuture.successful(
            Right((None, None)))
          error
        case Some(id) => env.dataStore.apiSubscriptionRepo.forTenant(tenant.id).findById(id.value)
          .map {
            case Some(sub) => Right((Some(sub), Some(sub.apiKey)))
            case None => Left(AppError.SubscriptionNotFound)
          }
      })
        .flatMap {
          case (maybeParentSub, otoroshiApiKey) =>

            val integrationToken = IdGenerator.token(64)

            val tunedApiKey = createOtoroshiApiKey(
              user = user,
              api = api,
              plan = plan,
              team = team,
              tenant = tenant,
              integrationToken = integrationToken,
              customMetadata = customMetadata,
              customMaxPerSecond = customMaxPerSecond,
              customMaxPerDay = customMaxPerDay,
              customMaxPerMonth = customMaxPerMonth,
              customReadOnly = customReadOnly,
              maybeOtoroshiApiKey = otoroshiApiKey)

            val automaticMetadata = tunedApiKey.metadata.filterNot(i => i._1.startsWith("daikoku_")) -- customMetadata
              .flatMap(_.asOpt[Map[String, String]])
              .getOrElse(Map.empty[String, String])
              .keys

            val apiSubscription = ApiSubscription(
              id = ApiSubscriptionId(IdGenerator.token(32)),
              tenant = tenant.id,
              apiKey = tunedApiKey.asOtoroshiApiKey,
              plan = plan.id,
              createdAt = DateTime.now(),
              team = team.id,
              api = api.id,
              by = user.id,
              customName = None,
              rotation = plan.autoRotation.map(rotation => ApiSubscriptionRotation(enabled = rotation)),
              integrationToken = integrationToken,
              metadata = Some(JsObject(automaticMetadata.view.mapValues(i => JsString(i)).toSeq)),
              tags = Some(tunedApiKey.tags),
              customMetadata = customMetadata,
              customMaxPerSecond = customMaxPerSecond,
              customMaxPerDay = customMaxPerDay,
              customMaxPerMonth = customMaxPerMonth,
              customReadOnly = customReadOnly,
              adminCustomName = adminCustomName,
              parent = parentSubscriptionId,
              thirdPartySubscriptionInformations = thirdPartySubscriptionInformations
            )


            val otoroshiApiKeyActionResult: EitherT[Future, AppError, ActualOtoroshiApiKey] = maybeParentSub match {
              case Some(subscription) => EitherT(otoroshiClient.getApikey(subscription.apiKey.clientId))
                .flatMap(otoApiKey =>
                  EitherT(otoroshiClient.updateApiKey(
                    otoApiKey.copy(
                      authorizedEntities = AuthorizedEntities(
                        groups = otoApiKey.authorizedEntities.groups ++ authorizedEntities.groups,
                        services = otoApiKey.authorizedEntities.services ++ authorizedEntities.services,
                        routes = otoApiKey.authorizedEntities.routes ++ authorizedEntities.routes),
                      tags = tunedApiKey.tags ++ otoApiKey.tags,
                      restrictions = ApiKeyRestrictions(
                        enabled = otoApiKey.restrictions.enabled && tunedApiKey.restrictions.enabled,
                        allowLast = otoApiKey.restrictions.allowLast || tunedApiKey.restrictions.allowLast,
                        allowed = tunedApiKey.restrictions.allowed ++ otoApiKey.restrictions.allowed,
                        forbidden = tunedApiKey.restrictions.forbidden ++ otoApiKey.restrictions.forbidden,
                        notFound = tunedApiKey.restrictions.forbidden ++ otoApiKey.restrictions.forbidden),
                      metadata = tunedApiKey.metadata ++ otoApiKey.metadata ++ Map(
                        "daikoku__metadata" -> mergeStringMapValue(
                          "daikoku__metadata",
                          tunedApiKey.metadata,
                          otoApiKey.metadata),
                        "daikoku__tags" -> mergeStringMapValue("daikoku__tags",
                          tunedApiKey.metadata,
                          otoApiKey.metadata),
                      )
                    )
                  )))
              case None => EitherT(otoroshiClient.createApiKey(tunedApiKey))
            }

            for {
              _ <- otoroshiApiKeyActionResult
              _ <- EitherT.liftF[Future, AppError, Boolean](env.dataStore.apiSubscriptionRepo
                .forTenant(tenant.id)
                .save(apiSubscription))
            } yield apiSubscription
        }.value
    }

    def createAdminKey(api: Api, plan: UsagePlan): Future[Either[AppError, ApiSubscription]] = {
      import cats.implicits._
      // TODO: verify if group is in authorized groups (if some)

      val clientId = IdGenerator.token(32)
      val clientSecret = IdGenerator.token(64)
      val clientName =
        s"daikoku-api-key-${api.humanReadableId}-${
          plan.customName
            .getOrElse(plan.typeName)
            .urlPathSegmentSanitized
        }-${team.humanReadableId}-${System.currentTimeMillis()}"
      val apiSubscription = ApiSubscription(
        id = ApiSubscriptionId(IdGenerator.token(32)),
        tenant = tenant.id,
        apiKey = OtoroshiApiKey(clientName, clientId, clientSecret),
        plan = plan.id,
        createdAt = DateTime.now(),
        team = team.id,
        api = api.id,
        by = user.id,
        customName = None,
        rotation = plan.autoRotation.map(_ => ApiSubscriptionRotation()),
        integrationToken = IdGenerator.token(64)
      )

      val r: EitherT[Future, AppError, ApiSubscription] = for {
        _ <- EitherT.liftF(
          env.dataStore.apiSubscriptionRepo
            .forTenant(tenant.id)
            .save(apiSubscription))
        _ <- EitherT.liftF(
          env.dataStore.tenantRepo.save(tenant.copy(adminSubscriptions = tenant.adminSubscriptions :+ apiSubscription.id))
        )
      } yield apiSubscription

      r.value
    }

    plan.otoroshiTarget.map(_.otoroshiSettings).flatMap { id =>
      tenant.otoroshiSettings.find(_.id == id)
    } match {
      case None if api.visibility == ApiVisibility.AdminOnly => createAdminKey(api, plan)
      case None => Future.successful(Left(OtoroshiSettingsNotFound))
      case Some(otoSettings) =>
        implicit val otoroshiSettings: OtoroshiSettings = otoSettings
        plan.otoroshiTarget.flatMap(_.authorizedEntities) match {
          case None => Future.successful(Left(ApiNotLinked))
          case Some(authorizedEntities) if authorizedEntities.isEmpty => Future.successful(Left(ApiNotLinked))
          case Some(authorizedEntities) =>
            val customMetadataKeys = plan.otoroshiTarget.get.apikeyCustomization.customMetadata.map(_.key)
            val isCustomMetadataProvided =
              customMetadataKeys.intersect(customMetadata.map(_.keys.toSeq).getOrElse(Seq.empty)) == customMetadataKeys &&
                customMetadata.map(_.values.toSeq).forall(values => !values.contains(JsNull))

            if (isCustomMetadataProvided) {
              createKey(api, plan, team, authorizedEntities, parentSubscriptionId)
            } else {
              FastFuture.successful(Left(ApiKeyCustomMetadataNotPrivided))
            }

        }
    }
  }

  def updateSubscription(tenant: Tenant,
                         subscription: ApiSubscription,
                         plan: UsagePlan): Future[Either[AppError, JsObject]] = {
    import cats.implicits._

    plan.otoroshiTarget.map(_.otoroshiSettings).flatMap { id =>
        tenant.otoroshiSettings.find(_.id == id)
      } match {
        case None => Future.successful(Left(OtoroshiSettingsNotFound))
        case Some(otoSettings) =>
          implicit val otoroshiSettings: OtoroshiSettings = otoSettings
          plan.otoroshiTarget.flatMap(_.authorizedEntities) match {
            case None => Future.successful(Left(ApiNotLinked))
            case Some(authorizedEntities) if authorizedEntities.isEmpty => Future.successful(Left(ApiNotLinked))
            case Some(authorizedEntities) =>

            val r: EitherT[Future, AppError, JsObject] = for {
              apiKey <- EitherT(
                otoroshiClient.getApikey(subscription.apiKey.clientId))
              _ <- EitherT.liftF(
                otoroshiClient.updateApiKey(
                  apiKey.copy(
                    authorizedEntities = authorizedEntities,
                    throttlingQuota = subscription.customMaxPerSecond.getOrElse(apiKey.throttlingQuota),
                    dailyQuota = subscription.customMaxPerDay.getOrElse(apiKey.dailyQuota),
                    monthlyQuota = subscription.customMaxPerMonth.getOrElse(apiKey.monthlyQuota),
                    metadata = apiKey.metadata ++ subscription.customMetadata
                      .flatMap(_.asOpt[Map[String, String]])
                      .getOrElse(Map.empty[String, String]),
                    readOnly = subscription.customReadOnly.getOrElse(apiKey.readOnly)
                  )))
              _ <- EitherT.liftF(
                env.dataStore.apiSubscriptionRepo
                  .forTenant(tenant.id)
                  .save(subscription)
              )
            } yield subscription.asSafeJson.as[JsObject]

            r.value
          }
      }
  }

  def deleteApiKey(tenant: Tenant,
                   subscription: ApiSubscription,
                   plan: UsagePlan,
                   team: Team): Future[Either[AppError, JsObject]] = {
    def deleteKey()(implicit otoroshiSettings: OtoroshiSettings): Future[Either[AppError, JsObject]] = {
      import cats.implicits._

      val r: EitherT[Future, AppError, JsObject] = for {
        _ <- EitherT.liftF(
          otoroshiClient.deleteApiKey(subscription.apiKey.clientId))
        _ <- EitherT.liftF(
          env.dataStore.apiSubscriptionRepo
            .forTenant(tenant.id)
            .deleteByIdLogically(subscription.id))
      } yield {
        Json.obj("archive" -> "done",
          "subscriptionId" -> subscription.id.asJson)
      }

      r.value
    }

    plan.otoroshiTarget.map(_.otoroshiSettings).flatMap { id =>
      tenant.otoroshiSettings.find(_.id == id)
    } match {
      case None => Future.successful(Left(OtoroshiSettingsNotFound))
      case Some(otoSettings) =>
        implicit val otoroshiSettings: OtoroshiSettings = otoSettings
        plan.otoroshiTarget.map(_.authorizedEntities) match {
          case None => Future.successful(Left(ApiNotLinked))
          case Some(authorizedEntities) if authorizedEntities.isEmpty => Future.successful(Left(ApiNotLinked))
          case Some(_) => deleteKey()
        }
    }
  }

  def archiveApiKey(tenant: Tenant,
                    subscription: ApiSubscription,
                    plan: UsagePlan,
                    enabled: Boolean): Future[Either[AppError, JsObject]] = {
    import cats.implicits._

    val updatedSubscription = subscription.copy(enabled = enabled)

    plan.otoroshiTarget.map(_.otoroshiSettings).flatMap { id =>
      tenant.otoroshiSettings.find(_.id == id)
    } match {
      case None => FastFuture.successful(Left(OtoroshiSettingsNotFound))
      case Some(otoSettings) =>
        implicit val otoroshiSettings: OtoroshiSettings = otoSettings

        val r: EitherT[Future, AppError, JsObject] = for {
          apiKey <- EitherT(otoroshiClient.getApikey(subscription.apiKey.clientId))
          _ <- subscription.parent match {
            case Some(_) =>
              plan.otoroshiTarget match {
                case Some(target) if target.authorizedEntities.isDefined && enabled =>
                    EitherT.liftF(
                      otoroshiClient.updateApiKey(apiKey.copy(authorizedEntities = apiKey.authorizedEntities.copy(
                        services = apiKey.authorizedEntities.services ++ target.authorizedEntities.get.services,
                        groups = apiKey.authorizedEntities.groups ++ target.authorizedEntities.get.groups,
                        routes = apiKey.authorizedEntities.routes ++ target.authorizedEntities.get.routes
                      ))))
                case Some(target) if target.authorizedEntities.isDefined =>
                    EitherT.liftF(
                      otoroshiClient.updateApiKey(apiKey.copy(authorizedEntities = apiKey.authorizedEntities.copy(
                        services = apiKey.authorizedEntities.services.filter(s => !target.authorizedEntities.get.services.contains(OtoroshiServiceId(s.value))),
                        groups = apiKey.authorizedEntities.groups.filter(s => !target.authorizedEntities.get.groups.contains(OtoroshiServiceGroupId(s.value))),
                        routes = apiKey.authorizedEntities.routes.filter(s => !target.authorizedEntities.get.routes.contains(OtoroshiRouteId(s.value)))
                      ))))
                case _ => EitherT.leftT[Future, JsObject](OtoroshiSettingsNotFound)
              }
            case None =>
              EitherT.liftF(
                otoroshiClient.updateApiKey(apiKey.copy(enabled = enabled)))
          }
          _ <- paymentClient.toggleStateThirdPartySubscription(updatedSubscription)
          _ <- EitherT.liftF(
            env.dataStore.apiSubscriptionRepo
              .forTenant(tenant.id)
              .save(updatedSubscription)
          )
        } yield updatedSubscription.asSafeJson.as[JsObject]

        r.value
    }
  }

  def regenerateApiKeySecret(tenant: Tenant,
                             subscription: ApiSubscription,
                             plan: UsagePlan,
                             api: Api,
                             team: Team,
                             user: User): Future[Either[AppError, JsObject]] = {
    import cats.implicits._

    plan.otoroshiTarget.map(_.otoroshiSettings).flatMap { id =>
      tenant.otoroshiSettings.find(_.id == id)
    } match {
      case None if api.visibility == ApiVisibility.AdminOnly =>
        val newClientSecret = IdGenerator.token(64)
        val updatedSubscription = subscription.copy(apiKey = subscription.apiKey.copy(clientSecret = newClientSecret))
        env.dataStore.apiSubscriptionRepo
          .forTenant(tenant.id)
          .save(updatedSubscription)
          .map(_ => Right(Json.obj("done" -> true, "subscription" -> updatedSubscription.asJson)))
      case None => Future.successful(Left(OtoroshiSettingsNotFound))
      case Some(otoSettings) =>
        implicit val otoroshiSettings: OtoroshiSettings = otoSettings
        //implicit val language: String = tenant.defaultLanguage.getOrElse("en")

        val newClientSecret = IdGenerator.token(64)
        val updatedSubscription = subscription.copy(apiKey = subscription.apiKey.copy(clientSecret = newClientSecret))

        val r: EitherT[Future, AppError, JsObject] = for {
          subscriptionTeam <- EitherT.liftF(
            env.dataStore.teamRepo
              .forTenant(tenant.id)
              .findById(subscription.team))
          admins <- EitherT.liftF(
            env.dataStore.userRepo.find(
              Json.obj("_id" -> Json.obj(
                "$in" -> JsArray(subscriptionTeam
                  .map(_.users
                    .filter(_.teamPermission == Administrator)
                    .map(_.userId.asJson)
                    .toSeq
                  ).getOrElse(Seq.empty)))))
          )
          apiKey <- EitherT(otoroshiClient.getApikey(subscription.apiKey.clientId))
          _ <- EitherT.liftF(otoroshiClient.updateApiKey(apiKey.copy(clientSecret = newClientSecret)))
          _ <- EitherT.liftF(
            env.dataStore.apiSubscriptionRepo
              .forTenant(tenant.id)
              .save(updatedSubscription)
          )
          _ <- EitherT.liftF(env.dataStore.notificationRepo
            .forTenant(tenant.id)
            .save(Notification(
              id = NotificationId(IdGenerator.token(32)),
              tenant = tenant.id,
              team = Some(subscription.team),
              sender = user.asNotificationSender,
              action = NotificationAction
                .ApiKeyRefresh(
                  subscription.customName.getOrElse(apiKey.clientName),
                  api.name,
                  plan.customName.getOrElse(
                    plan.typeName)),
              notificationType =
                NotificationType.AcceptOnly
            )))
          _ <- EitherT.liftF(Future.sequence(admins.map(admin => {
            implicit val language: String = admin.defaultLanguage.getOrElse(tenant.defaultLanguage.getOrElse("en"))
            (for {
              title <- translator.translate("mail.apikey.refresh.title", tenant)
              body <- translator.translate("mail.apikey.refresh.body", tenant, Map(
                "apiName" -> api.name,
                "planName" -> plan.customName.getOrElse(plan.typeName)
              ))
            } yield {
              tenant.mailer.send(title, Seq(admin.email), body, tenant)
            }).flatten
          })))
        } yield updatedSubscription.asSafeJson.as[JsObject]
        r.value
      }
  }

  def toggleApiKeyRotation(tenant: Tenant,
                           subscription: ApiSubscription,
                           plan: UsagePlan,
                           api: Api,
                           enabled: Boolean,
                           rotationEvery: Long,
                           gracePeriod: Long): Future[Either[AppError, JsObject]] = {
    import cats.implicits._

    if (api.visibility == ApiVisibility.AdminOnly) {
      Future.successful(Left(ApiKeyRotationConflict))
    } else if (plan.autoRotation.getOrElse(false)) {
      Future.successful(Left(ApiKeyRotationConflict))
    } else if (rotationEvery <= gracePeriod) {
      FastFuture.successful(Left(ApiKeyRotationError(Json.obj("error" -> "Rotation period can't ben less or equal to grace period"))))
    } else if (rotationEvery <= 0) {
      FastFuture.successful(Left(ApiKeyRotationError(Json.obj("error" -> "Rotation period can't be less or equal to zero"))))
    } else if (gracePeriod <= 0) {
      FastFuture.successful(Left(ApiKeyRotationError(Json.obj("error" -> "Grace period can't be less or equal to zero"))))
    } else {
      plan.otoroshiTarget.map(_.otoroshiSettings).flatMap { id =>
        tenant.otoroshiSettings.find(_.id == id)
      } match {
        case None => Future.successful(Left(OtoroshiSettingsNotFound))
        case Some(otoSettings) =>
          implicit val otoroshiSettings: OtoroshiSettings = otoSettings

          val r: EitherT[Future, AppError, JsObject] = for {
            apiKey <- EitherT(otoroshiClient.getApikey(subscription.apiKey.clientId))
            _ <- EitherT.liftF(
              otoroshiClient.updateApiKey(apiKey.copy(rotation = Some(ApiKeyRotation(enabled = enabled, rotationEvery = rotationEvery, gracePeriod = gracePeriod)))))
            _ <- EitherT.liftF(
              env.dataStore.apiSubscriptionRepo
                .forTenant(tenant.id)
                .save(subscription.copy(rotation = subscription.rotation.map(r => r.copy(enabled = enabled, rotationEvery = rotationEvery, gracePeriod = gracePeriod))
                  .orElse(Some(ApiSubscriptionRotation(rotationEvery = rotationEvery, gracePeriod = gracePeriod)))))
            )
            updatedSubscription <- EitherT.liftF(
              env.dataStore.apiSubscriptionRepo
                .forTenant(tenant.id)
                .findById(subscription.id)
            )
          } yield Json.obj("subscription" -> updatedSubscription.get.asSafeJson)
          r.value
      }
    }
  }

  def condenseEitherT[F[_], E, A](seq: Seq[EitherT[F, E, A]])(implicit F: Monad[F]): EitherT[F, E, Seq[A]] = {
    seq.foldLeft(EitherT.pure[F, E](Seq.empty[A]))((a, b) => {
      for {
        seq <- a
        value <- b
      } yield seq :+ value
    })
  }

  /**
   * remove a subcription from an aggregation, compute newly aggregation, save it in otoroshi and return new computed otoroshi apikey
   *
   * @param subscription the subscription to extract
   * @param tenant the tenant
   * @param user the user responsible for the extraction
   * @param o the oto settings
   * @return extracted otoroshi apikey (unsaved)
   */
  def extractSubscriptionFromAggregation(subscription: ApiSubscription, tenant: Tenant, user: User)(implicit o: OtoroshiSettings): Future[Either[AppError, ActualOtoroshiApiKey]] = {
    (for {
      //get parent ApiSubscription
      parentSubscriptionId <- EitherT.fromOption[Future](subscription.parent, MissingParentSubscription)
      parentSubscription <- EitherT.fromOptionF(env.dataStore.apiSubscriptionRepo.forTenant(tenant.id).findByIdNotDeleted(parentSubscriptionId), MissingParentSubscription)

      //get otoroshi aggregate apiKey
      oldApiKey <- EitherT(otoroshiClient.getApikey(parentSubscription.apiKey.clientId))

      //get all child subscriptions except subscription to extract
      childsSubscription <- EitherT.liftF(env.dataStore.apiSubscriptionRepo.forTenant(tenant)
        .findNotDeleted(Json.obj("parent" -> parentSubscriptionId.asJson, "_id" -> Json.obj("$ne" -> subscription.id.asJson))))

      //get team
      team <- EitherT.fromOptionF(env.dataStore.teamRepo.forTenant(tenant.id).findById(parentSubscription.team), TeamNotFound)

      //create new OtoroshiApiKey from parent sub
      parentApi <- EitherT.fromOptionF(env.dataStore.apiRepo.forTenant(tenant).findById(parentSubscription.api), AppError.ApiNotFound)
      parentPlan <- EitherT.fromOptionF(env.dataStore.usagePlanRepo.forTenant(tenant)
        .findByIdNotDeleted(parentSubscription.plan), PlanNotFound)
      newParentKey = createOtoroshiApiKey(
        user = user,
        api = parentApi,
        plan = parentPlan,
        team = team,
        tenant = tenant,
        integrationToken = IdGenerator.token(64),
        customMetadata = parentSubscription.customMetadata,
      )

      childsKeys <- condenseEitherT(childsSubscription.map(s => {
        for {
          api <- EitherT.fromOptionF[Future, AppError, Api](env.dataStore.apiRepo.forTenant(tenant).findById(s.api), AppError.ApiNotFound)
          plan <- EitherT.fromOptionF[Future, AppError, UsagePlan](env.dataStore.usagePlanRepo.forTenant(tenant).findById(s.plan), AppError.PlanNotFound)
        } yield createOtoroshiApiKey(
          user = user,
          api = api,
          plan = plan,
          team = team,
          tenant = tenant,
          integrationToken = IdGenerator.token(64),
          customMetadata = s.customMetadata,
        )
      }))

      //get api of subscription to extract
      api <- EitherT.fromOptionF[Future, AppError, Api](env.dataStore.apiRepo.forTenant(tenant).findById(subscription.api), ApiNotFound)

      //get plan of subscription to extract
      plan <- EitherT.fromOptionF[Future, AppError, UsagePlan](env.dataStore.usagePlanRepo.forTenant(tenant).findById(subscription.plan), PlanNotFound)

      //compute new OtoroshiApiKey for subscription to extract
      apikey = createOtoroshiApiKey(
            user = user,
            api = api,
            plan = plan,
            team = team,
            tenant = tenant,
            integrationToken = IdGenerator.token(64),
            customMetadata = subscription.customMetadata,
          )

      //compute new aggregation, copy from old OtoroshiApiKey to keep informations like quotas
      computedMetadata = newParentKey.metadata ++
        childsKeys.foldLeft(Map.empty[String, String])((acc, curr) => acc ++ curr.metadata)
      computedTags = newParentKey.tags ++ childsKeys.foldLeft(Set.empty[String])((acc, curr) => acc ++ curr.tags)

      newAggApiKey <- EitherT.rightT[Future, AppError](oldApiKey.copy(
        authorizedEntities = AuthorizedEntities(
          groups = newParentKey.authorizedEntities.groups ++ childsKeys.foldLeft(Set.empty[OtoroshiServiceGroupId])((acc, curr) => acc ++ curr.authorizedEntities.groups),
          services = newParentKey.authorizedEntities.services ++ childsKeys.foldLeft(Set.empty[OtoroshiServiceId])((acc, curr) => acc ++ curr.authorizedEntities.services),
          routes = newParentKey.authorizedEntities.routes ++ childsKeys.foldLeft(Set.empty[OtoroshiRouteId])((acc, curr) => acc ++ curr.authorizedEntities.routes)),
        tags = computedTags,
        restrictions = ApiKeyRestrictions(
          enabled = newParentKey.restrictions.enabled && childsKeys.foldLeft(false)((acc, curr) => acc && curr.restrictions.enabled),
          allowLast = newParentKey.restrictions.allowLast || childsKeys.foldLeft(true)((acc, curr) => acc || curr.restrictions.allowLast),
          allowed = newParentKey.restrictions.allowed ++ childsKeys.foldLeft(Seq.empty[ApiKeyRestrictionPath])((acc, curr) => acc ++ curr.restrictions.allowed),
          forbidden = newParentKey.restrictions.forbidden ++ childsKeys.foldLeft(Seq.empty[ApiKeyRestrictionPath])((acc, curr) => acc ++ curr.restrictions.forbidden),
          notFound = newParentKey.restrictions.notFound ++ childsKeys.foldLeft(Seq.empty[ApiKeyRestrictionPath])((acc, curr) => acc ++ curr.restrictions.notFound)),
        metadata = computedMetadata +
          ("daikoku__tags" -> computedTags.mkString(" | ")) +
          ("daikoku__metadata" -> computedMetadata.keySet.filterNot(_.startsWith("daikoku_")).mkString(" | "))))

      //save new aggregate in otoroshi
      _ <- EitherT(otoroshiClient.updateApiKey(newAggApiKey))

      //return extracted OtoroshiApiKey
    } yield apikey).value
  }

  def deleteApiSubscriptionsAsFlow(tenant: Tenant, apiOrGroupName: String, user: User): Flow[(UsagePlan, Seq[ApiSubscription]), UsagePlan, NotUsed] = Flow[(UsagePlan, Seq[ApiSubscription])]
    .map { case (plan, subscriptions) =>
      subscriptions.map(subscription => {
        (plan, subscription, Notification(
          id = NotificationId(IdGenerator.token(32)),
          tenant = tenant.id,
          team = Some(subscription.team),
          sender = user.asNotificationSender,
          notificationType = NotificationType.AcceptOnly,
          action = NotificationAction.ApiKeyDeletionInformation(apiOrGroupName, subscription.apiKey.clientId)
        ))
      })
    }
    .flatMapConcat(seq => Source(seq.toList))
    .mapAsync(1) { case (plan, subscription, notification) =>

      def deaggregateSubsAndDelete(subscription: ApiSubscription, childs: Seq[ApiSubscription], subscriberTeam: Team)(implicit otoroshiSettings: OtoroshiSettings) = {
        subscription.parent match {
          case Some(_) => extractSubscriptionFromAggregation(subscription, tenant, user)
            .map(_ => env.dataStore.apiSubscriptionRepo
              .forTenant(tenant.id)
              .deleteByIdLogically(subscription.id))
          //no need to delete key (aggregate is saved and return new key, just we don't save it)
          //just delete subsscription
          case None if childs.nonEmpty =>
            childs match {
              case newParent :: newChilds => for {
                //save new parent by removing link with old parent
                _ <- env.dataStore.apiSubscriptionRepo.forTenant(tenant).save(newParent.copy(parent = None))

                //save other sub from aggregation with link to new parent
                _ <- env.dataStore.apiSubscriptionRepo.forTenant(tenant).updateManyByQuery(
                  Json.obj("_id" -> Json.obj("$in" -> JsArray(newChilds.map(_.id.asJson)))),
                  Json.obj("$set" -> Json.obj("parent" -> newParent.id.asJson)))

                //compute new tags, metadata...
                _ <- otoroshiSynchronisator.verify(Json.obj("_id" -> newParent.id.asJson))
                //delete extracted OtoroshiApiKey into Otoroshi
                //delete extracted subscription
                - <- env.dataStore.apiSubscriptionRepo
                  .forTenant(tenant.id)
                  .deleteByIdLogically(subscription.id)
              } yield ()
            }
          case _ => deleteApiKey(tenant, subscription, plan, subscriberTeam)
        }
      }

      AppLogger.info(s"[DELETE_SUBS] :: plan => ${plan.customName} :: subscription => ${subscription.id}")

      (for {
        otoroshiSettings <- OptionT.fromOption[Future](plan.otoroshiTarget.map(_.otoroshiSettings).flatMap(id => tenant.otoroshiSettings.find(_.id == id)))
        subscriberTeam <- OptionT(env.dataStore.teamRepo.forTenant(tenant).findByIdNotDeleted(subscription.team))
        childs <- OptionT.liftF(env.dataStore.apiSubscriptionRepo.forTenant(tenant).findNotDeleted(Json.obj("parent" -> subscription.id.asJson)))
        _ <- OptionT.liftF(apiKeyStatsJob.syncForSubscription(subscription, tenant, completed = true))
        _ <- OptionT.liftF(deaggregateSubsAndDelete(subscription, childs, subscriberTeam)(otoroshiSettings))
        _ <- subscription.thirdPartySubscriptionInformations match {
          case Some(thirdPartySubscriptionInformations) => OptionT.liftF(env.dataStore.operationRepo.forTenant(tenant)
            .save(Operation(
              DatastoreId(IdGenerator.token(24)),
              tenant = tenant.id,
              itemId = subscription.id.value,
              itemType = ItemType.ThirdPartySubscription,
              action = OperationAction.Delete,
              payload = Json.obj(
                "paymentSettings" -> plan.paymentSettings.map(_.asJson).getOrElse(JsNull).as[JsValue],
                "thirdPartySubscriptionInformations" -> thirdPartySubscriptionInformations.asJson
              ).some
            )))
          case None => OptionT.pure[Future](())
        }
        _ <- OptionT.liftF(env.dataStore.notificationRepo.forTenant(tenant).save(notification))
      } yield ()).value
        .map(_ => plan)
    }

  def deleteUsagePlan(plan: UsagePlan, api: Api, tenant: Tenant, user: User): EitherT[Future, AppError, Api] = {
    val updatedApi = api.copy(possibleUsagePlans = api.possibleUsagePlans.filter(pp => pp != plan.id))
    for {
      _ <- EitherT.liftF(deleteApiPlansSubscriptions(Seq(plan), api, tenant, user))
      _ <- EitherT.liftF(env.dataStore.apiRepo.forTenant(tenant).save(updatedApi))
      _ <- EitherT.liftF(env.dataStore.usagePlanRepo.forTenant(tenant).deleteByIdLogically(plan.id))
      _ <- if(plan.paymentSettings.isDefined) EitherT.liftF[Future, AppError, Boolean](env.dataStore.operationRepo.forTenant(tenant).save(
        Operation(
          DatastoreId(IdGenerator.token(24)),
          tenant = tenant.id,
          itemId = plan.id.value,
          itemType = ItemType.ThirdPartyProduct,
          action = OperationAction.Delete,
          payload = Json.obj(
            "paymentSettings" -> plan.paymentSettings.map(_.asJson).getOrElse(JsNull).as[JsValue],
          ).some
        )
      )) else EitherT.pure[Future, AppError](true)
    } yield updatedApi
  }

  def deleteApiPlansSubscriptions(
                                   plans: Seq[UsagePlan],
                                   api: Api,
                                   tenant: Tenant,
                                   user: User
                                 ): Future[Done] = {
    implicit val mat: Materializer = env.defaultMaterializer

    Source(plans.toList)
      .mapAsync(1)(plan =>
        env.dataStore.apiSubscriptionRepo
          .forTenant(tenant)
          .findNotDeleted(
            Json.obj(
              "api" -> api.id.asJson,
              "plan" -> Json
                .obj("$in" -> JsArray(plans.map(_.id).map(_.asJson)))
            )
          )
          .map(seq => (plan, seq)))
      .via(deleteApiSubscriptionsAsFlow(tenant, api.name, user))
      .runWith(Sink.ignore)
      .recover {
        case e =>
          AppLogger.error(s"Error while deleting api subscriptions", e)
          Done
      }
  }

  def notifyApiSubscription(demand: SubscriptionDemand,
                            tenant: Tenant,
                            step: SubscriptionDemandStep,
                            actualStep: ValidationStep.TeamAdmin): EitherT[Future, AppError, Result] = {
    import cats.implicits._

    val motivationPattern = "\\[\\[(.+?)\\]\\]".r

    for {
      api <- EitherT.fromOptionF(env.dataStore.apiRepo.forTenant(tenant).findByIdNotDeleted(demand.api), AppError.ApiNotFound)
      user <- EitherT.fromOptionF(env.dataStore.userRepo.findByIdNotDeleted(demand.from), AppError.UserNotFound)
      motivationAsString = motivationPattern.findAllMatchIn(actualStep.formatter.getOrElse("[[motivation]]"))
        .foldLeft(actualStep.formatter.getOrElse("[[motivation]]"))((motivation, rgxMatch) => {
          val key = rgxMatch.group(1)
          val replacement = (demand.motivation.getOrElse(Json.obj()) \ key).asOpt[String].getOrElse(s"-- $key --")
          motivation.replace(s"[[$key]]", replacement)
        })
      notification = Notification(
        id = NotificationId(IdGenerator.token(32)),
        tenant = tenant.id,
        team = Some(api.team),
        sender = user.asNotificationSender,
        action = NotificationAction
          .ApiSubscriptionDemand(api.id, demand.plan, demand.team, demand.id, step.id, None, motivationAsString.some)
      )

      tenantLanguage: String = tenant.defaultLanguage.getOrElse("en")
      notificationUrl = env.getDaikokuUrl(tenant, "/notifications")

      _ <- EitherT.liftF(env.dataStore.notificationRepo.forTenant(tenant.id).save(notification))
      apiTeam <- EitherT.fromOptionF(env.dataStore.teamRepo.forTenant(tenant.id).findByIdNotDeleted(api.team), AppError.TeamNotFound)
      admins <- EitherT.liftF(env.dataStore.userRepo
        .findNotDeleted(
          Json.obj(
            "_id" -> Json.obj(
              "$in" -> JsArray(apiTeam.admins().map(_.asJson).toSeq)
            )
          )
        ))
      _ <- EitherT.liftF(Future.sequence(admins.map(admin => {
        implicit val language: String = admin.defaultLanguage.getOrElse(tenantLanguage)
        (for {
          title <- translator.translate("mail.apikey.demand.title", tenant)
          body <- translator.translate(
            "mail.apikey.demand.body",
            tenant,
            Map(
              "user" -> user.name,
              "apiName" -> api.name,
              "link" -> notificationUrl
            )
          )
        } yield {
          tenant.mailer.send(title, Seq(admin.email), body, tenant)
        }).flatten
      })))
    } yield Ok(Json.obj(
      "notificationSended" -> true,
      "creation" -> "waiting",
    ))
  }

  def callHttpRequestStep(step: ValidationStep.HttpRequest, _step: SubscriptionDemandStep, demand: SubscriptionDemand, tenant: Tenant, maybeSessionId: Option[String] = None)
                         (implicit language: String, currentUser: User): EitherT[Future, AppError, Result] = {

    def validStep(response: JsValue): EitherT[Future, AppError, Result] = {
      val customMedata = (response \ "customMetadata").asOpt[JsObject]
      val customMaxPerSecond = (response \ "customMaxPerSecond").asOpt[Long]
      val customMaxPerDay = (response \ "customMaxPerDay").asOpt[Long]
      val customMaxPerMonth = (response \ "customMaxPerMonth").asOpt[Long]
      val customReadOnly = (response \ "customReadOnly").asOpt[Boolean]
      val adminCustomName = (response \ "adminCustomName").asOpt[String]

      for {
        _ <- _step.check()
        updatedDemand = demand.copy(
          steps = demand.steps.map(s => if (s.id == _step.id) s.copy(state = SubscriptionDemandState.Accepted) else s),
          adminCustomName = adminCustomName,
          customMetadata = demand.customMetadata.fold(customMedata)(m =>  (m ++ customMedata.getOrElse(Json.obj())).some),
          customMaxPerSecond = customMaxPerSecond,
          customMaxPerDay = customMaxPerDay,
          customMaxPerMonth = customMaxPerMonth,
          customReadOnly = customReadOnly
        )
        _ <- EitherT.liftF(env.dataStore.subscriptionDemandRepo.forTenant(tenant).save(updatedDemand))
        result <- runSubscriptionProcess(demand.id, tenant, maybeSessionId = maybeSessionId)
      } yield result
    }

    for {
      api <- EitherT.fromOptionF[Future, AppError, Api](env.dataStore.apiRepo.forTenant(tenant).findById(demand.api), AppError.ApiNotFound)
      team <- EitherT.fromOptionF[Future, AppError, Team](env.dataStore.teamRepo.forTenant(tenant).findById(demand.team), AppError.TeamNotFound)
      plan <- EitherT.fromOptionF[Future, AppError, UsagePlan](env.dataStore.usagePlanRepo.forTenant(tenant).findById(demand.plan), AppError.PlanNotFound)
      user <- EitherT.fromOptionF[Future, AppError, User](env.dataStore.userRepo.findById(demand.from), AppError.UserNotFound)
      parentSubscription <- EitherT.liftF[Future, AppError, Option[ApiSubscription]](demand.parentSubscriptionId.fold(Option.empty[ApiSubscription].future)(s => env.dataStore.apiSubscriptionRepo.forTenant(tenant).findById(s)))
      parentApi <- EitherT.liftF[Future, AppError, Option[Api]](parentSubscription.fold[Future[Option[Api]]](FastFuture.successful(None))(s => env.dataStore.apiRepo.forTenant(tenant).findById(s.api)))
      parentPlan <- EitherT.liftF[Future, AppError, Option[UsagePlan]](parentSubscription.fold[Future[Option[UsagePlan]]](FastFuture.successful(None))(s => env.dataStore.usagePlanRepo.forTenant(tenant).findById(s.plan)))
      aggregatedSubs <- EitherT.liftF[Future, AppError, Seq[ApiSubscription]](parentSubscription.fold(FastFuture.successful(Seq.empty[ApiSubscription]))(s => env.dataStore.apiSubscriptionRepo.forTenant(tenant)
        .findNotDeleted(Json.obj("parent" -> s.api.value))))
      aggregatedApis <- EitherT.liftF[Future, AppError, Seq[Api]](env.dataStore.apiRepo.forTenant(tenant)
        .findNotDeleted(Json.obj("_id" -> Json.obj("$in" -> JsArray(aggregatedSubs.map(_.api.asJson))))))
      aggregatedPlan <- EitherT.liftF[Future, AppError, Seq[UsagePlan]](env.dataStore.usagePlanRepo.forTenant(tenant)
        .findNotDeleted(Json.obj("_id" -> Json.obj("$in" -> JsArray(aggregatedSubs.map(_.plan.asJson))))))

       response <- EitherT(env.wsClient.url(step.url)
        .withHttpHeaders(step.headers.toSeq: _*)
        .post(Json.obj(
          "demand" -> demand.asJson,
          "api" -> api.asJson,
          "plan" -> plan.asJson,
          "user" -> user.asJson,
          "team" -> team.asJson,
          "aggregate" -> parentSubscription.fold[JsValue](JsNull)(sub => Json.obj(
            "parent" -> Json.obj(
              "api" -> parentApi.get.asJson,
              "plan" -> parentPlan.get.asJson,
              "subscription" -> sub.asJson
            ),
            "subscriptions" -> aggregatedSubs.map(sub => {
              Json.obj(
                "subscription" -> sub.asJson,
                "api" -> aggregatedApis.find(_.id == sub.api).map(_.asJson).getOrElse(JsNull).as[JsValue],
                "plan" -> aggregatedPlan.find(_.id == sub.plan).map(_.asJson).getOrElse(JsNull).as[JsValue],
              )
            })
          )))).map(resp => {
        val value: Either[AppError, (Boolean, JsValue)] = Try {
          Right(((resp.json \ "accept").as[Boolean], resp.json))
        }.recover(e => {
          AppLogger.error(e.getMessage, e)
          AppLogger.error(s"body ==> ${Json.stringify(resp.json)}")
          Left(AppError.OtoroshiError(Json.obj("error" -> e.getMessage)))
        }).get
        value
      }))

      r <- if (response._1)
        validStep(response._2)
      else
        declineSubscriptionDemand(tenant, demand.id, _step.id, NotificationSender("automatic process", "no-reply@daikoku.io", None), (response._2 \ "message").asOpt[String])
    } yield r
  }

  def runSubscriptionProcess(demandId: SubscriptionDemandId, tenant: Tenant, from: Option[String] = None, maybeSessionId: Option[String] = None)(implicit language: String, currentUser: User): EitherT[Future, AppError, Result] = {
    def runRightProcess(step: SubscriptionDemandStep, demand: SubscriptionDemand, tenant: Tenant): EitherT[Future, AppError, Result] = {

      val run = step.step match {
        case ValidationStep.Email(_, emails, template, _) =>
          val value: EitherT[Future, AppError, Result] = for {
            title <- EitherT.liftF(translator.translate("mail.subscription.validation.title", tenant))
            user <- EitherT.fromOptionF(env.dataStore.userRepo.findByIdNotDeleted(demand.from), AppError.UserNotFound)
            team <- EitherT.fromOptionF(env.dataStore.teamRepo.forTenant(tenant).findByIdNotDeleted(demand.team), AppError.TeamNotFound)
            _ <- EitherT.liftF(Future.sequence(emails.map(email => {
              val stepValidator = StepValidator(
                id = DatastoreId(IdGenerator.token(32)),
                tenant = tenant.id,
                token = IdGenerator.token,
                step = step.id,
                subscriptionDemand = demand.id,
                metadata = Json.obj("email" -> email)
              )

              val cipheredValidationToken = encrypt(env.config.cypherSecret, stepValidator.token, tenant)
              val pathAccept = s"/api/subscription/_validate?token=$cipheredValidationToken"
              val pathDecline = s"/api/subscription/_decline?token=$cipheredValidationToken"

              translator.translate("mail.subscription.validation.body", tenant,
                Map(
                  "urlAccept" -> env.getDaikokuUrl(tenant, pathAccept),
                  "urlDecline" -> env.getDaikokuUrl(tenant, pathDecline),
                  "user" -> user.name,
                  "team" -> team.name,
                  "body" -> template.getOrElse("")
                ))
                .flatMap(body => env.dataStore.stepValidatorRepo.forTenant(tenant).save(stepValidator).map(_ => body))
                .flatMap(body => tenant.mailer.send(title, Seq(email), body, tenant))
            })))
          } yield {
            Ok(Json.obj("creation" -> "waiting"))
          }
          value
        case s: ValidationStep.TeamAdmin => notifyApiSubscription(
          demand = demand,
          step = step,
          tenant = tenant,
          actualStep = s
        )
        case ValidationStep.Payment(_, _, _) => paymentClient.checkoutSubscription(
          tenant = tenant,
          subscriptionDemand = demand,
          step = step,
          from = from
        )
        case s: ValidationStep.HttpRequest => callHttpRequestStep(s, step, demand, tenant)
      }

      val steps = demand.steps.map(s => if (s.id != step.id) s else s.copy(state = SubscriptionDemandState.InProgress))
      val demandState = SubscriptionDemandState.merge(steps.map(_.state))

      for {
        result <- run
        _ <- if (!step.step.isAutomatic) EitherT.liftF[Future, AppError, Boolean](env.dataStore.subscriptionDemandRepo.forTenant(tenant)
          .save(demand.copy(steps = steps, state = demandState))) else EitherT.pure[Future, AppError](true)
      } yield result
    }

    val value: EitherT[Future, AppError, (Option[SubscriptionDemandStep], SubscriptionDemand)] = for {
      demand <- EitherT.fromOptionF(env.dataStore.subscriptionDemandRepo.forTenant(tenant).findByIdNotDeleted(demandId), AppError.SubscriptionDemandNotFound)
      _ <- EitherT.cond[Future][AppError, Unit](!demand.state.isClosed, (), AppError.SubscriptionDemandClosed)
      maybeStep <- EitherT.pure[Future, AppError](demand.steps.find(!_.state.isClosed))
    } yield (maybeStep, demand)

    value
      .flatMap {
        //generate notification to checkout
        case (Some(step), demand) if step.step.name == "payment" && demand.steps.size > 1 && step.state.name == "waiting" =>
              for {
                _ <- EitherT.liftF[Future, AppError, Boolean](env.dataStore.notificationRepo.forTenant(tenant).save(
                  Notification(
                    id = NotificationId(IdGenerator.token(32)),
                    tenant = tenant.id,
                    team = demand.team.some,
                    sender = currentUser.asNotificationSender,
                    date = DateTime.now(),
                    notificationType = NotificationType.AcceptOnly,
                    action = NotificationAction.CheckoutForSubscription(demandId, demand.api, demand.plan, step.id))
                ))
                team <- EitherT.fromOptionF[Future, AppError, Team](env.dataStore.teamRepo.forTenant(tenant).findByIdNotDeleted(demand.team), AppError.TeamNotFound)
                api <- EitherT.fromOptionF[Future, AppError, Api](env.dataStore.apiRepo.forTenant(tenant).findByIdNotDeleted(demand.api), AppError.ApiNotFound)
                plan <- EitherT.fromOptionF[Future, AppError, UsagePlan](env.dataStore.usagePlanRepo.forTenant(tenant).findById(demand.plan), AppError.PlanNotFound)
                maybeAdmins = team.users.filter(_.teamPermission == TeamPermission.Administrator).map(_.userId)
                recipent <- EitherT.liftF[Future, AppError, Seq[User]](env.dataStore.userRepo.find(Json.obj("_id" -> Json.obj("$in" -> maybeAdmins.map(_.asJson)))))
                title <- EitherT.liftF[Future, AppError, String](translator.translate(
                  "mail.checkout.title",
                  tenant,
                  Map.empty))
                body <- EitherT.liftF[Future, AppError, String](translator.translate(
                  "mail.checkout.body",
                  tenant,
                  Map(
                    "api.name" -> api.name,
                    "api.plan" -> plan.customName.getOrElse(plan.typeName),
                    "link" -> env.getDaikokuUrl(tenant, s"/api/subscription/team/${team.id.value}/demands/${demand.id.value}/_run")
                  )))
                _ <- EitherT.liftF[Future, AppError, Unit](tenant.mailer.send(
                  title = title,
                  to = recipent.map(_.email),
                  body = body,
                  tenant = tenant))
              } yield (step.some, demand)
        case tuple =>
          EitherT.pure[Future, AppError](tuple)
      }
      .flatMap {
        case (Some(step), demand) => runRightProcess(step, demand, tenant)
        case (None, demand) => for {
          from <- EitherT.fromOptionF(env.dataStore.userRepo.findByIdNotDeleted(demand.from), AppError.UserNotFound)
          api <- EitherT.fromOptionF(env.dataStore.apiRepo.forTenant(tenant).findByIdNotDeleted(demand.api), AppError.ApiNotFound)
          team <- EitherT.fromOptionF(env.dataStore.teamRepo.forTenant(tenant).findByIdNotDeleted(demand.team), AppError.ApiNotFound)
          plan <- EitherT.fromOptionF[Future, AppError, UsagePlan](env.dataStore.usagePlanRepo.forTenant(tenant).findById(demand.plan), AppError.PlanNotFound)
          maybeSubscriptionInformations <- EitherT.liftF(plan.paymentSettings match {
            case Some(settings) => paymentClient.getSubscription(maybeSessionId, settings, tenant)
            case None => FastFuture.successful(None)
          })
          subscription <- EitherT(subscribeToApi(
            tenant = tenant,
            user = from,
            api = api,
            plan = plan,
            team = team,
            parentSubscriptionId = demand.parentSubscriptionId,
            customMetadata = demand.customMetadata,
            customMaxPerSecond = demand.customMaxPerSecond,
            customMaxPerDay = demand.customMaxPerDay,
            customMaxPerMonth = demand.customMaxPerMonth,
            customReadOnly = demand.customReadOnly,
            adminCustomName = demand.adminCustomName,
            thirdPartySubscriptionInformations = maybeSubscriptionInformations
          ))
          administrators <- EitherT.liftF(
            env.dataStore.userRepo
              .find(
                Json.obj("_deleted" -> false,
                  "_id" -> Json.obj(
                    "$in" -> JsArray(
                      team.users
                        .filter(_.teamPermission == Administrator)
                        .map(_.asJson)
                        .toSeq))))
          )
          _ <- EitherT.liftF(env.dataStore.subscriptionDemandRepo.forTenant(tenant).save(demand.copy(state = SubscriptionDemandState.Accepted)))
          newNotification = Notification(
            id = NotificationId(IdGenerator.token(32)),
            tenant = tenant.id,
            team = Some(team.id),
            sender = currentUser.asNotificationSender,
            notificationType = NotificationType.AcceptOnly,
            action = NotificationAction.ApiSubscriptionAccept(demand.api, demand.plan, team.id)
          )
          _ <- EitherT.liftF(
            env.dataStore.notificationRepo.forTenant(tenant).save(newNotification)
          )
          _ <- EitherT.liftF(
            Future.sequence((administrators ++ Seq(from)).map(admin => {
              implicit val language: String = admin.defaultLanguage.getOrElse(
                tenant.defaultLanguage.getOrElse("en"))
              (for {
                title <- translator.translate("mail.acceptation.title", tenant)
                body <- translator.translate(
                  "mail.api.subscription.acceptation.body",
                  tenant,
                  Map("user" -> from.name, "apiName" -> api.name))
              } yield {
                tenant.mailer.send(title, Seq(admin.email), body, tenant)
              }).flatten
            })))
        } yield Ok(Json.obj("creation" -> "done", "subscription" -> subscription.asSafeJson))
    }
  }


  def _createOrExtendApiKey(tenant: Tenant,
                            apiId: String,
                            planId: String,
                            teamId: String,
                            parentSubscriptionId: Option[ApiSubscriptionId] = None,
                            motivation: Option[JsObject] = None,
                            customMetadata: Option[JsObject],
                            customMaxPerSecond: Option[Long],
                            customMaxPerDay: Option[Long],
                            customMaxPerMonth: Option[Long],
                            customReadOnly: Option[Boolean],
                            adminCustomName: Option[String],
                           )(implicit language: String, currentUser: User) = {
    import cats.implicits._

    def controlApiAndPlan(api: Api): EitherT[Future, AppError, Unit] = {
      if (!api.isPublished) {
        EitherT.leftT[Future, Unit](AppError.ApiNotPublished)
      } else if (api.visibility == ApiVisibility.AdminOnly && !currentUser.isDaikokuAdmin) {
        EitherT.leftT[Future, Unit](AppError.ApiUnauthorized)
      } else {
        EitherT.pure(())
      }
    }

    def controlTeam(team: Team, api: Api, plan: UsagePlan): EitherT[Future, AppError, Unit] = {
      if (!currentUser.isDaikokuAdmin && !team.includeUser(currentUser.id)) {
        EitherT.leftT[Future, Unit](AppError.TeamUnauthorized)
      } else if (team.id != api.team && api.visibility != ApiVisibility.Public && !api.authorizedTeams.contains(team.id)) {
        EitherT.leftT[Future, Unit](AppError.ApiUnauthorized)
      } else if (team.id != api.team && plan.visibility == UsagePlanVisibility.Private && !plan.authorizedTeams.contains(team.id)) {
        EitherT.leftT[Future, Unit](AppError.PlanUnauthorized)
      } else if (tenant.subscriptionSecurity.forall(t => t) && team.`type` == TeamType.Personal) {
        EitherT.leftT[Future, Unit](AppError.SecurityError("Subscription security"))
      } else {
        EitherT.pure(())
      }
    }

    def controlSubscriptionExtension(plan: UsagePlan, team: Team): EitherT[Future, AppError, Unit] = {
      parentSubscriptionId match {
        case Some(subId) =>
          for {
            subscription <- EitherT.fromOptionF(env.dataStore.apiSubscriptionRepo
              .forTenant(tenant)
              .findByIdNotDeleted(subId.value), AppError.SubscriptionNotFound)
            _ <- EitherT.cond[Future][AppError, Unit](subscription.parent.isEmpty, (), AppError.SubscriptionParentExisted)
            _ <- EitherT.cond[Future][AppError, Unit](plan.aggregationApiKeysSecurity.isDefined &&
              plan.aggregationApiKeysSecurity.exists(identity), (), AppError.SecurityError("Subscription Aggregation"))
            _<- EitherT.cond[Future][AppError, Unit](subscription.team == team.id, (), AppError.SubscriptionAggregationTeamConflict)
            parentPlan <- EitherT.fromOptionF(env.dataStore.usagePlanRepo.forTenant(tenant).findById(subscription.plan), AppError.PlanNotFound)
            _ <- EitherT.cond[Future][AppError, Unit](parentPlan.otoroshiTarget
              .map(_.otoroshiSettings) == plan.otoroshiTarget
              .map(_.otoroshiSettings), (), AppError.SubscriptionAggregationOtoroshiConflict)
          } yield ()
        case None => EitherT.pure[Future, AppError](())
      }
    }

    def controlDemand(team: Team, api: Api, plan: UsagePlan): EitherT[Future, AppError,Unit] = {
      plan.allowMultipleKeys match {
        case Some(value) if value => EitherT.pure(())
        case _ => EitherT(env.dataStore.apiSubscriptionRepo.forTenant(tenant).findOneNotDeleted(
          Json.obj(
            "team" -> team.id.asJson,
            "api" -> api.id.asJson,
            "plan" -> plan.id.asJson
          )
        ).map {
          case Some(_) => Left(AppError.SubscriptionConflict)
          case None => Right(())
        })
      }
    }

    val value: EitherT[Future, AppError, Result] = for {
      api <- EitherT.fromOptionF(env.dataStore.apiRepo.forTenant(tenant.id).findByIdNotDeleted(apiId),
        AppError.ApiNotFound)
      plan <- EitherT.fromOptionF[Future, AppError, UsagePlan](env.dataStore.usagePlanRepo.forTenant(tenant).findById(planId),
        AppError.PlanNotFound)
      _ <- controlApiAndPlan(api)
      team <- EitherT.fromOptionF(env.dataStore.teamRepo.forTenant(tenant.id).findByIdNotDeleted(teamId),
        AppError.TeamNotFound)
      _ <- controlTeam(team, api, plan)
      _ <- controlDemand(team, api, plan)
      _ <- controlSubscriptionExtension(plan, team)
      result <- applyProcessForApiSubscription(
        tenant,
        currentUser,
        api,
        plan,
        team,
        parentSubscriptionId,
        motivation,
        customMetadata,
        customMaxPerSecond,
        customMaxPerDay,
        customMaxPerMonth,
        customReadOnly,
        adminCustomName
      )
    } yield result

    value.leftMap(_.render()).merge
  }

  def applyProcessForApiSubscription(
                                      tenant: Tenant,
                                      user: User,
                                      api: Api,
                                      plan: UsagePlan,
                                      team: Team,
                                      apiKeyId: Option[ApiSubscriptionId],
                                      motivation: Option[JsObject],
                                      customMetadata: Option[JsObject],
                                      customMaxPerSecond: Option[Long],
                                      customMaxPerDay: Option[Long],
                                      customMaxPerMonth: Option[Long],
                                      customReadOnly: Option[Boolean],
                                      adminCustomName: Option[String])(implicit language: String): EitherT[Future, AppError, Result] = {
    import cats.implicits._

    plan match {
      case _
        if api.visibility != ApiVisibility.Public && !api.authorizedTeams
          .contains(team.id) && !user.isDaikokuAdmin =>
        EitherT.leftT[Future, Result](ApiUnauthorized)
      case _
        if api.visibility == ApiVisibility.AdminOnly && !user.isDaikokuAdmin =>
        EitherT.leftT[Future, Result](ApiUnauthorized)
      case _
        if plan.visibility == UsagePlanVisibility.Private && api.team != team.id =>
        EitherT.leftT[Future, Result](PlanUnauthorized)
      case _ =>
        plan.subscriptionProcess match {
          case Nil => EitherT(subscribeToApi(tenant, user, api, plan, team, apiKeyId, thirdPartySubscriptionInformations = None))
            .map(s => Ok(Json.obj("creation" -> "done", "subscription" -> s.asSafeJson)))
          case steps =>
            val demanId = SubscriptionDemandId(IdGenerator.token(32))
            for {
              _ <- EitherT.liftF(env.dataStore.subscriptionDemandRepo.forTenant(tenant)
                .save(SubscriptionDemand(
                  id = demanId,
                  tenant = tenant.id,
                  api = api.id,
                  plan = plan.id,
                  state = SubscriptionDemandState.Waiting,
                  steps = steps.map(step => SubscriptionDemandStep(
                    id = SubscriptionDemandStepId(IdGenerator.token),
                    state = SubscriptionDemandState.Waiting,
                    step = step,
                  )),
                  team = team.id,
                  from = user.id,
                  motivation = motivation,
                  parentSubscriptionId = apiKeyId,
                  customMetadata = customMetadata,
                  customMaxPerSecond = customMaxPerSecond,
                  customMaxPerDay = customMaxPerDay,
                  customMaxPerMonth = customMaxPerMonth,
                  customReadOnly = customReadOnly,
                  adminCustomName = adminCustomName
                )))
              result <- runSubscriptionProcess(demanId, tenant)(language, user)
            } yield result
        }
    }
  }

  def declineSubscriptionDemand(tenant: Tenant, demandId: SubscriptionDemandId, stepId: SubscriptionDemandStepId, sender: NotificationSender, maybeMessage: Option[String] = None): EitherT[Future, AppError, Result] = {

    for {
      demand <- EitherT.fromOptionF(env.dataStore.subscriptionDemandRepo.forTenant(tenant)
        .findByIdNotDeleted(demandId), AppError.EntityNotFound("Subscription demand"))
      _ <- EitherT.liftF(env.dataStore.subscriptionDemandRepo.forTenant(tenant).save(demand.copy(
        state = SubscriptionDemandState.Refused,
        steps = demand.steps.map(s => if (s.id == stepId) s.copy(state = SubscriptionDemandState.Refused, metadata = Json.obj("by" -> sender.asJson)) else s)
      )))

      newNotification = Notification(
        id = NotificationId(IdGenerator.token(32)),
        tenant = tenant.id,
        team = demand.team.some,
        sender = sender,
        notificationType = NotificationType.AcceptOnly,
        action = NotificationAction.ApiSubscriptionReject(maybeMessage,
          demand.api,
          demand.plan,
          demand.team)
      )
      _ <- EitherT.liftF(env.dataStore.notificationRepo.forTenant(tenant).save(newNotification))
    } yield Ok(Json.obj("creation" -> "refused"))
  }

}
