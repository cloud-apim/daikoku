import { useQueryClient } from "@tanstack/react-query";
import React, { useContext, useEffect, useState } from "react";
import { toastr } from "react-redux-toastr";
import { constraints, format, type as formType } from "@maif/react-forms";
import Select from "react-select";
import { getApolloContext } from "@apollo/client";

import { IApi, IFastApi, IFastPlan, IFastSubscription, isError, ISubscription, ISubscriptionWithApiInfo, isValidationStepTeamAdmin, ITeamSimple, IUsagePlan } from "../../../types";
import { I18nContext } from "../../../contexts/i18n-context";
import * as Services from "../../../services";
import { ModalContext } from "../../../contexts";
import { isSubscriptionProcessIsAutomatic, Option } from '../../utils';

type FastApiCardProps = {
  team: ITeamSimple,
  apisWithAuthorization: Array<IFastApi>,
  subscriptions: Array<Array<IFastSubscription>>,
  showPlan: (plan: IFastPlan) => void
  showApiKey: (apiId: string, teamId: string, version: string, plan: IFastPlan) => void
  planResearch: string
}
export const FastApiCard = (props: FastApiCardProps) => {
  const { openFormModal, openApiKeySelectModal } = useContext(ModalContext);

  const queryClient = useQueryClient();
  const { client } = useContext(getApolloContext());

  const { translate } = useContext(I18nContext);
  const [selectedApiV, setSelectedApiV] = useState(props.apisWithAuthorization.find(a => a.api.isDefault)?.api.currentVersion || props.apisWithAuthorization[0].api.currentVersion);
  const [selectedApi, setSelectedApi] = useState<IFastApi>(props.apisWithAuthorization.find((api) => api.api.currentVersion === selectedApiV)!)

  useEffect(() => {
    setSelectedApi(props.apisWithAuthorization.find((api) => api.api.currentVersion === selectedApiV)!)
  }, [props.apisWithAuthorization])


  const changeApiV = (version: string) => {
    setSelectedApiV(version)
    setSelectedApi(props.apisWithAuthorization.find((api) => api.api.currentVersion === version)!)
  }

  const subscribe = (apiId: string, team: ITeamSimple, plan: IFastPlan, apiKey?: ISubscription) => {
    const apiKeyDemand = (motivation?: object) => apiKey
      ? Services.extendApiKey(apiId, apiKey._id, team._id, plan._id, motivation)
      : Services.askForApiKey(apiId, team._id, plan._id, motivation)

    const adminStep = plan.subscriptionProcess.find(s => isValidationStepTeamAdmin(s))
    if (adminStep && isValidationStepTeamAdmin(adminStep)) {
      openFormModal<{ motivation: string }>({
        title: translate('motivations.modal.title'),
        schema: adminStep.schema,
        onSubmit: (motivation) => {
          apiKeyDemand(motivation)
            .then((response) => {
              if (isError(response)) {
                toastr.error(
                  translate('Error'),
                  response.error
                )
              } else {
                toastr.info(
                  translate('Done'),
                  translate(
                    {
                      key: 'subscription.plan.waiting',
                      replacements: [
                        plan.customName!,
                        team.name
                      ]
                    }))
                queryClient.invalidateQueries({ queryKey: ['data'] })
              }
            }
            )

        },
        actionLabel: translate('Send')
      })
    } else {
      apiKeyDemand()
        .then((response) => {
          if (isError(response)) {
            toastr.error(
              translate('Error'),
              response.error
            )
          } else {
            toastr.success(
              translate('Done'),
              translate(
                {
                  key: 'subscription.plan.accepted',
                  replacements: [
                    plan.customName!,
                    team.name
                  ]
                }))
            queryClient.invalidateQueries({ queryKey: ['data'] })
          }
        })
    }
  }

  type IUsagePlanGQL = {
    _id: string
    otoroshiTarget: {
      otoroshiSettings: string
    }
    aggregationApiKeysSecurity: boolean
  }
  type IApiGQL = {
    _id: string
    _humanReadableId: string
    currentVersion: string
    name: string
    possibleUsagePlans: IUsagePlanGQL[]
  }

  const subscribeOrExtends = (apiId: string, team: ITeamSimple, plan: IFastPlan) => {
    if (client) {
      Services.getAllTeamSubscriptions(props.team._id)
        .then((subscriptions) => client.query({
          query: Services.graphql.apisByIdsWithPlans,
          variables: { ids: [...new Set(subscriptions.map((s) => s.api))] },
        })
          .then(({ data }) => ({ apis: data.apis, subscriptions }))
        )
        .then(({ apis, subscriptions }: { apis: Array<IApiGQL>, subscriptions: Array<ISubscriptionWithApiInfo> }) => {
          const int = subscriptions
            .map((subscription) => {
              const api = apis.find((a) => a._id === subscription.api);
              const plan = Option(api?.possibleUsagePlans)
                .flatMap((plans) => Option(plans.find((plan) => plan._id === subscription.plan)))
                .getOrNull();
              return { subscription, api, plan };
            })

          const filteredApiKeys = int.filter((infos) => infos.plan?.otoroshiTarget?.otoroshiSettings ===
            plan?.otoroshiTarget?.otoroshiSettings && infos.plan?.aggregationApiKeysSecurity
          )
            .map((infos) => infos.subscription);

          if (!plan.aggregationApiKeysSecurity || subscriptions.length <= 0) {
            subscribe(apiId, team, plan);
          } else {
            openApiKeySelectModal({
              plan,
              apiKeys: filteredApiKeys,
              onSubscribe: () => subscribe(apiId, team, plan),
              extendApiKey: (apiKey: ISubscription) => subscribe(apiId, team, plan, apiKey),
            });
          }
        });
    }

  }

  return (
    <div className="row py-2">
      <div className="col-12">
        <div className="d-flex flex-row mx-3 justify-content-between align-items-center">
          {/* TODO: overflow ellips  for title*/}
          <h3 style={{ overflow: 'hidden', textOverflow: "ellipsis", whiteSpace: 'nowrap' }}>{selectedApi.api.name}</h3>
          {props.apisWithAuthorization.length > 1 &&
            <Select
              name="versions-selector"
              classNamePrefix="reactSelect"
              className="me-2 col-2 select-sm"
              menuPlacement="auto"
              menuPosition="fixed"
              value={{ value: selectedApiV, label: selectedApiV }}
              isClearable={false}
              options={props.apisWithAuthorization.map((api) => {
                return { value: api.api.currentVersion, label: api.api.currentVersion }
              })}
              onChange={(e) => { changeApiV(e!.value) }}
            />}
        </div>
        <div className="d-flex flex-column fast_api" id="usage-plans__list">
          {selectedApi.subscriptionsWithPlan
            .map(subPlan => {
              const plan = selectedApi.api.possibleUsagePlans.find((pPlan) => pPlan._id === subPlan.planId)!
              return { plan, ...subPlan }
            })
            .sort((a, b) => (a.plan.customName || '').localeCompare(b.plan.customName || ''))
            .filter(({ plan }) => plan.otoroshiTarget && plan.otoroshiTarget.authorizedEntities
              && (!!plan.otoroshiTarget.authorizedEntities.groups.length
                || !!plan.otoroshiTarget.authorizedEntities.services.length
                || !!plan.otoroshiTarget.authorizedEntities.routes.length))
            .map(({ plan, subscriptionsCount, isPending }) => {
              if (!plan.customName?.toLowerCase().includes(props.planResearch.toLowerCase()) || plan.otoroshiTarget?.authorizedEntities === null) {
                return;
              }
              return (
                <div className="fast__hover plan cursor-pointer" key={plan._id} data-usage-plan={plan.customName}>
                  <div className="mx-3 d-flex justify-content-between my-1">
                    <div className="flex-grow-1" onClick={() => props.showPlan(plan)}
                      style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {plan.customName}
                    </div>
                    {!!subscriptionsCount &&
                      <button className={"btn btn-sm btn-outline-success"}
                        onClick={() =>
                          props.showApiKey(
                            selectedApi.api._id,
                            props.team._id,
                            selectedApiV,
                            plan
                          )}
                        style={{ whiteSpace: "nowrap" }}>
                        {translate({ key: 'fastMode.button.seeApiKey', plural: subscriptionsCount > 1 })}
                      </button>}
                    {((!subscriptionsCount && !isPending) || plan.allowMultipleKeys) &&
                      <button
                        style={{ whiteSpace: "nowrap" }}
                        className={"btn btn-sm btn-outline-primary"}
                        onClick={() => subscribeOrExtends(
                          selectedApi.api._id,
                          props.team,
                          plan
                        )}>
                        {translate(isSubscriptionProcessIsAutomatic(plan) ? ('Get API key') : ('Request API key'))}
                      </button>}
                    {isPending &&
                      <button style={{ whiteSpace: "nowrap" }} disabled={true}
                        className={"btn btn-sm btn-outline-primary disabled"}>
                        {translate('fastMode.button.pending')}
                      </button>}
                  </div>
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}