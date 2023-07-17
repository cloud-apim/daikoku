import { getApolloContext } from '@apollo/client';
import { constraints, format, type as formType } from '@maif/react-forms';
import difference from 'lodash/difference';
import find from 'lodash/find';
import React, { useContext } from 'react';
import { useSelector } from 'react-redux';

import { ModalContext } from '../../../contexts';
import { I18nContext } from '../../../core';
import * as Services from '../../../services';
import { currencies } from '../../../services/currencies';
import { IApi, IBaseUsagePlan, isMiniFreeWithQuotas, IState, IStateContext, ISubscription, ISubscriptionDemand, ISubscriptionWithApiInfo, isValidationStepTeamAdmin, ITeamSimple, IUsagePlan, IUsagePlanFreeWithQuotas, IUsagePlanPayPerUse, IUsagePlanQuotasWithLimits, IUsagePlanQuotasWitoutLimit } from '../../../types';
import { INotification } from '../../../types';
import {
  access,
  api,
  apikey, Can, isPublish, isSubscriptionProcessIsAutomatic, manage,
  Option, renderPlanInfo, renderPricing
} from '../../utils';
import { ActionWithTeamSelector } from '../../utils/ActionWithTeamSelector';
import { formatPlanType } from '../../utils/formatters';
import classNames from 'classnames';
import { Link, useNavigate } from 'react-router-dom';
import { is } from 'cypress/types/bluebird';


export const currency = (plan?: IBaseUsagePlan) => {
  if (!plan) {
    return ""; //todo: return undefined
  }
  const cur = find(currencies, (c) => c.code === plan.currency.code);
  return `${cur?.name}(${cur?.symbol})`;
};

type ApiPricingCardProps = {
  plan: IUsagePlan,
  api: IApi,
  askForApikeys: (x: { team: string, plan: IUsagePlan, apiKey?: ISubscription, motivation?: string }) => Promise<void>,
  myTeams: Array<ITeamSimple>,
  ownerTeam: ITeamSimple,
  subscriptions: Array<ISubscription>,
  inProgressDemands: Array<ISubscriptionDemand>,
}

const ApiPricingCard = (props: ApiPricingCardProps) => {
  const { Translation } = useContext(I18nContext);
  const { openFormModal, openLoginOrRegisterModal, openApiKeySelectModal, openCustomModal, close } = useContext(ModalContext);
  const { client } = useContext(getApolloContext());

  const { connectedUser, tenant } = useSelector<IState, IStateContext>(s => s.context)

  const showApiKeySelectModal = (team: string) => {
    const { plan } = props;

    //FIXME: not bwaaagh !!
    if (!client) {
      return;
    }

    const askForApikeys = (team: string, plan: IUsagePlan, apiKey?: ISubscription) => {
      if (plan.subscriptionProcess.some(isValidationStepTeamAdmin)) {
        openFormModal<{ motivation: string }>({
          title: translate('motivations.modal.title'),
          schema: {
            motivation: {
              type: formType.string,
              format: format.text,
              label: null,
              constraints: [
                constraints.required()
              ]
            }
          },
          onSubmit: ({ motivation }) => props.askForApikeys({ team, plan, apiKey, motivation }),
          actionLabel: translate('Send')
        })
      } else {
        props.askForApikeys({ team, plan: plan, apiKey })
          .then(() => close())
      }
    }

    Services.getAllTeamSubscriptions(team)
      .then((subscriptions) => client.query({
        query: Services.graphql.apisByIdsWithPlans,
        variables: { ids: [...new Set(subscriptions.map((s) => s.api))] },
      })
        .then(({ data }) => ({ apis: data.apis, subscriptions }))
      )
      .then(({ apis, subscriptions }: { apis: Array<IApi>, subscriptions: Array<ISubscriptionWithApiInfo> }) => {
        const int = subscriptions
          .map((subscription) => {
            const api = apis.find((a) => a._id === subscription.api);
            const plan: IUsagePlan = Option(api?.possibleUsagePlans)
              .flatMap((plans: Array<IUsagePlan>) => Option(plans.find((plan) => plan._id === subscription.plan)))
              .getOrNull();
            return { subscription, api, plan };
          })

        const filteredApiKeys = int.filter((infos) => infos.plan?.otoroshiTarget?.otoroshiSettings ===
          plan?.otoroshiTarget?.otoroshiSettings && infos.plan.aggregationApiKeysSecurity
        )
          .map((infos) => infos.subscription);

        if (!plan.aggregationApiKeysSecurity || subscriptions.length <= 0) {
          askForApikeys(team, plan);
        } else {
          openApiKeySelectModal({
            plan,
            apiKeys: filteredApiKeys,
            onSubscribe: () => askForApikeys(team, plan),
            extendApiKey: (apiKey: ISubscription) => askForApikeys(team, plan, apiKey),
          });
        }
      });
  };

  const plan = props.plan;
  const customDescription = plan.customDescription;
  const isAutomaticProcess = isSubscriptionProcessIsAutomatic(plan)

  const authorizedTeams = props.myTeams
    .filter((t) => !tenant.subscriptionSecurity || t.type !== 'Personal')
    .filter((t) => props.api.visibility === 'Public' ||
      props.api.authorizedTeams.includes(t._id) ||
      t._id === props.ownerTeam._id
    );

  const allPossibleTeams = difference(
    authorizedTeams.map((t) => t._id),
    props.subscriptions
      .filter((_) => !plan.allowMultipleKeys)
      .filter((f) => !f._deleted)
      .map((s) => s.team)
  );

  const isAccepted = !allPossibleTeams.length;

  const { translate } = useContext(I18nContext);

  let pricing = renderPricing(plan, translate)

  const otoroshiTargetIsDefined = !!plan.otoroshiTarget && plan.otoroshiTarget.authorizedEntities;
  const otoroshiEntitiesIsDefined = otoroshiTargetIsDefined && (!!plan.otoroshiTarget?.authorizedEntities?.groups.length ||
    !!plan.otoroshiTarget?.authorizedEntities?.routes.length ||
    !!plan.otoroshiTarget?.authorizedEntities?.services.length);


  const openTeamSelectorModal = () => {
    openCustomModal({
      title: 'select team',
      content: <TeamSelector
        teams={authorizedTeams
          .filter((t) => t.type !== 'Admin' || props.api.visibility === 'AdminOnly')
          .filter((team) => plan.visibility === 'Public' || team._id === props.ownerTeam._id)
          .filter((t) => !tenant.subscriptionSecurity || t.type !== 'Personal')}
        pendingTeams={props.inProgressDemands.map((s) => s.team)}
        acceptedTeams={props.subscriptions
          .filter((f) => !f._deleted)
          .map((subs) => subs.team)}
        allowMultipleDemand={plan.allowMultipleKeys}
        showApiKeySelectModal={showApiKeySelectModal}
        plan={props.plan}
      />
    })
  }

  return (
    <div className="col-md-4 card mb-4 shadow-sm usage-plan__card" data-usage-plan={plan.customName}>
      <div className="card-img-top card-link card-skin" data-holder-rendered="true">
        <span>{plan.customName || formatPlanType(plan, translate)}</span>
      </div>
      <div className="card-body plan-body d-flex flex-column">
        <p className="card-text text-justify">
          {customDescription && <span>{customDescription}</span>}
          {!customDescription && renderPlanInfo(plan)}
        </p>
        <div className="d-flex flex-column mb-2">
          <span className="plan-quotas">
            {!isMiniFreeWithQuotas(plan) && translate('plan.limits.unlimited')}
            {isMiniFreeWithQuotas(plan) && (
              <div>
                <div>
                  <Translation
                    i18nkey="plan.limits"
                    replacements={[plan.maxPerSecond, plan.maxPerMonth]}
                  >
                    Limits: {plan.maxPerSecond} req./sec, {plan.maxPerMonth} req./month
                  </Translation>
                </div>
              </div>
            )}
          </span>
          <span className="plan-pricing">
            <Translation i18nkey="plan.pricing" replacements={[pricing]}>
              pricing: {pricing}
            </Translation>
          </span>
        </div>
        <div className="d-flex justify-content-between align-items-center">
          {!otoroshiTargetIsDefined && props.api.visibility !== 'AdminOnly' && (
            <span className="badge bg-danger m-1">{translate('otoroshi.missing.target')}</span>
          )}
          {!otoroshiEntitiesIsDefined && props.api.visibility !== 'AdminOnly' && (
            <span className="badge bg-danger m-1">{translate('otoroshi.missing.entities')}</span>
          )}
          {(otoroshiTargetIsDefined && otoroshiEntitiesIsDefined || props.api.visibility === 'AdminOnly') &&
            (!isAccepted || props.api.visibility === 'AdminOnly') &&
            isPublish(props.api) && (
              <Can
                I={access}
                a={apikey}
                teams={authorizedTeams.filter(
                  (team) => plan.visibility === 'Public' || team._id === props.ownerTeam._id
                )}
              >
                {(props.api.visibility === 'AdminOnly' ||
                  (plan.otoroshiTarget && !isAccepted)) && (
                    <button type="button" className="btn btn-sm btn-access-negative col-12" onClick={openTeamSelectorModal}>
                      <Translation
                        i18nkey={
                          isAutomaticProcess ? 'Get API key' : 'Request API key'
                        }
                      >
                        {isAutomaticProcess ? 'Get API key' : 'Request API key'}
                      </Translation>
                    </button>
                  )}
              </Can>
            )}
          {connectedUser.isGuest && (
            <button
              type="button"
              className="btn btn-sm btn-access-negative mx-auto mt-3"
              onClick={() => openLoginOrRegisterModal({ tenant })}
            >
              <Translation i18nkey="Get API key">Get API key</Translation>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

type ITeamSelector = {
  teams: Array<ITeamSimple>
  pendingTeams: Array<string>
  acceptedTeams: Array<string>
  allowMultipleDemand?: boolean
  showApiKeySelectModal: (teamId: string) => void,
  plan: IUsagePlan
}

const TeamSelector = (props: ITeamSelector) => {
  const { translate } = useContext(I18nContext);
  const { close } = useContext(ModalContext);
  const navigate = useNavigate();

  const displayVerifiedBtn = props.plan.subscriptionProcess.some(p => p.type === 'payment')

  return (
    <div className="modal-body">
      <div>
        <div className='modal-description'>{translate('team.selection.desc.request')}</div>
        <div className='team-selection__container'>
          {
            props.teams
              .filter(t => !!props.allowMultipleDemand || !props.acceptedTeams.includes(t._id))
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(team => {
                const allowed = props.allowMultipleDemand ||
                  (!props.pendingTeams.includes(team._id) && !props.acceptedTeams.includes(team._id) && (!displayVerifiedBtn || team.verified))

                return (
                  <div
                    key={team._id}
                    className={classNames('team-selection team-selection__team', {
                      selectable: allowed,
                      'cursor-forbidden': !allowed,
                    })}
                    onClick={() => allowed ? props.showApiKeySelectModal(team._id) : () => { }}
                  >
                    {
                      props.pendingTeams.includes(team._id) &&
                      <button type="button" className="btn btn-sm btn-outline-secondary disabled">
                        {translate("Request in progress")}
                      </button>
                    }
                    {
                      displayVerifiedBtn && !team.verified &&
                      <button type="button" className="btn btn-sm btn-outline-warning" onClick={() => {
                        close()
                        navigate(`/${team._humanReadableId}/settings/edition`)
                      }}>
                        {translate("Email not verified")}
                      </button>
                    }
                    <span className="ms-2">{team.name}</span>
                  </div>
                )
              })
          }
        </div>
      </div>
    </div>
  )
}

type ApiPricingProps = {
  api: IApi
  myTeams: Array<ITeamSimple>
  ownerTeam: ITeamSimple
  subscriptions: Array<ISubscription>,
  inProgressDemands: Array<ISubscriptionDemand>,
  askForApikeys: (x: { team: string, plan: IUsagePlan, apiKey?: ISubscription, motivation?: string }) => Promise<void>,
}
export function ApiPricing(props: ApiPricingProps) {
  if (!props.api) {
    return null;
  }

  const possibleUsagePlans = props.api.possibleUsagePlans.filter((plan) => {
    return plan.visibility === 'Public' ||
      props.myTeams.some((team) => team._id === props.ownerTeam._id) ||
      props.myTeams.some((team) => plan.authorizedTeams.includes(team._id));
  });

  return (
    <div className="d-flex flex-row pricing-content flex-wrap" id="usage-plans__list">
      {possibleUsagePlans
        .sort((a, b) => (a.customName || a.type).localeCompare(b.customDescription || b.type))
        .map((plan) => <React.Fragment key={plan._id}>
          <ApiPricingCard
            api={props.api}
            key={plan._id}
            plan={plan}
            myTeams={props.myTeams}
            ownerTeam={props.ownerTeam}
            subscriptions={props.subscriptions.filter(
              (subs) => subs.api === props.api._id && subs.plan === plan._id
            )}
            inProgressDemands={props.inProgressDemands.filter(
              (demand) => demand.api === props.api._id && demand.plan === plan._id
            )}
            askForApikeys={props.askForApikeys}
          />
        </React.Fragment>)}
    </div>
  );
}
