package fr.maif.otoroshi.daikoku.ctrls

import akka.NotUsed
import akka.http.scaladsl.util.FastFuture
import akka.stream.Materializer
import akka.stream.scaladsl.{Flow, JsonFraming, Sink, Source}
import akka.util.ByteString
import cats.data.EitherT
import cats.implicits.{catsSyntaxOptionId, toTraverseOps}
import controllers.AppError
import controllers.AppError._
import fr.maif.otoroshi.daikoku.actions.{DaikokuAction, DaikokuActionContext, DaikokuActionMaybeWithGuest}
import fr.maif.otoroshi.daikoku.audit.AuditTrailEvent
import fr.maif.otoroshi.daikoku.ctrls.authorizations.async._
import fr.maif.otoroshi.daikoku.domain.NotificationAction.{ApiAccess, ApiSubscriptionDemand}
import fr.maif.otoroshi.daikoku.domain.UsagePlanVisibility.Private
import fr.maif.otoroshi.daikoku.domain._
import fr.maif.otoroshi.daikoku.domain.json._
import fr.maif.otoroshi.daikoku.env.Env
import fr.maif.otoroshi.daikoku.logger.AppLogger
import fr.maif.otoroshi.daikoku.utils.Cypher.decrypt
import fr.maif.otoroshi.daikoku.utils.RequestImplicits.EnhancedRequestHeader
import fr.maif.otoroshi.daikoku.utils.StringImplicits.BetterString
import fr.maif.otoroshi.daikoku.utils._
import jobs.{ApiKeyStatsJob, OtoroshiVerifierJob}
import org.joda.time.DateTime
import play.api.Logger
import play.api.http.HttpEntity
import play.api.i18n.I18nSupport
import play.api.libs.json._
import play.api.libs.streams.Accumulator
import play.api.mvc._
import reactivemongo.bson.BSONObjectID

import scala.concurrent.Future
import scala.util.{Failure, Success, Try}

class ApiController(
    DaikokuAction: DaikokuAction,
    DaikokuActionMaybeWithGuest: DaikokuActionMaybeWithGuest,
    apiService: ApiService,
    apiKeyStatsJob: ApiKeyStatsJob,
    env: Env,
    otoroshiClient: OtoroshiClient,
    cc: ControllerComponents,
    otoroshiSynchronisator: OtoroshiVerifierJob,
    translator: Translator,
    paymentClient: PaymentClient,
    deletionService: DeletionService
) extends AbstractController(cc)
    with I18nSupport {

  implicit val ec = env.defaultExecutionContext
  implicit val ev = env
  implicit val tr = translator

  val logger = Logger("ApiController")

  def me() =
    DaikokuAction.async { ctx =>
      authorizations.sync.PublicUserAccess(
        AuditTrailEvent("@{user.name} has accessed his own profile")
      )(ctx) {
        ctx.user.asJson
          .transform(
            (JsPath \ "twoFactorAuthentication" \ "secret").json.prune
          ) match {
          case JsSuccess(user, _) => Ok(user)
          case JsError(_)         => Ok(ctx.user.asJson)
        }
      }
    }

  def apiSwagger(teamId: String, apiId: String, version: String) =
    DaikokuActionMaybeWithGuest.async { ctx =>
      UberPublicUserAccess(
        AuditTrailEvent(
          "@{user.name} has accessed swagger of api @{api.name} on team @{team.name}"
        )
      )(ctx) {

        def fetchSwagger(api: Api): Future[Result] = {
          api.swagger match {
            case Some(SwaggerAccess(_, Some(content), _)) =>
              FastFuture.successful(Ok(content).as("application/json"))
            case Some(SwaggerAccess(url, None, headers)) => {
              val finalUrl =
                if (url.startsWith("/")) env.getDaikokuUrl(ctx.tenant, url)
                else url
              Try {
                env.wsClient
                  .url(finalUrl)
                  .withHttpHeaders(headers.toSeq: _*)
                  .get()
                  .map { resp =>
                    Ok(resp.body).as(
                      resp.header("Content-Type").getOrElse("application/json")
                    )
                  }
              }.recover {
                case _: Exception =>
                  FastFuture.successful(
                    BadRequest(Json.obj("error" -> "Can't retrieve swagger"))
                  )
              }.get
            }
            case None =>
              FastFuture.successful(
                NotFound(Json.obj("error" -> "swagger access not found"))
              )
          }
        }

        (ctx.tenant.apiReferenceHideForGuest, ctx.user.isGuest) match {
          case (None, true) =>
            FastFuture.successful(
              Forbidden(
                Json.obj(
                  "error" -> "Tenant is set up for hide api reference for Guest user"
                )
              )
            )
          case (Some(true), true) =>
            FastFuture.successful(
              Forbidden(
                Json.obj(
                  "error" -> "Tenant is set up for hide api reference for Guest user"
                )
              )
            )
          case (_, _) =>
            env.dataStore.teamRepo
              .forTenant(ctx.tenant.id)
              .findByIdOrHrIdNotDeleted(teamId)
              .flatMap {
                case Some(team) =>
                  ctx.setCtxValue("team.name", team.name)
                  env.dataStore.apiRepo
                    .findByVersion(ctx.tenant, apiId, version)
                    .flatMap {
                      case None =>
                        FastFuture.successful(
                          NotFound(Json.obj("error" -> "Api not found"))
                        )
                      case Some(api)
                          if api.visibility == ApiVisibility.Public =>
                        ctx.setCtxValue("api.name", api.name)
                        fetchSwagger(api)
                      case Some(api) if api.team == team.id =>
                        ctx.setCtxValue("api.name", api.name)
                        fetchSwagger(api)
                      case Some(api)
                          if api.visibility != ApiVisibility.Public && api.authorizedTeams
                            .contains(team.id) =>
                        ctx.setCtxValue("api.name", api.name)
                        fetchSwagger(api)
                      case _ =>
                        FastFuture.successful(
                          Unauthorized(
                            Json.obj(
                              "error" -> "You're not authorized on this api",
                              "status" -> 403
                            )
                          )
                        )
                    }
                case None =>
                  FastFuture.successful(
                    NotFound(Json.obj("error" -> "Team not found"))
                  )
              }
        }
      }
    }

  def myTeams() =
    DaikokuActionMaybeWithGuest.async { ctx =>
      UberPublicUserAccess(
        AuditTrailEvent("@{user.name} has accessed his team list")
      )(ctx) {
        env.dataStore.teamRepo
          .myTeams(ctx.tenant, ctx.user)
          .map { teams =>
            Ok(
              JsArray(
                teams
                  .sortWith((a, b) => a.name.compareToIgnoreCase(b.name) < 0)
                  .map(_.asSimpleJson)
              )
            )
          }
      }
    }

  def oneOfMyTeam(teamId: String) =
    DaikokuAction.async { ctx =>
      TeamMemberOnly(
        AuditTrailEvent(
          "@{user.name} has accessed on of his team @{team.name} - @{team.id}"
        )
      )(teamId, ctx) { team =>
        ctx.setCtxValue("team.name", team.name)
        ctx.setCtxValue("team.id", team.id)

        FastFuture.successful(Right(Ok(team.toUiPayload)))
      }
    }

  def myOwnTeam() =
    DaikokuAction.async { ctx =>
      PublicUserAccess(
        AuditTrailEvent(
          s"@{user.name} has accessed its first team on @{tenant.name}"
        )
      )(ctx) {
        env.dataStore.teamRepo
          .forTenant(ctx.tenant.id)
          .findOne(
            Json.obj(
              "_deleted" -> false,
              "type" -> TeamType.Personal.name,
              "users.userId" -> ctx.user.id.asJson
            )
          )
          .map {
            case None => NotFound(Json.obj("error" -> "Team not found"))
            case Some(team) if team.includeUser(ctx.user.id) =>
              Ok(team.asSimpleJson)
            case _ =>
              Unauthorized(
                Json.obj("error" -> "You're not authorized on this team")
              )
          }
      }
    }

  def subscribedApis(teamId: String) =
    DaikokuAction.async { ctx =>
      TeamMemberOnly(AuditTrailEvent(
        s"@{user.name} has accessed the subscribed api list of team @{team.name} - @{team.id}"))(
        teamId,
        ctx) { team =>
        for {
          subscriptions <- env.dataStore.apiSubscriptionRepo
            .forTenant(ctx.tenant.id)
            .findNotDeleted(Json.obj("team" -> team.id.asJson))
          parentSubs <- env.dataStore.apiSubscriptionRepo
            .forTenant(ctx.tenant)
            .findNotDeleted(
              Json.obj(
                "_id" -> Json.obj(
                  "$in" -> subscriptions.flatMap(s => s.parent).map(_.value)
                )))
          apis <- env.dataStore.apiRepo
            .forTenant(ctx.tenant)
            .findNotDeleted(Json.obj("_id" -> Json.obj(
              "$in" -> JsArray((parentSubs ++ subscriptions).map(_.api.asJson))
            )))
        } yield {
          Right(Ok(JsArray(apis.map(_.asJson))))
        }
      }
    }

  def getTeamVisibleApis(teamId: String, apiId: String, version: String) =
    DaikokuAction.async { ctx =>
      import cats.implicits._
      TeamMemberOnly(
        AuditTrailEvent(
          s"@{user.name} is accessing team @{team.name} visible api @{api.name} ($version)"
        )
      )(teamId, ctx) { team =>
        val r: EitherT[Future, Result, Result] = for {
          api <- EitherT.fromOptionF(
            env.dataStore.apiRepo.findByVersion(ctx.tenant, apiId, version),
            NotFound(Json.obj("error" -> "Api not found"))
          )
          apiPlans <- EitherT.liftF(env.dataStore.usagePlanRepo.forTenant(ctx.tenant)
            .findNotDeleted(Json.obj("_id" -> Json.obj("$in" -> JsArray(api.possibleUsagePlans.map(_.asJson))))))
          pendingRequests <- if (api.team == team.id)
            EitherT.liftF(FastFuture.successful(Seq.empty[Notification]))
          else if (!ctx.user.isDaikokuAdmin && api.visibility != ApiVisibility.Public && !api.authorizedTeams
                     .contains(team.id))
            EitherT.leftT[Future, Seq[Notification]](
              Unauthorized(
                Json.obj(
                  "error" -> "You're not authorized on this api",
                  "status" -> 403
                )
              )
            )
          else
            EitherT.liftF(
              env.dataStore.notificationRepo
                .forTenant(ctx.tenant.id)
                .findNotDeleted(
                  Json.obj(
                    "action.type" -> "ApiSubscription",
                    "status.status" -> "Pending",
                    "action.api" -> api.id.asJson,
                    "action.team" -> team.id.value
                  )
                )
            )
          subscriptions <- EitherT.liftF(
            env.dataStore.apiSubscriptionRepo
              .forTenant(ctx.tenant.id)
              .findNotDeleted(
                Json.obj("api" -> api.id.value, "team" -> team.id.value)
              )
          )
        } yield {
          val betterApis = api.asSimpleJson.as[JsObject] ++ Json.obj(
            "possibleUsagePlans" -> JsArray(
              apiPlans.map(p => p.asJson.as[JsObject] ++ Json.obj(
                "otoroshiTarget" -> p.otoroshiTarget.isDefined
              )))
          ) ++ Json.obj(
            "pendingRequestPlan" -> JsArray(
              pendingRequests.map(r =>
                r.action.asInstanceOf[ApiSubscriptionDemand].plan.asJson)
            )
          ) ++ Json.obj(
            "subscriptions" -> JsArray(subscriptions.map(_.asSimpleJson))
          )
          ctx.setCtxValue("api.name", api.name)
          ctx.setCtxValue("team.name", team.name)
          Ok(betterApis)
        }

        r.value.map(_.merge).map(Right(_)) }
    }

  def getApi(api: Api, ctx: DaikokuActionContext[AnyContent]) = {
    import cats.implicits._

    def control(myTeams: Seq[Team]): EitherT[Future, AppError, Unit] = {
      if ((api.visibility == ApiVisibility.Public || ctx.user.isDaikokuAdmin || (api.authorizedTeams :+ api.team)
        .intersect(myTeams.map(_.id))
        .nonEmpty) && (api.isPublished || myTeams.exists(_.id == api.team))) {
        EitherT.pure[Future, AppError](())
      } else {
        EitherT.leftT[Future, Unit](AppError.ApiUnauthorized)
      }
    }

    for {
      myTeams <- EitherT.liftF[Future, AppError, Seq[Team]](env.dataStore.teamRepo.myTeams(ctx.tenant, ctx.user))
      _ <- control(myTeams)
      pendingRequests <- EitherT.liftF[Future, AppError, Seq[Notification]](
        env.dataStore.notificationRepo
          .forTenant(ctx.tenant.id)
          .findNotDeleted(
            Json.obj(
              "action.type" -> "ApiSubscription",
              "status.status" -> "Pending",
              "action.api" -> api.id.asJson,
              "action.team" -> Json
                .obj("$in" -> JsArray(myTeams.map(_.id.asJson)))
            )
          )
      )
      subscriptions <- EitherT.liftF[Future, AppError, Seq[ApiSubscription]](
        env.dataStore.apiSubscriptionRepo
          .forTenant(ctx.tenant.id)
          .findNotDeleted(
            Json.obj(
              "api" -> api.id.value,
              "team" -> Json.obj("$in" -> JsArray(myTeams.map(_.id.asJson)))
            )
          )
      )
    } yield {
      val betterApi = api
        .asJson
        .as[JsObject] ++ Json.obj(
        "pendingRequests" -> JsArray(
          pendingRequests.map(_.asJson)
        )
      ) ++ Json.obj(
        "subscriptions" -> JsArray(subscriptions.map(_.asSimpleJson))
      )
      ctx.setCtxValue("api.name", api.name)

      if (ctx.tenant.apiReferenceHideForGuest
        .getOrElse(true) && ctx.user.isGuest) betterApi - "swagger"
      else betterApi

    }
  }

  def getVisibleApiWithId(apiId: String) =
    DaikokuActionMaybeWithGuest.async { ctx =>
      UberPublicUserAccess(
        AuditTrailEvent("@{user.name} is accessing visible api @{api.name}")
      )(ctx) {

        (for {
          api <- EitherT.fromOptionF(env.dataStore.apiRepo
            .forTenant(ctx.tenant)
            .findByIdOrHrId(apiId), AppError.ApiNotFound)
          betterApi <- getApi(api, ctx)
        } yield {
          ctx.setCtxValue("api.name", api.name)
          Ok(betterApi)
        })
          .leftMap(_.render())
          .merge
      }
    }

  def getVisiblePlan(apiId: String, version: String, planId: String) =
    DaikokuActionMaybeWithGuest.async { ctx =>
      UberPublicUserAccess(
        AuditTrailEvent("@{user.name} is accessing visible plan @{plan.id} -- @{api.name}/@{plan.name}")
      )(ctx) {

        def control(api: Api, myTeams: Seq[Team], plan: UsagePlan): EitherT[Future, AppError, Unit] = {
          if ((api.visibility == ApiVisibility.Public || ctx.user.isDaikokuAdmin || (api.authorizedTeams :+ api.team)
            .intersect(myTeams.map(_.id))
            .nonEmpty) && (api.isPublished || myTeams.exists(_.id == api.team))) {

            if (plan.visibility == UsagePlanVisibility.Public || ctx.user.isDaikokuAdmin || (plan.authorizedTeams :+ api.team)
              .intersect(myTeams.map(_.id))
              .nonEmpty) {
              EitherT.pure[Future, AppError](())
            } else {
              EitherT.leftT[Future, Unit](AppError.PlanUnauthorized)
            }
          } else {
            EitherT.leftT[Future, Unit](AppError.ApiUnauthorized)
          }
        }

        (for {
          api <- EitherT.fromOptionF(env.dataStore.apiRepo.findByVersion(ctx.tenant, apiId, version), AppError.ApiNotFound)
          plan <- EitherT.fromOptionF(env.dataStore.usagePlanRepo.forTenant(ctx.tenant).findById(planId), AppError.PlanNotFound)
          myTeams <- EitherT.liftF(env.dataStore.teamRepo.myTeams(ctx.tenant, ctx.user))
          _ <- control(api, myTeams, plan)
        } yield {
          ctx.setCtxValue("plan.id", plan.id.value)
          ctx.setCtxValue("aip.name", api.id.value)
          ctx.setCtxValue("plan.name", plan.customName.getOrElse(plan.typeName))
          Ok(plan.asJson)
        })
          .leftMap(_.render())
          .merge
      }
    }

  def getVisiblePlans(apiId: String, version: String) =
    DaikokuActionMaybeWithGuest.async { ctx =>
      UberPublicUserAccess(
        AuditTrailEvent("@{user.name} is accessing visible plans of @{api.name}")
      )(ctx) {

        def controlAndGet(api: Api, myTeams: Seq[Team], plans: Seq[UsagePlan]): EitherT[Future, AppError, Seq[UsagePlan]] = {
          if ((api.visibility == ApiVisibility.Public || ctx.user.isDaikokuAdmin || (api.authorizedTeams :+ api.team)
            .intersect(myTeams.map(_.id))
            .nonEmpty) && (api.isPublished || myTeams.exists(_.id == api.team))) {



            val filteredPlans = plans.filter(plan => plan.visibility == UsagePlanVisibility.Public || ctx.user.isDaikokuAdmin || (plan.authorizedTeams :+ api.team)
              .intersect(myTeams.map(_.id))
              .nonEmpty)
            EitherT.pure[Future, AppError](filteredPlans)
          } else {
            EitherT.leftT[Future, Seq[UsagePlan]](AppError.ApiUnauthorized)
          }
        }

        (for {
          api <- EitherT.fromOptionF[Future, AppError, Api](env.dataStore.apiRepo.findByVersion(ctx.tenant, apiId, version), AppError.ApiNotFound)
          plans <- EitherT.liftF[Future, AppError, Seq[UsagePlan]](env.dataStore.usagePlanRepo.findByApi(ctx.tenant.id, api))
          myTeams <- EitherT.liftF[Future, AppError, Seq[Team]](env.dataStore.teamRepo.myTeams(ctx.tenant, ctx.user))
          filteredPlans <- controlAndGet(api, myTeams, plans)
        } yield {
          ctx.setCtxValue("api.name", api.name)
          Ok(json.SeqUsagePlanFormat.writes(filteredPlans))
        })
          .leftMap(_.render())
          .merge
      }
    }

  def getVisibleApi(humanReadableId: String, version: String) =
    DaikokuActionMaybeWithGuest.async { ctx =>
      UberPublicUserAccess(
        AuditTrailEvent("@{user.name} is accessing visible api @{api.name}")
      )(ctx) {
        (for {
          api <- EitherT.fromOptionF(env.dataStore.apiRepo
            .findByVersion(ctx.tenant, humanReadableId, version), AppError.ApiNotFound)
          betterApi <- getApi(api, ctx)
        } yield {
          ctx.setCtxValue("api.name", api.name)
          Ok(betterApi)
        })
          .leftMap(_.render())
          .merge
      }
    }

  def getDocumentationPage(apiId: String, pageId: String) =
    DaikokuActionMaybeWithGuest.async { ctx =>
      UberPublicUserAccess(
        AuditTrailEvent(
          s"@{user.name} has accessed documentation page for @{api.name} - @{api.id} - $pageId"
        )
      )(ctx) {
        env.dataStore.apiRepo
          .forTenant(ctx.tenant.id)
          .findByIdNotDeleted(apiId)
          .flatMap {
            case None => AppError.ApiNotFound.renderF()
            case Some(api) =>
              ctx.setCtxValue("api.id", api.id.value)
              ctx.setCtxValue("api.name", api.name)
              env.dataStore.apiDocumentationPageRepo
                .forTenant(ctx.tenant.id)
                .findByIdOrHrId(pageId)
                .map {
                  case None => AppError.PageNotFound.render()
                  case Some(page) =>
                    api.documentation match {
                      case doc if !doc.docIds().contains(page.id.value) =>
                        AppError.PageNotFound.render()
                      case doc if page.remoteContentEnabled =>
                        //Ok(page.asWebUiJson.as[JsObject] ++ Json.obj("contentUrl" -> s"/api/apis/$apiId/pages/$pageId/content"))
                        val url: String = page.remoteContentUrl.getOrElse(
                          s"/api/apis/$apiId/pages/$pageId/content"
                        )
                        Ok(
                          page.asWebUiJson
                            .as[JsObject] ++ Json.obj("contentUrl" -> url)
                        )
                      case doc => Ok(page.asWebUiJson)
                    }
                }
          }
      }
    }

  private val extensions: Map[String, String] = Map(
    ".adoc" -> "text/asciidoc",
    ".avi" -> "video/x-msvideo",
    ".doc" -> "application/msword",
    ".docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".gif" -> "image/gif",
    ".html" -> "text/html",
    ".jpg" -> "image/jpeg",
    ".md" -> "text/markdown",
    ".mpeg" -> "video/mpeg",
    ".odp" -> "application/vnd.oasis.opendocument.presentation",
    ".ods" -> "application/vnd.oasis.opendocument.spreadsheet",
    ".odt" -> "application/vnd.oasis.opendocument.text",
    ".png" -> "image/png",
    ".pdf" -> "application/pdf",
    ".webm" -> "video/webm",
    ".css" -> "text/css",
    ".js" -> "text/javascript"
  ).map(t => (t._2, t._1))

  def getDocumentationPageRemoteContent(apiId: String, pageId: String) =
    DaikokuActionMaybeWithGuest.async { ctx =>
      import fr.maif.otoroshi.daikoku.utils.RequestImplicits._

      import scala.concurrent.duration._

      UberPublicUserAccess(
        AuditTrailEvent(
          s"@{user.name} has accessed documentation page remote content for @{api.name} - @{api.id} - $pageId"
        )
      )(ctx) {
        env.dataStore.apiRepo
          .forTenant(ctx.tenant.id)
          .findByIdNotDeleted(apiId)
          .flatMap {
            case None =>
              FastFuture.successful(
                NotFound(Json.obj("error" -> "Api not found"))
              )
            case Some(api) =>
              ctx.setCtxValue("api.id", api.id)
              ctx.setCtxValue("api.name", api.name)
              env.dataStore.apiDocumentationPageRepo
                .forTenant(ctx.tenant.id)
                .findByIdOrHrId(pageId)
                .flatMap {
                  case None =>
                    FastFuture.successful(
                      NotFound(Json.obj("error" -> "Page not found"))
                    )
                  case Some(page) =>
                    api.documentation match {
                      case doc
                          if doc.pages.contains(
                            page.id
                          ) && page.remoteContentEnabled => {
                        val disposition =
                          ("Content-Disposition" -> s"""attachment; filename="content${extensions
                            .getOrElse(page.contentType, ".txt")}"""")
                        var url = page.remoteContentUrl
                          .getOrElse(
                            "https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf"
                          )
                        if (url.startsWith("/")) {
                          val host = ctx.request.headers
                            .get("Otoroshi-Proxied-Host")
                            .orElse(ctx.request.headers.get("X-Forwarded-Host"))
                            .getOrElse(ctx.request.host)
                          url = s"${ctx.request.theProtocol}://${host}$url"
                        }
                        if (url.contains("?")) {
                          url = s"$url&sessionId=${ctx.session.sessionId.value}"
                        } else {
                          url = s"$url?sessionId=${ctx.session.sessionId.value}"
                        }
                        logger.info(s"Calling document url $url")
                        env.wsClient
                          .url(url)
                          .withMethod("GET")
                          .withRequestTimeout(30.seconds)
                          .withHttpHeaders(page.remoteContentHeaders.toSeq: _*)
                          .stream()
                          .map { r =>
                            Status(r.status)
                              .sendEntity(
                                HttpEntity.Streamed(
                                  r.bodyAsSource,
                                  r.header("Content-Length").map(_.toLong),
                                  r.header("Content-Type")
                                )
                              )
                              .withHeaders(
                                r.headers.view.mapValues(_.head).toSeq: _*
                              )
                              .as(page.contentType) //r.header("Content-Type").getOrElse(page.contentType))
                          }
                      }
                      case _ =>
                        FastFuture.successful(
                          NotFound(Json.obj("error" -> "Page not found"))
                        )
                    }
                }
          }
      }
    }

  private def getDocumentationDetailsImpl(
      tenant: Tenant,
      apiId: String,
      version: String
  ): Future[Either[JsValue, JsValue]] = {
    env.dataStore.apiRepo
      .findByVersion(tenant, apiId, version)
      .flatMap {
        case None => FastFuture.successful(Left(AppError.ApiNotFound.toJson()))
        case Some(api) =>
          val doc = api.documentation
          env.dataStore.apiDocumentationPageRepo
            .forTenant(tenant.id)
            .findWithProjection(
              Json.obj(
                "_deleted" -> false,
                "_id" -> Json
                  .obj("$in" -> JsArray(doc.docIds().map(JsString.apply)))
              ),
              Json.obj(
                "_id" -> true,
                "_humanReadableId" -> true,
                "title" -> true,
                "lastModificationAt" -> true
              )
            )
            .map { list =>
              val pages: Seq[JsObject] = api.documentation
                .docIds()
                .map(pageId => list.find(o => (o \ "_id").as[String] == pageId))
                .collect {
                  case Some(e) => e
                }
              Right(
                Json.obj(
                  "pages" -> SeqApiDocumentationDetailPageFormat
                    .writes(api.documentation.pages),
                  "titles" -> JsArray(pages)
                )
              )
            }
      }
  }

  def getRootApi(apiId: String) =
    DaikokuActionMaybeWithGuest.async { ctx =>
      UberPublicUserAccess(
        AuditTrailEvent(s"@{user.name} has requested root api @{api.id}")
      )(ctx) {
        env.dataStore.apiRepo
          .forTenant(ctx.tenant.id)
          .findOne(
            Json.obj(
              "_humanReadableId" -> apiId,
              "parent" -> JsNull
            )
          )
          .map {
            case None      => AppError.render(ApiNotFound)
            case Some(api) => Ok(ApiFormat.writes(api))
          }
      }
    }

  def getDocumentationDetails(apiId: String, version: String) =
    DaikokuActionMaybeWithGuest.async { ctx =>
      UberPublicUserAccess(
        AuditTrailEvent(
          s"@{user.name} has accessed documentation details for @{api.id}"
        )
      )(
        ctx
      ) {
        ctx.setCtxValue("api.id", apiId)
        getDocumentationDetailsImpl(ctx.tenant, apiId, version).map {
          case Left(r)  => NotFound(r)
          case Right(r) => Ok(r)
        }
      }
    }

  case class subscriptionData(
      apiKey: OtoroshiApiKey,
      plan: UsagePlanId,
      team: TeamId,
      api: ApiId
  )

  def byteStringToApiSubscription: Flow[ByteString, subscriptionData, NotUsed] =
    Flow[ByteString]
      .via(JsonFraming.objectScanner(Int.MaxValue))
      .map(_.utf8String)
      .filterNot(_.isEmpty)
      .map(Json.parse)
      .map(value =>
        subscriptionData(
          apiKey = (value \ "apikey").as(OtoroshiApiKeyFormat),
          plan = (value \ "plan").as(UsagePlanIdFormat),
          team = (value \ "team").as(TeamIdFormat),
          api = (value \ "api").as(ApiIdFormat)
      ))

  val sourceApiSubscriptionsDataBodyParser
    : BodyParser[Source[subscriptionData, _]] =
    BodyParser("Streaming BodyParser") { req =>
      req.contentType match {
        case Some("application/json") =>
          Accumulator
            .source[ByteString]
            .map(s => Right(s.via(byteStringToApiSubscription)))
        case _ =>
          Accumulator.source[ByteString].map(_ => Left(UnsupportedMediaType))
      }
    }

  def initSubscriptions() =
    DaikokuAction.async(sourceApiSubscriptionsDataBodyParser) { ctx =>
      TenantAdminOnly(
        AuditTrailEvent(
          s"@{user.name} has init an apikey for @{api.name} - @{api.id}"
        )
      )(ctx.tenant.id.value, ctx) { (tenant, _) =>
        val parallelism = 10;
        val subSource = ctx.request.body
          .map(
            data =>
              ApiSubscription(
                id = ApiSubscriptionId(BSONObjectID.generate().stringify),
                tenant = tenant.id,
                apiKey = data.apiKey,
                plan = data.plan,
                createdAt = DateTime.now(),
                team = data.team,
                api = data.api,
                by = ctx.user.id,
                customName = Some(data.apiKey.clientName),
                rotation = None,
                integrationToken = IdGenerator.token(64)
            ))

        val createSubFlow: Flow[ApiSubscription, ApiSubscription, NotUsed] =
          Flow[ApiSubscription]
            .mapAsync(10)(
              sub =>
                env.dataStore.apiSubscriptionRepo
                  .forTenant(tenant.id)
                  .save(sub)
                  .map(done => sub -> done))
            .filter(_._2)
            .map(_._1)

        val source = subSource
          .via(createSubFlow)

        val transformFlow = Flow[ApiSubscription]
          .map(_.apiKey.clientName)
          .map(json => ByteString(Json.stringify(JsString(json))))
          .intersperse(ByteString("["), ByteString(","), ByteString("]"))
          .watchTermination() { (mt, d) =>
            d.onComplete {
              case Success(done) =>
                AppLogger.debug(
                  s"init subscirptions for tenant ${tenant.id.value} is $done"
                )
              case Failure(exception) =>
                AppLogger.error("Error processing stream", exception)
            }
            mt
          }

        FastFuture.successful(
          Created.sendEntity(
            HttpEntity.Streamed(
              source.via(transformFlow),
              None,
              Some("application/json")
            )
          )
        )
      }
    }

  def byteStringToApi: Flow[ByteString, Api, NotUsed] =
    Flow[ByteString]
      .via(JsonFraming.objectScanner(Int.MaxValue))
      .map(_.utf8String)
      .filterNot(_.isEmpty)
      .map(Json.parse)
      .map(value => json.ApiFormat.reads(value))
      .filterNot(_.isError)
      .map(_.get)

  val sourceApiBodyParser: BodyParser[Source[Api, _]] =
    BodyParser("Streaming BodyParser") { req =>
      req.contentType match {
        case Some("application/json") =>
          Accumulator.source[ByteString].map(s => Right(s.via(byteStringToApi)))
        case _ =>
          Accumulator.source[ByteString].map(_ => Left(UnsupportedMediaType))
      }
    }

  def initApis() =
    DaikokuAction.async(sourceApiBodyParser) { ctx =>
      TenantAdminOnly(AuditTrailEvent(s"@{user.name} has init apis"))(
        ctx.tenant.id.value,
        ctx
      ) { (_, _) =>
        {
          val source = ctx.request.body
            .filter(api => api.tenant == ctx.tenant.id)
            .grouped(10)
            .alsoTo(
              Sink.foreach(seq =>
                AppLogger.debug(s"${seq.length} apis process"))
            )
            .flatMapConcat(seq => {
              Source(seq)
                .mapAsync(10) { api =>
                  env.dataStore.apiRepo
                    .forTenant(ctx.tenant.id)
                    .save(api)
                    .map { done =>
                      Json.obj("name" -> api.name, "done" -> done)
                    }
                }
            })
            .map(json => ByteString(Json.stringify(json)))
            .intersperse(ByteString("["), ByteString(","), ByteString("]"))
            .watchTermination() { (mt, d) =>
              d.onComplete {
                case Success(done) => AppLogger.debug(s"$done")
                case Failure(exception) =>
                  AppLogger.error("Error processing stream", exception)
              }
              mt
            }

          FastFuture.successful(
            Created.sendEntity(
              HttpEntity.Streamed(source, None, Some("application/json"))
            )
          )
        }
      }
    }

  def getBodyField[T](body: JsValue, fieldName: String)(implicit fjs: Reads[T]): Option[T] = body
    .asOpt[JsObject]
    .flatMap(o => (o \ fieldName).asOpt[T])

  def extendApiKey(apiId: String, planId: String, teamId: String, apiKeyId: String) =

    DaikokuAction.async(parse.json) { ctx =>
      PublicUserAccess(
        AuditTrailEvent(
          s"@{user.name} has asked for an apikey extension for @{api.name} - @{api.id}"
        )
      )(ctx) {
        import fr.maif.otoroshi.daikoku.utils.RequestImplicits._

        implicit val language: String = ctx.request.getLanguage(ctx.tenant)
        implicit val currentUser: User = ctx.user

        val motivation = ctx.request.body.getBodyField[String]("motivation")
        val customMaxPerSecond = ctx.request.body.getBodyField[Long]("customMaxPerSecond")
        val customMaxPerDay = ctx.request.body.getBodyField[Long]("customMaxPerDay")
        val customMaxPerMonth = ctx.request.body.getBodyField[Long]("customMaxPerMonth")
        val customReadOnly = ctx.request.body.getBodyField[Boolean]("customReadOnly")
        val customMetadata = ctx.request.body.getBodyField[JsObject]("customMetadata")

        apiService._createOrExtendApiKey(
          tenant = ctx.tenant,
          apiId = apiId,
          planId = planId,
          teamId = teamId,
          customMetadata = customMetadata,
          customMaxPerSecond = customMaxPerSecond,
          customMaxPerDay = customMaxPerDay,
          customMaxPerMonth = customMaxPerMonth,
          customReadOnly = customReadOnly,
          motivation = motivation,
          parentSubscriptionId = Some(ApiSubscriptionId(apiKeyId))
        )
      }
    }

  def askForApiKey(apiId: String, planId: String, teamId: String) =
    DaikokuAction.async(parse.json) { ctx =>
      PublicUserAccess(
        AuditTrailEvent(
          s"@{user.name} has asked for an apikey for @{api.name} - @{api.id}"
        )
      )(ctx) {
        import fr.maif.otoroshi.daikoku.utils.RequestImplicits._

        implicit val language: String = ctx.request.getLanguage(ctx.tenant)
        implicit val currentUser: User = ctx.user

        val motivation = ctx.request.body.getBodyField[String]("motivation")
        val customMaxPerSecond = ctx.request.body.getBodyField[Long]("customMaxPerSecond")
        val customMaxPerDay = ctx.request.body.getBodyField[Long]("customMaxPerDay")
        val customMaxPerMonth = ctx.request.body.getBodyField[Long]("customMaxPerMonth")
        val customReadOnly = ctx.request.body.getBodyField[Boolean]("customReadOnly")
        val customMetadata = ctx.request.body.getBodyField[JsObject]("customMetadata")

        apiService._createOrExtendApiKey(
          tenant = ctx.tenant,
          apiId = apiId,
          planId = planId,
          teamId = teamId,
          customMetadata = customMetadata,
          customMaxPerSecond = customMaxPerSecond,
          customMaxPerDay = customMaxPerDay,
          customMaxPerMonth = customMaxPerMonth,
          customReadOnly = customReadOnly,
          motivation = motivation)
      }
    }

  def validateProcess() = DaikokuActionMaybeWithGuest.async { ctx =>
    UberPublicUserAccess(
      AuditTrailEvent(s"Subscription process has been validated by @{validator.name}"))(ctx) {
      import fr.maif.otoroshi.daikoku.utils.RequestImplicits._
      implicit val language: String = ctx.request.getLanguage(ctx.tenant)
      implicit val currentUser: User = ctx.user

      val maybeSessionId = ctx.request.getQueryString("session_id")


      (for {
        encryptedToken <- EitherT.fromOption[Future](ctx.request.getQueryString("token"), AppError.EntityNotFound("token from query"))
        token <- EitherT.pure[Future, AppError](decrypt(env.config.cypherSecret, encryptedToken, ctx.tenant))
        validator <- EitherT.fromOptionF(env.dataStore.stepValidatorRepo.forTenant(ctx.tenant)
          .findOneNotDeleted(Json.obj("token" -> token)), AppError.EntityNotFound("token"))

        _ <- validateProcessWithStepValidator(validator, ctx.tenant, maybeSessionId)
      } yield if (ctx.user.isGuest) Ok(
        views.html.response(
          None,
          ctx.request.domain,
          env,
          ctx.tenant)) else Redirect(s"/apis"))
        .leftMap(error => Ok(
          views.html.response(
            error.getErrorMessage().some,
            ctx.request.domain,
            env,
            ctx.tenant))).merge
    }
  }

  def abortProcess() = DaikokuAction.async { ctx =>
    UberPublicUserAccess(
      AuditTrailEvent(s"Subscription process has been refused by @{validator.name}"))(ctx) {
      implicit val c = ctx
      (for {
        encryptedToken <- EitherT.fromOption[Future](ctx.request.getQueryString("token"), AppError.EntityNotFound("token from query"))
        token <- EitherT.pure[Future, AppError](decrypt(env.config.cypherSecret, encryptedToken, ctx.tenant))
        validator <- EitherT.fromOptionF(env.dataStore.stepValidatorRepo.forTenant(ctx.tenant)
          .findOneNotDeleted(Json.obj("token" -> token)), AppError.EntityNotFound("token"))
        _ <- EitherT.liftF[Future, AppError, Boolean](env.dataStore.stepValidatorRepo.forTenant(ctx.tenant).deleteByIdLogically(validator.id))
      } yield Redirect("/apis"))
        .leftMap(_.render())
        .merge
    }
  }

  def declineProcess() = DaikokuActionMaybeWithGuest.async { ctx =>
    UberPublicUserAccess(
      AuditTrailEvent(s"Subscription process has been refused by @{validator.name}"))(ctx) {
      implicit val c = ctx
      //todo: get validator name
      (for {
        encryptedToken <- EitherT.fromOption[Future](ctx.request.getQueryString("token"), AppError.EntityNotFound("token from query"))
        token <- EitherT.pure[Future, AppError](decrypt(env.config.cypherSecret, encryptedToken, ctx.tenant))
        validator <- EitherT.fromOptionF(env.dataStore.stepValidatorRepo.forTenant(ctx.tenant)
          .findOneNotDeleted(Json.obj("token" -> token)), AppError.EntityNotFound("token"))
        _ <- declineProcessWithStepValidator(validator, ctx.tenant)
      } yield Ok(
        views.html.response(
          None,
          ctx.request.domain,
          env,
          ctx.tenant))).leftMap(error => Ok(
        views.html.response(
          error.getErrorMessage().some,
          ctx.request.domain,
          env,
          ctx.tenant))).merge
    }
  }

  def runProcess(teamId: String, demandId: String) = DaikokuAction.async { ctx =>
    TeamMemberOnly( AuditTrailEvent(s"Subscription process for demand @{demand.id} has been re-run by @{user.name}"))(teamId, ctx) { team =>
      ctx.setCtxValue("demand.id", demandId)
      implicit val language: String = ctx.request.getLanguage(ctx.tenant)
      implicit val currentUser: User = ctx.user

      val from = env.getDaikokuUrl(
        ctx.tenant,
        s"/${team.humanReadableId}/settings"
      )

      (for {
        demand <- EitherT.fromOptionF(env.dataStore.subscriptionDemandRepo.forTenant(ctx.tenant).findByIdNotDeleted(demandId), AppError.EntityNotFound("Subscription demand"))
        result <- apiService.runSubscriptionProcess(demand.id, ctx.tenant, from.some)
      } yield result).value
    }
  }

  def cancelProcess(teamId: String, demandId: String) = DaikokuAction.async { ctx =>
    TeamAdminOnly(AuditTrailEvent(s"Subscription process for demand @{demand.id} has been canceled by @{user.name}"))(teamId, ctx){ team =>

      ctx.setCtxValue("demand.id", demandId)

      (for {
        demand <- EitherT.fromOptionF[Future, AppError, SubscriptionDemand](env.dataStore.subscriptionDemandRepo.forTenant(ctx.tenant).findByIdNotDeleted(demandId), AppError.EntityNotFound("Subscription demand"))
        _ <- EitherT.liftF[Future, AppError, Boolean](env.dataStore.subscriptionDemandRepo.forTenant(ctx.tenant).deleteById(demand.id))
        _ <- EitherT.liftF[Future, AppError, Boolean](env.dataStore.stepValidatorRepo.forTenant(ctx.tenant).delete(Json.obj("subscriptionDemand" -> demand.id.asJson)))
      } yield Ok(Json.obj("done" -> true)))
        .leftMap(_.render())
        .merge
    }
  }

  private def validateProcessWithStepValidator(validator: StepValidator, tenant: Tenant, maybeSessionId: Option[String] = None)(implicit language: String, currentUser: User) = {
    for {
      demand <- EitherT.fromOptionF(env.dataStore.subscriptionDemandRepo.forTenant(tenant)
        .findByIdNotDeleted(validator.subscriptionDemand), AppError.EntityNotFound("Subscription demand Validator"))
      _ <- EitherT.fromOptionF(env.dataStore.teamRepo.forTenant(tenant)
        .findByIdNotDeleted(demand.team), AppError.TeamNotFound)
      _ <- EitherT.fromOptionF(env.dataStore.apiRepo.forTenant(tenant).findByIdNotDeleted(demand.api), AppError.ApiNotFound)
      step <- EitherT.fromOption[Future](demand.steps.find(_.id == validator.step), AppError.EntityNotFound("Validation Step"))
      _ <- step.check()
      updatedDemand = demand.copy(steps = demand.steps.map(s => if (s.id == step.id) s.copy(state = SubscriptionDemandState.Accepted) else s))
      _ <- EitherT.liftF(env.dataStore.subscriptionDemandRepo.forTenant(tenant).save(updatedDemand))
      _ <- EitherT.liftF(env.dataStore.notificationRepo.forTenant(tenant)
        .updateManyByQuery(Json.obj(
          "action.type" -> "CheckoutForSubscription",
          "action.demand" -> demand.id.asJson,
          "action.step" -> step.id.asJson
        ), Json.obj(
          "$set" -> Json.obj("status" -> json.NotificationStatusFormat.writes(NotificationStatus.Accepted()))
        )))
      result <- apiService.runSubscriptionProcess(demand.id, tenant, maybeSessionId = maybeSessionId)
      _ <- EitherT.liftF[Future, AppError, Boolean](env.dataStore.stepValidatorRepo.forTenant(tenant).deleteById(validator.id))
    } yield result
  }

  private def declineProcessWithStepValidator(validator: StepValidator, tenant: Tenant): EitherT[Future, AppError, Unit] = {
    for {
      demand <- EitherT.fromOptionF(env.dataStore.subscriptionDemandRepo.forTenant(tenant)
        .findByIdNotDeleted(validator.subscriptionDemand), AppError.EntityNotFound("Subscription demand Validator"))
      _ <- EitherT.fromOptionF(env.dataStore.apiRepo.forTenant(tenant).findByIdNotDeleted(demand.api), AppError.ApiNotFound)
      step <- EitherT.fromOption[Future](demand.steps.find(_.id == validator.step), AppError.EntityNotFound("Validation Step"))
      _ <- step.check()
      _ <- apiService.declineSubscriptionDemand(tenant, demand.id, step.id, NotificationSender((validator.metadata \ "email").as[String], (validator.metadata \ "email").as[String], None))
    } yield ()
  }

  def getMyTeamsApiSubscriptions(apiId: String, version: String) =
    DaikokuActionMaybeWithGuest.async { ctx =>
      UberPublicUserAccess(
        AuditTrailEvent(
          s"@{user.name} has accessed subscriptions for @{api.name} - @{api.id}"
        )
      )(ctx) {
        def findSubscriptions(api: Api, teams: Seq[Team]): Future[Result] = {
          for {
            subscriptions <- env.dataStore.apiSubscriptionRepo
              .forTenant(ctx.tenant.id)
              .findNotDeleted(
                Json.obj(
                  "api" -> api.id.value,
                  "team" -> Json.obj("$in" -> JsArray(teams.map(_.id.asJson)))
                )
              )
            pendingRequests <- env.dataStore.subscriptionDemandRepo.
              forTenant(ctx.tenant)
              .findNotDeleted(Json.obj(
                "api" -> api.id.asJson,
                "team" -> Json.obj("$in" -> JsArray(teams.map(_.id.asJson))),
                "state" -> SubscriptionDemandState.InProgress.name
            ))
          } yield {
            Ok(
              Json.obj(
                "subscriptions" -> JsArray(
                  subscriptions
                    .map(subscription => {
                      val apiKeyVisible = teams
                        .find(_.id == subscription.team)
                        .exists(authorizations.isTeamApiKeyVisible(_, ctx.user))

                      if (apiKeyVisible) {
                        subscription.asJson
                      } else {
                        subscription.asJson.as[JsObject] - "apiKey"
                      }
                    })
                ),
                "requests" -> JsArray(pendingRequests.map(_.asJson))
              )
            )
          }
        }

        env.dataStore.teamRepo
          .myTeams(ctx.tenant, ctx.user)
          .flatMap(myTeams => {
            env.dataStore.apiRepo
              .findByVersion(ctx.tenant, apiId, version)
              .flatMap {
                case None =>
                  FastFuture
                    .successful(NotFound(Json.obj("error" -> "Api not found")))
                case Some(api)
                    if api.visibility == ApiVisibility.Public || api.authorizedTeams
                      .intersect(myTeams.map(_.id))
                      .nonEmpty || myTeams.exists(t => t.id == api.team) =>
                  ctx.setCtxValue("api.name", api.name)
                  ctx.setCtxValue("api.id", api.id.value)
                  findSubscriptions(api, myTeams)
                case _ =>
                  FastFuture.successful(
                    Unauthorized(
                      Json.obj(
                        "error" -> "You're not authorized on this api",
                        "status" -> 401
                      )
                    )
                  )
              }
          })
      }
    }

  def updateApiSubscriptionCustomName(teamId: String, subscriptionId: String) =
    DaikokuAction.async(parse.json) { ctx =>
      TeamApiKeyAction(
        AuditTrailEvent(
          s"@{user.name} has update custom name for subscription @{subscription._id}"
        )
      )(teamId, ctx) { _ =>
        val customName =
          (ctx.request.body.as[JsObject] \ "customName").as[String].trim
        env.dataStore.apiSubscriptionRepo
          .forTenant(ctx.tenant)
          .findOneNotDeleted(
            Json.obj("_id" -> subscriptionId, "team" -> teamId)
          )
          .flatMap {
            case None =>
              FastFuture.successful(
                NotFound(Json.obj("error" -> "apiSubscription not found"))
              )
            case Some(subscription) =>
              val updatedSubscription = subscription.copy(customName = Some(customName))
              env.dataStore.apiSubscriptionRepo
                .forTenant(ctx.tenant)
                .save(updatedSubscription)
                .map(_ => Ok(updatedSubscription.asSafeJson))
          }
      }
    }

  def updateApiSubscription(teamId: String, subscriptionId: String) =
    DaikokuAction.async(parse.json) { ctx =>
      TeamAdminOnly(
        AuditTrailEvent(
          s"@{user.name} has updated subscription for @{subscription.id}"
        )
      )(teamId, ctx) { team =>
        val body = ctx.request.body.as[JsObject]
        (for {
          subscription <- EitherT.fromOptionF(env.dataStore.apiSubscriptionRepo
            .forTenant(ctx.tenant)
            .findByIdNotDeleted(subscriptionId), AppError.SubscriptionNotFound)
          _ <- EitherT.fromOptionF(env.dataStore.apiRepo.forTenant(ctx.tenant)
            .findOne(Json.obj("_id" -> subscription.api.asJson, "team" -> team.id.asJson)), AppError.ForbiddenAction)
          plan <- EitherT.fromOptionF(env.dataStore.usagePlanRepo.forTenant(ctx.tenant).findById(subscription.plan), AppError.ApiNotFound)
          subToSave = subscription.copy(
            customMetadata = (body \ "customMetadata").asOpt[JsObject],
            customMaxPerSecond =
              (body \ "customMaxPerSecond").asOpt[Long],
            customMaxPerDay = (body \ "customMaxPerDay").asOpt[Long],
            customMaxPerMonth =
              (body \ "customMaxPerMonth").asOpt[Long],
            customReadOnly = (body \ "customReadOnly").asOpt[Boolean]
          )
          result <- EitherT(apiService.updateSubscription(ctx.tenant, subToSave, plan))
        } yield Ok(result))
          .leftMap(_.render())
          .merge
      }
    }

  def getApiSubscriptionsForTeam(
      apiId: String,
      teamId: String,
      version: String,
      plan: Option[String]
  ) =
    DaikokuAction.async { ctx =>
      TeamApiKeyAction(
        AuditTrailEvent(
          s"@{user.name} has accessed subscriptions for @{api.name} - @{api.id}"
        )
      )(teamId, ctx) { team =>
        val teamPermission = team.users
          .find(u => u.userId == ctx.user.id)
          .map(_.teamPermission)
          .getOrElse(TeamPermission.TeamUser)

        val repo = env.dataStore.apiSubscriptionRepo
          .forTenant(ctx.tenant.id)

        def subscriptionToJson(
            api: Api,
            plan: UsagePlan,
            sub: ApiSubscription,
            parentSub: Option[ApiSubscription]
        ): Future[JsValue] = {
          val name: String = plan.customName.getOrElse(plan.typeName)
          val r = sub
            .asAuthorizedJson(
              teamPermission,
              plan.integrationProcess,
              ctx.user.isDaikokuAdmin
            )
            .as[JsObject] ++
            Json.obj("planType" -> plan.typeName) ++
            Json.obj("planName" -> name) ++
            Json.obj("apiName" -> api.name) ++
            Json.obj("_humanReadableId" -> api.humanReadableId) ++
            Json.obj("parentUp" -> false)

          sub.parent match {
            case None => FastFuture.successful(r)
            case Some(parentId) =>
              parentSub match {
                case Some(parent) =>
                  FastFuture.successful(
                    r ++ Json.obj("parentUp" -> parent.enabled)
                  )
                case None =>
                  env.dataStore.apiSubscriptionRepo
                    .forTenant(ctx.tenant.id)
                    .findById(parentId.value)
                    .map {
                      case None    => r
                      case Some(p) => r ++ Json.obj("parentUp" -> p.enabled)
                    }
              }

          }
        }

        def findSubscriptions(api: Api, team: Team, planId: Option[String]): Future[Result] = {

          ctx.setCtxValue("api.name", api.name)
          ctx.setCtxValue("api.id", api.id.value)
          val jsonResearch = {planId match {
            case Some(_) =>
              Json.obj("api" -> api.id.value, "team" -> team.id.value,"plan" -> planId)
            case None =>
              Json.obj("api" -> api.id.value, "team" -> team.id.value)
          }}

          repo.findNotDeleted(jsonResearch)
            .flatMap { subscriptions =>
              repo.findNotDeleted(
                Json.obj("parent" -> Json.obj("$in" -> subscriptions.map(s =>
                  s.id.value))))
                .flatMap { subs =>
                  Future
                    .sequence(
                      (subscriptions ++ subs)
                        .map(sub => {
                          (sub.parent match {
                            case Some(_) =>
                              env.dataStore.apiRepo
                                .forTenant(ctx.tenant.id)
                                .findByIdNotDeleted(sub.api.value)
                            case None => FastFuture.successful(Some(api))
                          }).flatMap {
                            case Some(api) =>
                              env.dataStore.usagePlanRepo.forTenant(ctx.tenant)
                                .findByIdNotDeleted(sub.plan)
                                .flatMap {
                                  case None => FastFuture.successful(Json.obj()) //FIXME
                                  case Some(plan) => subscriptionToJson(
                                    api = api,
                                    plan = plan,
                                    sub = sub,
                                    parentSub = sub.parent.flatMap(p =>
                                      subscriptions.find(s => s.id == p)
                                    )
                                  )
                                }

                            case None => FastFuture.successful(Json.obj())
                          }
                        })
                    )
                    .map(values => Ok(JsArray(values)))
                }
            }
        }

        env.dataStore.apiRepo
          .findByVersion(ctx.tenant, apiId, version)
          .flatMap {
            case None => AppError.ApiNotFound.renderF()
            case Some(api)
                if ctx.user.isDaikokuAdmin || api.visibility == ApiVisibility.Public =>
              findSubscriptions(api, team, plan)
            case Some(api) if api.team == team.id =>
              findSubscriptions(api, team, plan)
            case Some(api)
                if api.visibility != ApiVisibility.Public && api.authorizedTeams
                  .contains(team.id) =>
              findSubscriptions(api, team, plan)
            case _ => AppError.ApiUnauthorized.renderF()
          }
      }
    }

  def getSubscriptionsOfTeam(teamId: String) =
    DaikokuAction.async { ctx =>
      TeamApiKeyAction(
        AuditTrailEvent(
          s"@{user.name} has accessed subscriptions of team : - $teamId"
        )
      )(teamId, ctx) { team =>
        val teamPermission = team.users
          .find(u => u.userId == ctx.user.id)
          .map(_.teamPermission)
          .getOrElse(TeamPermission.TeamUser)

        for {
          subscriptions <- env.dataStore.apiSubscriptionRepo
            .forTenant(ctx.tenant.id)
            .findNotDeleted(Json.obj("team" -> team.id.value))
          parentSubs <- env.dataStore.apiSubscriptionRepo
            .forTenant(ctx.tenant)
            .findNotDeleted(
              Json.obj(
                "_id" -> Json.obj(
                  "$in" -> JsArray(
                    subscriptions.flatMap(s => s.parent).map(_.asJson))
                )))
          apis <- env.dataStore.apiRepo
            .forTenant(ctx.tenant)
            .findNotDeleted(
              Json.obj("_id" -> Json.obj(
                "$in" -> JsArray((subscriptions ++ parentSubs).map(_.api.asJson))
              )))
          plans <- env.dataStore.usagePlanRepo.forTenant(ctx.tenant)
            .findNotDeleted(Json.obj("_id" -> Json.obj("$in" -> JsArray(apis.flatMap(_.possibleUsagePlans).map(_.asJson)))))
        } yield {
          Ok(
            JsArray(subscriptions
              .map(sub => {
                val api = apis.find(a => a.id == sub.api)
                val planIntegrationProcess = plans
                  .find(p => p.id == sub.plan)
                  .map(_.integrationProcess)
                  .getOrElse(IntegrationProcess.Automatic)

                val apiName: String = api.map(_.name).getOrElse("")
                sub
                  .asAuthorizedJson(
                    teamPermission,
                    planIntegrationProcess,
                    ctx.user.isDaikokuAdmin
                  )
                  .as[JsObject] ++
                  plans.find(p => p.id == sub.plan)
                    .map(plan => Json.obj("planType" -> plan.typeName))
                    .getOrElse(Json.obj("planType" -> "")) ++ Json.obj(
                  "apiName" -> apiName)
              })))
        }
      }
    }

  def getSubscriptionInformations(teamId: String, subscriptionId: String) =
    DaikokuAction.async { ctx =>
      TeamAdminOnly(
        AuditTrailEvent(
          s"@{user.name} has accessed to plan informations for subscription @{subscriptionId}"
        )
      )(teamId, ctx) { team =>
        ctx.setCtxValue("subscriptionId", subscriptionId)

        val r: EitherT[Future, AppError, Result] = for {
          subscription <- EitherT.fromOptionF(env.dataStore.apiSubscriptionRepo
            .forTenant(ctx.tenant.id)
            .findOneNotDeleted(Json.obj("_id" -> subscriptionId, "team" -> team.id.asJson)), AppError.SubscriptionNotFound)
          api <- EitherT.fromOptionF[Future, AppError, Api] (env.dataStore.apiRepo
          .forTenant(ctx.tenant.id)
          .findById(subscription.api), AppError.ApiNotFound)
          plan <- EitherT.fromOptionF[Future, AppError, UsagePlan](env.dataStore.usagePlanRepo.forTenant(ctx.tenant).findById(subscription.plan), AppError.PlanNotFound)
        } yield Ok(
          Json.obj(
            "api" -> api.asSimpleJson,
            "subscription" -> subscription.asSimpleJson,
            "plan" -> plan.asJson
          )
        )

        r
          .leftMap(_.render())
          .merge
      }
    }

  def toggleApiSubscription(
      teamId: String,
      subscriptionId: String,
      enabled: Option[Boolean]
  ) =
    DaikokuAction.async { ctx =>
      TeamApiKeyAction(
        AuditTrailEvent(
          s"@{user.name} has @{action} api subscription @{subscription.id} of @{team.name} - @{team.id}"
        )
      )(teamId, ctx) { team =>
        ctx.setCtxValue("@action", if (enabled.getOrElse(false)) "disabled" else "enabled")

        apiSubscriptionAction(
          ctx.tenant,
          team,
          subscriptionId,
          (_: Api, plan: UsagePlan, subscription: ApiSubscription) => {
            ctx.setCtxValue("subscription", subscription)
            subscription.parent match {
              case Some(_) => FastFuture.successful(Left(ForbiddenAction))
              case None =>
                toggleSubscription(
                  plan,
                  subscription,
                  ctx.tenant,
                  enabled.getOrElse(false)
                )
            }
          }
        )
      }
    }

  def makeUniqueSubscription(teamId: String, subscriptionId: String) =
    DaikokuAction.async { ctx =>
      TeamApiKeyAction(
        AuditTrailEvent(
          s"@{user.name} has made unique aggregate api subscription @{subscription.id} of @{team.name} - @{team.id}"
        )
      )(teamId, ctx) { team =>
        apiSubscriptionAction(
          ctx.tenant,
          team,
          subscriptionId,
          (api: Api, plan: UsagePlan, subscription: ApiSubscription) => {
            subscription.parent match {
              case None =>
                EitherT.leftT[Future, JsObject](MissingParentSubscription).value
              case Some(parentSubscriptionId) =>
                plan.otoroshiTarget.map(_.otoroshiSettings).flatMap { id =>
                  ctx.tenant.otoroshiSettings.find(_.id == id)
                } match {
                  case None =>
                    FastFuture.successful(Left(OtoroshiSettingsNotFound))
                  case Some(otoroshiSettings) =>
                    implicit val o: OtoroshiSettings = otoroshiSettings
                    import cats.implicits._
                    (for {
                      apikey <- EitherT(
                        apiService.extractSubscriptionFromAggregation(
                          subscription,
                          ctx.tenant,
                          ctx.user
                        )
                      )
                      createdApiKey <- EitherT(
                        otoroshiClient.createApiKey(apikey)(o))
                      _ <- EitherT.right[AppError](
                        env.dataStore.apiSubscriptionRepo
                          .forTenant(ctx.tenant.id)
                          .save(
                            subscription.copy(
                              parent = None,
                              metadata = Some(
                                JsObject(
                                  apikey.metadata
                                    .filterNot(i => i._1.startsWith("daikoku_"))
                                    .view
                                    .mapValues(i => JsString(i))
                                    .toSeq
                                )
                              ),
                              apiKey = subscription.apiKey.copy(
                                clientId = createdApiKey.clientId,
                                clientSecret = createdApiKey.clientSecret,
                                clientName = createdApiKey.clientName
                              )
                            )
                          )
                      )
                    } yield {
                      Json.obj("created" -> true)
                    }).value
                }
            }
          }
        )
      }
    }

  def toggleApiSubscriptionByApiOwner(
      teamId: String,
      subscriptionId: String,
      enabled: Option[Boolean]
  ) =
    DaikokuAction.async { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(
          s"@{user.name} has archived api subscription @{subscription.id} of @{team.name} - @{team.id}"
        )
      )(teamId, ctx) { team =>
        import cats.implicits._

        (for {
          sub <- EitherT.fromOptionF[Future, AppError, ApiSubscription](env.dataStore.apiSubscriptionRepo
            .forTenant(ctx.tenant)
            .findByIdOrHrIdNotDeleted(subscriptionId), AppError.SubscriptionNotFound)
          api <- EitherT.fromOptionF[Future, AppError, Api](env.dataStore.apiRepo
            .forTenant(ctx.tenant)
            .findOneNotDeleted(Json.obj("_id" -> sub.api.asJson, "team" -> team.id.asJson)), AppError.ApiNotFound)
          plan <- EitherT.fromOptionF[Future, AppError, UsagePlan](env.dataStore.usagePlanRepo.forTenant(ctx.tenant)
          .findById(sub.plan), AppError.PlanNotFound)
          result <- EitherT(toggleSubscription(
            plan,
            sub,
            ctx.tenant,
            enabled.getOrElse(false)
          ))
        } yield Ok(result))
          .leftMap(_.render())
          .merge
      }
    }

  def toggleApiKeyRotation(teamId: String, subscriptionId: String) =
    DaikokuAction.async(parse.json) { ctx =>
      TeamApiKeyAction(
        AuditTrailEvent(
          s"@{user.name} has toggle api subscription rotation @{subscription.id} of @{team.name} - @{team.id}"
        )
      )(teamId, ctx) { team =>
        apiSubscriptionAction(
          ctx.tenant,
          team,
          subscriptionId,
          (api: Api, plan: UsagePlan, subscription: ApiSubscription) => {
            ctx.setCtxValue("subscription", subscription)
            val enabled =
              (ctx.request.body.as[JsObject] \ "enabled").as[Boolean]
            val rotationEvery =
              (ctx.request.body.as[JsObject] \ "rotationEvery").as[Long]
            val gracePeriod =
              (ctx.request.body.as[JsObject] \ "gracePeriod").as[Long]
            apiService.toggleApiKeyRotation(
              ctx.tenant,
              subscription,
              plan,
              api,
              enabled,
              rotationEvery,
              gracePeriod
            )
          }
        )
      }
    }

  def regenerateApiKeySecret(teamId: String, subscriptionId: String) =
    DaikokuAction.async { ctx =>
      TeamApiKeyAction(
        AuditTrailEvent(
          s"@{user.name} has regenerate apikey secret @{subscription.id} of @{team.name} - @{team.id}"
        )
      )(teamId, ctx) { team =>
        apiSubscriptionAction(
          ctx.tenant,
          team,
          subscriptionId,
          (api: Api, plan: UsagePlan, subscription: ApiSubscription) => {
            ctx.setCtxValue("subscription", subscription)
            apiService.regenerateApiKeySecret(
              ctx.tenant,
              subscription,
              plan,
              api,
              team,
              ctx.user
            )
          }
        )
      }
    }

  def deleteApiSubscription(teamId: String, subscriptionId: String) =
    DaikokuAction.async { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(
          s"@{user.name} has deleted api subscription @{subscription.id} of @{team.name} - @{team.id}"
        )
      )(teamId, ctx) { team =>
        apiSubscriptionAction(
          ctx.tenant,
          team,
          subscriptionId,
          (api: Api, plan: UsagePlan, subscription: ApiSubscription) => {
            ctx.setCtxValue("subscription", subscription)

            for {
              _ <- apiKeyStatsJob.syncForSubscription(subscription, ctx.tenant)
              notif = Notification(
                id = NotificationId(BSONObjectID.generate().stringify),
                tenant = ctx.tenant.id,
                team = Some(subscription.team),
                sender = ctx.user.asNotificationSender,
                notificationType = NotificationType.AcceptOnly,
                action = NotificationAction.ApiKeyDeletionInformation(api.name, subscription.apiKey.clientId)
              )
              _ <- env.dataStore.notificationRepo.forTenant(ctx.tenant).save(notif)
              delete <- apiService
                .deleteApiKey(ctx.tenant, subscription, plan, team)
                .flatMap(delete => {
                  if (plan.visibility == Private) {
                    env.dataStore.usagePlanRepo
                      .forTenant(ctx.tenant)
                      .save(plan.removeAuthorizedTeam(team.id))
                      .map(_ => delete)
                  } else {
                    FastFuture.successful(delete)
                  }
                })
            } yield delete
          }
        )
      }
    }

  private def apiSubscriptionAction(
      tenant: Tenant,
      team: Team,
      subscriptionId: String,
      action: (
          Api,
          UsagePlan,
          ApiSubscription
      ) => Future[Either[AppError, JsObject]]
  ) = {
    import cats.implicits._

    (for {
      subscription <- EitherT.fromOptionF[Future, AppError, ApiSubscription](env.dataStore.apiSubscriptionRepo
        .forTenant(tenant)
        .findOneNotDeleted(Json.obj("_id" -> subscriptionId, "team" -> team.id.asJson)), AppError.SubscriptionNotFound)
      api <- EitherT.fromOptionF[Future, AppError, Api](env.dataStore.apiRepo
        .forTenant(tenant)
        .findByIdNotDeleted(subscription.api), AppError.ApiNotFound)
      plan <- EitherT.fromOptionF[Future, AppError, UsagePlan](env.dataStore.usagePlanRepo
        .forTenant(tenant)
        .findOneNotDeleted(Json.obj("_id" -> subscription.plan.asJson)), AppError.PlanNotFound)
      result <- EitherT(action(api, plan, subscription))
    } yield Ok(result))
      .leftMap(_.render())
      .merge

  }

  def toggleSubscription(
      plan: UsagePlan,
      subscription: ApiSubscription,
      tenant: Tenant,
      enabled: Boolean
  ): Future[Either[AppError, JsObject]] = {
    for {
      _ <- apiKeyStatsJob.syncForSubscription(subscription, tenant)
      delete <- apiService.archiveApiKey(tenant, subscription, plan, enabled)
    } yield delete
  }

  def cleanArchivedSubscriptions(teamId: String) =
    DaikokuAction.async { ctx =>
      TeamAdminOnly(
        AuditTrailEvent(
          s"@{user.name} has cleaned api subscription of @{team.name} - @{team.id}"
        )
      )(teamId, ctx) { team =>
        for {
          subRepo <- env.dataStore.apiSubscriptionRepo.forTenantF(ctx.tenant)
          archivedSubs <- subRepo.findNotDeleted(
            Json.obj("team" -> team.id.asJson, "enabled" -> false))
          _ <- env.dataStore.apiSubscriptionRepo
            .forTenant(ctx.tenant)
            .deleteLogically(
              Json.obj("team" -> team.id.asJson, "enabled" -> false))
        } yield {
          Ok(
            Json.obj(
              "done" -> true,
              "apiSubscriptions" -> JsArray(archivedSubs.map(_.id.asJson))
            ))
        }
      }
    }

  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  def apiOfTeam(teamId: String, apiId: String, version: String) =
    DaikokuAction.async { ctx =>
      CommonServices
        .apiOfTeam(teamId, apiId, version)(ctx, env, ec)
        .map {
          case Right(api)    => Ok(api.api.asJson.as[JsObject] ++ api.translation)
          case Left(error) => AppError.render(error)
        }
    }

  def apisOfTeam(teamId: String) =
    DaikokuAction.async { ctx =>
      TeamMemberOnly(
        AuditTrailEvent(
          s"@{user.name} has accessed apis of team @{team.name} - @{team.id}")
      )(teamId, ctx) { team =>
        env.dataStore.apiRepo
          .forTenant(ctx.tenant.id)
          .findNotDeleted(
            Json.obj(
              "team" -> team.id.value
            )
          )
          .map { apis =>
            Right(Ok(JsArray(apis.map(_.asJson))))
          }
      }
    }

  def checkApiNameUniqueness(
      id: Option[String],
      name: String,
      tenant: TenantId
  ): Future[Boolean] = {
    val apiRepo = env.dataStore.apiRepo.forTenant(tenant)
    val maybeHumanReadableId = name.urlPathSegmentSanitized

    id match {
      case Some(value) =>
        apiRepo
          .findByIdNotDeleted(value)
          .flatMap {
            case None =>
              apiRepo
                .exists(Json.obj("_humanReadableId" -> maybeHumanReadableId))
            case Some(api) =>
              val v = api.parent match {
                case Some(parent) => parent.value
                case None         => value
              }
              apiRepo
                .exists(
                  Json.obj(
                    "parent" -> JsNull,
                    "_humanReadableId" -> maybeHumanReadableId,
                    "_id" -> Json.obj("$ne" -> v)
                  )
                )
          }
      case None =>
        apiRepo
          .exists(
            Json.obj(
              "parent" -> JsNull,
              "_humanReadableId" -> maybeHumanReadableId
            )
          )
    }
  }

  def verifyNameUniqueness() =
    DaikokuAction.async(parse.json) { ctx =>
      PublicUserAccess(
        AuditTrailEvent(
          s"@{user.name} is checking if api name (@{api.name}) is unique"
        )
      )(ctx) {
        val name = (ctx.request.body.as[JsObject] \ "name")
          .asOpt[String]
          .map(_.toLowerCase.trim)
          .getOrElse("")
        val id =
          (ctx.request.body.as[JsObject] \ "id").asOpt[String].map(_.trim)
        ctx.setCtxValue("api.name", name)

        checkApiNameUniqueness(id, name, ctx.tenant.id)
          .map(exists => Ok(Json.obj("exists" -> exists)))
      }
    }

  def getAllApiDocumentation(teamId: String, apiId: String, version: String) =
    DaikokuAction.async { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(
          s"@{user.name} has requested all pages of @{api.name} - @{team.id}"
        )
      )(teamId, ctx) { team =>
        {
          env.dataStore.apiRepo
            .forTenant(ctx.tenant.id)
            .find(
              Json.obj(
                "_humanReadableId" -> apiId,
                "currentVersion" -> Json.obj("$ne" -> version)
              )
            )
            .flatMap(apis =>
              Future.sequence(apis.map { api =>
                env.dataStore.apiDocumentationPageRepo
                  .forTenant(ctx.tenant.id)
                  .find(
                    Json.obj(
                      "_id" -> Json.obj(
                        "$in" -> JsArray(
                          api.documentation.docIds().map(JsString.apply)
                        )
                      )
                    )
                  )
                  .map { pages =>
                    Json.obj(
                      "currentVersion" -> api.currentVersion.value,
                      "apiId" -> api.id.asJson,
                      "pages" -> pages.map(
                        page =>
                          Json.obj(
                            "_id" -> page.id.asJson,
                            "title" -> JsString(page.title)
                        ))
                    )
                  }
              }))
            .map(v => Ok(JsArray(v)))
        }
      }
    }

  def cloneDocumentation(teamId: String, apiId: String, version: String) =
    DaikokuAction.async(parse.json) { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(
          s"@{user.name} has imported pages from $version in @{api.name} @{team.id}"
        )
      )(teamId, ctx) { _ =>
        {
          val pages = (ctx.request.body \ "pages").as[Seq[JsObject]]

          (for {
            fromPages <- env.dataStore.apiDocumentationPageRepo
              .forTenant(ctx.tenant.id)
              .find(
                Json.obj(
                  "_id" -> Json.obj(
                    "$in" -> JsArray(
                      pages.map(page => (page \ "pageId").as[JsString])
                    )
                  )
                )
              )
            createdPages <- Future.sequence(fromPages.map(page => {
              val generatedId = ApiDocumentationPageId(BSONObjectID.generate().stringify)
              env.dataStore.apiDocumentationPageRepo
                .forTenant(ctx.tenant.id)
                .save(page.copy(id = generatedId))
                .flatMap(_ =>
                  FastFuture.successful(
                    ApiDocumentationDetailPage(generatedId, page.title, Seq.empty)
                ))
            }))
            api <- env.dataStore.apiRepo.findByVersion(ctx.tenant,
                                                       apiId,
                                                       version)
          } yield {
            api match {
              case None => FastFuture.successful(AppError.render(ApiNotFound))
              case Some(api) =>
                env.dataStore.apiRepo
                  .forTenant(ctx.tenant.id)
                  .save(
                    api.copy(documentation = api.documentation
                      .copy(pages = api.documentation.pages ++ createdPages))
                  )
                  .map(_ => Ok(Json.obj("cloned" -> true)))
            }
          }).flatten
        }
      }
    }

  def askForApiAccess(apiId: String) =
    DaikokuAction.async(parse.json) { ctx =>
      val teamIds: Seq[String] = (ctx.request.body \ "teams").as[Seq[String]]

      PublicUserAccess(
        AuditTrailEvent(
          s"@{user.name} has asked access to api @{api.name} - @{api.id}"
        )
      )(ctx) {

        env.dataStore.apiRepo
          .forTenant(ctx.tenant.id)
          .findByIdNotDeleted(apiId)
          .flatMap {
            case Some(api) =>
              Future
                .sequence(
                  teamIds.map(teamId =>
                    env.dataStore.teamRepo
                      .forTenant(ctx.tenant.id)
                      .findByIdNotDeleted(teamId)
                      .flatMap {
                        case Some(team) => askOwnerForApiAccess(api, team, ctx)
                        case None =>
                          FastFuture
                            .successful(Json.obj(teamId -> "Team not found"))
                    })
                )
                .map(jsResults => Right(Ok(Json.arr(jsResults))))
            case None =>
              FastFuture.successful(
                Left(NotFound(Json.obj("error" -> "Api not found")))
              )
          }
          .map(_.merge)
      }
    }

  def askOwnerForApiAccess(
      api: Api,
      team: Team,
      ctx: DaikokuActionContext[JsValue]
  ): Future[JsObject] = {
    import cats.implicits._

    val notification = Notification(
      id = NotificationId(BSONObjectID.generate().stringify),
      tenant = ctx.tenant.id,
      team = Some(api.team),
      sender = ctx.user.asNotificationSender,
      action = NotificationAction.ApiAccess(api.id, team.id)
    )
    val tenantLanguage: String = ctx.tenant.defaultLanguage.getOrElse("en")

    for {
      notificationRepo <- env.dataStore.notificationRepo
        .forTenantF(ctx.tenant.id)
      saved <- notificationRepo.save(notification)
      maybeOwnerteam <- env.dataStore.teamRepo
        .forTenant(ctx.tenant.id)
        .findByIdNotDeleted(api.team)
      maybeAdmins <- maybeOwnerteam.traverse { ownerTeam =>
        env.dataStore.userRepo
          .find(
            Json
              .obj(
                "_deleted" -> false,
                "_id" -> Json.obj(
                  "$in" -> JsArray(ownerTeam.admins().map(_.asJson).toSeq)
                )
              )
          )
      }
      _ <- maybeAdmins.traverse { admins =>
        Future.sequence(admins.map { admin =>
          implicit val language: String =
            admin.defaultLanguage.getOrElse(tenantLanguage)
          (for {
            title <- translator.translate("mail.api.access.title", ctx.tenant)
            body <- translator.translate(
              "mail.api.access.body",
              ctx.tenant,
              Map(
                "user" -> ctx.user.name,
                "apiName" -> api.name,
                "teamName" -> team.name,
                "link" -> env.getDaikokuUrl(ctx.tenant, "/notifications")
              )
            )
          } yield {
            ctx.tenant.mailer.send(title, Seq(admin.email), body, ctx.tenant)
          }).flatten
        })
      }
    } yield {
      Json.obj(s"${team.id.value}" -> saved)
    }
  }

  def deleteApiOfTeam(teamId: String, apiId: String) =
    DaikokuAction.async { ctx =>
      implicit val mat: Materializer = env.defaultMaterializer
      TeamApiEditorOnly(
        AuditTrailEvent(
          s"@{user.name} has delete api @{api.name} - @{api.id} of team @{team.name} - @{team.id}"
        )
      )(teamId, ctx) { team =>
        env.dataStore.apiRepo
          .forTenant(ctx.tenant.id)
          .findOneNotDeleted(
            Json.obj("_id" -> apiId, "team" -> team.id.asJson)
          ) flatMap {
          case None => AppError.ApiNotFound.renderF()
          case Some(api) if api.visibility == ApiVisibility.AdminOnly => AppError.ForbiddenAction.renderF()
          case Some(api) =>
            Source(api.possibleUsagePlans.toList)
              .mapAsync(1)(planId => {
                for {
                  subs <- env.dataStore.apiSubscriptionRepo
                    .forTenant(ctx.tenant)
                    .findNotDeleted(
                      Json.obj("api" -> api.id.asJson, "plan" -> planId.asJson)
                    )
                  plan <- env.dataStore.usagePlanRepo.forTenant(ctx.tenant).findById(planId)
                } yield (plan.get, subs) //FIXME
              })
              .via(apiService.deleteApiSubscriptionsAsFlow(
                tenant = ctx.tenant,
                apiOrGroupName = api.name,
                user = ctx.user
              ))
              .runWith(Sink.fold(Set.empty[UsagePlan])((set, plan) => set + plan))
              .flatMap(plans => env.dataStore.operationRepo.forTenant(ctx.tenant).insertMany(
                plans.map(plan => Operation(
                  DatastoreId(IdGenerator.token(24)),
                  tenant = ctx.tenant.id,
                  itemId = plan.id.value,
                  itemType = ItemType.ThirdPartyProduct,
                  action = OperationAction.Delete,
                  payload = Json.obj(
                    "paymentSettings" -> plan.paymentSettings.map(_.asJson).getOrElse(JsNull).as[JsValue],
                  ).some
                )).toSeq
              ))
              .flatMap(_ =>
                env.dataStore.apiRepo
                  .forTenant(ctx.tenant.id)
                  .deleteByIdLogically(apiId))
              .map(_ => Ok(Json.obj("done" -> true)))
        }
      }
    }

  def createApiOfTeam(teamId: String) =
    DaikokuAction.async(parse.json) { ctx =>
      val body = ctx.request.body.as[JsObject]
      val finalBody = (body \ "_id").asOpt[String] match {
        case Some(_) => body
        case None =>
          body ++ Json.obj("_id" -> BSONObjectID.generate().stringify)
      }

      val name = (finalBody \ "name").as[String].toLowerCase.trim
      val id = (finalBody \ "_id").asOpt[String].map(_.trim)

      TeamApiEditorOnly(
        AuditTrailEvent(
          s"@{user.name} want to create an api on @{team.name} - @{team.id} (@{api.name} - @{api.id})"
        )
      )(teamId, ctx) { team =>
        ctx.tenant.creationSecurity match {
          case Some(true) if !team.apisCreationPermission.getOrElse(false) =>
            FastFuture.successful(
              Forbidden(
                Json.obj(
                  "error" -> "Team forbidden to create api on current tenant"
                )
              )
            )
          case _ =>
            ApiFormat.reads(finalBody) match {
              case JsError(e) =>
                FastFuture
                  .successful(
                    BadRequest(
                      Json.obj(
                        "error" -> "Error while parsing payload",
                        "msg" -> e.toString()
                      )
                    )
                  )
              case JsSuccess(api, _) =>
                checkApiNameUniqueness(id, name, ctx.tenant.id)
                  .flatMap {
                    case true =>
                      FastFuture.successful(
                        Conflict(
                          Json.obj(
                            "error" -> "Resource with same name already exists"
                          )
                        )
                      )
                    case false =>
                      ctx.setCtxValue("api.id", api.id)
                      ctx.setCtxValue("api.name", api.name)
                      env.dataStore.apiRepo
                        .forTenant(ctx.tenant.id)
                        .save(api)
                        .map { _ =>
                          Created(api.asJson)
                        }
                  }
            }
        }
      }
    }

  def updateApiOfTeam(teamId: String, apiId: String, version: String) =
    DaikokuAction.async(parse.json) { ctx =>
      val finalBody = ctx.request.body
      TeamApiEditorOnly(
        AuditTrailEvent(
          s"@{user.name} has updated an api on @{team.name} - @{team.id} (@{api.name} - @{api.id})"
        )
      )(teamId, ctx) { team =>
        env.dataStore.apiRepo
          .findByVersion(ctx.tenant, apiId, version) flatMap {
          case None => FastFuture.successful(AppError.render(ApiNotFound))
          case Some(oldApi) if oldApi.team != team.id =>
            FastFuture.successful(AppError.render(ApiNotFound))
          case Some(oldApi) =>
            ApiFormat.reads(finalBody) match {
              case JsError(e) =>
                FastFuture.successful(
                  BadRequest(
                    Json.obj(
                      "error" -> "Error while parsing payload",
                      "msg" -> e.toString()
                    )
                  )
                )
              case JsSuccess(api, _) =>
                checkApiNameUniqueness(
                  Some(api.id.value),
                  api.name,
                  ctx.tenant.id
                ).flatMap {
                  case true =>
                    FastFuture.successful(
                      Conflict(
                        Json.obj(
                          "error" -> "Resource with same name already exists"
                        )
                      )
                    )
                  case false =>
                    env.dataStore.apiRepo
                      .forTenant(ctx.tenant.id)
                      .exists(
                        Json.obj(
                          "_humanReadableId" -> api.humanReadableId,
                          "currentVersion" -> api.currentVersion.asJson,
                          "_id" -> Json.obj("$ne" -> api.id.value)
                        )
                      )
                      .flatMap {
                        case true => AppError.renderF(ApiVersionConflict)
                        case false =>
                          for {
                            _ <- env.dataStore.apiRepo
                              .forTenant(ctx.tenant.id)
                              .save(api)
                            _ <- otoroshiSynchronisator.verify(
                              Json.obj("api" -> api.id.value)
                            ) //launch synhro to maybe update customeMetadata & authorizedEntities
                            _ <- updateTagsOfIssues(ctx.tenant.id, api)
                            _ <- updateAllHumanReadableId(ctx,
                              api,
                              oldApi)
                            _ <- turnOffDefaultVersion(
                              ctx,
                              api,
                              oldApi,
                              api.humanReadableId,
                              api.currentVersion.value
                            )
                            _ <- checkIssuesVersion(ctx, api, oldApi)
                          } yield {
                            ctx.setCtxValue("api.name", api.name)
                            ctx.setCtxValue("api.id", api.id)

                            Ok(api.asJson)
                          }
                      }
                }

            }
        }
      }
    }

  private def checkIssuesVersion(
      ctx: DaikokuActionContext[JsValue],
      apiToSave: Api,
      oldApi: Api
  ) = {
    if (oldApi.currentVersion != oldApi.currentVersion) {
      env.dataStore.apiIssueRepo
        .forTenant(ctx.tenant.id)
        .find(
          Json.obj("_id" -> Json.obj("$in" -> apiToSave.issues.map(_.value)))
        )
        .map { issues =>
          Future.sequence(
            issues
              .filter(issue =>
                issue.apiVersion match {
                  case None => true
                  case Some(version) =>
                    version == apiToSave.currentVersion.value
              })
              .map(
                issue =>
                  env.dataStore.apiIssueRepo
                    .forTenant(ctx.tenant.id)
                    .save(
                      issue
                        .copy(apiVersion = Some(apiToSave.currentVersion.value))
                  ))
          )
        }
    } else
      FastFuture.successful(())
  }

  private def updateAllHumanReadableId(
      ctx: DaikokuActionContext[JsValue],
      apiToSave: Api,
      oldApi: Api
  ) = {
    if (oldApi.name != apiToSave.name) {
      env.dataStore.apiRepo
        .forTenant(ctx.tenant.id)
        .find(Json.obj("_humanReadableId" -> oldApi.humanReadableId))
        .flatMap { apis =>
          Future
            .sequence(
              apis.map(
                api =>
                  env.dataStore.apiRepo
                    .forTenant(ctx.tenant.id)
                    .save(api.copy(name = apiToSave.name)))
            )
        }
    } else
      FastFuture.successful(())
  }

  private def turnOffDefaultVersion(
      ctx: DaikokuActionContext[JsValue],
      apiToSave: Api,
      oldApi: Api,
      humanReadableId: String,
      version: String
  ) = {
    if (apiToSave.isDefault && !oldApi.isDefault)
      env.dataStore.apiRepo
        .forTenant(ctx.tenant.id)
        .find(
          Json.obj(
            "_humanReadableId" -> humanReadableId,
            "currentVersion" -> Json.obj("$ne" -> version)
          )
        )
        .map { apis =>
          Future.sequence(
            apis.map(
              api =>
                env.dataStore.apiRepo
                  .forTenant(ctx.tenant.id)
                  .save(api.copy(isDefault = false)))
          )
        } else
      FastFuture.successful(())
  }

  private def updateTagsOfIssues(tenantId: TenantId, api: Api) = {
    env.dataStore.apiIssueRepo
      .forTenant(tenantId)
      .findAll()
      .flatMap { issues =>
        Future.sequence(issues.map(issue => {
          env.dataStore.apiIssueRepo
            .forTenant(tenantId)
            .save(
              issue.copy(tags = issue.tags
                .filter(tag => api.issuesTags.exists(t => t.id == tag)))
            )
        }))
      }
  }

  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  def createDocPage(teamId: String) =
    DaikokuAction.async(parse.json) { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(
          s"@{user.name} has created a doc page on @{team.name} - @{team.id} (@{page.id})"
        )
      )(
        teamId,
        ctx
      ) { _ =>
        ApiDocumentationPageFormat.reads(ctx.request.body) match {
          case JsError(e) =>
            FastFuture.successful(
              BadRequest(
                Json.obj(
                  "error" -> "Error while parsing payload",
                  "msg" -> e.toString
                )
              )
            )
          case JsSuccess(page, _) => {
            ctx.setCtxValue("page.id", page.id)
            env.dataStore.apiDocumentationPageRepo
              .forTenant(ctx.tenant.id)
              .save(page)
              .map { _ =>
                Ok(page.asJson)
              }
          }
        }
      }
    }

  def deleteDocPage(teamId: String, pageId: String) =
    DaikokuAction.async { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(
          s"@{user.name} has deleted a doc page on @{team.name} - @{team.id} (@{page.id})"
        )
      )(
        teamId,
        ctx
      ) { team =>
        ctx.setCtxValue("page.id", pageId)
        env.dataStore.apiDocumentationPageRepo
          .forTenant(ctx.tenant.id)
          .deleteByIdLogically(pageId)
          .map { _ =>
            Ok(Json.obj("done" -> true))
          }
      }
    }

  def saveDocPage(teamId: String, pageId: String) =
    DaikokuAction.async(parse.json) { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(
          s"@{user.name} has saved a doc page on @{team.name} - @{team.id} (@{page.id})"
        )
      )(
        teamId,
        ctx
      ) { team =>
        env.dataStore.apiDocumentationPageRepo
          .forTenant(ctx.tenant.id)
          .findByIdNotDeleted(pageId)
          .flatMap {
            case None =>
              FastFuture.successful(
                NotFound(Json.obj("error" -> "Page not found"))
              )
            case Some(p) => {
              ApiDocumentationPageFormat.reads(ctx.request.body) match {
                case JsError(e) =>
                  FastFuture
                    .successful(
                      BadRequest(
                        Json.obj(
                          "error" -> "Error while parsing payload",
                          "msg" -> e.toString
                        )
                      )
                    )
                case JsSuccess(page, _) => {
                  env.dataStore.apiDocumentationPageRepo
                    .forTenant(ctx.tenant.id)
                    .save(page)
                    .map { _ =>
                      Ok(page.asJson)
                    }
                }
              }
            }
          }
      }
    }

  def search() =
    DaikokuAction.async(parse.json) { ctx =>
      PublicUserAccess(AuditTrailEvent(s"@{user.name} has searched @{search}"))(
        ctx
      ) {
        val body = ctx.request.body.as[JsObject]
        val search = (body \ "search").asOpt[String].getOrElse("")
        ctx.setCtxValue("search", search)

        val searchAsRegex =
          Json.obj("$regex" -> s".*$search.*", "$options" -> "-i")
        val teamUsersFilter =
          if (ctx.user.isDaikokuAdmin) Json.obj()
          else Json.obj("users.userId" -> ctx.user.id.value)

        for {
          myTeams <- env.dataStore.teamRepo.myTeams(ctx.tenant, ctx.user)
          teams <- env.dataStore.teamRepo
            .forTenant(ctx.tenant.id)
            .findNotDeleted(
              Json.obj("name" -> searchAsRegex) ++ teamUsersFilter,
              5,
              Json.obj("name" -> 1).some
            )
          log = AppLogger.info(s"total teams ${teams.length}")
          apis <- env.dataStore.apiRepo
            .forTenant(ctx.tenant.id)
            .findNotDeleted(
              Json.obj(
                "name" -> searchAsRegex,
                "$or" -> Json.arr(
                  Json.obj("visibility" -> "Public"),
                  Json.obj(
                    "$or" -> Json.arr(
                      Json.obj(
                        "authorizedTeams" -> Json
                          .obj("$in" -> JsArray(myTeams.map(_.id.asJson)))
                      ),
                      Json.obj(
                        "team" -> Json
                          .obj("$in" -> JsArray(myTeams.map(_.id.asJson)))
                      )
                    )
                  )
                )
              ),
              5
            )
        } yield {
          Ok(
            Json.arr(
              Json.obj(
                "label" -> "Teams",
                "options" -> JsArray(
                  teams.map(
                    t =>
                      Json.obj(
                        "value" -> t.humanReadableId,
                        "label" -> t.name,
                        "type" -> "team"
                    ))
                )
              ),
              Json.obj(
                "label" -> "Apis",
                "options" -> JsArray(
                  apis.map(
                    a =>
                      Json.obj(
                        "value" -> a.humanReadableId,
                        "team" -> a.team.value,
                        "label" -> a.name,
                        "version" -> a.currentVersion.asJson,
                        "type" -> "api"
                    ))
                )
              )
            )
          )
        }
      }
    }

  def categories() =
    DaikokuAction.async { ctx =>
      PublicUserAccess(AuditTrailEvent(s"@{user.name} get categories"))(ctx) {
        env.dataStore.apiRepo
          .forTenant(ctx.tenant.id)
          .findWithProjection(Json.obj(), Json.obj("categories" -> true))
          .map(
            tags =>
              tags.map(
                tag =>
                  (tag \ "categories")
                    .asOpt[Seq[String]]
                    .map(_.toSet)
                    .getOrElse(Set.empty)))
          .map(_.toSet)
          .map(_.flatten)
          .map(categories => Ok(JsArray(categories.map(JsString.apply).toSeq)))
      }
    }

  def getApiSubscriptions(teamId: String, apiId: String, version: String) =
    DaikokuAction.async { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(
          s"@{user.name} has acceeded to team (@{team.id}) subscription for api @{api.id}"
        )
      )(teamId, ctx) { team =>
        env.dataStore.apiRepo
          .findByVersion(ctx.tenant, apiId, version)
          .flatMap {
            case Some(api) if api.team != team.id =>
              FastFuture.successful(
                Unauthorized(
                  Json.obj("error" -> "Unauthorized to access to this api")
                )
              )
            case Some(api) =>
              env.dataStore.apiSubscriptionRepo
                .forTenant(ctx.tenant)
                .findNotDeleted(Json.obj("api" -> api.id.asJson))
                .map(subs => Ok(JsArray(subs.map(_.asSafeJson))))
            case None =>
              FastFuture.successful(
                NotFound(Json.obj("error" -> "Api not found"))
              )
          }
      }
    }

  def getPosts(
      apiId: String,
      version: String,
      offset: Option[Int],
      limit: Option[Int]
  ) =
    DaikokuActionMaybeWithGuest.async { ctx =>
      UberPublicUserAccess(
        AuditTrailEvent(s"@{user.name} has accessed posts for @{api.id}")
      )(ctx) {
        ctx.setCtxValue("api.id", apiId)

        getPostsImpl(
          ctx.tenant,
          apiId,
          version,
          limit.getOrElse(10),
          offset.getOrElse(0)
        ).map {
          case Left(r)  => NotFound(r)
          case Right(r) => Ok(r)
        }
      }
    }

  private def getPostsImpl(
      tenant: Tenant,
      apiId: String,
      version: String,
      limit: Int,
      offset: Int
  ): Future[Either[JsValue, JsValue]] = {
    env.dataStore.apiRepo.findByVersion(tenant, apiId, version).flatMap {
      case None =>
        FastFuture.successful(Left(Json.obj("error" -> "Api not found")))
      case Some(api) =>
        env.dataStore.apiPostRepo
          .forTenant(tenant.id)
          .findWithPagination(
            Json.obj(
              "_id" -> Json.obj(
                "$in" -> JsArray(api.posts.map(_.asJson))
              )
            ),
            offset,
            limit
          )
          .map(
            data =>
              Right(
                Json.obj(
                  "posts" -> JsArray(data._1.map(_.asJson)),
                  "total" -> data._2
                )
            ))
    }
  }

  def createPost(teamId: String, apiId: String) =
    DaikokuAction.async(parse.json) { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(s"@{user.name} has created posts for @{api.id}")
      )(teamId, ctx) { _ =>
        val postId = ApiPostId(BSONObjectID.generate().stringify)

        val body = ApiPost(
          id = postId,
          tenant = ctx.tenant.id,
          lastModificationAt = DateTime.now(),
          title = (ctx.request.body \ "title").as[String],
          content = (ctx.request.body \ "content").as[String]
        )

        env.dataStore.apiPostRepo
          .forTenant(ctx.tenant.id)
          .save(body)
          .flatMap {
            case true =>
              env.dataStore.apiRepo
                .forTenant(ctx.tenant.id)
                .findByIdNotDeleted(apiId)
                .flatMap {
                  case Some(api) =>
                    env.dataStore.apiRepo
                      .forTenant(ctx.tenant.id)
                      .save(api.copy(posts = api.posts ++ Seq(postId)))
                      .flatMap {
                        case true =>
                          val tenantLanguage: String =
                            ctx.tenant.defaultLanguage.getOrElse("en")
                          for {
                            subs <- env.dataStore.apiSubscriptionRepo
                              .forTenant(ctx.tenant.id)
                              .find(Json.obj("api" -> apiId))
                            api <- env.dataStore.apiRepo
                              .forTenant(ctx.tenant.id)
                              .findByIdNotDeleted(apiId)
                            _ <- Future.sequence(
                              subs
                                .toSet[ApiSubscription]
                                .map(
                                  sub =>
                                    env.dataStore.notificationRepo
                                      .forTenant(ctx.tenant.id)
                                      .save(
                                        Notification(
                                          id = NotificationId(
                                            BSONObjectID.generate().stringify
                                          ),
                                          tenant = ctx.tenant.id,
                                          sender = ctx.user.asNotificationSender,
                                          action =
                                            NotificationAction.NewPostPublished(
                                              teamId,
                                              api.map(_.name).getOrElse("")
                                            ),
                                          notificationType =
                                            NotificationType.AcceptOnly,
                                          team = Some(sub.team)
                                        )
                                    ))
                            )
                            subTeams <- {
                              val teamIds = subs
                                .toSet[ApiSubscription]
                                .map(_.team)
                              env.dataStore.teamRepo
                                .forTenant(ctx.tenant)
                                .find(
                                  Json.obj(
                                    "_id" -> Json.obj(
                                      "$in" -> JsArray(
                                        teamIds.map(_.asJson).toList
                                      )
                                    )
                                  )
                                )
                            }
                            members <- subTeams
                              .traverse { t =>
                                env.dataStore.userRepo
                                  .find(
                                    Json
                                      .obj(
                                        "_id" -> Json.obj(
                                          "$in" -> JsArray(
                                            t.users
                                              .filter(
                                                _.teamPermission == TeamPermission.Administrator
                                              )
                                              .map(_.userId.asJson)
                                              .toList
                                          )
                                        ),
                                        "_deleted" -> false
                                      )
                                  )
                              }
                              .map(_.flatten)
                            _ <- Future.sequence(members.map { member =>
                              implicit val language: String =
                                member.defaultLanguage.getOrElse(tenantLanguage)
                              (for {
                                title <- translator.translate(
                                  "mail.create.post.title",
                                  ctx.tenant
                                )
                                body <- translator.translate(
                                  "mail.create.post.body",
                                  ctx.tenant,
                                  Map(
                                    "user" -> ctx.user.name,
                                    "apiName" -> api.get.humanReadableId,
                                    "teamName" -> api.get.team.value, //not sure
                                    "link" -> env.getDaikokuUrl(
                                      ctx.tenant,
                                      "/" + api.get.team.value + "/" + api.get.humanReadableId + "/" + api.get.currentVersion.value + "/news"
                                    ) //same
                                  )
                                )
                              } yield {
                                ctx.tenant.mailer.send(
                                  title,
                                  Seq(member.email),
                                  body,
                                  ctx.tenant
                                )
                              }).flatten
                            })
                          } yield {
                            Ok(Json.obj("created" -> true))
                          }
                        case false =>
                          FastFuture.successful(
                            BadRequest(
                              Json.obj("error" -> "Failed to create post")
                            )
                          )
                      }
                  case None =>
                    AppLogger.error("Api not found after post creation")
                    FastFuture.successful(
                      NotFound(
                        Json.obj(
                          "error" -> "Failed to create post : Api not found"
                        )
                      )
                    )
                }
            case false =>
              FastFuture.successful(
                BadRequest(Json.obj("error" -> "Failed to create post"))
              )
          }
      }
    }

  def updatePost(teamId: String, apiId: String, postId: String) =
    DaikokuAction.async(parse.json) { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(s"@{user.name} has updated posts for @{api.id}")
      )(teamId, ctx) { _ =>
        env.dataStore.apiPostRepo
          .forTenant(ctx.tenant.id)
          .findByIdNotDeleted(postId)
          .flatMap {
            case Some(post) =>
              env.dataStore.apiPostRepo
                .forTenant(ctx.tenant.id)
                .save(
                  post.copy(
                    content = (ctx.request.body \ "content").as[String],
                    title = (ctx.request.body \ "title").as[String]
                  )
                )
                .flatMap {
                  case true =>
                    FastFuture.successful(
                      Ok(Json.obj("message" -> "Post saved"))
                    )
                  case false =>
                    FastFuture.successful(
                      BadRequest(Json.obj("error" -> "Something went wrong"))
                    )
                }
            case None =>
              FastFuture.successful(
                NotFound(Json.obj("error" -> "Post not found"))
              )
          }
      }
    }

  def removePost(teamId: String, apiId: String, postId: String) =
    DaikokuAction.async { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(s"@{user.name} has removed posts for @{api.id}")
      )(teamId, ctx) { _ =>
        env.dataStore.apiPostRepo
          .forTenant(ctx.tenant.id)
          .deleteById(postId)
          .flatMap {
            case true =>
              FastFuture.successful(Ok(Json.obj("message" -> "Post removed")))
            case false =>
              FastFuture.successful(
                BadRequest(Json.obj("error" -> "Something went wrong"))
              )
          }
      }
    }

  def toggleStar(apiId: String) =
    DaikokuAction.async { ctx =>
      PublicUserAccess(
        AuditTrailEvent(s"@{user.name} has starred @{api.name} - @{api.id}")
      )(ctx) {
        env.dataStore.apiRepo
          .forTenant(ctx.tenant.id)
          .findByIdNotDeleted(apiId)
          .flatMap {
            case Some(api) =>
              val starred = ctx.user.starredApis.contains(api.id)
              val newStars = api.stars + (if (starred) -1 else 1)
              for {
                _ <- env.dataStore.userRepo.save(
                  ctx.user.copy(starredApis =
                    if (starred) ctx.user.starredApis.filter(id => id != api.id)
                    else ctx.user.starredApis ++ Seq(api.id))
                )
                _ <- env.dataStore.apiRepo
                  .forTenant(ctx.tenant.id)
                  .save(api.copy(stars = newStars))
              } yield {
                Ok(Json.obj("done" -> true))
              }
            case None =>
              FastFuture.successful(
                NotFound(Json.obj("error" -> "Api not found"))
              )
          }
      }
    }

  def getIssue(apiId: String, issueId: String) =
    DaikokuActionMaybeWithGuest.async { ctx =>
      UberPublicUserAccess(
        AuditTrailEvent(s"@{user.name} has accessed issues for @{api.id}")
      )(ctx) {
        ctx.setCtxValue("api.id", apiId)

        env.dataStore.apiIssueRepo
          .forTenant(ctx.tenant.id)
          .findOne(
            Json.obj(
              "_id" -> issueId
            )
          )
          .flatMap {
            case None =>
              FastFuture.successful(
                NotFound(Json.obj("error" -> "Issue not found"))
              )
            case Some(issue) =>
              for {
                creators <- Future.sequence(
                  issue.comments.map(comment =>
                    env.dataStore.userRepo.findById(comment.by.value))
                )
                issueCreator <- env.dataStore.userRepo.findById(issue.by.value)
                api <- env.dataStore.apiRepo
                  .forTenant(ctx.tenant.id)
                  .findOne(
                    Json.obj(
                      "_humanReadableId" -> apiId,
                      "parent" -> JsNull
                    )
                  )
              } yield {
                issueCreator
                  .map { creator =>
                    val issuesTags = api.map(_.issuesTags).getOrElse(Set.empty)
                    Ok(
                      (issue.asJson.as[JsObject] ++
                        Json.obj(
                          "by" -> creator.asSimpleJson,
                          "tags" -> Json.toJson(
                            issue.tags
                              .map(tagId =>
                                issuesTags
                                  .find(_.id == tagId)
                                  .map(tag => ApiTagFormat.writes(tag)))
                          ),
                          "comments" -> Json.toJson(
                            issue.comments.zipWithIndex
                              .map {
                                case (comment, i) =>
                                  ApiIssueCommentFormat
                                    .writes(comment) + ("by" -> creators(i)
                                    .map(_.asSimpleJson)
                                    .getOrElse(Json.obj()))
                              }
                          )
                        ))
                    )
                  }
                  .getOrElse(
                    BadRequest(
                      Json.obj("error" -> "The issue creator is missing")
                    )
                  )
              }
          }
      }
    }

  def getIssues(apiId: String) =
    DaikokuActionMaybeWithGuest.async { ctx =>
      UberPublicUserAccess(
        AuditTrailEvent(s"@{user.name} has accessed issues for @{api.id}")
      )(ctx) {
        ctx.setCtxValue("api.id", apiId)

        env.dataStore.apiRepo
          .forTenant(ctx.tenant.id)
          .findOne(
            Json.obj(
              "_humanReadableId" -> apiId,
              "parent" -> JsNull
            )
          )
          .flatMap {
            case None =>
              FastFuture.successful(
                NotFound(Json.obj("error" -> "Api not found"))
              )
            case Some(api) =>
              env.dataStore.apiIssueRepo
                .forTenant(ctx.tenant.id)
                .find(
                  Json.obj(
                    "_id" -> Json
                      .obj("$in" -> JsArray(api.issues.map(_.asJson)))
                  )
                )
                .map(issues => issues.filter(!_.deleted))
                .flatMap(issues =>
                  for {
                    creators <- Future.sequence(
                      issues.map(issue =>
                        env.dataStore.userRepo.findById(issue.by.value))
                    )
                  } yield {
                    Ok(
                      JsArray(
                        issues.zipWithIndex
                          .map {
                            case (issue, i) =>
                              issue.asJson.as[JsObject] +
                                ("by" -> creators(i)
                                  .map(_.asSimpleJson)
                                  .getOrElse(Json.obj())) +
                                ("tags" -> Json.toJson(
                                  issue.tags
                                    .map(
                                      tagId =>
                                        api.issuesTags
                                          .find(_.id == tagId)
                                          .map(tag => ApiTagFormat.writes(tag))
                                          .getOrElse(Json.obj()))
                                ))
                          }
                      )
                    )
                })
          }
      }
    }

  def createIssue(teamId: String, apiId: String) =
    DaikokuAction.async(parse.json) { ctx =>
      PublicUserAccess(
        AuditTrailEvent(s"@{user.name} has accessed issues for @{api.id}")
      )(ctx) {
        ApiIssueFormat.reads(ctx.request.body) match {
          case JsError(_) =>
            FastFuture.successful(
              BadRequest(Json.obj("error" -> "Body can't be parse to issue"))
            )
          case JsSuccess(issue, _) =>
            env.dataStore.teamRepo
              .forTenant(ctx.tenant.id)
              .findByIdOrHrId(teamId)
              .flatMap {
                case None =>
                  FastFuture.successful(
                    Results.NotFound(Json.obj("error" -> "Team not found"))
                  )
                case Some(_) =>
                  env.dataStore.apiRepo
                    .forTenant(ctx.tenant.id)
                    .findOne(
                      Json.obj(
                        "_humanReadableId" -> apiId,
                        "parent" -> JsNull
                      )
                    )
                    .flatMap {
                      case None =>
                        FastFuture.successful(AppError.render(ApiNotFound))
                      case Some(api) =>
                        env.dataStore.apiIssueRepo
                          .forTenant(ctx.tenant.id)
                          .save(
                            issue
                              .copy(seqId = api.issues.size, by = ctx.user.id)
                          )
                          .flatMap {
                            case false =>
                              FastFuture.successful(
                                BadRequest(
                                  Json.obj("error" -> "failed to create issue")
                                )
                              )
                            case true =>
                              env.dataStore.apiRepo
                                .forTenant(ctx.tenant.id)
                                .save(
                                  api.copy(issues = api.issues ++ Seq(issue.id))
                                )
                                .flatMap {
                                  case false =>
                                    FastFuture.successful(
                                      BadRequest(
                                        Json.obj(
                                          "error" -> "Failed to save new issue in api issues list"
                                        )
                                      )
                                    )
                                  case true =>
                                    val tenantLanguage: String =
                                      ctx.tenant.defaultLanguage.getOrElse("en")
                                    for {
                                      subs <- env.dataStore.apiSubscriptionRepo
                                        .forTenant(ctx.tenant.id)
                                        .find(
                                          Json.obj(
                                            "api" -> api.id.value
                                          )
                                        )
                                      optTeam <- env.dataStore.teamRepo
                                        .forTenant(ctx.tenant.id)
                                        .findById(teamId)
                                      _ <- {
                                        Future.sequence(
                                          subs
                                            .distinctBy(_.team)
                                            .map(
                                              sub =>
                                                env.dataStore.notificationRepo
                                                  .forTenant(ctx.tenant.id)
                                                  .save(
                                                    Notification(
                                                      id = NotificationId(
                                                        BSONObjectID
                                                          .generate()
                                                          .stringify
                                                      ),
                                                      tenant = ctx.tenant.id,
                                                      sender = ctx.user.asNotificationSender,
                                                      action =
                                                        NotificationAction
                                                          .NewIssueOpen(
                                                            teamId,
                                                            api.name,
                                                            s"/${optTeam.map(_.humanReadableId).getOrElse("")}/${api.humanReadableId}/${api.currentVersion.value}/issues/${issue.id.value}"
                                                          ),
                                                      notificationType =
                                                        NotificationType.AcceptOnly,
                                                      team = Some(sub.team)
                                                    )
                                                ))
                                        )
                                      }
                                      maybeOwnerteam <- env.dataStore.teamRepo
                                        .forTenant(ctx.tenant.id)
                                        .findByIdNotDeleted(api.team)
                                      maybeAdmins <- maybeOwnerteam.traverse {
                                        ownerTeam =>
                                          env.dataStore.userRepo
                                            .find(
                                              Json
                                                .obj(
                                                  "_deleted" -> false,
                                                  "_id" -> Json.obj(
                                                    "$in" -> JsArray(
                                                      ownerTeam
                                                        .admins()
                                                        .map(_.asJson)
                                                        .toSeq
                                                    )
                                                  )
                                                )
                                            )
                                      }
                                      _ <- maybeAdmins.traverse { admins =>
                                        Future.sequence(admins.map { admin =>
                                          implicit val language: String =
                                            admin.defaultLanguage
                                              .getOrElse(tenantLanguage)
                                          (for {
                                            title <- translator.translate(
                                              "mail.new.issue.title",
                                              ctx.tenant
                                            )
                                            body <- translator.translate(
                                              "mail.new.issue.body",
                                              ctx.tenant,
                                              Map(
                                                "user" -> ctx.user.name,
                                                "apiName" -> api.name,
                                                "teamName" -> api.team.value, // not sure if it's okay
                                                "link" -> env.getDaikokuUrl(
                                                  ctx.tenant,
                                                  "/" + api.team.value + "/" + api.humanReadableId + "/" + api.currentVersion.value + "/issues"
                                                ) //same
                                              )
                                            )
                                          } yield {
                                            ctx.tenant.mailer.send(
                                              title,
                                              Seq(admin.email),
                                              body,
                                              ctx.tenant
                                            )
                                          }).flatten
                                        })
                                      }
                                      _ <- env.dataStore.notificationRepo
                                        .forTenant(ctx.tenant.id)
                                        .save(
                                          Notification(
                                            id = NotificationId(
                                              BSONObjectID
                                                .generate()
                                                .stringify
                                            ),
                                            tenant = ctx.tenant.id,
                                            sender = ctx.user.asNotificationSender,
                                            action =
                                              NotificationAction.NewIssueOpen(
                                                teamId,
                                                api.name,
                                                s"/${optTeam.map(_.humanReadableId).getOrElse("")}/${api.humanReadableId}/${api.currentVersion.value}/issues/${issue.id.value}"
                                              ),
                                            notificationType =
                                              NotificationType.AcceptOnly,
                                            team = Some(maybeOwnerteam.get.id)
                                          )
                                        )

                                    } yield {
                                      Created(Json.obj("created" -> true))
                                    }
                                }
                          }
                    }
              }
        }
      }
    }

  def updateIssue(teamId: String, apiId: String, issueId: String) =
    DaikokuAction.async(parse.json) { ctx =>
      PublicUserAccess(
        AuditTrailEvent(s"@{user.name} has updated issues for @{api.id}")
      )(ctx) {

        def commentsHasBeenRemovedWithoutRights(
            isDaikokuAdmin: Boolean,
            a: Seq[ApiIssueComment],
            b: Seq[ApiIssueComment]
        ) =
          !isDaikokuAdmin &&
            a.size < b.size &&
            b.filterNot { comment =>
                a.exists(c =>
                  c.createdAt.getMillis == comment.createdAt.getMillis)
              }
              .exists(comment => comment.by != ctx.user.id)

        def commentsHasBeenUpdatedWithoutRights(
            isDaikokuAdmin: Boolean,
            a: Seq[ApiIssueComment],
            b: Seq[ApiIssueComment]
        ) =
          !isDaikokuAdmin &&
            a.size == b.size &&
            b.filterNot { comment =>
                a.exists(c => c.content == comment.content)
              }
              .exists(comment => comment.by != ctx.user.id)

        def notifyTeam(apiName: String, linkTo: String, team: TeamId) =
          env.dataStore.notificationRepo
            .forTenant(ctx.tenant.id)
            .save(
              Notification(
                id = NotificationId(BSONObjectID.generate().stringify),
                tenant = ctx.tenant.id,
                sender = ctx.user.asNotificationSender,
                action =
                  NotificationAction.NewCommentOnIssue(teamId, apiName, linkTo),
                notificationType = NotificationType.AcceptOnly,
                team = Some(team)
              )
            )

        ApiIssueFormat.reads(ctx.request.body) match {
          case JsError(_) =>
            FastFuture.successful(
              BadRequest(Json.obj("error" -> "Body can't be parse to issue"))
            )
          case JsSuccess(issue, _) =>
            (for {
              optIssue <- env.dataStore.apiIssueRepo
                .forTenant(ctx.tenant.id)
                .findOne(Json.obj("_id" -> issueId))
              optTeam <- env.dataStore.teamRepo
                .forTenant(ctx.tenant.id)
                .findById(teamId)
            } yield {
              (optIssue, optTeam) match {
                case (Some(existingIssue), Some(team)) =>
                  val isTeamMember = team.users.find(_.userId == ctx.user.id)
                  val isDaikokuAdmin = ctx.user.isDaikokuAdmin

                  val sortedExistingComments =
                    existingIssue.comments.sortBy(_.createdAt.getMillis)
                  val sortedEntryComments =
                    issue.comments.sortBy(_.createdAt.getMillis)

                  if (!existingIssue.tags.equals(
                        issue.tags
                      ) && isTeamMember.isEmpty && !isDaikokuAdmin)
                    FastFuture.successful(
                      Unauthorized(
                        Json
                          .obj("error" -> "You're not authorized to edit tags")
                      )
                    )
                  else if (commentsHasBeenRemovedWithoutRights(
                             isDaikokuAdmin,
                             sortedEntryComments,
                             sortedExistingComments
                           ))
                    FastFuture.successful(
                      Unauthorized(
                        Json.obj(
                          "error" -> "You're not allowed to delete a comment that does not belong to you"
                        )
                      )
                    )
                  else if (commentsHasBeenUpdatedWithoutRights(
                             isDaikokuAdmin,
                             sortedEntryComments,
                             sortedExistingComments
                           ))
                    FastFuture.successful(
                      Unauthorized(
                        Json.obj(
                          "error" -> "You're not allowed to edit a comment that does not belong to you"
                        )
                      )
                    )
                  else if (existingIssue.open != issue.open && isTeamMember.isEmpty && !isDaikokuAdmin)
                    FastFuture.successful(
                      Unauthorized(
                        Json.obj(
                          "error" -> "You're not authorized to close or re-open an issue"
                        )
                      )
                    )
                  else if (existingIssue.title != issue.title && !isDaikokuAdmin && (issue.by != ctx.user.id || (issue.by != ctx.user.id && isTeamMember.isEmpty)))
                    FastFuture.successful(
                      Unauthorized(
                        Json
                          .obj("error" -> "You're not authorized to edit issue")
                      )
                    )
                  else
                    env.dataStore.apiIssueRepo
                      .forTenant(ctx.tenant.id)
                      .save(issue)
                      .flatMap { updated =>
                        if (updated) {
                          if (existingIssue.comments.size < issue.comments.size)
                            for {
                              subs <- env.dataStore.apiSubscriptionRepo
                                .forTenant(ctx.tenant.id)
                                .find(
                                  Json.obj(
                                    "_humanReadableId" -> apiId
                                  )
                                )
                              api <- env.dataStore.apiRepo
                                .forTenant(ctx.tenant.id)
                                .findOne(
                                  Json.obj(
                                    "_humanReadableId" -> apiId,
                                    "parent" -> JsNull
                                  )
                                )
                              _ <- {
                                Future.sequence(
                                  subs
                                    .distinctBy(_.team)
                                    .map(sub =>
                                      notifyTeam(
                                        api.map(_.name).getOrElse(""),
                                        s"${team.humanReadableId}/${api.map(_.humanReadableId).getOrElse("")}/${api
                                          .map(_.currentVersion.value)
                                          .getOrElse("1.0.0")}/issues/${issue.id.value}",
                                        sub.team
                                    ))
                                )
                              }
                            } yield Ok(Json.obj("message" -> "Issue saved"))
                          else
                            FastFuture.successful(
                              Ok(Json.obj("message" -> "Issue saved"))
                            )
                        } else
                          FastFuture.successful(
                            BadRequest(
                              Json.obj("error" -> "Something went wrong")
                            )
                          )
                      }
                case _ =>
                  FastFuture.successful(
                    NotFound(Json.obj("error" -> "Team or issue not found"))
                  )
              }
            }).flatMap(_.asInstanceOf[Future[Result]])
        }
      }
    }

  def getComments(apiId: String, issueId: String) =
    DaikokuActionMaybeWithGuest.async { ctx =>
      UberPublicUserAccess(
        AuditTrailEvent(s"@{user.name} has accessed comments for @{api.id}")
      )(ctx) {
        ctx.setCtxValue("api.id", apiId)

        env.dataStore.apiRepo
          .forTenant(ctx.tenant.id)
          .findOne(
            Json.obj(
              "_humanReadableId" -> apiId,
              "parent" -> JsNull
            )
          )
          .flatMap {
            case None =>
              FastFuture.successful(
                NotFound(Json.obj("error" -> "Api not found"))
              )
            case Some(_) =>
              env.dataStore.apiIssueRepo
                .forTenant(ctx.tenant.id)
                .findById(issueId)
                .flatMap(
                  issue =>
                    FastFuture.successful(
                      Ok(
                        JsArray(
                          issue
                            .map(_.comments)
                            .getOrElse(Seq.empty[ApiIssueComment])
                            .map(ApiIssueCommentFormat.writes)
                        )
                      )
                  ))
          }
      }
    }

  def createVersion(teamId: String, apiId: String) =
    DaikokuAction.async(parse.json) { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(
          s"@{user.name} has created new version (@{newVersion}) of api @{api.id} with @{team.name} - @{team.id}"
        )
      )(teamId, ctx) { team =>
        val newVersion = (ctx.request.body \ "version").asOpt[String]

        ctx.setCtxValue("newVersion", newVersion)

        newVersion match {
          case None =>
            FastFuture.successful(
              BadRequest(Json.obj("error" -> "Missing parameters"))
            )
          case Some(newVersion) if newVersion.isEmpty =>
            FastFuture.successful(
              BadRequest(Json.obj("error" -> "Version number is too short"))
            )
          case Some(newVersion) =>
            val apiRepo = env.dataStore.apiRepo.forTenant(ctx.tenant.id)
            val generatedApiId = ApiId(BSONObjectID.generate().stringify)
            apiRepo
              .findOne(
                Json.obj(
                  "$or" -> Json.arr(
                    Json.obj("_humanReadableId" -> apiId),
                    Json.obj("_id" -> apiId)
                  ),
                  "parent" -> JsNull
                )
              )
              .flatMap {
                case None => FastFuture.successful(AppError.render(ApiNotFound))
                case Some(api) if api.currentVersion.value == newVersion =>
                  FastFuture.successful(AppError.render(ApiVersionConflict))
                case Some(api) =>
                  apiRepo
                    .exists(
                      Json.obj(
                        "currentVersion" -> newVersion,
                        "_humanReadableId" -> api.humanReadableId
                      )
                    )
                    .flatMap {
                      case true =>
                        FastFuture.successful(
                          AppError.render(ApiVersionConflict)
                        )
                      case false =>
                        apiRepo
                          .save(
                            api.copy(
                              id = generatedApiId,
                              parent = Some(api.id),
                              currentVersion = Version(newVersion),
                              isDefault = true,
                              testing = Testing(),
                              documentation = ApiDocumentation(
                                id = ApiDocumentationId(
                                  BSONObjectID.generate().stringify
                                ),
                                tenant = ctx.tenant.id,
                                lastModificationAt = DateTime.now(),
                                pages = Seq.empty
                              ),
                              swagger = Some(
                                SwaggerAccess(
                                  url = "/assets/swaggers/petstore.json")
                              ),
                              possibleUsagePlans = Seq.empty,
                              defaultUsagePlan = UsagePlanId(""),
                              posts = Seq.empty,
                              issues = Seq.empty,
                              state = ApiState.Created
                            )
                          )
                          .flatMap {
                            case true =>
                              apiRepo
                                .updateManyByQuery(
                                  Json.obj(
                                    "_humanReadableId" -> api.humanReadableId,
                                    "_id" -> Json
                                      .obj("$ne" -> generatedApiId.value)
                                  ),
                                  Json.obj(
                                    "$set" -> Json.obj("isDefault" -> false)
                                  )
                                )
                                .map(_ => Created(Json.obj("created" -> true)))
                            case false =>
                              FastFuture.successful(
                                BadRequest(
                                  Json.obj(
                                    "error" -> "The creation of api has failed"
                                  )
                                )
                              )
                          }
                    }
              }
        }
      }
    }

  def getAllApiVersions(teamId: String, apiId: String) =
    DaikokuActionMaybeWithGuest.async { ctx =>
      UberPublicUserAccess(
        AuditTrailEvent(
          s"@{user.name} has requested all versions of api @{api.name} - @{api.id}"
        )
      )(ctx) {
        env.dataStore.apiRepo
          .findAllVersions(tenant = ctx.tenant, id = apiId)
          .map { apis =>
            ctx.setCtxValue("api.name", apis.head.name)
            ctx.setCtxValue("api.id", apiId)
            Ok(
              SeqVersionFormat.writes(
                apis
                  .filter(api =>
                    !ctx.user.isGuest || api.visibility.name == ApiVisibility.Public.name)
                  .map(_.currentVersion)
                  .sortWith((a, b) => a.value.compareToIgnoreCase(b.value) < 0)
              )
            )
          }
      }
    }

  def getDefaultApiVersion(apiId: String) =
    DaikokuActionMaybeWithGuest.async { ctx =>
      UberPublicUserAccess(
        AuditTrailEvent(
          "@{user.name} has accessed to default version of api @{api.name}"
        )
      )(ctx) {
        for {
          myTeams <- env.dataStore.teamRepo.myTeams(ctx.tenant, ctx.user)
          apis <- env.dataStore.apiRepo
            .forTenant(ctx.tenant.id)
            .find(
              Json.obj(
                "_deleted" -> false,
                "_humanReadableId" -> apiId
              )
            )
        } yield {
          val filteredApis =
            apis
              .filter(
                api =>
                  api.authorizedTeams.exists(t =>
                    myTeams.exists(a => a.id == t)) || myTeams.exists(a =>
                    a.id == api.team))

          filteredApis.find(api => api.isDefault) match {
            case None =>
              apis.find(api => api.parent.isEmpty) match {
                case Some(api) =>
                  Ok(Json.obj("defaultVersion" -> api.currentVersion.asJson))
                case None => AppError.ApiNotFound.render()
              }
            case Some(api) =>
              Ok(Json.obj("defaultVersion" -> api.currentVersion.asJson))
          }
        }
      }
    }

  def getAllPlan(teamId: String, apiId: String, version: String) =
    DaikokuAction.async { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(
          s"@{user.name} has requested all plan of api @{api.id} with @{team.name} - @{team.id}"
        )
      )(teamId, ctx) { team =>

        (for {
          api <- EitherT.fromOptionF[Future, AppError, Api](env.dataStore.apiRepo.forTenant(ctx.tenant)
            .findOne(Json.obj("_humanReadableId" -> apiId,
              "currentVersion" -> Json.obj("$ne" -> version))), AppError.ApiNotFound)
          _ <- if (api.team != team.id) EitherT.leftT[Future, Unit](AppError.ApiNotFound) else EitherT.pure[Future, AppError](())
          plans <- EitherT.liftF[Future, AppError, Seq[UsagePlan]](env.dataStore.usagePlanRepo.findByApi(ctx.tenant.id, api))
        } yield Ok(json.SeqUsagePlanFormat.writes(plans)))
          .leftMap(_.render())
          .merge
      }
    }

  def getPlan(teamId: String, apiId: String, version: String, planId: String) =
    DaikokuAction.async { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(s"@{user.name} get plan of api @{api.id} with @{team.name} - @{team.id}")
      )(teamId, ctx) { team =>

        def controlApiAndPlan(api: Api): EitherT[Future, AppError, Unit] = {
          if (api.team != team.id || api.possibleUsagePlans.forall(p => p.value != planId))
            EitherT.leftT[Future, Unit](AppError.PlanNotFound)
          else
            EitherT.pure[Future, AppError](())
        }

        (for {
          api <- EitherT.fromOptionF[Future, AppError, Api](env.dataStore.apiRepo.forTenant(ctx.tenant)
            .findOne(Json.obj("_humanReadableId" -> apiId,
              "currentVersion" -> Json.obj("$ne" -> version))), AppError.ApiNotFound)
          _ <- controlApiAndPlan(api)
          plan <- EitherT.fromOptionF[Future, AppError, UsagePlan](env.dataStore.usagePlanRepo.forTenant(ctx.tenant).findById(planId), AppError.PlanNotFound)
        } yield Ok(plan.asJson))
          .leftMap(_.render())
          .merge
      }
    }

  def clonePlan(teamId: String, apiId: String) =
    DaikokuAction.async(parse.json) { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(
          s"@{user.name} has cloned plan of api @{api.id} with @{team.name} - @{team.id}"
        )
      )(teamId, ctx) { _ =>
        val planId = (ctx.request.body \ "plan").as[String]
        val fromApiId = (ctx.request.body \ "api").as[String]

        val apiRepo = env.dataStore.apiRepo.forTenant(ctx.tenant.id)


        (for {
          fromApi <- EitherT.fromOptionF(apiRepo.findById(fromApiId), AppError.ApiNotFound)
          api <- EitherT.fromOptionF(apiRepo.findById(apiId), AppError.ApiNotFound)
          plan <- EitherT.fromOptionF(env.dataStore.usagePlanRepo.forTenant(ctx.tenant).findById(planId), AppError.PlanNotFound)
          copyPlanId = UsagePlanId(BSONObjectID.generate().stringify)
          customName = Some(
            s"Imported plan from ${fromApi.currentVersion} - ${plan.typeName}"
          )
          copy = (plan match {
            case u: UsagePlan.Admin =>
              u.copy(id = copyPlanId, customName = customName)
            case u: UsagePlan.PayPerUse =>
              u.copy(id = copyPlanId, customName = customName)
            case u: UsagePlan.FreeWithQuotas =>
              u.copy(id = copyPlanId, customName = customName)
            case u: UsagePlan.FreeWithoutQuotas =>
              u.copy(id = copyPlanId, customName = customName)
            case u: UsagePlan.QuotasWithLimits =>
              u.copy(id = copyPlanId, customName = customName)
            case u: UsagePlan.QuotasWithoutLimits =>
              u.copy(id = copyPlanId, customName = customName)
          }).asInstanceOf[UsagePlan]
          _ <- EitherT.liftF[Future, AppError, Boolean](env.dataStore.usagePlanRepo.forTenant(ctx.tenant).save(copy))
          _ <- EitherT.liftF[Future, AppError, Boolean](apiRepo.save(api.copy(possibleUsagePlans = api.possibleUsagePlans ++ Seq(copyPlanId))))
        } yield Created(copy.asJson))
          .leftMap(_.render())
          .merge
      }
    }

  def getMyTeamsStatusAccess(teamId: String, apiId: String, version: String) =
    DaikokuAction.async { ctx =>
      PublicUserAccess(
        AuditTrailEvent(
          s"@{user.name} has requested status of own teams requests for api @{api.name}"
        )
      )(ctx) {
        env.dataStore.apiRepo
          .findByVersion(ctx.tenant, apiId, version)
          .flatMap {
            case None => FastFuture.successful(AppError.render(ApiNotFound))
            case Some(api) =>
              ctx.setCtxValue("api.name", api.name)

              (for {
                myTeams <- env.dataStore.teamRepo.myTeams(ctx.tenant, ctx.user)
                pendingRequests <- env.dataStore.notificationRepo
                  .forTenant(ctx.tenant.id)
                  .findNotDeleted(
                    Json.obj(
                      "action.type" -> "ApiAccess",
                      "status.status" -> "Pending",
                      "action.api" -> api.id.asJson,
                      "action.team" -> Json
                        .obj("$in" -> JsArray(myTeams.map(_.id.asJson)))
                    )
                  )
                subscriptions <- env.dataStore.apiSubscriptionRepo
                  .forTenant(ctx.tenant.id)
                  .findNotDeleted(
                    Json.obj(
                      "api" -> api.id.value,
                      "team" -> Json
                        .obj("$in" -> JsArray(myTeams.map(_.id.asJson)))
                    )
                  )
              } yield {
                api
                  .asPublicWithAuthorizationsJson()
                  .as[JsObject] ++ Json.obj(
                  "pendingRequests" -> JsArray(pendingRequests.map(_.asJson)),
                  "subscriptions" -> JsArray(subscriptions.map(_.asSimpleJson)),
                  "myTeams" -> SeqTeamFormat.writes(myTeams),
                  "authorizations" -> JsArray(
                    myTeams
                      .filter(t => t.`type` != TeamType.Admin)
                      .map(team =>
                        Json.obj(
                          "team" -> team.id.asJson,
                          "authorized" -> (api.authorizedTeams
                            .contains(team.id) || api.team == team.id),
                          "pending" -> pendingRequests.exists(notif => {
                            val accessApi = notif.action.asInstanceOf[ApiAccess]
                            accessApi.team == team.id && accessApi.api == api.id
                          })
                      ))
                  )
                )
              }).map(p => Ok(p))
          }
      }
    }

  def transferApiOwnership(teamId: String, apiId: String) =
    DaikokuAction.async(parse.json) { ctx =>
      TeamAdminOnly(
        AuditTrailEvent(
          s"@{user.name} has transfer ownership of api @{api.name} to @{newTeam.name}"
        )
      )(teamId, ctx) { _ =>
        val newTeamName: String = (ctx.request.body \ "team").as[String]

        (for {
          newTeam <- EitherT.fromOptionF(
            env.dataStore.teamRepo
              .forTenant(ctx.tenant)
              .findOneNotDeleted(Json.obj("name" -> newTeamName)),
            AppError.render(TeamNotFound)
          )
          api <- EitherT.fromOptionF(
            env.dataStore.apiRepo
              .forTenant(ctx.tenant)
              .findByIdNotDeleted(apiId),
            AppError.render(ApiNotFound)
          )
          notification = Notification(
            id = NotificationId(BSONObjectID.generate().stringify),
            tenant = ctx.tenant.id,
            team = Some(newTeam.id),
            sender = ctx.user.asNotificationSender,
            action = NotificationAction.TransferApiOwnership(newTeam.id, api.id)
          )
          _ <- EitherT.liftF[Future, Result, Boolean](
            env.dataStore.notificationRepo
              .forTenant(ctx.tenant)
              .save(notification)
          )
        } yield {
          Ok(Json.obj("notify" -> true))
        }).merge
      }
    }

  def createNewPlan(teamId: String, apiId: String, version: String) =
    DaikokuAction.async(parse.json) { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(s"@{user.name} has created new plan @{plan.id} for api @{api.name} to @{newTeam.name}")
      )(teamId, ctx) { team =>
        val newPlan = ctx.request.body.as(UsagePlanFormat)

        def addProcess(api: Api, plan: UsagePlan): EitherT[Future, AppError, UsagePlan] = {
          val updatedPlan: UsagePlan = (plan.otoroshiTarget.forall(_.apikeyCustomization.customMetadata.isEmpty), plan.paymentSettings) match {
            case (true, None) => plan
            case (true, Some(settings)) => plan.addSubscriptionStep(ValidationStep.Payment(IdGenerator.token(32), settings.thirdPartyPaymentSettingsId))
            case (false, Some(settings)) => plan
            .addSubscriptionStep(ValidationStep.Payment(IdGenerator.token(32), settings.thirdPartyPaymentSettingsId))
            .addSubscriptionStep(ValidationStep.TeamAdmin(IdGenerator.token(32), api.team), 0.some)
            case (false, None) => plan.addSubscriptionStep(ValidationStep.TeamAdmin(IdGenerator.token(32), api.team), 0.some)
          }
          EitherT.pure[Future, AppError](updatedPlan)
        }

        (for {
          api <- EitherT.fromOptionF[Future, AppError, Api](env.dataStore.apiRepo.forTenant(ctx.tenant)
            .findOneNotDeleted(Json.obj("_id" -> apiId, "team" -> team.id.asJson, "currentVersion" -> version)), AppError.ApiNotFound)
          updatedPlan <- addProcess(api, newPlan)
          updatedApi = api.copy(possibleUsagePlans = api.possibleUsagePlans :+ updatedPlan.id)
          _ <- EitherT.liftF[Future, AppError, Boolean](env.dataStore.apiRepo.forTenant(ctx.tenant).save(updatedApi))
          _ <- EitherT.liftF[Future, AppError, Boolean](env.dataStore.usagePlanRepo.forTenant(ctx.tenant).save(updatedPlan))

        } yield Ok(updatedApi.asJson))
          .leftMap(_.render())
          .merge
      }
    }

  def updatePlan(teamId: String, apiId: String, version: String, planId: String) =
    DaikokuAction.async(parse.json) { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(s"@{user.name} has updated plan @{plan.id} for api @{api.name} to @{newTeam.name}")
      )(teamId, ctx) { team =>
        val updatedPlan = ctx.request.body.as(UsagePlanFormat)

        def getPlanAndCheckIt(oldPlan: UsagePlan, newPlan: UsagePlan): EitherT[Future, AppError, UsagePlan] = {
          oldPlan match {
            case _ if oldPlan.otoroshiTarget.map(_.otoroshiSettings) != newPlan.otoroshiTarget.map(_.otoroshiSettings) => EitherT.leftT(AppError.ForbiddenAction)
            // Handle type changes
            case _ if oldPlan.typeName != newPlan.typeName => EitherT.leftT(AppError.ForbiddenAction)
            //Handle prices changes or payment settings deletion (addition is really forbidden)
            case _ if oldPlan.paymentSettings != newPlan.paymentSettings => EitherT.leftT(AppError.ForbiddenAction)
            case p: UsagePlan.QuotasWithLimits if p.costPerMonth != newPlan.costPerMonth => EitherT.leftT(AppError.ForbiddenAction)
            case p: UsagePlan.QuotasWithoutLimits
              if p.costPerMonth != newPlan.costPerMonth || p.costPerAdditionalRequest != oldPlan.asInstanceOf[UsagePlan.QuotasWithoutLimits].costPerAdditionalRequest =>
              EitherT.leftT(AppError.ForbiddenAction)
            case p: UsagePlan.PayPerUse
              if p.costPerMonth != newPlan.costPerMonth || p.costPerRequest != oldPlan.asInstanceOf[UsagePlan.PayPerUse].costPerRequest =>
              EitherT.leftT(AppError.ForbiddenAction)
            //handle otoroshi target update
            case _ if !ctx.tenant.aggregationApiKeysSecurity.exists(identity) && newPlan.aggregationApiKeysSecurity.exists(identity) =>
              EitherT.leftT(AppError.SubscriptionAggregationDisabled)
            //it's forbidden to update otoroshi target, must use migration API instead
            case p if p.otoroshiTarget.map(_.otoroshiSettings) != newPlan.otoroshiTarget.map(_.otoroshiSettings) =>
              EitherT.leftT(AppError.ForbiddenAction)
            case _ => EitherT.pure(newPlan)
          }
        }

        def handleVisibilityToggling(oldPlan: UsagePlan, plan: UsagePlan, api: Api): EitherT[Future, AppError, UsagePlan] = {
          oldPlan match {
            case _ if plan.visibility != oldPlan.visibility =>
              plan.visibility match {
                case UsagePlanVisibility.Public => EitherT.pure(plan.removeAllAuthorizedTeams())
                case UsagePlanVisibility.Private =>
                  val future: Future[Either[AppError, UsagePlan]] = env.dataStore.apiSubscriptionRepo.forTenant(ctx.tenant)
                    .findNotDeleted(Json.obj("api" -> api.id.asJson, "plan" -> plan.id.asJson))
                    .map(subs => subs.map(_.team).distinct)
                    .map(x => Right(plan.addAutorizedTeams(x)))
                  val value: EitherT[Future, AppError, UsagePlan] = EitherT(future)
                  value
              }
            case _ => EitherT.pure(plan)
          }
        }

        def handleProcess(plan: UsagePlan, newPlan: UsagePlan, api: Api): EitherT[Future, AppError, UsagePlan] = {
          //FIXME rewrite the following code
          plan.some
            .map(oldPlan => {
              if (oldPlan.paymentSettings.isEmpty && newPlan.paymentSettings.isDefined) {
                (oldPlan, newPlan.addSubscriptionStep(ValidationStep.Payment(IdGenerator.token(32), newPlan.paymentSettings.get.thirdPartyPaymentSettingsId)))
              } else {
                (oldPlan, newPlan)
              }
            })
            .map { case (oldPlan, plan) =>
              if (oldPlan.paymentSettings.isDefined && plan.paymentSettings.isEmpty) {
                (oldPlan, plan.removeSubscriptionStep(step => step.name == "payment"))
              } else {
                (oldPlan, plan)
              }
            }
            .map { case (oldPlan, plan) =>
              if (oldPlan.otoroshiTarget.forall(_.apikeyCustomization.customMetadata.isEmpty) && plan.otoroshiTarget.exists(_.apikeyCustomization.customMetadata.nonEmpty)) {
                plan.addSubscriptionStep(ValidationStep.TeamAdmin(IdGenerator.token(32), api.team))
              } else {
                plan
              }
            } match {
            case Some(updatedPlan) => EitherT.pure[Future, AppError](updatedPlan)
            case None => EitherT.leftT[Future, UsagePlan](AppError.PlanNotFound)
          }
        }

        def runDemandUpdate(oldPlan: UsagePlan, updatedPlan: UsagePlan, api: Api): EitherT[Future, AppError, Unit] = {
          import fr.maif.otoroshi.daikoku.utils.RequestImplicits._

          implicit val c: DaikokuActionContext[JsValue] = ctx
          implicit val mat: Materializer = env.defaultMaterializer
          implicit val language: String = ctx.request.getLanguage(ctx.tenant)
          implicit val currentUser: User = ctx.user

          val res: Future[Either[AppError, Unit]] = env.dataStore.subscriptionDemandRepo.forTenant(ctx.tenant)
            .streamAllRaw(Json.obj(
              "api" -> api.id.asJson,
              "plan" -> updatedPlan.id.asJson,
              "$or" -> Json.arr(
                Json.obj("state" -> SubscriptionDemandState.InProgress.name),
                Json.obj("state" -> SubscriptionDemandState.Waiting.name),
              )))
            .map(json.SubscriptionDemandFormat.reads)
            .collect { case JsSuccess(demand, _) => demand }
            .mapAsync(1)(demand => {

              val newSteps = updatedPlan.subscriptionProcess.map(validationStep => {
                val demandStep = demand.steps.find(_.step.id == validationStep.id)

                SubscriptionDemandStep(
                  id = demandStep.map(_.id).getOrElse(SubscriptionDemandStepId(IdGenerator.token(32))),
                  state = demandStep.map(_.state).getOrElse(SubscriptionDemandState.Waiting),
                  step = validationStep,
                  metadata = demandStep.map(_.metadata).getOrElse(Json.obj())
                )
              })

              env.dataStore.subscriptionDemandRepo.forTenant(ctx.tenant).save(demand.copy(steps = newSteps))
            })
            .runWith(Sink.ignore)
            .map(_ => {
              updatedPlan.subscriptionProcess.foreach(step => {
                if (!oldPlan.subscriptionProcess.exists(_.id == step.id)) {
                  for {
                    demands <- env.dataStore.subscriptionDemandRepo.forTenant(ctx.tenant).findNotDeleted(Json.obj(
                      "api" -> api.id.asJson,
                      "plan" -> updatedPlan.id.asJson,
                      "$or" -> Json.arr(
                        Json.obj("state" -> SubscriptionDemandState.InProgress.name),
                        Json.obj("state" -> SubscriptionDemandState.Waiting.name),
                      )
                    ))
                    validators <- env.dataStore.stepValidatorRepo.forTenant(ctx.tenant).findNotDeleted(Json.obj(
                      "subscriptionDemand" -> Json.obj("$in" -> JsArray(demands.map(_.id.asJson))),
                      "step" -> step.id
                    ))
                    _ <- Future.sequence(validators.map(v => validateProcessWithStepValidator(v, ctx.tenant)).map(_.value))
                  } yield ()
                } else if (!oldPlan.subscriptionProcess.find(_.id == step.id).contains(step)) {
                  for {
                    demands <- env.dataStore.subscriptionDemandRepo.forTenant(ctx.tenant).findNotDeleted(Json.obj(
                      "api" -> api.id.asJson,
                      "plan" -> updatedPlan.id.asJson,
                      "$or" -> Json.arr(
                        Json.obj("state" -> SubscriptionDemandState.InProgress.name),
                        Json.obj("state" -> SubscriptionDemandState.Waiting.name),
                      )
                    ))
                    validators <- env.dataStore.stepValidatorRepo.forTenant(ctx.tenant).findNotDeleted(Json.obj(
                      "subscriptionDemand" -> Json.obj("$in" -> JsArray(demands.map(_.id.asJson))),
                      "step" -> step.id
                    ))
                    _ <- Future.sequence(demands
                      .filter(d => validators.exists(_.subscriptionDemand == d.id))
                      .map(d => apiService.runSubscriptionProcess(d.id, ctx.tenant))
                      .map(_.value))
                  } yield ()
                }
              }) match {
                case _ => Right(())
              }
            })


          val value: EitherT[Future, AppError, Unit] = EitherT(res)
          value
        }

        val value: EitherT[Future, AppError, Result] = for {
          api <- EitherT.fromOptionF(env.dataStore.apiRepo.forTenant(ctx.tenant)
            .findOneNotDeleted(Json.obj("_id" -> apiId, "team" -> team.id.asJson, "currentVersion" -> version)), AppError.ApiNotFound)
          oldPlan <- EitherT.fromOptionF(env.dataStore.usagePlanRepo.forTenant(ctx.tenant).findById(planId), AppError.PlanNotFound)
          _ <- EitherT.liftF(env.dataStore.subscriptionDemandRepo.forTenant(ctx.tenant)
            .updateManyByQuery(
              Json.obj("api" -> api.id.asJson, "plan" -> planId, "state" -> SubscriptionDemandState.InProgress.name),
              Json.obj(
                "$set" -> Json.obj("state" -> SubscriptionDemandState.Blocked.name)
              )))
          _ <- getPlanAndCheckIt(oldPlan, updatedPlan)
          handledUpdatedPlan <- handleVisibilityToggling(oldPlan, updatedPlan, api)
          updatedPlan <- handleProcess(oldPlan, handledUpdatedPlan, api)
          _ <- EitherT.liftF(env.dataStore.usagePlanRepo.forTenant(ctx.tenant).save(updatedPlan))
          _ <- EitherT.liftF(otoroshiSynchronisator.verify(Json.obj("api" -> api.id.value)))
          _ <- runDemandUpdate(oldPlan, updatedPlan, api)
          //FIXME: attention, peut etre il y en a qui sont blocked de base
          _ <- EitherT.liftF(env.dataStore.subscriptionDemandRepo.forTenant(ctx.tenant)
            .updateManyByQuery(
              Json.obj("api" -> api.id.asJson, "plan" -> planId, "state" -> SubscriptionDemandState.Blocked.name),
              Json.obj(
                "$set" -> Json.obj("state" -> SubscriptionDemandState.InProgress.name)
              )))
        } yield Ok(updatedPlan.asJson)

        value.leftMap(_.render()).merge
      }
    }

  def deletePlan(teamId: String, apiId: String, version: String, planId: String) =
    DaikokuAction.async { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(s"@{user.name} has deleted plan @{plan.id} for api @{api.name}")
      )(teamId, ctx) { team =>
        val value: EitherT[Future, AppError, Result] = for {
          api <- EitherT.fromOptionF(env.dataStore.apiRepo.forTenant(ctx.tenant)
            .findOneNotDeleted(Json.obj("_id" -> apiId, "team" -> team.id.asJson, "currentVersion" -> version)), AppError.ApiNotFound)
          plan <- EitherT.fromOptionF[Future, AppError, UsagePlan](env.dataStore.usagePlanRepo.forTenant(ctx.tenant).findById(planId), AppError.PlanNotFound)
          updatedApi = api.copy(possibleUsagePlans = api.possibleUsagePlans.filter(pp => pp.value != planId))
          _ <- EitherT.liftF(apiService.deleteApiPlansSubscriptions(Seq(plan), api, ctx.tenant, ctx.user))
          _ <- EitherT.liftF(env.dataStore.apiRepo.forTenant(ctx.tenant).save(updatedApi))
          _ <- EitherT.liftF(env.dataStore.usagePlanRepo.forTenant(ctx.tenant).deleteByIdLogically(planId))
          _ <- EitherT.liftF(env.dataStore.operationRepo.forTenant(ctx.tenant).save(
            Operation(
              DatastoreId(IdGenerator.token(24)),
              tenant = ctx.tenant.id,
              itemId = plan.id.value,
              itemType = ItemType.ThirdPartyProduct,
              action = OperationAction.Delete,
              payload = Json.obj(
                "paymentSettings" -> plan.paymentSettings.map(_.asJson).getOrElse(JsNull).as[JsValue],
              ).some
            )
          ))
        } yield Ok(updatedApi.asJson)

        value.leftMap(_.render()).merge
      }
    }


  def setupPayment(teamId: String, apiId: String, version: String, planId: String) =
    DaikokuAction.async(parse.json) { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(s"@{user.name} has setup payment for plan @{plan.id} of api @{api.name}")
      )(teamId, ctx) { team =>
        val paymentSettingsId = (ctx.request.body \ "paymentSettings" \ "thirdPartyPaymentSettingsId").as(ThirdPartyPaymentSettingsIdFormat)
        val base = ctx.request.body.as(BasePaymentInformationFormat)

        def getRatedPlan(api: Api, plan: UsagePlan, base: BasePaymentInformation): EitherT[Future, AppError, UsagePlan] = {
          plan match {
            case p: UsagePlan.QuotasWithLimits => EitherT.pure(p.mergeBase(base))
            case p: UsagePlan.QuotasWithoutLimits =>
              val costPerAdditionalRequest = (ctx.request.body \ "costPerAdditionalRequest").as[BigDecimal]
              val ratedPlan = p.mergeBase(base).copy(costPerAdditionalRequest = costPerAdditionalRequest)
              EitherT.pure(ratedPlan)
            case p: UsagePlan.PayPerUse =>
              val costPerRequest = (ctx.request.body \ "costPerRequest").as[BigDecimal]
              val ratedPlan = p.mergeBase(base).copy(costPerRequest = costPerRequest)
              EitherT.pure(ratedPlan)
            case _ => EitherT.leftT[Future, UsagePlan](AppError.PlanUnauthorized)
          }
        }

        val value: EitherT[Future, AppError, Result] = for {
          api <- EitherT.fromOptionF(env.dataStore.apiRepo.forTenant(ctx.tenant)
            .findOneNotDeleted(Json.obj("_id" -> apiId, "team" -> team.id.asJson, "currentVersion" -> version)), AppError.ApiNotFound)
          plan <- EitherT.fromOptionF[Future, AppError, UsagePlan](env.dataStore.usagePlanRepo.forTenant(ctx.tenant).findById(planId), AppError.PlanNotFound)
          _ <- plan.paymentSettings match {
            case Some(_) => EitherT.leftT[Future, Unit](AppError.EntityConflict("Payment,  already setup"))
            case None => EitherT.pure[Future, AppError](())
          }
          ratedPlan <- getRatedPlan(api, plan, base)
          paymentSettings <- paymentClient.createProduct(ctx.tenant, api, ratedPlan, paymentSettingsId)

          ratedPlanwithSettings = ratedPlan match {
            case p: UsagePlan.QuotasWithLimits =>
              p.copy(paymentSettings = paymentSettings.some)
                .addSubscriptionStep(ValidationStep.Payment(
                  id = IdGenerator.token(32),
                  thirdPartyPaymentSettingsId = paymentSettings.thirdPartyPaymentSettingsId))
            case p: UsagePlan.QuotasWithoutLimits =>
              p.copy(paymentSettings = paymentSettings.some)
                .addSubscriptionStep(ValidationStep.Payment(
                  id = IdGenerator.token(32),
                  thirdPartyPaymentSettingsId = paymentSettings.thirdPartyPaymentSettingsId
                ))
            case p: UsagePlan.PayPerUse =>
              p.copy(paymentSettings = paymentSettings.some)
                .addSubscriptionStep(ValidationStep.Payment(
                  id = IdGenerator.token(32),
                  thirdPartyPaymentSettingsId = paymentSettings.thirdPartyPaymentSettingsId
                ))
            case p: UsagePlan => p
          }

          _ <- EitherT.liftF(env.dataStore.usagePlanRepo.forTenant(ctx.tenant).save(ratedPlanwithSettings))
        } yield Ok(ratedPlanwithSettings.asJson)

        value.leftMap(_.render()).merge
      }
    }
  def stopPayment(teamId: String, apiId: String, version: String, planId: String) =
    DaikokuAction.async(parse.json) { ctx =>
      TeamAdminOnly(
        AuditTrailEvent(s"@{user.name} has created new plan @{plan.id} for api @{api.name} to @{newTeam.name}")
      )(teamId, ctx) { team =>

        val value: EitherT[Future, Result, Result] = for {
          api <- EitherT.fromOptionF(env.dataStore.apiRepo.forTenant(ctx.tenant).findById(apiId), AppError.ApiNotFound.render())
          //todo: save api
          //todo: run job to "close payment"
          //todo: close pricing in stripe ?
        } yield (Ok(Json.obj()))

        value.merge
      }
    }
}
