package fr.maif.otoroshi.daikoku.domain

import fr.maif.otoroshi.daikoku.actions.DaikokuActionContext
import fr.maif.otoroshi.daikoku.audit.AuditTrailEvent
import fr.maif.otoroshi.daikoku.ctrls.authorizations.async._UberPublicUserAccess
import fr.maif.otoroshi.daikoku.env.Env
import play.api.libs.json.{JsArray, JsValue, Json}
import sangria.schema.{Field, IntType}
import storage.DataStore

import scala.concurrent.ExecutionContext

object NotificationsQueries {
  case class Error(message: String) extends Exception(message)

  def myUnreadNotificationsCount()(implicit ev: Env, ec: ExecutionContext): Field[(DataStore, DaikokuActionContext[JsValue]), Unit] =
    Field("myUnreadNotificationsCount", IntType, resolve = ctx => {
      _UberPublicUserAccess(AuditTrailEvent(s"@{user.name} has accessed to his count of unread notifications"))(ctx.ctx._2) {
        val dataStore = ctx.ctx._1
        val context = ctx.ctx._2
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
      }.map {
        case Left(value) => value
        case Right(r) => throw Error(r.toString)
      }
    })

  def queries()(implicit env: Env, ec: ExecutionContext) = List(myUnreadNotificationsCount())
}
