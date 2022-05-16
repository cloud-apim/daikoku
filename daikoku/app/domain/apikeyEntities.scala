package fr.maif.otoroshi.daikoku.domain

import fr.maif.otoroshi.daikoku.domain.TeamPermission.Administrator
import fr.maif.otoroshi.daikoku.utils.IdGenerator
import org.joda.time.DateTime
import play.api.libs.json._

case class CustomMetadata(key: String, possibleValues: Set[String] = Set.empty)
  extends CanJson[CustomMetadata] {
  def asJson: JsValue = json.CustomMetadataFormat.writes(this)
}
case class ApikeyCustomization(
                                clientIdOnly: Boolean = false,
                                readOnly: Boolean = false,
                                constrainedServicesOnly: Boolean = false,
                                metadata: JsObject = play.api.libs.json.Json.obj(),
                                customMetadata: Seq[CustomMetadata] = Seq.empty,
                                tags: JsArray = play.api.libs.json.Json.arr(),
                                restrictions: ApiKeyRestrictions = ApiKeyRestrictions()
                              ) extends CanJson[ApikeyCustomization] {
  def asJson: JsValue = json.ApikeyCustomizationFormat.writes(this)
}

case class ApiKeyRotation(
                           enabled: Boolean = true,
                           rotationEvery: Long = 31 * 24,
                           gracePeriod: Long = 7 * 24,
                           nextSecret: Option[String] = None
                         )

case class ApiSubscriptionRotation(
                                    enabled: Boolean = true,
                                    rotationEvery: Long = 31 * 24,
                                    gracePeriod: Long = 7 * 24,
                                    pendingRotation: Boolean = false
                                  ) {
  def toApiKeyRotation: ApiKeyRotation = {
    ApiKeyRotation(
      enabled = enabled,
      rotationEvery= rotationEvery,
      gracePeriod = gracePeriod,
    )
  }
}


case class ApiSubscription(
                            id: ApiSubscriptionId,
                            tenant: TenantId,
                            deleted: Boolean = false,
                            apiKey: OtoroshiApiKey, // TODO: add the actual plan at the time of the subscription
                            plan: UsagePlanId,
                            createdAt: DateTime,
                            team: TeamId,
                            api: ApiId,
                            by: UserId,
                            customName: Option[String],
                            enabled: Boolean = true,
                            rotation: Option[ApiSubscriptionRotation],
                            integrationToken: String,
                            customMetadata: Option[JsObject] = None,
                            customMaxPerSecond: Option[Long] = None,
                            customMaxPerDay: Option[Long] = None,
                            customMaxPerMonth: Option[Long] = None,
                            customReadOnly: Option[Boolean] = None,
                            parent: Option[ApiSubscriptionId] = None
                          ) extends CanJson[ApiSubscription] {
  override def asJson: JsValue = json.ApiSubscriptionFormat.writes(this)
  def asAuthorizedJson(permission: TeamPermission,
                       planIntegration: IntegrationProcess,
                       isDaikokuAdmin: Boolean): JsValue =
    (permission, planIntegration) match {
      case (_, _) if isDaikokuAdmin => json.ApiSubscriptionFormat.writes(this)
      case (Administrator, _)       => json.ApiSubscriptionFormat.writes(this)
      case (_, IntegrationProcess.ApiKey) =>
        json.ApiSubscriptionFormat.writes(this)
      case (_, IntegrationProcess.Automatic) =>
        json.ApiSubscriptionFormat.writes(this).as[JsObject] - "apiKey"
    }
  def asSafeJson: JsValue =
    json.ApiSubscriptionFormat
      .writes(this)
      .as[JsObject] - "apiKey" - "integrationToken" ++ Json.obj(
      "apiKey" -> Json.obj("clientName" -> apiKey.clientName))
  def asSimpleJson: JsValue = Json.obj(
    "_id" -> json.ApiSubscriptionIdFormat.writes(id),
    "_tenant" -> json.TenantIdFormat.writes(tenant),
    "_deleted" -> deleted,
    "plan" -> json.UsagePlanIdFormat.writes(plan),
    "team" -> json.TeamIdFormat.writes(team),
    "api" -> json.ApiIdFormat.writes(api),
    "createdAt" -> json.DateTimeFormat.writes(createdAt),
    "customName" -> customName
      .map(id => JsString(id))
      .getOrElse(JsNull)
      .as[JsValue],
    "enabled" -> JsBoolean(enabled)
  )
}

object RemainingQuotas {
  val MaxValue: Long = 10000000L
}

case class ActualOtoroshiApiKey(
                                 clientId: String = IdGenerator.token(16),
                                 clientSecret: String = IdGenerator.token(64),
                                 clientName: String,
                                 authorizedEntities: AuthorizedEntities,
                                 enabled: Boolean = true,
                                 allowClientIdOnly: Boolean = false,
                                 readOnly: Boolean = false,
                                 constrainedServicesOnly: Boolean = false,
                                 throttlingQuota: Long = RemainingQuotas.MaxValue,
                                 dailyQuota: Long = RemainingQuotas.MaxValue,
                                 monthlyQuota: Long = RemainingQuotas.MaxValue,
                                 tags: Seq[String] = Seq.empty[String],
                                 metadata: Map[String, String] = Map.empty[String, String],
                                 restrictions: ApiKeyRestrictions = ApiKeyRestrictions(),
                                 rotation: Option[ApiKeyRotation])
  extends CanJson[OtoroshiApiKey] {
  override def asJson: JsValue = json.ActualOtoroshiApiKeyFormat.writes(this)
  def asOtoroshiApiKey: OtoroshiApiKey = OtoroshiApiKey(clientName = clientName, clientId = clientId, clientSecret = clientSecret)
}

case class ApiKeyConsumption(
                              id: DatastoreId,
                              tenant: TenantId,
                              team: TeamId,
                              api: ApiId,
                              plan: UsagePlanId,
                              clientId: String,
                              hits: Long,
                              globalInformations: ApiKeyGlobalConsumptionInformations,
                              quotas: ApiKeyQuotas,
                              billing: ApiKeyBilling,
                              from: DateTime,
                              to: DateTime)
  extends CanJson[ApiKeyConsumption] {
  override def asJson: JsValue = json.ConsumptionFormat.writes(this)
}

case class ApiKeyGlobalConsumptionInformations(hits: Long,
                                               dataIn: Long,
                                               dataOut: Long,
                                               avgDuration: Option[Double],
                                               avgOverhead: Option[Double])
  extends CanJson[ApiKeyGlobalConsumptionInformations] {
  override def asJson: JsValue =
    json.GlobalConsumptionInformationsFormat.writes(this)
}

case class ApiKeyQuotas(authorizedCallsPerSec: Long,
                        currentCallsPerSec: Long,
                        remainingCallsPerSec: Long,
                        authorizedCallsPerDay: Long,
                        currentCallsPerDay: Long,
                        remainingCallsPerDay: Long,
                        authorizedCallsPerMonth: Long,
                        currentCallsPerMonth: Long,
                        remainingCallsPerMonth: Long)
  extends CanJson[ApiKeyQuotas] {
  override def asJson: JsValue = json.ApiKeyQuotasFormat.writes(this)
}

case class ApiKeyBilling(hits: Long, total: BigDecimal)
  extends CanJson[ApiKeyBilling] {
  override def asJson: JsValue = json.ApiKeyBillingFormat.writes(this)
}