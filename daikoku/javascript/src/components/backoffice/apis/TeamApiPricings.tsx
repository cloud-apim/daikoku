import { UniqueIdentifier } from '@dnd-kit/core';
import { constraints, Form, format, Schema, type } from '@maif/react-forms';
import { useQuery } from '@tanstack/react-query';
import classNames from 'classnames';
import cloneDeep from 'lodash/cloneDeep';
import { nanoid } from 'nanoid';
import { useContext, useEffect, useState } from 'react';
import { toastr } from 'react-redux-toastr';
import { useParams } from 'react-router-dom';
import Select, { components } from 'react-select';
import CreatableSelect from 'react-select/creatable';
import Settings from 'react-feather/dist/icons/settings'
import Trash from 'react-feather/dist/icons/trash'
import Plus from 'react-feather/dist/icons/plus'
import AtSign from 'react-feather/dist/icons/at-sign'
import CreditCard from 'react-feather/dist/icons/credit-card'
import User from 'react-feather/dist/icons/user'

import { ModalContext } from '../../../contexts';
import { I18nContext } from '../../../core';
import * as Services from '../../../services';
import { currencies } from '../../../services/currencies';
import { ITeamSimple } from '../../../types';
import { IApi, isError, isValidationStepEmail, isValidationStepPayment, isValidationStepTeamAdmin, IUsagePlan, IValidationStep, IValidationStepEmail, IValidationStepTeamAdmin, UsagePlanVisibility } from '../../../types/api';
import { IOtoroshiSettings, ITenant, ITenantFull, IThirdPartyPaymentSettings } from '../../../types/tenant';
import {
  BeautifulTitle, formatPlanType, IMultistepsformStep,
  MultiStepForm, Option,
  renderPricing,
  team
} from '../../utils';
import { addArrayIf, insertArrayIndex } from '../../utils/array';
import { FixedItem, SortableItem, SortableList } from '../../utils/dnd/SortableList';

const SUBSCRIPTION_PLAN_TYPES = {
  FreeWithoutQuotas: {
    defaultName: 'Free plan',
    defaultDescription: 'Free plan with unlimited number of calls per day and per month',
  },
  FreeWithQuotas: {
    defaultName: 'Free plan with quotas',
    defaultDescription: 'Free plan with limited number of calls per day and per month',
  },
  QuotasWithLimits: {
    defaultName: 'Quotas with limits',
    defaultDescription: 'Priced plan with limited number of calls per day and per month',
  },
  QuotasWithoutLimits: {
    defaultName: 'Quotas with Pay per use',
    defaultDescription: 'Priced plan with unlimited number of calls per day and per month',
  },
  PayPerUse: { defaultName: 'Pay per use', defaultDescription: 'Plan priced on usage' },
};

const OtoroshiEntitiesSelector = ({
  rawValues,
  onChange,
  translate
}: any) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [groups, setGroups] = useState<Array<any>>([]);
  const [services, setServices] = useState<Array<any>>([]);
  const [routes, setRoutes] = useState<Array<any>>([]);
  const [disabled, setDisabled] = useState<boolean>(true);
  const [value, setValue] = useState<any>(undefined);

  const { Translation } = useContext(I18nContext);

  const params = useParams();

  useEffect(() => {
    const otoroshiTarget = rawValues.otoroshiTarget;

    if (otoroshiTarget && otoroshiTarget.otoroshiSettings) {
      Promise.all([
        Services.getOtoroshiGroupsAsTeamAdmin(
          params.teamId,
          rawValues.otoroshiTarget.otoroshiSettings
        ),
        Services.getOtoroshiServicesAsTeamAdmin(
          params.teamId,
          rawValues.otoroshiTarget.otoroshiSettings
        ),
        Services.getOtoroshiRoutesAsTeamAdmin(
          params.teamId,
          rawValues.otoroshiTarget.otoroshiSettings
        )
      ])
        .then(([groups, services, routes]) => {
          if (!groups.error)
            setGroups(groups.map((g: any) => ({
              label: g.name,
              value: g.id,
              type: 'group'
            })));
          else setGroups([]);
          if (!services.error)
            setServices(services.map((g: any) => ({
              label: g.name,
              value: g.id,
              type: 'service'
            })));
          else setServices([]);
          if (!routes.error)
            setRoutes(routes.map((g: any) => ({
              label: g.name,
              value: g.id,
              type: 'route'
            })));
          else setRoutes([]);
        })
        .catch(() => {
          setGroups([]);
          setServices([]);
          setRoutes([]);
        });
    }
    setDisabled(!otoroshiTarget || !otoroshiTarget.otoroshiSettings);
  }, [rawValues?.otoroshiTarget?.otoroshiSettings]);

  useEffect(() => {
    if (groups && services && routes) {
      setLoading(false);
    }
  }, [services, groups, routes]);

  useEffect(() => {
    if (!!groups && !!services && !!routes && !!rawValues.otoroshiTarget.authorizedEntities) {
      setValue([
        ...rawValues.otoroshiTarget.authorizedEntities.groups.map((authGroup: any) => (groups as any).find((g: any) => g.value === authGroup)),
        ...(rawValues.otoroshiTarget.authorizedEntities.services || []).map((authService: any) => (services as any).find((g: any) => g.value === authService)),
        ...(rawValues.otoroshiTarget.authorizedEntities.routes || []).map((authRoute: any) => (routes as any).find((g: any) => g.value === authRoute))
      ].filter((f) => f));
    }
  }, [rawValues, groups, services, routes]);

  const onValueChange = (v: any) => {
    if (!v) {
      onChange(null);
      setValue(undefined);
    } else {
      const value = v.reduce(
        (acc: any, entitie: any) => {
          switch (entitie.type) {
            case 'group':
              return {
                ...acc,
                groups: [...acc.groups, groups.find((g: any) => g.value === entitie.value).value],
              };
            case 'service':
              return {
                ...acc,
                services: [...acc.services, services.find((s: any) => s.value === entitie.value).value],
              };
            case 'route':
              return {
                ...acc,
                routes: [...acc.routes, routes.find((s: any) => s.value === entitie.value).value],
              };
          }
        },
        { groups: [], services: [], routes: [] }
      );
      setValue([
        ...value.groups.map((authGroup: any) => groups.find((g: any) => g.value === authGroup)),
        ...value.services.map((authService: any) => services.find((g: any) => g.value === authService)),
        ...value.routes.map((authRoute: any) => routes.find((g: any) => g.value === authRoute)),
      ]);
      onChange(value);
    }
  };

  return (<div>
    <Select
      id={`input-label`}
      isMulti
      name={`search-label`}
      isLoading={loading}
      isDisabled={disabled && !loading}
      placeholder={translate('Authorized.entities.placeholder')} //@ts-ignore //FIXME
      components={(props: any) => <components.Group {...props} />}
      options={[
        { label: 'Service groups', options: groups },
        { label: 'Services', options: services },
        { label: 'Routes', options: routes },
      ]} value={value} onChange={onValueChange} classNamePrefix="reactSelect" className="reactSelect" />
    <div className="col-12 d-flex flex-row mt-1">
      <div className="d-flex flex-column flex-grow-1">
        <strong className="font-italic">
          <Translation i18nkey="authorized.groups">Services Groups</Translation>
        </strong>
        {!!value &&
          value.filter((x: any) => x.type === 'group')
            .map((g: any, idx: any) => (<span className="font-italic" key={idx}>
              {g.label}
            </span>))}
      </div>
      <div className="d-flex flex-column flex-grow-1">
        <strong className="font-italic">
          <Translation i18nkey="authorized.services">Services</Translation>
        </strong>
        {!!value &&
          value.filter((x: any) => x.type === 'service')
            .map((g: any, idx: any) => (<span className="font-italic" key={idx}>
              {g.label}
            </span>))}
      </div>
      <div className="d-flex flex-column flex-grow-1">
        <strong className="font-italic">
          <Translation i18nkey="authorized.routes">Routes</Translation>
        </strong>
        {!!value &&
          value.filter((x: any) => x.type === 'route')
            .map((g: any, idx: any) => (<span className="font-italic" key={idx}>
              {g.label}
            </span>))}
      </div>
    </div>
  </div>);
};

const CustomMetadataInput = (props: {
  value?: Array<{ key: string, possibleValues: Array<string> }>;
  onChange?: (param: any) => void;
  setValue?: (key: string, data: any) => void;
  translate: (key: string) => string
}) => {
  const { alert } = useContext(ModalContext);

  const changeValue = (possibleValues: any, key: any) => {
    const oldValue = Option(props.value?.find((x: any) => x.key === key)).getOrElse({ '': '' });
    const newValues = [...(props.value || []).filter((x: any) => x.key !== key), { ...oldValue, key, possibleValues }];
    props.onChange && props.onChange(newValues);
  };

  const changeKey = (e: any, oldName: any) => {
    if (e && e.preventDefault) e.preventDefault();

    const oldValue = Option(props.value?.find((x: any) => x.key === oldName)).getOrElse({ '': '' });
    const newValues = [
      ...(props.value || []).filter((x: any) => x.key !== oldName),
      { ...oldValue, key: e.target.value },
    ];
    props.onChange && props.onChange(newValues);
  };

  const addFirst = (e: any) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!props.value || props.value.length === 0) {
      props.onChange && props.onChange([{ key: '', possibleValues: [] }]);
      //FIXME: add better info to user for the new subscription process
      alert({ message: props.translate('custom.metadata.process.change.to.manual'), title: props.translate('Information') })
    }
  };

  const addNext = (e: any) => {
    if (e && e.preventDefault) e.preventDefault();
    const newItem = { key: '', possibleValues: [] };
    const newValues = [...(props.value || []), newItem];
    props.onChange && props.onChange(newValues);
  };

  const remove = (e: any, key: any) => {
    if (e && e.preventDefault) e.preventDefault();

    props.onChange && props.onChange((props.value || []).filter((x: any) => x.key !== key));
  };

  return (
    <div>
      {!props.value?.length && (
        <div className="col-sm-10">
          <button type="button" className="btn btn-outline-primary" onClick={addFirst}>
            <i className="fas fa-plus" />{' '}
          </button>
        </div>
      )}

      {(props.value || []).map(({
        key,
        possibleValues
      }, idx) => (
        <div key={idx} className="col-sm-10">
          <div className="input-group">
            <input
              type="text"
              className="form-control col-5 me-1"
              value={key}
              onChange={(e) => changeKey(e, key)}
            />
            <CreatableSelect
              isMulti
              onChange={(e) =>
                changeValue(
                  e.map(({ value }) => value),
                  key
                )
              }
              options={undefined}
              value={possibleValues.map((value: any) => ({
                label: value,
                value
              }))}
              className="input-select reactSelect flex-grow-1"
              classNamePrefix="reactSelect"
            />
            <button
              type="button"
              className="input-group-text btn btn-outline-danger"
              onClick={(e) => remove(e, key)}
            >
              <i className="fas fa-trash" />
            </button>
            {idx === (props.value?.length || 0) - 1 && (
              <button
                type="button"
                className="input-group-text btn btn-outline-primary"
                onClick={addNext}
              >
                <i className="fas fa-plus" />{' '}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

type CardProps = {
  plan: IUsagePlan
  isDefault: boolean
  makeItDefault?: () => void
  toggleVisibility?: () => void
  deletePlan?: () => void
  editPlan?: () => void
  duplicatePlan?: () => void
  creation?: boolean
}
const Card = ({
  plan,
  isDefault,
  makeItDefault,
  toggleVisibility,
  deletePlan,
  editPlan,
  duplicatePlan,
  creation
}: CardProps) => {
  const { translate, Translation } = useContext(I18nContext);
  const { confirm } = useContext(ModalContext);


  const pricing = renderPricing(plan, translate)

  const deleteWithConfirm = () => {
    confirm({ message: translate('delete.plan.confirm') })
      .then((ok) => {
        if (ok && deletePlan) {
          deletePlan()
        }
      });
  };

  const noOtoroshi = !plan.otoroshiTarget || !plan.otoroshiTarget.authorizedEntities ||
    (!plan.otoroshiTarget.authorizedEntities.groups.length &&
      !plan.otoroshiTarget.authorizedEntities.services.length &&
      !plan.otoroshiTarget.authorizedEntities.routes.length)

  return (
    <div className="card hoverable-card mb-4 shadow-sm" style={{ position: 'relative' }}>
      {noOtoroshi && (
        <BeautifulTitle className="" title={translate("warning.missing.otoroshi")} style={{
          position: 'absolute',
          fontSize: '20px',
          bottom: '15px',
          right: '15px',
          zIndex: '100',
          color: 'var(--error-color, #ff6347)'
        }}>
          <i className="fas fa-exclamation-triangle" />
        </BeautifulTitle>
      )}
      <div style={{
        position: 'absolute',
        fontSize: '20px',
        top: '15px',
        right: '15px',
        zIndex: '100',
      }}>
        {plan.visibility === PRIVATE && (
          <i className="fas fa-lock" />
        )}
        {isDefault && (
          <i className="fas fa-star" />
        )}
      </div>
      {!creation && (
        <div
          className="dropdown"
          style={{ position: 'absolute', top: '15px', left: '15px', zIndex: '100' }}
        >
          <i
            className="fa fa-cog cursor-pointer dropdown-menu-button"
            style={{ fontSize: '20px' }}
            data-bs-toggle="dropdown"
            aria-expanded="false"
            id="dropdownMenuButton"
          />
          <div className="dropdown-menu" aria-labelledby="dropdownMenuButton">
            {!isDefault && plan.visibility !== PRIVATE && (
              <span className="dropdown-item cursor-pointer" onClick={makeItDefault}>
                <Translation i18nkey="Make default plan">Make default plan</Translation>
              </span>
            )}
            {!isDefault && (
              <span onClick={toggleVisibility} className="dropdown-item cursor-pointer">
                {plan.visibility === PUBLIC && (
                  <Translation i18nkey="Make it private">Make it private</Translation>
                )}
                {plan.visibility === PRIVATE && (
                  <Translation i18nkey="Make it public">Make it public</Translation>
                )}
              </span>
            )}
            <div className="dropdown-divider" />
            <span className="dropdown-item cursor-pointer" onClick={duplicatePlan}>
              <Translation i18nkey="Duplicate plan">duplicate</Translation>
            </span>
            <span className="dropdown-item cursor-pointer" onClick={editPlan}>
              <Translation i18nkey="Edit plan">Edit</Translation>
            </span>
            <div className="dropdown-divider" />
            <span
              className="dropdown-item cursor-pointer btn-danger-negative"
              onClick={deleteWithConfirm}
            >
              <Translation i18nkey="Delete plan">delete</Translation>
            </span>
          </div>
        </div>
      )}
      <div className="card-img-top card-link card-skin" data-holder-rendered="true">
        <span>{plan.customName || formatPlanType(plan, translate)}</span>
      </div>
      <div className="card-body plan-body d-flex flex-column">
        <p className="card-text text-justify">
          <span>{plan.customDescription}</span>
        </p>
        <div className="d-flex flex-column mb-2">
          <span className="plan-quotas">
            {!plan.maxPerSecond && !plan.maxPerMonth && translate('plan.limits.unlimited')}
            {!!plan.maxPerSecond && !!plan.maxPerMonth && (
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
      </div>
    </div>
  );
};

const PUBLIC: UsagePlanVisibility = 'Public';
const PRIVATE: UsagePlanVisibility = 'Private';

type Props = {
  api: IApi
  team: ITeamSimple
  tenant: ITenant
  setApi: (api: IApi) => void
  setDefaultPlan: (plan: IUsagePlan) => void
  creation: boolean
  expertMode: boolean
  injectSubMenu: (x: JSX.Element | null) => void
  openApiSelectModal?: () => void
}
type Tab = 'settings' | 'security' | 'payment' | 'subscription-process'
export const TeamApiPricings = (props: Props) => {
  const possibleMode = { list: 'LIST', creation: 'CREATION', edition: 'EDITION' };
  const [planForEdition, setPlanForEdition] = useState<IUsagePlan>();
  const [mode, setMode] = useState('LIST');
  const [creation, setCreation] = useState(false);
  const [selectedTab, setSelectedTab] = useState<Tab>('settings')

  const { translate } = useContext(I18nContext);
  const { openApiSelectModal, confirm } = useContext(ModalContext);

  const queryFullTenant = useQuery(['full-tenant'], () => Services.oneTenant(props.tenant._id))

  useEffect(() => {
    return () => {
      props.injectSubMenu(null);
    };
  }, []);

  useEffect(() => {
    if (mode !== possibleMode.list) {
      props.injectSubMenu(<div className='entry__submenu d-flex flex-column'>
        <span
          className={classNames('submenu__entry__link', { active: selectedTab === 'settings' })}
          onClick={() => setSelectedTab('settings')}>{translate('Settings')}</span>
        {mode === possibleMode.edition && paidPlans.includes(planForEdition!.type) && (
          <span className={classNames('submenu__entry__link', { active: selectedTab === 'payment' })}
            onClick={() => setSelectedTab('payment')}>{translate('Payment')}</span>
        )}
        {mode === possibleMode.edition && (
          <span className={classNames('submenu__entry__link', { active: selectedTab === 'subscription-process' })}
            onClick={() => setSelectedTab('subscription-process')}>{translate('Process')}</span>
        )}
        {mode === possibleMode.edition && (
          <span className={classNames('submenu__entry__link', { active: selectedTab === 'security' })}
            onClick={() => setSelectedTab('security')}>{translate('Security')}</span>
        )}
      </div>)
    } else {
      props.injectSubMenu(null)
    }

  }, [mode, selectedTab])

  useEffect(() => {
    if (mode === possibleMode.creation) {
      setPlanForEdition(planForEdition);
      setMode(possibleMode.edition);
    }
  }, [props.api]);


  const pathes = {
    type: type.object,
    format: format.form,
    array: true,
    schema: {
      method: {
        type: type.string,
        format: format.select,
        label: translate('http.method'),
        options: [
          '*',
          'GET',
          'HEAD',
          'POST',
          'PUT',
          'DELETE',
          'CONNECT',
          'OPTIONS',
          'TRACE',
          'PATCH',
        ],
      },
      path: {
        type: type.string,
        label: translate('http.path'),
        defaultValue: '/',
        constraints: [
          constraints.matches(/^\/([^\s]\w*)*$/, translate('constraint.match.path')),
        ],
      },
    },
    flow: ['method', 'path'],
  };

  const freeWithQuotasFlow = [
    {
      label: translate('Quotas'),
      collapsed: false,
      flow: ['maxPerSecond', 'maxPerDay', 'maxPerMonth'],
    },
  ];

  const quotasWithLimitsFlow = [
    {
      label: translate('Third-party Payment'),
      collapsed: false,
      flow: ['paymentSettings'],
    },
    {
      label: translate('Billing'),
      collapsed: false,
      flow: ['trialPeriod', 'billingDuration', 'costPerMonth', 'currency'],
    },
  ];

  const quotasWithoutLimitsFlow = [
    {
      label: translate('Third-party Payment'),
      collapsed: false,
      flow: ['paymentSettings'],
    },
    {
      label: translate('Billing'),
      collapsed: false,
      flow: [
        'trialPeriod',
        'billingDuration',
        'costPerMonth',
        'costPerAdditionalRequest',
        'currency',
      ],
    },
  ];

  const payPerUseFlow = [
    {
      label: translate('Third-party Payment'),
      collapsed: false,
      flow: ['paymentSettings'],
    },
    {
      label: translate('Billing'),
      collapsed: false,
      flow: [
        'trialPeriod',
        'billingDuration',
        'costPerMonth',
        'costPerRequest',
        'currency',
      ],
    },
  ];

  const getRightBillingFlow = (plan: IUsagePlan) => {
    if (!plan) {
      return [];
    }
    switch (plan.type) {
      case 'FreeWithQuotas':
        return freeWithQuotasFlow;
      case 'QuotasWithLimits':
        return quotasWithLimitsFlow;
      case 'QuotasWithoutLimits':
        return quotasWithoutLimitsFlow;
      case 'PayPerUse':
        return payPerUseFlow;
      default:
        return [];
    }
  };



  const deletePlan = (plan: IUsagePlan) => {
    Services.deletePlan(props.team._id, props.api._id, props.api.currentVersion, plan)
  };

  const createNewPlan = () => {
    Services.fetchNewPlan('FreeWithQuotas')
      .then(newPlan => {
        setPlanForEdition(newPlan);
        setMode(possibleMode.creation);
        setSelectedTab('settings')
        setCreation(true);
      })
  };
  const editPlan = (plan: IUsagePlan) => {
    setCreation(false);
    setPlanForEdition(plan);
    setMode(possibleMode.edition);
  };

  const makePlanDefault = (plan: IUsagePlan) => {
    props.setDefaultPlan(plan);
  };

  const toggleVisibility = (plan: IUsagePlan) => {
    if (props.api.defaultUsagePlan !== plan._id) {
      const originalVisibility = plan.visibility;
      const visibility = originalVisibility === PUBLIC ? PRIVATE : PUBLIC;
      const updatedPlan = { ...plan, visibility };
      savePlan(updatedPlan);
    }
  };

  const savePlan = (plan: IUsagePlan) => {
    const service = creation ? Services.createPlan : Services.updatePlan
    return service(props.team._id, props.api._id, props.api.currentVersion, plan)
      .then(response => {
        if (isError(response)) {
          toastr.error(translate('Error'), translate(response.error))
        } else {
          toastr.success(translate('Success'), creation ? translate('plan.creation.successful') : translate('plan.update.successful'))
          setPlanForEdition(response.possibleUsagePlans.find(p => p._id === plan._id))
          props.setApi(response)
          setCreation(false)
        }
      })
  };

  const setupPayment = (plan: IUsagePlan) => {
    //FIXME: beware of update --> display a message to explain what user is doing !!
    console.debug({planForEdition})
    return Services.setupPayment(props.team._id, props.api._id, props.api.currentVersion, plan)
      .then(response => {
        if (isError(response)) {
          toastr.error(translate('Error'), translate(response.error))
        } else {
          toastr.success(translate('Success'), translate('plan.payment.setup.successful'))
          setPlanForEdition(response.possibleUsagePlans.find(p => p._id === plan._id))
          props.setApi(response)
        }
      })
  }

  const clonePlanAndEdit = (plan: IUsagePlan) => {
    const clone: IUsagePlan = {
      ...cloneDeep(plan),
      _id: nanoid(32),
      customName: `${plan.customName} (copy)`,
      paymentSettings: undefined
    };
    setPlanForEdition(clone);
    setMode(possibleMode.creation);
    setCreation(true);
  };

  const importPlan = () => {
    openApiSelectModal({
      api: props.api,
      teamId: props.team._id,
      onClose: (plan) => {
        const clone = {
          ...cloneDeep(plan),
          _id: nanoid(32),
          customName: `${plan.customName} (import)`,
        };
        setPlanForEdition(clone);
        setMode(possibleMode.creation);
        setCreation(true);
      },
    });
  };

  const cancelEdition = () => {
    setPlanForEdition(undefined);
    setMode(possibleMode.list);
    props.injectSubMenu(null);
    setCreation(false);
  };

  const planTypes = [
    'FreeWithoutQuotas',
    'FreeWithQuotas',
    'QuotasWithLimits',
    'QuotasWithoutLimits',
    'PayPerUse',
  ];

  const paidPlans = [
    'QuotasWithLimits',
    'QuotasWithoutLimits',
    'PayPerUse',
  ];

  const steps: Array<IMultistepsformStep<IUsagePlan>> = [
    {
      id: 'info',
      label: 'Informations',
      schema: {
        type: {
          type: type.string,
          format: format.select,
          label: translate('Type'),
          onAfterChange: ({ rawValues, setValue, value, reset }: any) => {

            Services.fetchNewPlan(value)
              .then((newPlan => {
                const isDescIsDefault = Object.values(SUBSCRIPTION_PLAN_TYPES)
                  .map(({ defaultDescription }) => defaultDescription)
                  .some((d) => !rawValues.customDescription || d === rawValues.customDescription);
                let customDescription = rawValues.customDescription;
                if (isDescIsDefault) {
                  const planType = SUBSCRIPTION_PLAN_TYPES[value]
                  customDescription = planType.defaultDescription;
                }

                reset({ ...newPlan, ...rawValues, type: value, customDescription })
              }))

          },
          options: planTypes,
          transformer: (value: any) => ({
            label: translate(value),
            value
          }),
          constraints: [
            constraints.required(translate('constraints.required.type')),
            constraints.oneOf(planTypes, translate('constraints.oneof.plan.type')),
          ],
        },
        customName: {
          type: type.string,
          label: translate('Name'),
          placeholder: translate('Plan name'),
        },
        customDescription: {
          type: type.string,
          format: format.text,
          label: translate('Description'),
          placeholder: translate('Plan description'),
        },
      },
      flow: ['type', 'customName', 'customDescription'],
    },
    {
      id: 'oto',
      label: translate('Otoroshi Settings'),
      schema: {
        otoroshiTarget: {
          type: type.object,
          format: format.form,
          label: translate('Otoroshi target'),
          schema: {
            otoroshiSettings: {
              type: type.string,
              format: format.select,
              disabled: !creation && !!planForEdition?.otoroshiTarget?.otoroshiSettings,
              label: translate('Otoroshi instances'),
              optionsFrom: Services.allSimpleOtoroshis(props.tenant._id),
              transformer: (s: IOtoroshiSettings) => ({
                label: s.url,
                value: s._id
              }),
            },
            authorizedEntities: {
              type: type.object,
              visible: ({ rawValues }) => !!rawValues.otoroshiTarget.otoroshiSettings,
              deps: ['otoroshiTarget.otoroshiSettings'],
              render: (props) => OtoroshiEntitiesSelector({ ...props, translate }),
              label: translate('Authorized entities'),
              placeholder: translate('Authorized.entities.placeholder'),
              help: translate('authorized.entities.help'),
            },
          },
        }
      },
      flow: ['otoroshiTarget', 'subscriptionProcess'],
    },
    {
      id: 'customization',
      label: translate('Otoroshi Customization'),
      schema: {
        otoroshiTarget: {
          type: type.object,
          format: format.form,
          label: null,
          schema: {
            otoroshiSettings: {
              type: type.string,
              visible: false,
            },
            authorizedEntities: {
              type: type.object,
              visible: false,
            },
            apikeyCustomization: {
              type: type.object,
              format: format.form,
              label: null,
              schema: {
                clientIdOnly: {
                  type: type.bool,
                  label: ({ rawValues }) => {
                    if (rawValues.aggregationApiKeysSecurity) {
                      return `${translate('Read only apikey')} (${translate('disabled.due.to.aggregation.security')})`;
                    }
                    else {
                      return translate('Apikey with clientId only');
                    }
                  },
                  disabled: ({ rawValues }) => !!rawValues.aggregationApiKeysSecurity,
                  onChange: ({ setValue, value }) => {
                    if (value) {
                      setValue('aggregationApiKeysSecurity', false);
                    }
                  },
                },
                readOnly: {
                  type: type.bool,
                  label: ({ rawValues }) => {
                    if (rawValues.aggregationApiKeysSecurity) {
                      return `${translate('Read only apikey')} (${translate('disabled.due.to.aggregation.security')})`;
                    }
                    else {
                      return translate('Read only apikey');
                    }
                  },
                  disabled: ({ rawValues }) => !!rawValues.aggregationApiKeysSecurity,
                  onChange: ({ setValue, value }) => {
                    if (value) {
                      setValue('aggregationApiKeysSecurity', false);
                    }
                  },
                },
                constrainedServicesOnly: {
                  type: type.bool,
                  label: translate('Constrained services only'),
                },
                metadata: {
                  type: type.object,
                  label: translate('Automatic API key metadata'),
                  help: translate('automatic.metadata.help'),
                },
                customMetadata: {
                  type: type.object,
                  array: true,
                  label: translate('Custom Apikey metadata'),
                  defaultValue: [],
                  render: (props) => <CustomMetadataInput {...props} translate={translate} />,
                  help: translate('custom.metadata.help'),
                },
                tags: {
                  type: type.string,
                  array: true,
                  label: translate('Apikey tags'),
                  constraints: [
                    constraints.required(translate('constraints.required.value'))
                  ]
                },
                restrictions: {
                  type: type.object,
                  format: format.form,
                  schema: {
                    enabled: {
                      type: type.bool,
                      label: translate('Enable restrictions'),
                    },
                    allowLast: {
                      type: type.bool,
                      visible: ({ rawValues }) => !!rawValues.otoroshiTarget.apikeyCustomization.restrictions.enabled,
                      deps: ['otoroshiTarget.apikeyCustomization.restrictions.enabled'],
                      label: translate('Allow at last'),
                      help: translate('allow.least.help'),
                    },
                    allowed: {
                      label: translate('Allowed pathes'),
                      visible: ({ rawValues }) => rawValues.otoroshiTarget.apikeyCustomization.restrictions.enabled,
                      deps: ['otoroshiTarget.apikeyCustomization.restrictions.enabled'],
                      ...pathes,
                    },
                    forbidden: {
                      label: translate('Forbidden pathes'),
                      visible: ({ rawValues }) => rawValues.otoroshiTarget.apikeyCustomization.restrictions.enabled,
                      deps: ['otoroshiTarget.apikeyCustomization.restrictions.enabled'],
                      ...pathes,
                    },
                    notFound: {
                      label: translate('Not found pathes'),
                      visible: ({ rawValues }) => rawValues.otoroshiTarget.apikeyCustomization.restrictions.enabled,
                      deps: ['otoroshiTarget.apikeyCustomization.restrictions.enabled'],
                      ...pathes,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      id: 'quotas',
      label: translate('Quotas'),
      disabled: (plan) => plan.type === 'FreeWithoutQuotas' || plan.type === 'PayPerUse',
      schema: {
        maxPerSecond: {
          type: type.number,
          label: translate('Max. per second'),
          placeholder: translate('Max. requests per second'),
          props: {
            step: 1,
            min: 0,
          },
          constraints: [
            constraints.positive('constraints.positive'),
            constraints.integer('constraints.integer'),
          ],
        },
        maxPerDay: {
          type: type.number,
          label: translate('Max. per day'),
          placeholder: translate('Max. requests per day'),
          props: {
            step: 1,
            min: 0,
          },
          constraints: [
            constraints.positive('constraints.positive'),
            constraints.integer('constraints.integer'),
          ],
        },
        maxPerMonth: {
          type: type.number,
          label: translate('Max. per month'),
          placeholder: translate('Max. requests per month'),
          props: {
            step: 1,
            min: 0,
          },
          constraints: [
            constraints.positive('constraints.positive'),
            constraints.integer('constraints.integer'),
          ],
        },
      },
    },
  ];

  const billingSchema = {
    paymentSettings: {
      type: type.object,
      format: format.form,
      label: translate('payment settings'),
      schema: {
        thirdPartyPaymentSettingsId: {
          type: type.string,
          format: format.select,
          label: translate('Type'),
          help: 'If no type is selected, use daikokuy APIs to get billing informations',
          options: queryFullTenant.data ? (queryFullTenant.data as ITenantFull).thirdPartyPaymentSettings : [],
          transformer: (s: IThirdPartyPaymentSettings) => ({ label: s.name, value: s._id }),
          props: { isClearable: true },
          onChange: ({ rawValues, setValue, value }) => {
            const settings = queryFullTenant.data ? (queryFullTenant.data as ITenantFull).thirdPartyPaymentSettings : []
            setValue('paymentSettings.type', settings.find(s => value === s._id)?.type);
          }
        }
      }
    },
    costPerMonth: {
      type: type.number,
      label: ({ rawValues }) => translate(`Cost per ${rawValues?.billingDuration?.unit.toLocaleLowerCase()}`),
      placeholder: translate('Cost per billing period'),
      constraints: [constraints.positive('constraints.positive')],
    },
    costPerAdditionalRequest: {
      type: type.number,
      label: translate('Cost per add. req.'),
      placeholder: translate('Cost per additionnal request'),
      constraints: [constraints.positive('constraints.positive')],
    },
    costPerRequest: {
      type: type.number,
      label: translate('Cost per req.'),
      placeholder: translate('Cost per request'),
      constraints: [constraints.positive('constraints.positive')],
    },
    currency: {
      type: type.object,
      format: format.form,
      label: null,
      schema: {
        code: {
          type: type.string,
          format: format.select,
          label: translate('Currency'),
          defaultValue: 'EUR',
          options: currencies.map((c) => ({
            label: `${c.name} (${c.symbol})`,
            value: c.code,
          })),
        },
      },
    },
    billingDuration: {
      type: type.object,
      format: format.form,
      label: translate('Billing every'),
      schema: {
        value: {
          type: type.number,
          label: translate('Billing period'),
          placeholder: translate('The Billing period'),
          props: {
            step: 1,
            min: 0,
          },
          constraints: [
            constraints.positive('constraints.positive'),
            constraints.integer('constraints.integer'),
            constraints.required('constraints.required.billing.period'),
          ],
        },
        unit: {
          type: type.string,
          format: format.buttonsSelect,
          label: translate('Billing period unit'),
          options: [
            { label: translate('Hours'), value: 'Hour' },
            { label: translate('Days'), value: 'Day' },
            { label: translate('Months'), value: 'Month' },
            { label: translate('Years'), value: 'Year' },
          ],
          constraints: [
            constraints.required('constraints.required.billing.period'),
            constraints.oneOf(['Hour', 'Day', 'Month', 'Year'], translate('constraints.oneof.period')),
          ],
        },
      },
    },
    trialPeriod: {
      type: type.object,
      format: format.form,
      label: translate('Trial'),
      schema: {
        value: {
          type: type.number,
          label: translate('Trial period'),
          placeholder: translate('The trial period'),
          defaultValue: 0,
          props: {
            step: 1,
            min: 0,
          },
          constraints: [
            constraints.integer(translate('constraints.integer')),
            constraints.test('positive', translate('constraints.positive'), (v) => v >= 0),
          ],
        },
        unit: {
          type: type.string,
          format: format.buttonsSelect,
          label: translate('Trial period unit'),
          defaultValue: 'Month',
          options: [
            { label: translate('Hours'), value: 'Hour' },
            { label: translate('Days'), value: 'Day' },
            { label: translate('Months'), value: 'Month' },
            { label: translate('Years'), value: 'Year' },
          ],
          constraints: [
            constraints.oneOf(['Hour', 'Day', 'Month', 'Year'], translate('constraints.oneof.period')),
            // constraints.when('trialPeriod.value', (value) => value > 0, [constraints.oneOf(['Hour', 'Day', 'Month', 'Year'], translate('constraints.oneof.period'))]) //FIXME
          ],
        },
      },
    },
  }

  const securitySchema: Schema = {
    otoroshiTarget: {
      type: type.object,
      visible: false,
    },
    autoRotation: {
      type: type.bool,
      format: format.buttonsSelect,
      label: translate('Force apikey auto-rotation'),
      props: {
        trueLabel: translate('Enabled'),
        falseLabel: translate('Disabled'),
      }
    },
    aggregationApiKeysSecurity: {
      type: type.bool,
      format: format.buttonsSelect,
      visible: !!props.tenant.aggregationApiKeysSecurity,
      label: translate('aggregation api keys security'),
      help: translate('aggregation_apikeys.security.help'),
      onChange: ({ value, setValue }: any) => {
        if (value)
          confirm({ message: translate('aggregation.api_key.security.notification') })
            .then((ok) => {
              if (ok) {
                setValue('otoroshiTarget.apikeyCustomization.readOnly', false);
                setValue('otoroshiTarget.apikeyCustomization.clientIdOnly', false);
              }
            });
      },
      props: {
        trueLabel: translate('Enabled'),
        falseLabel: translate('Disabled'),
      }
    },
    allowMultipleKeys: {
      type: type.bool,
      format: format.buttonsSelect,
      label: translate('Allow multiple apiKey demands'),
      props: {
        trueLabel: translate('Enabled'),
        falseLabel: translate('Disabled'),
      }
    },
    integrationProcess: {
      type: type.string,
      format: format.buttonsSelect,
      label: () => translate('Integration'),
      options: [
        {
          label: translate('Automatic'),
          value: 'Automatic',
        },
        { label: translate('ApiKey'), value: 'ApiKey' },
      ], //@ts-ignore //FIXME
      expert: true,
    },
  }

  return (<div className="d-flex col flex-column pricing-content">
    <div className="album">
      {planForEdition && mode !== possibleMode.list && <i onClick={cancelEdition} className="fa-regular fa-circle-left fa-lg cursor-pointer" style={{ marginTop: 0 }} />}
      <div className="container">
        <div className="d-flex mb-3">
          {!planForEdition && <button onClick={createNewPlan} type="button" className="btn btn-outline-success btn-sm me-1">
            {translate('add a new plan')}
          </button>}
          {!planForEdition && !!props.api.parent && (<button onClick={importPlan} type="button" className="btn btn-outline-primary me-1" style={{ marginTop: 0 }}>
            {translate('import a plan')}
          </button>)}
        </div>
        {planForEdition && mode !== possibleMode.list && (<div className="row">
          <div className="col-md-12">
            {selectedTab === 'settings' && <MultiStepForm<IUsagePlan>
              value={planForEdition}
              steps={steps}
              initial="info"
              creation={creation}
              save={savePlan}
              labels={{
                previous: translate('Previous'),
                skip: translate('Skip'),
                next: translate('Next'),
                save: translate('Save'),
              }} />}
            {selectedTab === 'payment' && (
              <Form
                schema={billingSchema}
                flow={getRightBillingFlow(planForEdition)}
                onSubmit={plan => setupPayment(plan)}
                value={planForEdition}
              />
            )}
            {selectedTab === 'security' && (
              <Form
                schema={securitySchema}
                onSubmit={savePlan}
                value={planForEdition}
              />
            )}
            {selectedTab === 'subscription-process' && (
              <SubscriptionProcessEditor savePlan={savePlan} value={planForEdition} team={props.team} tenant={queryFullTenant.data as ITenantFull} />
            )}
          </div>
        </div>)}
        {mode === possibleMode.list && (<div className="row">
          {props.api.possibleUsagePlans
            .sort((a, b) => (a.customName || a.type).localeCompare(b.customName || b.type))
            .map((plan) => <div key={plan._id} className="col-md-4">
              <Card
                plan={plan}
                isDefault={plan._id === props.api.defaultUsagePlan}
                makeItDefault={() => makePlanDefault(plan)}
                toggleVisibility={() => toggleVisibility(plan)}
                deletePlan={() => deletePlan(plan)}
                editPlan={() => editPlan(plan)}
                duplicatePlan={() => clonePlanAndEdit(plan)} />
            </div>)}
        </div>)}
      </div>
    </div>
  </div>);
};



type SubProcessProps = {
  savePlan: (plan: IUsagePlan) => Promise<void>,
  value: IUsagePlan,
  team: ITeamSimple,
  tenant: ITenantFull
}

type EmailOption = { option: 'all' | 'oneOf' }

const SubscriptionProcessEditor = (props: SubProcessProps) => {
  const { translate } = useContext(I18nContext);
  const { openFormModal, close } = useContext(ModalContext);

  const addStepToRightPlace = (process: Array<IValidationStep>, step: IValidationStep, index: number): Array<IValidationStep> => {
    if (step.type === 'teamAdmin') {
      return insertArrayIndex(step, process, 0)
    } else if (step.type === 'email') {
      return insertArrayIndex(step, process, index)
    } else {
      return process
    }
  }


  const editProcess = (name: string, index: number) => {
    //todo: use the index !!
    switch (name) {
      case 'email':
        return openFormModal({
          title: translate('subscription.process.add.email.step.title'),
          schema: {
            title: {
              type: type.string,
              defaultValue: "Email",
              constraints: [
                constraints.required(translate('constraints.required.value'))
              ]
            },
            emails: {
              type: type.string,
              format: format.email,
              array: true,
            },
            message: {
              type: type.string,
              format: format.text
            },
            option: {
              type: type.string,
              format: format.buttonsSelect,
              options: ["all", 'oneOf'],
              defaultValue: 'oneOf'
            }
          },
          onSubmit: (data: IValidationStepEmail & EmailOption) => {
            if (data.option === 'oneOf') {
              const step: IValidationStepEmail = { type: 'email', emails: data.emails, message: data.message, id: nanoid(32), title: data.title }
              props.savePlan({ ...props.value, subscriptionProcess: addStepToRightPlace(props.value.subscriptionProcess, { ...step, id: nanoid(32) }, index) })
            } else {
              const steps: Array<IValidationStepEmail> = data.emails.map(email => ({ type: 'email', emails: [email], message: data.message, id: nanoid(32), title: data.title }))
              const subscriptionProcess = steps.reduce((process, step) => addStepToRightPlace(process, step, index), props.value.subscriptionProcess)
              props.savePlan({ ...props.value, subscriptionProcess })

            }
          },
          actionLabel: translate('Create')
        })
      case 'teamAdmin': {
        const step: IValidationStepTeamAdmin = { type: 'teamAdmin', team: props.team._id, id: nanoid(32), title: 'Admin' }
        return props.savePlan({ ...props.value, subscriptionProcess: [step, ...props.value.subscriptionProcess] })
          .then(() => close())

      }
    }
  }

  const editMailStep = (value: IValidationStepEmail) => {
    return openFormModal({
      title: translate('subscription.process.update.email.step.title'),
      schema: {
        emails: {
          type: type.string,
          array: true,
        },
        message: {
          type: type.string,
          format: format.text
        }
      },
      onSubmit: (data: IValidationStepEmail) => {
        props.savePlan({
          ...props.value,
          subscriptionProcess: props.value.subscriptionProcess.map(p => {
            if (p.id === data.id) {
              return data
            }
            return p
          })
        })
      },
      actionLabel: translate('Update'),
      value
    })
  }

  //todo
  const addProcess = (index: number) => {
    const alreadyStepAdmin = props.value.subscriptionProcess.some(isValidationStepTeamAdmin)

    const options = addArrayIf(!alreadyStepAdmin, [
      { value: 'email', label: translate('subscription.process.email') }
    ], { value: 'teamAdmin', label: translate('subscription.process.team.admin') })

    openFormModal({
      title: translate('subscription.process.creation.title'),
      schema: {
        type: {
          type: type.string,
          format: format.buttonsSelect,
          label: translate('subscription.process.type.selection'),
          options
        }
      },
      onSubmit: (data: IValidationStep) => editProcess(data.type, index),
      actionLabel: translate('Create'),
      noClose: true
    })
  }

  const deleteStep = (deletedStepId: UniqueIdentifier) => {
    const subscriptionProcess = props.value.subscriptionProcess.filter(step => step.id !== deletedStepId)
    props.savePlan({ ...props.value, subscriptionProcess })
  }

  if (!props.value.subscriptionProcess.length) {
    return (
      <div className='d-flex flex-column align-items-center'>
        <div> {translate('api.pricings.no.step.explanation')}</div>
        <button className='btn btn-outline-secondary my-2' onClick={() => addProcess(0)}>
          {translate('api.pricings.add.first.step.btn.label')}
        </button>
      </div>
    )
  }

  return (
    <div className='d-flex flex-row align-items-center'>
      <button className='btn btn-outline-secondary sortable-list-btn' onClick={() => addProcess(0)}><Plus /></button>
      <SortableList
        items={props.value.subscriptionProcess}
        onChange={subscriptionProcess => props.savePlan({ ...props.value, subscriptionProcess })}
        className="flex-grow-1"
        renderItem={(item, idx) => {
          if (isValidationStepTeamAdmin(item) && !!Object.keys(props.value.otoroshiTarget?.apikeyCustomization.customMetadata || {}).length) {
            return (
              <FixedItem id={item.id}>
                <ValidationStep
                  index={idx + 1}
                  step={item}
                  tenant={props.tenant} />
              </FixedItem>
            )
          } else if (isValidationStepPayment(item)) {
            return (
              <FixedItem id={item.id}>
                <ValidationStep
                  index={idx + 1}
                  step={item}
                  tenant={props.tenant} />
              </FixedItem>
            )
          } else {
            return (
              <>
                <SortableItem
                  className="validation-step-container"
                  action={
                    <div className={classNames('d-flex flex-row', {
                      'justify-content-between': isValidationStepEmail(item),
                      'justify-content-end': !isValidationStepEmail(item),
                    })}>
                      {isValidationStepEmail(item) ? <button className='btn btn-sm btn-outline-primary' onClick={() => editMailStep(item)}><Settings size={15} /></button> : <></>}
                      <button className='btn btn-sm btn-outline-danger' onClick={() => deleteStep(item.id)}><Trash size={15} /></button>
                    </div>}
                  id={item.id}>
                  <ValidationStep
                    index={idx + 1}
                    step={item}
                    tenant={props.tenant} />
                </SortableItem>
                <button className='btn btn-outline-secondary sortable-list-btn' onClick={() => addProcess(idx + 1)}><Plus /></button>
              </>
            )
          }
        }}
      />
    </div>
  )
}

type ValidationStepProps = {
  step: IValidationStep,
  tenant: ITenantFull,
  update?: () => void,
  index: number
}

const ValidationStep = (props: ValidationStepProps) => {
  const step = props.step
  if (isValidationStepPayment(step)) {
    const thirdPartyPaymentSettings = props.tenant.thirdPartyPaymentSettings.find(setting => setting._id == step.thirdPartyPaymentSettingsId)
    return (
      <div className='d-flex flex-column validation-step'>
        <span className='validation-step__index'>{String(props.index).padStart(2, '0')}</span>
        <span className='validation-step__name'>{step.title}</span>
        <span className='validation-step__type'><CreditCard /></span>
        <div className="d-flex flex-row validation-step__infos">
          <span>{thirdPartyPaymentSettings?.name}</span>
          <span>{thirdPartyPaymentSettings?.type}</span>
        </div>
      </div>
    )
  } else if (isValidationStepEmail(step)) {
    return (
      <div className='d-flex flex-column validation-step'>
        <span className='validation-step__index'>{String(props.index).padStart(2, '0')}</span>
        <span className='validation-step__name'>{step.title}</span>
        <span className='validation-step__type'><AtSign /></span>
        <div className="d-flex flex-row validation-step__infos">
          <span>{step.emails[0]}</span>
          {step.emails.length > 1 && <span>{` + ${step.emails.length - 1}`}</span>}
        </div>
      </div>
    )
  } else if (isValidationStepTeamAdmin(step)) {
    return (
      <div className='d-flex flex-column validation-step'>
        <span className='validation-step__index'>{String(props.index).padStart(2, '0')}</span>
        <span className='validation-step__name'>{step.title}</span>
        <span className='validation-step__type'><User /></span>
      </div>
    )
  } else {
    return <></>
  }
}
