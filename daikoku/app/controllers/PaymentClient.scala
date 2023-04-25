package fr.maif.otoroshi.daikoku.ctrls

import akka.http.scaladsl.util.FastFuture
import cats.data.{EitherT, OptionT}
import cats.implicits.catsSyntaxOptionId
import com.stripe.Stripe
import com.stripe.model.{Customer, UsageRecord}
import com.stripe.model.checkout.Session
import com.stripe.net.RequestOptions
import com.stripe.param.UsageRecordCreateOnSubscriptionItemParams
import controllers.AppError
import fr.maif.otoroshi.daikoku.domain.ThirdPartyPaymentSettings.StripeSettings
import fr.maif.otoroshi.daikoku.domain._
import fr.maif.otoroshi.daikoku.env.Env
import fr.maif.otoroshi.daikoku.logger.AppLogger
import fr.maif.otoroshi.daikoku.utils.Cypher.encrypt
import fr.maif.otoroshi.daikoku.utils.IdGenerator
import org.joda.time.DateTime
import play.api.libs.json.{JsArray, JsObject, Json}
import play.api.libs.ws.{WSAuthScheme, WSRequest}
import play.api.mvc.Result
import play.api.mvc.Results.Ok

import scala.concurrent.Future

class PaymentClient(
    env: Env
) {

  type ProductId = String
  type PriceId = String

  implicit val ec = env.defaultExecutionContext
  implicit val ev = env
  val STRIPE_URL = "https://api.stripe.com";
  val ws = env.wsClient

  def getStripeProductName(api: Api, plan: UsagePlan) =
    s"${api.name}::${api.currentVersion.value}/${plan.customName.getOrElse(plan.typeName)}"


  private def stripeClient(
      path: String
  )(implicit stripeSettings: StripeSettings): WSRequest = {
    ws.url(s"$STRIPE_URL$path")
      .withHttpHeaders(
        "content-type" -> "application/x-www-form-urlencoded"
      )
      .withAuth(
        stripeSettings.secretKey,
        "",
        WSAuthScheme.BASIC
      )
  }

  def createProduct(
      tenant: Tenant,
      api: Api,
      plan: UsagePlan,
      settingsId: ThirdPartyPaymentSettingsId
  ): EitherT[Future, AppError, PaymentSettings] =
    tenant.thirdPartyPaymentSettings.find(_.id == settingsId) match {
      case Some(settings) =>
        settings match {
          case s: StripeSettings =>
            implicit val stripeSettings: StripeSettings = s
            createStripeProduct(
              api,
              plan
            )
        }
      case None =>
        EitherT.leftT[Future, PaymentSettings](
          AppError.ThirdPartyPaymentSettingsNotFound
        )
    }

  def checkoutSubscription(tenant: Tenant,
                           subscriptionDemand: SubscriptionDemand,
                           step: SubscriptionDemandStep,
                           from: Option[String] = None
                          ): EitherT[Future, AppError, Result] = {
    for {
      api <- EitherT.fromOptionF(env.dataStore.apiRepo.forTenant(tenant).findByIdNotDeleted(subscriptionDemand.api), AppError.ApiNotFound)
      apiTeam <- EitherT.fromOptionF(env.dataStore.teamRepo.forTenant(tenant).findByIdNotDeleted(api.team), AppError.TeamNotFound)
      team <- EitherT.fromOptionF(env.dataStore.teamRepo.forTenant(tenant).findByIdNotDeleted(subscriptionDemand.team), AppError.TeamNotFound)
      user <- EitherT.fromOptionF(env.dataStore.userRepo.findByIdNotDeleted(subscriptionDemand.from), AppError.UserNotFound)
      plan <- EitherT.fromOption[Future](api.possibleUsagePlans.find(_.id == subscriptionDemand.plan), AppError.PlanNotFound)
      settings <- EitherT.fromOption[Future](plan.paymentSettings, AppError.ThirdPartyPaymentSettingsNotFound)
      checkoutUrl <- createSessionCheckout(tenant, api, team, apiTeam, subscriptionDemand, settings, user, step, from)
    } yield Ok(Json.obj("checkoutUrl" -> checkoutUrl))
  }

  def createSessionCheckout(tenant: Tenant,
                            api: Api,
                            team: Team,
                            apiTeam: Team,
                            demand: SubscriptionDemand,
                            settings: PaymentSettings,
                            user: User,
                            step: SubscriptionDemandStep,
                            from: Option[String] = None) = {
    settings match {
      case p: PaymentSettings.Stripe =>
        implicit val stripeSettings: StripeSettings =
          tenant.thirdPartyPaymentSettings
            .find(_.id == p.thirdPartyPaymentSettingsId)
            .get
            .asInstanceOf[StripeSettings]
        createStripeCheckoutSession(
          tenant,
          api,
          team,
          apiTeam,
          demand,
          p,
          user,
          step,
          from
        )
    }
  }

  def postStripePrice(
      body: Map[String, String]
  )(implicit s: StripeSettings): EitherT[Future, AppError, PriceId] = {
    EitherT
      .liftF(
        stripeClient("/v1/prices")
          .post(body)
      )
      .flatMap(res => {
        if (res.status == 200 || res.status == 201) {
          EitherT.rightT[Future, AppError]((res.json \ "id").as[PriceId])
        } else {
          EitherT.leftT[Future, PriceId](
            AppError.OtoroshiError(res.json.as[JsObject])
          )
        }
      })
  }

  def createStripePrice(
      plan: UsagePlan,
      productId: ProductId
  )(implicit
      stripeSettings: StripeSettings
  ): EitherT[Future, AppError, PaymentSettings] = {

    val planName: String = plan.customName.getOrElse(plan.typeName)

    val body = Map(
      "product" -> productId,
      "unit_amount" -> (plan.costPerMonth * 100).longValue.toString,
      "currency" -> plan.currency.code,
      "nickname" -> planName,
      "metadata[plan]" -> plan.id.value,
      "recurring[interval]" -> plan.billingDuration.unit.name.toLowerCase
    )

    plan match {
      case _: UsagePlan.QuotasWithLimits =>
        postStripePrice(body)
          .map(priceId =>
            PaymentSettings.Stripe(
              stripeSettings.id,
              productId,
              StripePriceIds(basePriceId = priceId)
            )
          )
      case p: UsagePlan.QuotasWithoutLimits =>
        for {
          baseprice <- postStripePrice(body)
          payperUsePrice <- postStripePrice(
            Map(
              "product" -> productId,
              "unit_amount" -> (p.costPerAdditionalRequest * 100).longValue.toString,
              "currency" -> plan.currency.code,
              "nickname" -> planName,
              "metadata[plan]" -> plan.id.value,
              "recurring[interval]" -> plan.billingDuration.unit.name.toLowerCase,
              "recurring[usage_type]" -> "metered",
              "recurring[aggregate_usage]" -> "sum"
            )
          )
        } yield PaymentSettings.Stripe(
          stripeSettings.id,
          productId,
          StripePriceIds(
            basePriceId = baseprice,
            additionalPriceId = payperUsePrice.some
          )
        )
      case p: UsagePlan.PayPerUse =>
        for {
          baseprice <- postStripePrice(body)
          payperUsePrice <- postStripePrice(
            Map(
              "product" -> productId,
              "unit_amount" -> (p.costPerRequest * 100).longValue.toString,
              "currency" -> plan.currency.code,
              "nickname" -> planName,
              "metadata[plan]" -> plan.id.value,
              "recurring[interval]" -> plan.billingDuration.unit.name.toLowerCase,
              "recurring[usage_type]" -> "metered",
              "recurring[aggregate_usage]" -> "sum"
            )
          )
        } yield PaymentSettings.Stripe(
          stripeSettings.id,
          productId,
          StripePriceIds(
            basePriceId = baseprice,
            additionalPriceId = payperUsePrice.some
          )
        )
      case _ =>
        EitherT.leftT[Future, PaymentSettings](
          AppError.PlanUnauthorized
        )
    }
  }

  def createStripeProduct(
      api: Api,
      plan: UsagePlan
  )(implicit
      stripeSettings: StripeSettings
  ): EitherT[Future, AppError, PaymentSettings] = {

    val body = Map(
      "name" -> getStripeProductName(api, plan),
      "metadata[tenant]" -> api.tenant.value,
      "metadata[api]" -> api.id.value,
      "metadata[team]" -> api.team.value,
      "metadata[plan]" -> plan.id.value
    )

    EitherT
      .liftF(
        stripeClient("/v1/products")
          .post(body)
      )
      .flatMap(res => {
        if (res.status == 200 || res.status == 201) {
          val productId = (res.json \ "id").as[ProductId]
          createStripePrice(plan, productId)
        } else {
          EitherT.leftT[Future, PaymentSettings](
            AppError.OtoroshiError(res.json.as[JsObject])
          )
        }
      })
  }

  def createStripeCheckoutSession(
      tenant: Tenant,
      api: Api,
      team: Team,
      apiTeam: Team,
      subscriptionDemand: SubscriptionDemand,
      settings: PaymentSettings.Stripe,
      user: User,
      step: SubscriptionDemandStep,
      from: Option[String] = None
  )(implicit
      stripeSettings: StripeSettings
  ): EitherT[Future, AppError, String] = {

    val stepValidator = StepValidator(
      id = DatastoreId(IdGenerator.token),
      tenant = tenant.id,
      token = IdGenerator.token,
      step = step.id,
      subscriptionDemand = subscriptionDemand.id,
    )

    val cipheredValidationToken = encrypt(env.config.cypherSecret, stepValidator.token, tenant)

    val baseBody = Map(
      "metadata[tenant]" -> subscriptionDemand.tenant.value,
      "metadata[api]" -> subscriptionDemand.api.value,
      "metadata[team]" -> subscriptionDemand.team.value,
      "metadata[plan]" -> subscriptionDemand.plan.value,
      "metadata[subscription_demand]" -> subscriptionDemand.id.value,
      "line_items[0][price]" -> settings.priceIds.basePriceId,
      "line_items[0][quantity]" -> "1",
      "mode" -> "subscription",
      "customer_email" -> team.contact,
      "billing_address_collection " -> "required",
      "locale" -> user.defaultLanguage.orElse(tenant.defaultLanguage).getOrElse("en").toLowerCase,
      "success_url" -> env.getDaikokuUrl(
        tenant,
        s"/api/subscription/_validate?token=$cipheredValidationToken&session_id={CHECKOUT_SESSION_ID}" //todo: add callback
      ),
      "cancel_url" -> from.getOrElse(env.getDaikokuUrl(
        tenant,
        s"/${apiTeam.humanReadableId}/${api.humanReadableId}/${api.currentVersion.value}/pricing"
      ))
    )

    val body = settings.priceIds.additionalPriceId
      .map(addPriceId => baseBody + ("line_items[1][price]" -> addPriceId))
      .getOrElse(baseBody)

    //FIXME: clean this shitting code
    for {
      _ <- EitherT.liftF(env.dataStore.stepValidatorRepo.forTenant(tenant).save(stepValidator))


    } yield ???

    EitherT
      .liftF(
        stripeClient("/v1/checkout/sessions")
          .post(body)
      )
      .flatMap(res => {
        if (res.status == 200 || res.status == 201) {
          val url = (res.json \ "url").as[String]
          //todo: handle real redirection to checkout page
          EitherT.pure(url)
        } else {
          EitherT.leftT[Future, String](
            AppError.OtoroshiError(res.json.as[JsObject])
          )
        }
      })
  }

  def getSubscription(maybeSessionId: Option[String], settings: PaymentSettings, tenant: Tenant): Future[Option[String]] =
    settings match {
      case p: PaymentSettings.Stripe =>
        implicit val stripeSettings: StripeSettings = tenant.thirdPartyPaymentSettings
            .find(_.id == p.thirdPartyPaymentSettingsId)
            .get
            .asInstanceOf[StripeSettings]
        getStripeSubscription(maybeSessionId)
    }

  def getStripeSubscription(maybeSessionId: Option[String])(implicit stripeSettings: StripeSettings): Future[Option[String]] = {
    maybeSessionId match {
      case Some(sessionId) =>
        for {
          session <- stripeClient(s"/v1/checkout/sessions/$sessionId").get()
          sub = (session.json \ "subscription").as[String]
          subscription <- stripeClient(s"/v1/subscriptions/$sub").get()
        } yield {
          (subscription.json \ "items").asOpt[JsObject]
            .flatMap(items => (items \ "data").as[JsArray].value
              .find(element => (element \ "plan" \ "usage_type").as[String] == "metered")
              .map(element => (element \ "id").as[String]))
        }
      case None => FastFuture.successful(None)
    }
  }

  def syncWithThirdParty(consumption: ApiKeyConsumption, plan: UsagePlan): Future[Unit] = {
    plan.paymentSettings match {
      case Some(paymentSettings) =>
        (for {
        subscription <- OptionT(env.dataStore.apiSubscriptionRepo.forTenant(consumption.tenant).findOneNotDeleted(Json.obj("apiKey.clientId" -> consumption.clientId)))
        tenant <- OptionT(env.dataStore.tenantRepo.findByIdNotDeleted(consumption.tenant))
        setting <- OptionT.fromOption[Future](tenant.thirdPartyPaymentSettings.find(_.id == paymentSettings.thirdPartyPaymentSettingsId))
      } yield {
        setting match {
          case s: ThirdPartyPaymentSettings.StripeSettings =>
            implicit val stripeSettings: StripeSettings = s
            syncConsumptionWithStripe(subscription, consumption)
          case _ =>
            FastFuture.successful(())
        }
      }).value.map(_ => ())
      case None => FastFuture.successful(())
    }
  }

  def syncConsumptionWithStripe(apiSubscription: ApiSubscription, consumption: ApiKeyConsumption)(implicit stripeSettings: StripeSettings) = {
    apiSubscription.thirdPartySubscription match {
      case Some(sub) =>
        val body = Map(
          "quantity" -> consumption.hits.toString,
          "timestamp" -> (consumption.from.getMillis / 1000).toString
        )

        stripeClient(s"/v1/subscription_items/$sub/usage_records")
          .post(body)
      case None => FastFuture.successful(())
    }



  }
}
