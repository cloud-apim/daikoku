package jobs

import akka.actor.Cancellable
import akka.http.scaladsl.util.FastFuture
import cats.data.{EitherT, OptionT}
import controllers.AppError
import fr.maif.otoroshi.daikoku.ctrls.PaymentClient
import fr.maif.otoroshi.daikoku.domain._
import fr.maif.otoroshi.daikoku.env.Env
import fr.maif.otoroshi.daikoku.logger.AppLogger
import fr.maif.otoroshi.daikoku.utils.ApiService
import org.joda.time.DateTime
import play.api.Logger
import play.api.libs.json._

import java.util.concurrent.atomic.AtomicReference
import scala.concurrent.duration.DurationInt
import scala.concurrent.{ExecutionContext, Future}

class QueueJob(
    env: Env,
    apiKeyStatsJob: ApiKeyStatsJob,
    apiService: ApiService,
    paymentClient: PaymentClient
) {
  private val logger = Logger("OtoroshiDeletionJob")

  implicit val ec: ExecutionContext = env.defaultExecutionContext
  implicit val ev: Env = env

  private val ref = new AtomicReference[Cancellable]()

  def start(): Unit = {
    if (!env.config.deletionByCron && ref.get() == null) {
      logger.info("Start deletion job")
      logger.info(s"deletion by cron ==> every ${env.config.deletionInterval}")
      ref.set(
        env.defaultActorSystem.scheduler
          .scheduleAtFixedRate(10.seconds, env.config.deletionInterval) { () =>
            deleteFirstOperation()
          }
      )
    }
  }

  def stop(): Unit = {
    Option(ref.get()).foreach(_.cancel())
  }

  //*************************
  //*** ELEMENTS DELETION ***
  //*************************

  private def deleteApiNotifications(api: Api): Future[Boolean] = {
    env.dataStore.notificationRepo
      .forTenant(api.tenant)
      .deleteLogically(Json.obj(
        "action.type" ->
          Json.obj("$in" -> JsArray(Seq(
            "ApiAccess",
            "ApiSubscription",
            "ApiSubscriptionAccept",
            "ApiSubscriptionReject",
            "NewPostPublished",
            "NewIssueOpen",
            "NewCommentOnIssue",
            "TransferApiOwnership"
          ).map(JsString))),
        "$or" -> Json.arr(
          Json.obj("action.api" -> api.id.asJson),
          Json.obj("action.apiName" -> JsString(api.name)),
        )
      ))
  }

  private def deleteSubscriptionNotifications(
      subscription: ApiSubscription): Future[Boolean] = {
    env.dataStore.notificationRepo
      .forTenant(subscription.tenant)
      .deleteLogically(Json.obj(
        "action.type" ->
          Json.obj(
            "$in" -> JsArray(
              Seq(
                "ApiKeyRotationInProgress",
                "ApiKeyRotationEndend",
                "ApiKeyRefresh"
              ).map(JsString))),
        "$or" -> Json.arr(
          Json.obj("action.clientId" -> JsString(subscription.apiKey.clientId)),
          Json.obj("action.subscription" -> subscription.id.asJson),
        )
      ))
  }

  private def deleteTeamNotifications(team: Team): Future[Boolean] = {
    env.dataStore.notificationRepo
      .forTenant(team.tenant)
      .deleteLogically(Json.obj(
        "action.type" ->
          Json.obj(
            "$in" -> JsArray(
              Seq(
                "TeamAccess",
                "TeamInvitation",
                "ApiSubscription",
                "ApiSubscriptionAccept",
                "ApiSubscriptionReject",
                "TransferApiOwnership"
              ).map(JsString))),
        "action.team" -> team.id.asJson
      ))
  }

  private def deleteUserNotifications(user: User,
                                      tenant: TenantId): Future[Boolean] = {
    env.dataStore.notificationRepo
      .forTenant(tenant)
      .deleteLogically(
        Json.obj(
          "action.type" ->
            Json.obj(
              "$in" -> JsArray(Seq(
                "TeamInvitation"
              ).map(JsString))),
          "action.user" -> user.id.asJson
        ))
  }

  private def deleteUserMessages(user: User, tenant: TenantId): Future[Long] = {
    env.dataStore.teamRepo
      .forTenant(tenant)
      .findOne(Json.obj("type" -> "Admin"))
      .flatMap {
        case Some(adminTeam)
            if !adminTeam.users.exists(u => u.userId == user.id) =>
          env.dataStore.messageRepo
            .forTenant(tenant)
            .updateMany(
              Json.obj(
                "$or" -> Json.arr(
                  Json.obj("sender" -> user.id.asJson),
                  Json.obj("participants" -> user.id.asJson)
                )
              ),
              Json.obj("closed" -> JsNumber(DateTime.now().toDate.getTime))
            )
        case None => FastFuture.successful(0L)
      }
  }

  private def deleteApi(o: Operation): Future[Unit] = {
    {
      (for {
        api <- OptionT(
          env.dataStore.apiRepo
            .forTenant(o.tenant)
            .findByIdNotDeleted(o.itemId))
        _ <- OptionT.liftF(
          env.dataStore.operationRepo
            .forTenant(o.tenant)
            .save(o.copy(status = OperationStatus.InProgress)))
        _ <- OptionT.liftF(
          env.dataStore.apiPostRepo
            .forTenant(o.tenant)
            .deleteLogically(Json.obj(
              "_id" -> Json.obj("$in" -> JsArray(api.posts.map(_.asJson))))))
        _ <- OptionT.liftF(
          env.dataStore.apiIssueRepo
            .forTenant(o.tenant)
            .deleteLogically(Json.obj(
              "_id" -> Json.obj("$in" -> JsArray(api.issues.map(_.asJson))))))
        _ <- OptionT.liftF(
          env.dataStore.apiDocumentationPageRepo
            .forTenant(o.tenant)
            .deleteLogically(Json.obj("_id" -> Json.obj(
              "$in" -> JsArray(api.documentation.docIds().map(JsString))))))
        _ <- OptionT.liftF(deleteApiNotifications(api))
        _ <- OptionT.liftF(env.dataStore.operationRepo.forTenant(o.tenant).deleteById(o.id))
      } yield ()).value
        .map(_ =>
          logger.debug(
            s"[deletion job] :: api ${o.itemId} successfully deleted"))
        .recover(e => {
          logger.error(
            s"[deletion job] :: [id ${o.id.value}] :: error during deletion of api ${o.itemId}: $e")
          env.dataStore.operationRepo
            .forTenant(o.tenant)
            .save(o.copy(status = OperationStatus.Error))
        })
    }
  }

  private def deleteSubscription(o: Operation): Future[Unit] = {
    val value: EitherT[Future, AppError, Unit] = for {
      _ <- EitherT.liftF(env.dataStore.operationRepo.forTenant(o.tenant).save(o.copy(status = OperationStatus.InProgress)))
      tenant <- EitherT.fromOptionF(env.dataStore.tenantRepo.findById(o.tenant), AppError.TenantNotFound)
      subscription <- EitherT.fromOptionF(env.dataStore.apiSubscriptionRepo.forTenant(o.tenant).findById(o.itemId), AppError.EntityNotFound("subscription"))
      api <- EitherT.fromOptionF(env.dataStore.apiRepo.forTenant(o.tenant).findById(subscription.api), AppError.ApiNotFound)
      plan <- EitherT.fromOption[Future](api.possibleUsagePlans.find(p => p.id == subscription.plan)
        .orElse(o.payload.map(json.UsagePlanFormat.reads).collect { case JsSuccess(value, _) => value}), AppError.PlanNotFound)
      //todo: send notification & mail ?
      _ <- EitherT.liftF(apiService.archiveApiKey(tenant, subscription, plan, enabled = false))
      _ <- EitherT.liftF(apiKeyStatsJob.syncForSubscription(subscription, tenant, completed = true))
      - <- EitherT.liftF(paymentClient.deleteThirdPartySubscription(subscription).value)
      _ <- EitherT.liftF(env.dataStore.apiSubscriptionRepo.forTenant(tenant).deleteByIdLogically(subscription.id))
      _ <- EitherT.liftF(deleteSubscriptionNotifications(subscription))
    } yield ()

    value.value
      .flatMap {
        case Left(error) =>
          logger.error(s"[deletion job] :: [id ${o.id.value}] :: error during deletion of subscription ${o.itemId}: ${error.getErrorMessage()}")
          env.dataStore.operationRepo
            .forTenant(o.tenant)
            .save(o.copy(status = OperationStatus.Error))
            .map(_ => ())
        case Right(_) =>
          logger.debug(s"[deletion job] :: subscription ${o.itemId} successfully deleted")
          env.dataStore.operationRepo.forTenant(o.tenant).deleteById(o.id)
      }.map(_ => ())
  }

  private def deleteTeam(o: Operation): Future[Unit] = {
    (for {
      team <- OptionT(
        env.dataStore.teamRepo.forTenant(o.tenant).findById(o.itemId))
      _ <- OptionT.liftF(
        env.dataStore.operationRepo
          .forTenant(o.tenant)
          .save(o.copy(status = OperationStatus.InProgress)))
      _ <- OptionT.liftF(
        env.dataStore.operationRepo.forTenant(o.tenant).deleteById(o.id))
      _ <- OptionT.liftF(deleteTeamNotifications(team))
    } yield ()).value
      .map(_ =>
        logger.debug(
          s"[deletion job] :: team ${o.itemId} successfully deleted"))
      .recover(e => {
        logger.error(
          s"[deletion job] :: [id ${o.id}] :: error during deletion of team ${o.itemId}: $e")
        env.dataStore.operationRepo
          .forTenant(o.tenant)
          .save(o.copy(status = OperationStatus.Error))
      })
  }

  private def deleteUser(o: Operation): Future[Unit] = {
    (for {
      user <- OptionT(env.dataStore.userRepo.findById(o.itemId))
      _ <- OptionT.liftF(
        env.dataStore.operationRepo
          .forTenant(o.tenant)
          .save(o.copy(status = OperationStatus.InProgress)))
      _ <- OptionT.liftF(
        env.dataStore.operationRepo.forTenant(o.tenant).deleteById(o.id))
      _ <- OptionT.liftF(deleteUserNotifications(user, o.tenant))
      _ <- OptionT.liftF(deleteUserMessages(user, o.tenant))
    } yield ()).value
      .map(_ =>
        logger.debug(
          s"[deletion job] :: user ${o.itemId} successfully deleted"))
      .recover(e => {
        logger.error(
          s"[deletion job] :: [id ${o.id}] :: error during deletion of user ${o.itemId}: $e")
        env.dataStore.operationRepo
          .forTenant(o.tenant)
          .save(o.copy(status = OperationStatus.Error))
      })
  }

  //***************************
  //*** THIRD PARTY PAYMENT ***
  //***************************


  private def syncConsumption(o: Operation): Future[Unit] = {
    //todo: use eitherT instead of OptionT
    (for {
      consumption <- OptionT(env.dataStore.consumptionRepo.forTenant(o.tenant).findByIdNotDeleted(o.itemId))
      api <- OptionT(env.dataStore.apiRepo.forTenant(o.tenant).findByIdNotDeleted(consumption.api))
      plan <- OptionT.fromOption[Future](api.possibleUsagePlans.find(_.id == consumption.plan))
      _ <- OptionT.liftF(paymentClient.syncWithThirdParty(consumption, plan))
      _ <- OptionT.liftF(env.dataStore.operationRepo.forTenant(o.tenant).deleteById(o.id))
    } yield ())
      .value.map(_ => ())
  }

  private def deleteThirdPartySubscription(o: Operation): Future[Unit] = {
    (for {
      _ <- EitherT.liftF(env.dataStore.operationRepo.forTenant(o.tenant).save(o.copy(status = OperationStatus.InProgress)))
      apiSubscription <- EitherT.fromOptionF(env.dataStore.apiSubscriptionRepo.forTenant(o.tenant).findById(o.itemId), AppError.EntityNotFound("api subscription"))
      _ <- paymentClient.deleteThirdPartySubscription(apiSubscription)
    } yield ()).value.map {
      case Left(value) =>
        AppLogger.error(s"[QUEUE JOB] :: ${o.id.value} :: ERROR : ${value.getErrorMessage()}")
        env.dataStore.operationRepo
          .forTenant(o.tenant)
          .save(o.copy(status = OperationStatus.Error))

      case Right(_) => env.dataStore.operationRepo.forTenant(o.tenant).deleteById(o.id)
    }.flatten.map(_ => ())
  }

//  private def deleteThirdPartyProduct(o: Operation): Future[Unit] = {
//    env.dataStore.operationRepo.forTenant(o.tenant).save(o.copy(status = OperationStatus.InProgress))
//      .flatMap(_ => o.payload match {
//        case Some(settings) => json.PaymentSettingsFormat.reads(settings) match {
//          case JsSuccess(paymentSettings, _) => paymentClient.deleteThirdPartyProduct(paymentSettings, o.tenant).value
//            .flatMap(_ => env.dataStore.operationRepo.forTenant(o.tenant).deleteById(o.id))
//          case JsError(_) => env.dataStore.operationRepo.forTenant(o.tenant).save(o.copy(status = OperationStatus.Error))
//        }
//        case None => env.dataStore.operationRepo.forTenant(o.tenant).save(o.copy(status = OperationStatus.Error))
//      }).map(_ => ())
//  }

  //***************************
  //***************************


  def deleteFirstOperation(): Future[Unit] = {
    env.dataStore.operationRepo
      .forAllTenant()
      .findOne(
        Json.obj(
          "$and" -> Json.arr(
            Json.obj("status" -> Json.obj("$ne" -> OperationStatus.Error.name)),
            Json.obj("status" -> OperationStatus.Idle.name)
          )))
      .flatMap {
        case Some(operation) =>
          ((operation.itemType, operation.action) match {
            case (ItemType.Subscription, OperationAction.Delete) =>
              deleteSubscription(operation)
            case (ItemType.Api, OperationAction.Delete) => deleteApi(operation)
            case (ItemType.Team, OperationAction.Delete) =>
              deleteTeam(operation)
            case (ItemType.User, OperationAction.Delete) =>
              deleteUser(operation)
            case (ItemType.ThirdPartySubscription, OperationAction.Delete) =>
              deleteThirdPartySubscription(operation)
            case (ItemType.ApiKeyConsumption, OperationAction.Sync) =>
              syncConsumption(operation)
            case (_, _) => FastFuture.successful(())
          }).flatMap(_ => deleteFirstOperation())
        case None =>
          FastFuture.successful(())
      }
  }
}
