package fr.maif.otoroshi.daikoku.utils

import fr.maif.otoroshi.daikoku.domain.Tenant
import fr.maif.otoroshi.daikoku.env.Env
import play.api.i18n.{Lang, MessagesApi}
import play.api.libs.json.Json

import scala.concurrent.Future

class Translator {
  def translate(key: String, language: String, args: Map[String, String] = Map.empty)(implicit messagesApi: MessagesApi, env: Env, tenant: Tenant): Future[String] = {
    implicit val ec = env.defaultExecutionContext
    implicit val mat = env.defaultMaterializer

    env.dataStore.translationRepo.forTenant(tenant)
      .findOne(Json.obj("key" -> key, "language" -> language))
      .map {
        case None => messagesApi(key)(lang = Lang(language))
        case Some(translation) => translation.value
      }
      .map { value =>
          args.zipWithIndex.foldLeft(value) {
            (acc, a) =>
              val idx = s"{${a._2-1}}"
              acc.replaceAll(idx, a._1.toString)
          }
      }
  }
}
