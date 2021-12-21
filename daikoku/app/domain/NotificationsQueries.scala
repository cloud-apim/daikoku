package fr.maif.otoroshi.daikoku.domain

import controllers.AppError
import fr.maif.otoroshi.daikoku.actions.DaikokuActionContext
import fr.maif.otoroshi.daikoku.audit.AuditTrailEvent
import fr.maif.otoroshi.daikoku.ctrls.authorizations.async.{_UberPublicUserAccess}
import fr.maif.otoroshi.daikoku.env.Env
import play.api.libs.json.{JsArray, JsValue, Json}
import sangria.schema.{Context, _}
import storage.DataStore

import scala.concurrent.{ExecutionContext, Future}

class NotificationsQueries(ns: SchemaDefinition) {
  def myUnreadNotificationsCount()(implicit ev: Env, ec: ExecutionContext): Field[(DataStore, DaikokuActionContext[JsValue]), Unit] =
    Field("myUnreadNotificationsCount", IntType, resolve = ctx => {
      wrappedAccess(_UberPublicUserAccess(AuditTrailEvent(s"@{user.name} has accessed to his count of unread notifications"))(ctx.ctx._2) {
        spreadContext((dataStore, context) => {
          for {
            myTeams <- dataStore.teamRepo.myTeams(context.tenant, context.user)
            notificationRepo <- dataStore.notificationRepo.forTenantF(context.tenant.id)
            youHaveUnreadNotifications <- notificationRepo.findNotDeleted(
              Json.obj(
                "status.status" -> "Pending",
                "$or" -> Json.arr(
                  Json.obj(
                    "team" -> Json.obj("$in" -> JsArray(myTeams
                      .filter(t => t.admins().contains(context.user.id))
                      .map(_.id.asJson)))),
                  Json.obj("action.user" -> context.user.id.asJson)
                )
              )
            )
          } yield {
            context.setCtxValue("notifications", youHaveUnreadNotifications.size)
            youHaveUnreadNotifications.size
          }
        }, ctx)
      })
    })

  def wrappedAccess[B](f: => Future[Either[B, AppError]])(implicit ec: ExecutionContext) = {
      f.map {
        case Left(value) => value
        case Right(r) => throw NotAuthorizedError(r.toString)
      }
  }

  def spreadContext[B](f: (DataStore, DaikokuActionContext[JsValue]) => Future[B],
                       ctx: Context[(DataStore, DaikokuActionContext[JsValue]), Unit]) = {
    val dataStore = ctx.ctx._1
    val context = ctx.ctx._2
    f(dataStore, context)
  }

    def queries()(implicit env: Env, ec: ExecutionContext) = List(
      myUnreadNotificationsCount()
    )
}
