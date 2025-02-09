package fr.maif.otoroshi.daikoku.ctrls

import org.apache.pekko.http.scaladsl.util.FastFuture
import org.apache.pekko.stream.scaladsl.Source
import org.apache.pekko.util.ByteString
import fr.maif.otoroshi.daikoku.actions.{
  DaikokuAction,
  DaikokuActionMaybeWithGuest,
  DaikokuTenantAction
}
import fr.maif.otoroshi.daikoku.audit.AuditTrailEvent
import fr.maif.otoroshi.daikoku.ctrls.authorizations.async._
import fr.maif.otoroshi.daikoku.domain.AssetId
import fr.maif.otoroshi.daikoku.env.Env
import fr.maif.otoroshi.daikoku.logger.AppLogger
import fr.maif.otoroshi.daikoku.utils.IdGenerator
import org.apache.pekko.stream.connectors.s3.ObjectMetadata
import play.api.http.HttpEntity
import play.api.libs.json.{JsArray, Json}
import play.api.libs.streams.Accumulator
import play.api.mvc.{
  AbstractController,
  Action,
  BodyParser,
  ControllerComponents
}

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt
import scala.jdk.CollectionConverters._

trait NormalizeSupport {

  import java.text.Normalizer.{normalize => jnormalize, _}

  def normalize(in: String): String = {
    val cleaned = in.trim.toLowerCase
    val tuple = cleaned.splitAt(cleaned.lastIndexOf('.'))

    val normalized = jnormalize(tuple._1, Form.NFC)

    val fileNameNormalized = normalized
      .replaceAll("'s", "")
      .replaceAll("ß", "ss")
      .replaceAll("ø", "o")
      .replaceAll("[^a-zA-Z0-9-]+", "-")
      .replaceAll("-+", "-")
      .stripSuffix("-")

    fileNameNormalized + tuple._2
  }
}

object NormalizeSupport extends NormalizeSupport

class TeamAssetsController(
    DaikokuAction: DaikokuAction,
    DaikokuActionMaybeWithGuest: DaikokuActionMaybeWithGuest,
    env: Env,
    cc: ControllerComponents
) extends AbstractController(cc)
    with NormalizeSupport {

  implicit val ec: ExecutionContext = env.defaultExecutionContext
  implicit val ev: Env = env

  val bodyParser: BodyParser[Source[ByteString, _]] =
    BodyParser("Assets parser") { _ =>
      Accumulator.source[ByteString].map(Right.apply)
    }

  val illegalTeamAssetContentTypes: Seq[String] =
    Seq("text/html", "text/css", "text/javascript", "application/x-javascript")

  def storeAsset(teamId: String): Action[Source[ByteString, _]] =
    DaikokuAction.async(bodyParser) { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(s"@{user.name} stores asset in team @{team.id}")
      )(teamId, ctx) { team =>
        val contentType = ctx.request.headers
          .get("Asset-Content-Type")
          .orElse(ctx.request.contentType)
          .getOrElse("application/octet-stream")
        val filename = normalize(
          ctx.request
            .getQueryString("filename")
            .getOrElse(IdGenerator.token(16))
        )
        val title = ctx.request.getQueryString("title").getOrElse("--")
        val desc = ctx.request.getQueryString("desc").getOrElse("--")
        val assetId = AssetId(IdGenerator.uuid)
        ctx.tenant.bucketSettings match {
          case None =>
            FastFuture.successful(
              NotFound(Json.obj("error" -> "No bucket config found !"))
            )
          case Some(_) if illegalTeamAssetContentTypes.contains(contentType) =>
            FastFuture.successful(
              Forbidden(Json.obj("error" -> "content type is not allowed"))
            )
          case Some(cfg) =>
            env.assetsStore
              .storeAsset(
                ctx.tenant.id,
                team.id,
                assetId,
                filename,
                title,
                desc,
                contentType,
                ctx.request.body
              )(cfg)
              .map { res =>
                Ok(Json.obj("done" -> true, "id" -> assetId.value))
              } recover {
              case e: fr.maif.otoroshi.daikoku.utils.BadFileContentFromContentType =>
                BadRequest(Json.obj("error" -> "Bad file content"))
              case e =>
                AppLogger.error(
                  s"Error during team asset storage: ${e.getMessage}",
                  e
                )
                InternalServerError(Json.obj("error" -> e.toString))
            }
        }
      }
    }

  def replaceAsset(
      teamId: String,
      assetId: String
  ): Action[Source[ByteString, _]] =
    DaikokuAction.async(bodyParser) { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(s"@{user.name} replace asset in team @{team.id}")
      )(teamId, ctx) { team =>
        def getMetaHeaderValue(
            metadata: ObjectMetadata,
            headerName: String
        ): Option[String] = {
          metadata.headers.asScala
            .find(_.name() == s"x-amz-meta-$headerName")
            .map(_.value())
        }

        val requestContentType = ctx.request.headers
          .get("Asset-Content-Type")
          .orElse(ctx.request.contentType)
          .getOrElse("application/octet-stream")

        ctx.tenant.bucketSettings match {
          case None =>
            FastFuture.successful(
              NotFound(Json.obj("error" -> "No bucket config found !"))
            )
          case Some(cfg) =>
            env.assetsStore
              .getAssetMetaHeaders(ctx.tenant.id, team.id, AssetId(assetId))(
                cfg
              )
              .flatMap {
                case None =>
                  FastFuture.successful(
                    NotFound(Json.obj("error" -> "Asset not found"))
                  )
                case Some(metadata)
                    if metadata.contentType.get != requestContentType =>
                  FastFuture.successful(
                    Forbidden(
                      Json.obj(
                        "error" -> "content type is different from the original"
                      )
                    )
                  )
                case Some(_)
                    if illegalTeamAssetContentTypes.contains(
                      requestContentType
                    ) =>
                  FastFuture.successful(
                    Forbidden(
                      Json.obj("error" -> "content type is not allowed")
                    )
                  )
                case Some(metadata) =>
                  val filename =
                    getMetaHeaderValue(metadata, "filename").getOrElse("--")
                  val desc =
                    getMetaHeaderValue(metadata, "desc").getOrElse("--")
                  val title =
                    getMetaHeaderValue(metadata, "title").getOrElse("--")
                  val contentType = metadata.contentType
                    .orElse(ctx.request.contentType)
                    .getOrElse("application/octet-stream")

                  env.assetsStore
                    .storeAsset(
                      ctx.tenant.id,
                      team.id,
                      AssetId(assetId),
                      filename,
                      title,
                      desc,
                      contentType,
                      ctx.request.body
                    )(cfg)
                    .map { res =>
                      Ok(Json.obj("done" -> true, "id" -> assetId))
                    } recover {
                    case e =>
                      AppLogger.error(
                        s"Error during update tenant asset: $filename",
                        e
                      )
                      InternalServerError(Json.obj("error" -> ec.toString))
                  }
              }
        }
      }
    }

  def listAssets(teamId: String) =
    DaikokuAction.async { ctx =>
      TeamAdminOrTenantAdminOnly(
        AuditTrailEvent(
          s"@{user.name} listed assets of team @{team.name} - @{team.id}"
        )
      )(teamId, ctx) { team =>
        ctx.tenant.bucketSettings match {
          case None =>
            FastFuture.successful(
              NotFound(Json.obj("error" -> "No bucket config found !"))
            )
          case Some(cfg) =>
            env.assetsStore.listAssets(ctx.tenant.id, team.id)(cfg).map { res =>
              Ok(JsArray(res.map(_.asJson)))
            }
        }
      }
    }

  def deleteAsset(teamId: String, assetId: String) =
    DaikokuAction.async { ctx =>
      TeamApiEditorOnly(
        AuditTrailEvent(s"@{user.name} deleted asset @{assetId} of @{team.id}")
      )(teamId, ctx) { team =>
        ctx.setCtxValue("assetId", assetId)
        ctx.tenant.bucketSettings match {
          case None =>
            FastFuture.successful(
              NotFound(Json.obj("error" -> "No bucket config found !"))
            )
          case Some(cfg) =>
            env.assetsStore
              .deleteAsset(ctx.tenant.id, team.id, AssetId(assetId))(cfg)
              .map { res =>
                Ok(Json.obj("done" -> true))
              }
        }
      }
    }

  def getAsset(teamId: String, assetId: String) =
    DaikokuActionMaybeWithGuest.async { ctx =>
      // TODO: validate if usser has right to see the asset based on team and api
      UberPublicUserAccess(
        AuditTrailEvent(
          s"@{user.name} accessed asset @{assetId} on team @{teamId}"
        )
      )(ctx) {
        ctx.setCtxValue("teamId", teamId)
        ctx.setCtxValue("assetId", assetId)
        ctx.tenant.bucketSettings match {
          case None =>
            FastFuture.successful(
              NotFound(Json.obj("error" -> "No bucket config found !"))
            )
          case Some(cfg) =>
            env.dataStore.teamRepo
              .forTenant(ctx.tenant)
              .findById(teamId)
              .flatMap {
                case None =>
                  FastFuture.successful(
                    NotFound(Json.obj("error" -> "Team not found!"))
                  )
                case Some(team) =>
                  env.assetsStore
                    .getAsset(ctx.tenant.id, team.id, AssetId(assetId))(cfg)
                    .map {
                      case Some((source, meta)) =>
                        val filename = meta.metadata
                          .filter(_.name().startsWith("x-amz-meta-"))
                          .find(_.name() == "x-amz-meta-filename")
                          .map(_.value())
                          .getOrElse("asset.txt")
                        val disposition =
                          ("Content-Disposition" -> s"""attachment; filename="$filename"""")
                        if (
                          ctx.request
                            .getQueryString("download")
                            .exists(_ == "true")
                        ) {
                          Ok.sendEntity(
                              HttpEntity.Streamed(
                                source,
                                None,
                                meta.contentType
                                  .map(Some.apply)
                                  .getOrElse(Some("application/octet-stream"))
                              )
                            )
                            .withHeaders(disposition)
                        } else {
                          Ok.sendEntity(
                            HttpEntity.Streamed(
                              source,
                              None,
                              meta.contentType
                                .map(Some.apply)
                                .getOrElse(Some("application/octet-stream"))
                            )
                          )
                        }
                      case None =>
                        NotFound(Json.obj("error" -> "Asset not found!"))
                    }
              }
        }
      }
    }
}

class TenantAssetsController(
    DaikokuAction: DaikokuAction,
    DaikokuTenantAction: DaikokuTenantAction,
    env: Env,
    cc: ControllerComponents
) extends AbstractController(cc)
    with NormalizeSupport {

  implicit val ec: ExecutionContext = env.defaultExecutionContext
  implicit val ev: Env = env

  val bodyParser: BodyParser[Source[ByteString, _]] =
    BodyParser("Assets parser") { _ =>
      Accumulator.source[ByteString].map(Right.apply)
    }

  def storeAsset() =
    DaikokuAction.async(bodyParser) { ctx =>
      TenantAdminOnly(
        AuditTrailEvent(s"@{user.name} stores asset in team @{team.id}")
      )(ctx.tenant.id.value, ctx) { (_, _) =>
        val contentType = ctx.request.headers
          .get("Asset-Content-Type")
          .orElse(ctx.request.contentType)
          .getOrElse("application/octet-stream")
        val filename = normalize(
          ctx.request
            .getQueryString("filename")
            .getOrElse(IdGenerator.token(16))
        )
        val title =
          normalize(ctx.request.getQueryString("title").getOrElse("--"))
        val desc = ctx.request.getQueryString("desc").getOrElse("--")
        val assetId = AssetId(IdGenerator.uuid)
        ctx.tenant.bucketSettings match {
          case None =>
            FastFuture.successful(
              NotFound(Json.obj("error" -> "No bucket config found !"))
            )
          case Some(cfg) =>
            env.assetsStore
              .storeTenantAsset(
                ctx.tenant.id,
                assetId,
                filename,
                title,
                desc,
                contentType,
                ctx.request.body
              )(cfg)
              .map { _ =>
                Ok(Json.obj("done" -> true, "id" -> assetId.value))
              } recover {
              case e =>
                AppLogger.error(
                  s"Error during tenant asset storage: ${filename}",
                  e
                )
                InternalServerError(Json.obj("error" -> ec.toString))
            }
        }
      }
    }

  def replaceAsset(assetId: String) =
    DaikokuAction.async(bodyParser) { ctx =>
      TenantAdminOnly(
        AuditTrailEvent(s"@{user.name} replace asset in team @{team.id}")
      )(ctx.tenant.id.value, ctx) { (_, _) =>
        def getMetaHeaderValue(
            metadata: ObjectMetadata,
            headerName: String
        ): Option[String] = {
          metadata.headers.asScala
            .find(_.name() == s"x-amz-meta-$headerName")
            .map(_.value())
        }

        ctx.tenant.bucketSettings match {
          case None =>
            FastFuture.successful(
              NotFound(Json.obj("error" -> "No bucket config found !"))
            )
          case Some(cfg) =>
            env.assetsStore
              .getTenantAssetMetaHeaders(ctx.tenant.id, AssetId(assetId))(cfg)
              .flatMap {
                case None =>
                  FastFuture.successful(
                    NotFound(Json.obj("error" -> "Asset not found"))
                  )
                case Some(metadata) =>
                  val filename =
                    getMetaHeaderValue(metadata, "filename").getOrElse("--")
                  val desc =
                    getMetaHeaderValue(metadata, "desc").getOrElse("--")
                  val title =
                    getMetaHeaderValue(metadata, "title").getOrElse("--")
                  val contentType = metadata.contentType
                    .orElse(ctx.request.contentType)
                    .getOrElse("application/octet-stream")

                  env.assetsStore
                    .storeTenantAsset(
                      ctx.tenant.id,
                      AssetId(assetId),
                      filename,
                      title,
                      desc,
                      contentType,
                      ctx.request.body
                    )(cfg)
                    .map { res =>
                      Ok(Json.obj("done" -> true, "id" -> assetId))
                    } recover {
                    case e =>
                      AppLogger
                        .error(
                          s"Error during update tenant asset: $filename",
                          e
                        )
                      InternalServerError(Json.obj("error" -> ec.toString))
                  }
              }
        }
      }
    }

  def listAssets() =
    DaikokuAction.async { ctx =>
      ctx.request.getQueryString("teamId") match {
        case Some(teamId) =>
          TeamAdminOnly(
            AuditTrailEvent(s"@{user.name} listed assets of team @{team.id}")
          )(teamId, ctx) { _ =>
            ctx.tenant.bucketSettings match {
              case None =>
                FastFuture.successful(
                  NotFound(Json.obj("error" -> "No bucket config found !"))
                )
              case Some(cfg) =>
                env.assetsStore.listTenantAssets(ctx.tenant.id)(cfg).map {
                  res =>
                    Ok(JsArray(res.map(_.asJson)))
                }
            }
          }
        case None =>
          TenantAdminOnly(
            AuditTrailEvent(s"@{user.name} listed assets of team @{team.id}")
          )(ctx.tenant.id.value, ctx) { (_, _) =>
            ctx.tenant.bucketSettings match {
              case None =>
                FastFuture.successful(
                  NotFound(Json.obj("error" -> "No bucket config found !"))
                )
              case Some(cfg) =>
                env.assetsStore.listTenantAssets(ctx.tenant.id)(cfg).map {
                  res =>
                    Ok(JsArray(res.map(_.asJson)))
                }
            }
          }
      }
    }

  def deleteAsset(assetId: String) =
    DaikokuAction.async { ctx =>
      TenantAdminOnly(
        AuditTrailEvent(s"@{user.name} deleted asset @{assetId} of @{team.id}")
      )(ctx.tenant.id.value, ctx) { (_, _) =>
        ctx.setCtxValue("assetId", assetId)
        ctx.tenant.bucketSettings match {
          case None =>
            FastFuture.successful(
              NotFound(Json.obj("error" -> "No bucket config found !"))
            )
          case Some(cfg) =>
            env.assetsStore
              .deleteTenantAsset(ctx.tenant.id, AssetId(assetId))(cfg)
              .map { _ =>
                Ok(Json.obj("done" -> true))
              }
        }
      }
    }

  def getAsset(assetId: String) = {
    DaikokuTenantAction.async { ctx =>
      ctx.tenant.bucketSettings match {
        case None =>
          FastFuture.successful(
            NotFound(Json.obj("error" -> "No bucket config found !"))
          )
        case Some(cfg) =>
          val download = ctx.request.getQueryString("download").contains("true")
          val redirect = ctx.request.getQueryString("redirect").contains("true")

          env.assetsStore.getTenantAssetPresignedUrl(
            ctx.tenant.id,
            AssetId(assetId)
          )(cfg) match {
            case None =>
              FastFuture.successful(
                NotFound(Json.obj("error" -> "Asset not found!"))
              )
            case Some(url) if redirect => FastFuture.successful(Redirect(url))
            case Some(_) if download =>
              env.assetsStore
                .getTenantAsset(ctx.tenant.id, AssetId(assetId))(cfg)
                .map {
                  case None => NotFound(Json.obj("error" -> "Asset not found!"))
                  case Some((source, meta)) =>
                    val filename = meta.metadata
                      .filter(_.name().startsWith("x-amz-meta-"))
                      .find(_.name() == "x-amz-meta-filename")
                      .map(_.value())
                      .getOrElse("asset.txt")

                    Ok.sendEntity(
                        HttpEntity.Streamed(
                          source,
                          None,
                          meta.contentType
                            .map(Some.apply)
                            .getOrElse(Some("application/octet-stream"))
                        )
                      )
                      .withHeaders(
                        "Content-Disposition" -> s"""attachment; filename="$filename""""
                      )
                }
            case Some(url) =>
              env.wsClient
                .url(url)
                .withRequestTimeout(10.minutes)
                .get()
                .map(resp => {
                  resp.status match {
                    case 200 =>
                      Ok.sendEntity(
                        HttpEntity.Streamed(
                          resp.bodyAsSource,
                          None,
                          Option(resp.contentType)
                        )
                      )
                    case _ => NotFound(Json.obj("error" -> "Asset not found!"))
                  }
                })
                .recover {
                  case err =>
                    InternalServerError(Json.obj("error" -> err.getMessage))
                }

          }
      }
    }
  }
}

class UserAssetsController(
    DaikokuAction: DaikokuAction,
    env: Env,
    cc: ControllerComponents
) extends AbstractController(cc) {

  implicit val ec: ExecutionContext = env.defaultExecutionContext
  implicit val ev: Env = env

  val bodyParser: BodyParser[Source[ByteString, _]] =
    BodyParser("Assets parser") { _ =>
      Accumulator.source[ByteString].map(Right.apply)
    }

  def storeAvatar() =
    DaikokuAction.async(bodyParser) { ctx =>
      PublicUserAccess(
        AuditTrailEvent(
          s"@{user.name} stores his avatar from tenant @{tenant.id} - @{assetId}"
        )
      )(ctx) {
        val contentType = ctx.request.headers
          .get("Asset-Content-Type")
          .orElse(ctx.request.contentType)
          .getOrElse("image/jpg")
        val filename =
          ctx.request
            .getQueryString("filename")
            .getOrElse(IdGenerator.token(16))
        val assetId = AssetId(ctx.user.id.value)
        ctx.tenant.bucketSettings match {
          case None =>
            FastFuture.successful(
              NotFound(Json.obj("error" -> "No bucket config found !"))
            )
          case Some(cfg) =>
            env.assetsStore
              .storeUserAsset(
                ctx.tenant.id,
                ctx.user.id,
                assetId,
                filename,
                contentType,
                ctx.request.body
              )(cfg)
              .map { _ =>
                ctx.setCtxValue("assetId", assetId)
                Ok(Json.obj("done" -> true, "id" -> assetId.value))
              } recover {
              case e => InternalServerError(Json.obj("error" -> ec.toString))
            }
        }
      }
    }

  def getAvatar(tenantId: String, assetId: String) =
    DaikokuAction.async { ctx =>
      env.dataStore.tenantRepo
        .findByIdOrHrIdNotDeleted(tenantId)
        .map(maybeTenant => maybeTenant.flatMap(t => t.bucketSettings))
        .flatMap {
          case None =>
            FastFuture.successful(
              NotFound(Json.obj("error" -> "No bucket config found !"))
            )
          case Some(cfg) =>
            env.assetsStore
              .getUserAsset(ctx.tenant.id, ctx.user.id, AssetId(assetId))(cfg)
              .map {
                case Some((source, meta)) =>
                  val filename = meta.metadata
                    .filter(_.name().startsWith("x-amz-meta-"))
                    .find(_.name() == "x-amz-meta-filename")
                    .map(_.value())
                    .getOrElse("asset.jpg")
                  val disposition =
                    ("Content-Disposition" -> s"""attachment; filename="$filename"""")
                  if (ctx.request.getQueryString("download").contains("true")) {
                    Ok.sendEntity(
                        HttpEntity.Streamed(
                          source,
                          None,
                          meta.contentType
                            .map(Some.apply)
                            .getOrElse(Some("application/octet-stream"))
                        )
                      )
                      .withHeaders(disposition)
                  } else {
                    Ok.sendEntity(
                      HttpEntity.Streamed(
                        source,
                        None,
                        meta.contentType
                          .map(Some.apply)
                          .getOrElse(Some("application/octet-stream"))
                      )
                    )
                  }
                case None => NotFound(Json.obj("error" -> "Asset not found!"))
              }
        }
    }
}

class AssetsThumbnailController(
    DaikokuAction: DaikokuAction,
    env: Env,
    cc: ControllerComponents
) extends AbstractController(cc) {

  implicit val ec: ExecutionContext = env.defaultExecutionContext
  implicit val ev: Env = env

  val bodyParser: BodyParser[Source[ByteString, _]] =
    BodyParser("Assets parser") { _ =>
      Accumulator.source[ByteString].map(Right.apply)
    }

  def storeAsset(id: String) =
    DaikokuAction.async(bodyParser) { ctx =>
      PublicUserAccess(AuditTrailEvent(s"@{user.name} stores thumbnail"))(ctx) {
        val contentType = ctx.request.headers
          .get("Asset-Content-Type")
          .orElse(ctx.request.contentType)
          .getOrElse("image/png")
        val assetId = AssetId(id)
        ctx.tenant.bucketSettings match {
          case None =>
            FastFuture.successful(
              NotFound(Json.obj("error" -> "No bucket config found !"))
            )
          case Some(cfg) =>
            env.assetsStore
              .storeThumbnail(ctx.tenant.id, assetId, ctx.request.body)(cfg)
              .map { _ =>
                Ok(Json.obj("done" -> true, "id" -> assetId.value))
              } recover {
              case _ => InternalServerError(Json.obj("error" -> ec.toString))
            }
        }
      }
    }

  def getAsset(assetId: String) =
    DaikokuAction.async { ctx =>
      ctx.tenant.bucketSettings match {
        case None =>
          FastFuture.successful(
            NotFound(Json.obj("error" -> "No bucket config found !"))
          )
        case Some(cfg) =>
          env.assetsStore
            .getThumbnail(ctx.tenant.id, AssetId(assetId))(cfg)
            .map {
              case Some((source, meta)) =>
                Ok.sendEntity(
                  HttpEntity.Streamed(
                    source,
                    None,
                    meta.contentType
                      .map(Some.apply)
                      .getOrElse(Some("application/octet-stream"))
                  )
                )
              case None => NotFound(Json.obj("error" -> "Asset not found!"))
            }
      }
    }
}
