package fr.maif.otoroshi.daikoku.env

import akka.Done
import akka.http.scaladsl.util.FastFuture
import akka.stream.Materializer
import akka.stream.scaladsl.{Sink, Source}
import fr.maif.otoroshi.daikoku.domain.json.{ApiFormat, ApiSubscriptionFormat, TeamFormat, TenantFormat, UserFormat}
import fr.maif.otoroshi.daikoku.domain.{CmsPage, CmsPageId, DatastoreId, Evolution}
import fr.maif.otoroshi.daikoku.logger.AppLogger
import fr.maif.otoroshi.daikoku.utils.OtoroshiClient
import org.joda.time.DateTime
import play.api.libs.json._
import reactivemongo.bson.BSONObjectID
import storage.DataStore

import scala.concurrent.{ExecutionContext, Future}

sealed trait EvolutionScript {
  def version: String
  def script: (
      Option[DatastoreId],
      DataStore,
      Materializer,
      ExecutionContext,
      OtoroshiClient
  ) => Future[Done]
  def run(maybeId: Option[DatastoreId], dataStore: DataStore, otoroshiClient: OtoroshiClient)(implicit
      mat: Materializer,
      ec: ExecutionContext
  ): Future[Done] =
    script(maybeId, dataStore, mat, ec, otoroshiClient)
}

object evolution_102 extends EvolutionScript {
  override def version: String = "1.0.2"

  override def script: (
      Option[DatastoreId],
      DataStore,
      Materializer,
      ExecutionContext,
      OtoroshiClient
  ) => Future[Done] =
    (
        maybeId: Option[DatastoreId],
        dataStore: DataStore,
        mat: Materializer,
        ec: ExecutionContext,
        _: OtoroshiClient
    ) => {
      AppLogger.info("Begin evolution 1.0.2")
      dataStore.apiRepo
        .forAllTenant()
        .streamAllRaw()(ec)
        .filter(value =>
          (value \ "possibleUsagePlans")
            .as[JsArray]
            .value
            .exists(plan =>
              (plan \ "otoroshiTarget" \ "serviceGroup")
                .asOpt[String]
                .isDefined
            )
        )
        .mapAsync(10) { value =>
          val usagePlans = (value \ "possibleUsagePlans").as[JsArray]
          val newPlans = usagePlans.value.map(plan => {
            val oldGroupValue =
              (plan \ "otoroshiTarget" \ "serviceGroup").asOpt[String]

            if (oldGroupValue.isDefined) {
              val oldOtoroshiTarget = (plan \ "otoroshiTarget").as[JsObject]
              val maybeOtoroshiTarget = oldOtoroshiTarget - "serviceGroup" ++
                Json.obj(
                  "authorizedEntities" -> Json.obj(
                    "groups" -> JsArray(Seq(JsString(oldGroupValue.get))),
                    "services" -> JsArray()
                  )
                )
              plan.as[JsObject] ++ Json
                .obj("otoroshiTarget" -> maybeOtoroshiTarget)
            } else {
              plan
            }
          })
          val goodApi = value
            .as[JsObject] ++ Json.obj("possibleUsagePlans" -> JsArray(newPlans))

          dataStore.apiRepo
            .forAllTenant()
            .save(Json.obj("_id" -> (goodApi \ "_id").as[String]), goodApi)(ec)
        }
        .runWith(Sink.ignore)(mat)
    }
}

object evolution_150 extends EvolutionScript {
  override def version: String = "1.5.0"

  override def script: (
      Option[DatastoreId],
      DataStore,
      Materializer,
      ExecutionContext,
      OtoroshiClient
  ) => Future[Done] =
    (
        maybeId: Option[DatastoreId],
        dataStore: DataStore,
        mat: Materializer,
        ec: ExecutionContext,
        _: OtoroshiClient
    ) => {
      AppLogger.info(
        s"Begin evolution $version - Set isDefault at true on all api"
      )

      dataStore.apiRepo
        .forAllTenant()
        .streamAllRaw()(ec)
        .mapAsync(10) { value =>
          ApiFormat.reads(value) match {
            case JsSuccess(api, _) =>
              dataStore.apiRepo
                .forAllTenant()
                .save(api.copy(isDefault = true))(ec)
            case JsError(errors) =>
              FastFuture.successful(
                AppLogger.error(s"Evolution $version : $errors")
              )
          }
        }
        .runWith(Sink.ignore)(mat)
    }
}

object evolution_151 extends EvolutionScript {
  override def version: String = "1.5.1"

  override def script: (
      Option[DatastoreId],
      DataStore,
      Materializer,
      ExecutionContext,
      OtoroshiClient
  ) => Future[Done] =
    (
        _: Option[DatastoreId],
        dataStore: DataStore,
        mat: Materializer,
        ec: ExecutionContext,
        _: OtoroshiClient
    ) => {
      AppLogger.info(
        s"Begin evolution $version - Convert unlogged home to CMS format"
      )

      dataStore.tenantRepo
        .streamAllRaw()(ec)
        .mapAsync(10) { value =>
          TenantFormat.reads(value) match {
            case JsSuccess(tenant, _) =>
              tenant.style match {
                case Some(value) =>
                  dataStore.cmsRepo
                    .forTenant(tenant)
                    .findOneNotDeleted(Json.obj("path" -> "/"))(ec)
                    .map {
                      case Some(_) => FastFuture.successful(())
                      case None =>
                        val homeId = BSONObjectID.generate().stringify
                        dataStore.cmsRepo
                          .forTenant(tenant)
                          .save(
                            CmsPage(
                              id = CmsPageId(homeId),
                              tenant = tenant.id,
                              visible = value.homePageVisible,
                              authenticated = false,
                              name = "Old unlogged home",
                              forwardRef = None,
                              tags = List(),
                              metadata = Map(),
                              contentType = "text/html",
                              body =
                                if (value.unloggedHome.nonEmpty)
                                  value.unloggedHome
                                else "<!DOCTYPE html><html><head></head><body><h1>Home page</h1><a href=\"/apis\">Back office</a></body></html>",
                              draft =
                                if (value.unloggedHome.nonEmpty)
                                  value.unloggedHome
                                else "<!DOCTYPE html><html><head></head><body><h1>Home page</h1><a href=\"/apis\">Back office</a></body></html>",
                              path = Some("/"),
                              lastPublishedDate = Some(DateTime.now())
                            )
                          )(ec)
                        dataStore.tenantRepo.save(
                          tenant.copy(style =
                            tenant.style.map(_.copy(homeCmsPage = Some(homeId)))
                          )
                        )(ec)
                    }(ec)
                case None => FastFuture.successful(())
              }
            case JsError(errors) =>
              FastFuture.successful(
                AppLogger.error(s"Evolution $version : $errors")
              )
          }
        }
        .runWith(Sink.ignore)(mat)
    }
}

object evolution_155 extends EvolutionScript {
  override def version: String = "1.5.5"

  override def script: (
      Option[DatastoreId],
      DataStore,
      Materializer,
      ExecutionContext,
      OtoroshiClient
  ) => Future[Done] =
    (
        _: Option[DatastoreId],
        dataStore: DataStore,
        mat: Materializer,
        ec: ExecutionContext,
        _: OtoroshiClient
    ) => {

      AppLogger.info(
        s"Begin evolution $version - Rewrite all _humanReadableId - sorry for the inconvenience caused"
      )

      val userSource = dataStore.userRepo
        .streamAllRaw()(ec)
        .mapAsync(10) { value =>
          UserFormat.reads(value) match {
            case JsSuccess(v, _) =>
              dataStore.userRepo
                .save(v)(ec)
            case JsError(errors) =>
              FastFuture.successful(
                AppLogger.error(s"Evolution $version : $errors")
              )
          }
        }
      val tenantSource = dataStore.tenantRepo
        .streamAllRaw()(ec)
        .mapAsync(10) { value =>
          TenantFormat.reads(value) match {
            case JsSuccess(v, _) =>
              dataStore.tenantRepo
                .save(v)(ec)
            case JsError(errors) =>
              FastFuture.successful(
                AppLogger.error(s"Evolution $version : $errors")
              )
          }
        }
      val teamSource = dataStore.teamRepo
        .forAllTenant()
        .streamAllRaw()(ec)
        .mapAsync(10) { value =>
          TeamFormat.reads(value) match {
            case JsSuccess(v, _) =>
              dataStore.teamRepo
                .forAllTenant()
                .save(v)(ec)
            case JsError(errors) =>
              FastFuture.successful(
                AppLogger.error(s"Evolution $version : $errors")
              )
          }
        }
      val apiSource = dataStore.apiRepo
        .forAllTenant()
        .streamAllRaw()(ec)
        .mapAsync(10) { value =>
          ApiFormat.reads(value) match {
            case JsSuccess(v, _) =>
              dataStore.apiRepo
                .forAllTenant()
                .save(v)(ec)
            case JsError(errors) =>
              FastFuture.successful(
                AppLogger.error(s"Evolution $version : $errors")
              )
          }
        }

      val repos = Seq(
        userSource,
        tenantSource,
        teamSource,
        apiSource
      )

      Source(repos)
        .flatMapConcat(x => x)
        .runWith(Sink.ignore)(mat)

    }
}

object evolution_157 extends EvolutionScript {

  import cats.data.OptionT
  import cats.implicits._
  override def version: String = "1.5.7"

  override def script: (
      Option[DatastoreId],
      DataStore,
      Materializer,
      ExecutionContext,
      OtoroshiClient
  ) => Future[Done] =
    (
        _: Option[DatastoreId],
        dataStore: DataStore,
        mat: Materializer,
        ec: ExecutionContext,
        otoroshiClient: OtoroshiClient
    ) => {
      AppLogger.info(
        s"Begin evolution $version - sync all subscriptions metadata with associated plan metadata"
      )

      implicit val execContext: ExecutionContext = ec

      val source = dataStore.apiSubscriptionRepo.forAllTenant()
        .streamAllRaw()
        .mapAsync(10) { value =>
          ApiSubscriptionFormat.reads(value) match {
            case JsSuccess(sub, _) =>
              AppLogger.info(s"begin sync of ${sub.id} with api ${sub.api.asJson}")
              (for {
                api           <- OptionT(dataStore.apiRepo.forTenant(sub.tenant).findOne(Json.obj("_id" -> sub.api.asJson)))
                otoSettingsId <- OptionT.fromOption[Future](api.possibleUsagePlans
                  .find(pp => pp.id == sub.plan)
                  .flatMap(pp => pp.otoroshiTarget)
                  .map(_.otoroshiSettings))
                tenant        <- OptionT(dataStore.tenantRepo.findOne(Json.obj("_id" -> api.tenant.asJson)))
                otoSettings   <- OptionT.fromOption[Future](tenant.otoroshiSettings.find(o => o.id == otoSettingsId))


                realApk <- OptionT.liftF(otoroshiClient.getApikey(sub.apiKey.clientId)(otoSettings))

                metadata = realApk
                  .leftMap(_ => Json.obj())
                  .map(apk =>
                    JsObject((apk.metadata.filterNot(i => i._1.startsWith("daikoku_")) -- sub.customMetadata
                      .flatMap(_.asOpt[Map[String, String]])
                      .getOrElse(Map.empty[String, String]).keys)
                      .view.mapValues(i => JsString(i)).toSeq)
                  )
                  .merge

                _ = AppLogger.info(s"${sub.id} :: api ${api.id} with metadata ${Json.stringify(metadata)}")
                _ <- OptionT.liftF(dataStore.apiSubscriptionRepo.forTenant(sub.tenant).save(sub.copy(metadata = Some(metadata))))
              } yield ()).value
            case JsError(errors) =>
              FastFuture.successful(
                AppLogger.error(s"Evolution $version : $errors")
              )
          }
        }

      source
        .runWith(Sink.ignore)(mat)
    }
}

object evolutions {
  val list: Set[EvolutionScript] =
    Set(evolution_102, evolution_150, evolution_151, evolution_155, evolution_157)
  def run(
      dataStore: DataStore,
      otoroshiClient: OtoroshiClient
  )(implicit ec: ExecutionContext, mat: Materializer): Future[Done] =
    Source(list)
      .map { evolution =>
        dataStore.evolutionRepo
          .findOne(Json.obj("version" -> evolution.version))
          .flatMap {
            case None =>
              evolution.run(None, dataStore, otoroshiClient).flatMap { _ =>
                dataStore.evolutionRepo
                  .save(
                    Evolution(
                      id = DatastoreId(BSONObjectID.generate().stringify),
                      version = evolution.version,
                      applied = true
                    )
                  )
                  .map(f => {
                    AppLogger.info(s"Evolution ${evolution.version} done")
                    f
                  })
              }

            case Some(e) if !e.applied =>
              evolution
                .run(Some(e.id), dataStore, otoroshiClient)
                .flatMap { _ =>
                  dataStore.evolutionRepo
                    .save(
                      Evolution(
                        id = e.id,
                        version = evolution.version,
                        applied = true
                      )
                    )(ec)
                    .map(f => {
                      AppLogger.info(s"Evolution ${evolution.version} done")
                      f
                    })
                }
          }
      }
      .runWith(Sink.ignore)
}
