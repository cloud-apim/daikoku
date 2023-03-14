package fr.maif.otoroshi.daikoku.utils

import java.util.concurrent.ConcurrentHashMap
import akka.http.scaladsl.model.Uri
import fr.maif.otoroshi.daikoku.domain.Tenant
import play.api.mvc.RequestHeader

import scala.util.Try

object RequestImplicits {

  private val uriCache = new ConcurrentHashMap[String, String]()

  implicit class EnhancedRequestHeader(val requestHeader: RequestHeader)
      extends AnyVal {
    def relativeUri: String = {
      val uri = requestHeader.uri
      uriCache.computeIfAbsent(uri, _ => {
        Try(Uri(uri).toRelative.toString()).getOrElse(uri)
      })
    }
    def theProtocol: String = {
      requestHeader.headers
        .get("X-Forwarded-Proto")
        .orElse(requestHeader.headers.get("X-Forwarded-Protocol"))
        .map(_ == "https")
        .orElse(Some(requestHeader.secure))
        .map {
          case true  => "https"
          case false => "http"
        }
        .getOrElse("http")
    }

    def theHost: String = {
      requestHeader.headers
        .get("Otoroshi-Proxied-Host")
        .orElse(requestHeader.headers.get("X-Forwarded-Host"))
        .getOrElse(requestHeader.host)
    }

    def getLanguage(tenant: Tenant): String = {
      requestHeader.headers.toSimpleMap
      .find (test => test._1 == "X-contact-language")
      .map (h => h._2)
      .orElse (tenant.defaultLanguage)
      .getOrElse ("en")
    }
  }
}
