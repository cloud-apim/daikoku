package fr.maif.otoroshi.daikoku.ctrls

import akka.http.scaladsl.util.FastFuture
import daikoku.BuildInfo
import fr.maif.otoroshi.daikoku.actions.{DaikokuAction, DaikokuActionMaybeWithGuest, DaikokuActionMaybeWithoutUser, DaikokuActionMaybeWithoutUserContext}
import fr.maif.otoroshi.daikoku.audit.AuditTrailEvent
import fr.maif.otoroshi.daikoku.ctrls.authorizations.async.TenantAdminOnly
import fr.maif.otoroshi.daikoku.domain.{CmsHistory, CmsPage, CmsPageId, DaikokuStyle, UserId, json}
import fr.maif.otoroshi.daikoku.env.Env
import fr.maif.otoroshi.daikoku.utils.Errors
import org.joda.time.DateTime
import play.api.i18n.I18nSupport
import play.api.libs.json._
import play.api.mvc._
import reactivemongo.bson.BSONObjectID
import utils.diff_match_patch
import utils.diff_match_patch.Operation

import java.io.{File, FileOutputStream}
import java.util
import java.util.zip.{ZipEntry, ZipOutputStream}
import scala.concurrent.Future

class HomeController(
    DaikokuActionMaybeWithoutUser: DaikokuActionMaybeWithoutUser,
    DaikokuActionMaybeWithGuest: DaikokuActionMaybeWithGuest,
    DaikokuAction: DaikokuAction,
    env: Env,
    cc: ControllerComponents)
    extends AbstractController(cc)
    with I18nSupport {

  implicit val ec = env.defaultExecutionContext
  implicit val e = env
  implicit val m = messagesApi

  def actualIndex[A](ctx: DaikokuActionMaybeWithoutUserContext[A]): Future[Result] = {
    ctx.user match {
      case _ if ctx.request.uri.startsWith("/robots.txt") =>
        ctx.tenant.robotTxt match {
          case Some(robotTxt) => FastFuture.successful(Ok(views.txt.robot.render(robotTxt)))
          case None           => FastFuture.successful(NotFound(Json.obj("error" -> "robots.txt not found")))
        }
      case Some(_) =>
        if (ctx.request.uri == "/") {
          manageCmsHome(ctx,
            Ok(
              views.html.index(ctx.user.get,
                ctx.session.get,
                ctx.tenant,
                ctx.request.domain,
                env,
                ctx.isTenantAdmin,
                ctx.apiCreationPermitted))
          )
        } else
          FastFuture.successful(Ok(views.html.index(ctx.user.get, ctx.session.get, ctx.tenant,
              ctx.request.domain, env, ctx.isTenantAdmin, ctx.apiCreationPermitted)))
      case None if ctx.request.uri.startsWith("/signup") =>
        FastFuture.successful(Ok(views.html.unauthenticatedindex(ctx.tenant, ctx.request.domain, env)))
      case None if ctx.request.uri.startsWith("/reset") =>
        FastFuture.successful(Ok(views.html.unauthenticatedindex(ctx.tenant, ctx.request.domain, env)))
      case None if ctx.request.uri.startsWith("/2fa") =>
        FastFuture.successful(Ok(views.html.unauthenticatedindex(ctx.tenant, ctx.request.domain, env)))
      case None if ctx.request.uri == "/" =>
        manageCmsHome(ctx, Ok(views.html.unauthenticatedindex(ctx.tenant, ctx.request.domain, env)))
      case _ => manageCmsHome(ctx, Redirect("/"))
    }
  }

  private def manageCmsHome[A](ctx: DaikokuActionMaybeWithoutUserContext[A], redirectTo: Result) = {
    ctx.tenant.style match {
      case Some(value) if value.homePageVisible =>
        value.homeCmsPage match {
          case Some(pageId) => cmsPageByIdWithoutAction(ctx, pageId)
          case _ => FastFuture.successful(redirectTo)
        }
      case _ => FastFuture.successful(redirectTo)
    }
  }

  def index() = DaikokuActionMaybeWithoutUser.async { ctx =>
      actualIndex(ctx)
  }

  def indexWithPath(path: String) = DaikokuActionMaybeWithoutUser.async { ctx =>
    actualIndex(ctx)
  }

  def health() = DaikokuActionMaybeWithGuest { ctx =>
    ctx.request.headers.get("Otoroshi-Health-Check-Logic-Test") match {
      //todo: better health check
      case Some(value) =>
        Ok.withHeaders(
          "Otoroshi-Health-Check-Logic-Test-Result" -> (value.toLong + 42L).toString)
      case None => BadRequest
    }
  }

  def getDaikokuVersion() = DaikokuActionMaybeWithoutUser { ctx =>
    Ok(Json.obj("version" -> BuildInfo.version))
  }

  private def getMatchingRoutes(path: String, cmsPaths: Seq[(String, CmsPage)], strictMode: Boolean = false): Seq[CmsPage] = {
    val paths = path
      .replace("/_", "")
      .split("/")
      .filter(_.nonEmpty)

    var matched = false

    paths.foldLeft(cmsPaths.map(r => (
      r._1.replace("/_/", "").split("/") ++ Array(if(r._2.exact) "" else "*"),
      r._2
    ))
      .map(p => (p._1.filter(_.nonEmpty), p._2))
      .filter(p => p._1.nonEmpty)
    ) { (paths, path) => {
        if (paths.isEmpty || matched)
          paths
        else {
          val matchingRoutes = paths.filter(p => p._1.nonEmpty && (p._1.head == path || p._1.head == "*"))
          if (matchingRoutes.nonEmpty)
            matchingRoutes.map(p => (p._1.tail, p._2))
          else  {
            val matchingRoute = paths.find(p => p._1.isEmpty)
            if(matchingRoute.nonEmpty && !strictMode) {
              matched = true
              Seq(matchingRoute.get)
            } else
              Seq()
          }
        }
    }}.map(_._2)
  }

  def cmsPageByPath(path: String) = DaikokuActionMaybeWithoutUser.async { ctx =>
    val actualPath = if (path.startsWith("/")) {
      path
    } else {
      s"/$path"
    }
    env.dataStore.cmsRepo.forTenant(ctx.tenant).findOneNotDeleted(Json.obj("path" -> actualPath)).flatMap {
      case None =>
        env.dataStore.cmsRepo.forTenant(ctx.tenant).findAllNotDeleted()
          .map(cmsPages => cmsPages.filter(p => p.path.exists(_.nonEmpty)))
          .flatMap(cmsPages => {
            val strictPage = getMatchingRoutes(ctx.request.path, cmsPages.filter(p => p.exact && p.path.nonEmpty).map(p => (p.path.get, p)), true)

            val page = if(strictPage.nonEmpty)
              strictPage
            else
              getMatchingRoutes(ctx.request.path, cmsPages
                .filter(p => !p.exact && p.path.nonEmpty).map(p => (p.path.get, p)))

            page.headOption match {
              case Some(r) if r.authenticated && (ctx.user.isEmpty || ctx.user.exists(_.isGuest)) => redirectToLoginPage(ctx)
              case Some(r) => r.render(ctx, None, ctx.request.getQueryString("draft").contains("true")).map(res => Ok(res._1).as(res._2))
              case None => cmsPageNotFound(ctx)
            }
          })
      case Some(page) if !page.visible => cmsPageNotFound(ctx)
      case Some(page) if page.authenticated && ctx.user.isEmpty => redirectToLoginPage(ctx)
      case Some(page) => page.render(ctx, None, ctx.request.getQueryString("draft").contains("true")).map(res => Ok(res._1).as(res._2))
    }
  }

  private def redirectToLoginPage[A](ctx: DaikokuActionMaybeWithoutUserContext[A]) =
    FastFuture.successful(Redirect(s"/auth/${ctx.tenant.authProvider.name}/login?redirect=${ctx.request.path}"))

  private def cmsPageNotFound[A](ctx: DaikokuActionMaybeWithoutUserContext[A]): Future[Result] = {
    val optionFoundPage: Option[DaikokuStyle] = ctx.tenant.style
      .find(p => p.homePageVisible && p.notFoundCmsPage.nonEmpty)

      optionFoundPage match {
        case Some(p) => env.dataStore.cmsRepo.forTenant(ctx.tenant).findById(p.notFoundCmsPage.get).flatMap {
          case Some(page) =>
            page.render(ctx).map(res => Ok(res._1).as(res._2))
          case _ => Errors.craftResponseResult("Page not found !", Results.NotFound, ctx.request, None, env)
        }
        case _ => Errors.craftResponseResult("Page not found !", Results.NotFound, ctx.request, None, env)
      }
  }

  private def cmsPageByIdWithoutAction[A](ctx: DaikokuActionMaybeWithoutUserContext[A], id: String) = {
    env.dataStore.cmsRepo.forTenant(ctx.tenant).findByIdNotDeleted(id).flatMap {
      case None => cmsPageNotFound(ctx)
      case Some(page) if !page.visible => cmsPageNotFound(ctx)
      case Some(page) if page.authenticated && ctx.user.isEmpty => FastFuture.successful(Redirect(s"/auth/${ctx.tenant.authProvider.name}/login?redirect=${ctx.request.path}"))
      case Some(page) => page.render(ctx, None, ctx.request.getQueryString("draft").contains("true")).map(res => Ok(res._1).as(res._2))
    }
  }

  def cmsPageById(id: String) = DaikokuActionMaybeWithoutUser.async { ctx =>
    cmsPageByIdWithoutAction(ctx, id)
  }

  def cmsDiffById(id: String, diffId: String) = DaikokuAction.async { ctx =>
    TenantAdminOnly(
      AuditTrailEvent("@{user.name} has get a cms diff"))(
      ctx.tenant.id.value,
      ctx) { (tenant, _) => {
        val diffMatchPatch = new diff_match_patch()

        env.dataStore.cmsRepo.forTenant(tenant)
          .findById(id)
          .map {
            case None => NotFound(Json.obj("error" -> "cms page not found"))
            case Some(page) =>
              val historySeq = buildCmsPageFromPatches(page.history, diffId)
              val diffs = diffMatchPatch.diff_main(
                page.draft,
                historySeq
              )
                Ok(
                  Json.obj(
                    "html" -> (if(ctx.request.getQueryString("showDiffs").exists(_.toBoolean)) diffMatchPatch.diff_prettyHtml(diffs) else historySeq),
                    "hasDiff" -> !diffs.isEmpty
                  )
                )
          }
      }
    }
  }

  def restoreDiff(id: String, diffId: String) = DaikokuAction.async { ctx =>
    TenantAdminOnly(
      AuditTrailEvent("@{user.name} has restore the cms page @{pageName} with revision of @{diffDate}"))(
      ctx.tenant.id.value,
      ctx) { (tenant, _) => {
      env.dataStore.cmsRepo.forTenant(tenant)
        .findById(id)
        .flatMap {
          case None => FastFuture.successful(NotFound(Json.obj("error" -> "cms page not found")))
          case Some(page) =>
            ctx.setCtxValue("pageName", page.name)
            ctx.setCtxValue("diffDate", page.history.find(_.id == diffId).map(_.date).getOrElse("unknown date"))

            val newContentPage = buildCmsPageFromPatches(page.history, diffId)
            val history = diff(newContentPage, page.draft, ctx.user.id)

            env.dataStore.cmsRepo.forTenant(tenant)
              .save(page.copy(draft = newContentPage, history = (page.history :+ history).take(tenant.style.map(_.cmsHistoryLength).getOrElse(10) + 1)))
              .map(_ => Ok(Json.obj("restored" -> true)))
        }
    }
    }
  }

  def createCmsPageWithName(name: String) = DaikokuAction.async { ctx =>
    TenantAdminOnly(
      AuditTrailEvent("@{user.name} has created a cms page with name"))(
      ctx.tenant.id.value,
      ctx) { (tenant, _) => {
        val page = CmsPage(
          id = CmsPageId(BSONObjectID.generate().stringify),
          tenant = tenant.id,
          visible = true,
          authenticated = false,
          name = name,
          forwardRef = None,
          tags = List(),
          metadata = Map(),
          draft = "",
          contentType = "text/html",
          body = "",
          path = Some("/" + BSONObjectID.generate().stringify)
        )
        env.dataStore.cmsRepo.forTenant(tenant)
          .save(page)
          .map {
            case true => Created(page.asJson)
            case false => BadRequest(Json.obj("error" -> "Error when creating cms page"))
          }
      }
    }
  }

  def diff(a: String, b: String, userId: UserId): CmsHistory = {
    val patchMatch = new utils.diff_match_patch()
    val diff = patchMatch.patch_toText(patchMatch.patch_make(a, b))
    CmsHistory(
      id = BSONObjectID.generate().stringify,
      date = DateTime.now(),
      diff = diff,
      user = userId
    )
  }

  private def buildCmsPageFromPatches(history: Seq[CmsHistory], diffId: String): String = {
    var diffReached = false
    val items = history.flatMap(item => {
      if (item.id == diffId) {
        diffReached = true
        Some(item)
      } else if (!diffReached)
        Some(item)
      else
        None
    })
    val diffMatchPatch = new diff_match_patch()
    items.foldLeft("") {
      case (text, current) => diffMatchPatch.patch_apply(
        new util.LinkedList(diffMatchPatch.patch_fromText(current.diff)),
        text
      )
    }
  }

  def createCmsPage() = DaikokuAction.async(parse.json) { ctx =>
    TenantAdminOnly(
      AuditTrailEvent("@{user.name} has created a cms page"))(
      ctx.tenant.id.value,
      ctx) { (tenant, _) => {
        val body =  ctx.request.body.as[JsObject]
        val cmsPage = body ++
          Json.obj("_id" -> JsString((body \ "id").asOpt[String].getOrElse(BSONObjectID.generate().stringify))) ++
          Json.obj("_tenant" -> tenant.id.value)

        json.CmsPageFormat.reads(cmsPage) match {
          case JsSuccess(page, _) =>
            env.dataStore.cmsRepo.forTenant(tenant)
              .findByIdOrHrId(page.id.value)
              .map {
                case Some(cms) =>
                  val d = diff(cms.draft, page.draft, ctx.user.id)
                  if(d.diff.nonEmpty)
                    page.copy(history = cms.history :+ d)
                  else
                    page.copy(history = cms.history)
                case None =>
                  val d = diff("", page.draft, ctx.user.id)
                  if(d.diff.nonEmpty)
                    page.copy(history = Seq(d))
                  else
                    page
              }
              .flatMap(page => {
                env.dataStore.cmsRepo.forTenant(tenant)
                  .save(page.copy(history = page.history.takeRight(tenant.style.map(_.cmsHistoryLength).getOrElse(10) + 1)))
                  .map {
                    case true => Created(Json.obj("created" -> true))
                    case false => BadRequest(Json.obj("error" -> "Error when creating cms page"))
                  }
              })
          case e: JsError => FastFuture.successful(BadRequest(JsError.toJson(e)))
        }
      }
    }
  }

  def updateCmsPage(id: String) = DaikokuAction.async(parse.json) { ctx =>
    TenantAdminOnly(
      AuditTrailEvent("@{user.name} has updated a cms page"))(
      ctx.tenant.id.value,
      ctx) { (_, _) =>
      FastFuture.successful(Ok(Json.obj("" -> "")))
    }
  }

  def deleteCmsPage(id: String) = DaikokuAction.async { ctx =>
    TenantAdminOnly(
      AuditTrailEvent("@{user.name} has removed a cms page"))(
      ctx.tenant.id.value,
      ctx) { (tenant, _) =>
      env.dataStore.cmsRepo.forTenant(tenant)
        .deleteByIdLogically(id)
        .map {
          case true => Ok(Json.obj("created" -> true))
          case false => BadRequest(Json.obj("error" -> "Unable to remove the cms page"))
        }
    }
  }

  def download() = DaikokuAction.async { ctx =>
    TenantAdminOnly(
      AuditTrailEvent("@{user.nae} has download all files of the cms"))(
      ctx.tenant.id.value,
      ctx) { (tenant, _) =>
        env.dataStore.cmsRepo.forTenant(tenant)
          .findAllNotDeleted()
          .map(pages => {
            val outZip = new File(s"/tmp/${System.currentTimeMillis()}.zip");
            val out = new ZipOutputStream(new FileOutputStream(outZip));

            val contentTypeToExtension = Map(
              "application/json" -> "json",
              "text/html" -> "html",
              "text/javascript" -> "js",
              "text/css" -> "css",
              "text/markdown" -> "md",
              "text/plain" -> "txt",
              "text/xml" -> "xml"
            )

            pages.foreach(page => {
              val sb = new StringBuilder()
              sb.append(page.body)
              val data = sb.toString().getBytes()

              val e = new ZipEntry(s"${page.name}.${contentTypeToExtension.getOrElse(page.contentType, ".txt")}")
              out.putNextEntry(e)

              out.write(data, 0, data.length)
            })

            val summary: JsObject = Json.obj(
              "pages" -> pages.foldLeft(Json.arr()) { (acc, page) => acc ++ Json.arr(page.asJson.as[JsObject] - "body") }
            )

            val sb = new StringBuilder()
            sb.append(Json.stringify(summary))
            val data = sb.toString().getBytes()

            val e = new ZipEntry("summary.json")
            out.putNextEntry(e)
            out.write(data, 0, data.length)

            out.closeEntry()
            out.close()

            Ok.sendFile(outZip)
          })
    }
  }
}















