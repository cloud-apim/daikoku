import React, { useContext, useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { nanoid } from 'nanoid';
import { constraints, type, format } from '@maif/react-forms';
import Select, { components } from 'react-select';
import CreatableSelect from 'react-select/creatable';
import { toastr } from 'react-redux-toastr';
import cloneDeep from 'lodash/cloneDeep';

import { I18nContext, openApiSelectModal } from '../../../core';
import {
  formatCurrency,
  getCurrencySymbol,
  newPossibleUsagePlan,
  formatPlanType,
  MultiStepForm,
  Option,
} from '../../utils';
import { currencies } from '../../../services/currencies';
import * as Services from '../../../services';
import { useDispatch } from 'react-redux';
import { IApi, IUsagePlan } from '../../../types/api';
import { ITenantFull } from '../../../types/tenant';
import { ITeamSimple } from '../../../types';

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

const OtoroshiServicesAndGroupSelector = ({
  rawValues,
  onChange,
  translateMethod
}: any) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [groups, setGroups] = useState<Array<any>>([]);
  const [services, setServices] = useState<Array<any>>([]);
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
      ])
        .then(([groups, services]) => {
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
        })
        .catch(() => {
          setGroups([]);
          setServices([]);
        });
    }
    setDisabled(!otoroshiTarget || !otoroshiTarget.otoroshiSettings);
  }, [rawValues?.otoroshiTarget?.otoroshiSettings]);

  useEffect(() => {
    if (groups && services) {
      setLoading(false);
    }
  }, [services, groups]);

  useEffect(() => {
    if (!!groups && !!services && !!rawValues.otoroshiTarget.authorizedEntities) {
      setValue([
        ...rawValues.otoroshiTarget.authorizedEntities.groups.map((authGroup: any) => (groups as any).find((g: any) => g.value === authGroup)),
        ...rawValues.otoroshiTarget.authorizedEntities.services.map((authService: any) => (services as any).find((g: any) => g.value === authService)),
      ].filter((f) => f));
    }
  }, [rawValues, groups, services]);

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
          }
        },
        { groups: [], services: [] }
      );
      setValue([
        ...value.groups.map((authGroup: any) => groups.find((g: any) => g.value === authGroup)),
        ...value.services.map((authService: any) => services.find((g: any) => g.value === authService)),
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
      placeholder={translateMethod('Authorized.entities.placeholder')} //@ts-ignore //FIXME
      components={(props: any) => <components.Group {...props} />}
      options={[
        { label: 'Service groups', options: groups },
        { label: 'Services', options: services },
      ]} value={value} onChange={onValueChange} classNamePrefix="reactSelect" className="reactSelect" />
    <div className="col-12 d-flex flex-row mt-1">
      <div className="d-flex flex-column flex-grow-1">
        <strong className="font-italic">
          <Translation i18nkey="Authorized Groups">Authorized Groups</Translation>
        </strong>
        {!!value &&
          value.filter((x: any) => x.type === 'group')
            .map((g: any, idx: any) => (<span className="font-italic" key={idx}>
              {g.label}
            </span>))}
      </div>
      <div className="d-flex flex-column flex-grow-1">
        <strong className="font-italic">
          <Translation i18nkey="Authorized Services">Authorized Services</Translation>
        </strong>
        {!!value &&
          value.filter((x: any) => x.type === 'service')
            .map((g: any, idx: any) => (<span className="font-italic" key={idx}>
              {g.label}
            </span>))}
      </div>
    </div>
  </div>);
};

const CustomMetadataInput = ({
  value,
  onChange,
  setValue,
  translateMethod
}: any) => {
  const changeValue = (possibleValues: any, key: any) => {
    const oldValue = Option(value.find((x: any) => x.key === key)).getOrElse({ '': '' });
    const newValues = [...value.filter((x: any) => x.key !== key), { ...oldValue, key, possibleValues }];
    onChange(newValues);
  };

  const changeKey = (e: any, oldName: any) => {
    if (e && e.preventDefault) e.preventDefault();

    const oldValue = Option(value.find((x: any) => x.key === oldName)).getOrElse({ '': '' });
    const newValues = [
      ...value.filter((x: any) => x.key !== oldName),
      { ...oldValue, key: e.target.value },
    ];
    onChange(newValues);
  };

  const addFirst = (e: any) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!value || value.length === 0) {
      onChange([{ key: '', possibleValues: [] }]);
      setValue('subscriptionProcess', 'Manual');
      toastr.info(translateMethod('Info'), translateMethod('custom.metadata.process.change.to.manual'));
    }
  };

  const addNext = (e: any) => {
    if (e && e.preventDefault) e.preventDefault();
    const newItem = { key: '', possibleValues: [] };
    const newValues = [...value, newItem];
    onChange(newValues);
  };

  const remove = (e: any, key: any) => {
    if (e && e.preventDefault) e.preventDefault();

    onChange(value.filter((x: any) => x.key !== key));
  };

  return (
    <div>
      {!value?.length && (
        <div className="col-sm-10">
          <button type="button" className="btn btn-outline-primary" onClick={addFirst}>
            <i className="fas fa-plus" />{' '}
          </button>
        </div>
      )}
      {(value || []).map(({
        key,
        possibleValues
      }: any, idx: any) => (
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
            {idx === value.length - 1 && (
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

const Card = ({
  plan,
  isDefault,
  makeItDefault,
  toggleVisibility,
  deletePlan,
  editPlan,
  duplicatePlan,
  creation
}: any) => {
  const { translateMethod, Translation } = useContext(I18nContext);

  let pricing = translateMethod('Free');
  const req = translateMethod('req.');
  const month = translateMethod('month');
  if (plan.costPerMonth && plan.costPerAdditionalRequest) {
    pricing = `${formatCurrency(plan.costPerMonth)} ${getCurrencySymbol(
      plan.currency.code
    )}/${month} + ${formatCurrency(plan.costPerAdditionalRequest)} ${getCurrencySymbol(
      plan.currency.code
    )}/${req}`;
  } else if (plan.costPerMonth) {
    pricing = `${formatCurrency(plan.costPerMonth)} ${getCurrencySymbol(
      plan.currency.code
    )}/${month}`;
  } else if (plan.costPerRequest) {
    pricing = `${formatCurrency(plan.costPerRequest)} ${getCurrencySymbol(
      plan.currency.code
    )}/${req}`;
  }

  const deleteWithConfirm = () => {
    (window.confirm(translateMethod('delete.plan.confirm')) as any).then((ok: any) => {
      if (ok) {
        deletePlan();
      }
    });
  };

  return (
    <div className="card hoverable-card mb-4 shadow-sm" style={{ position: 'relative' }}>
      {isDefault && (
        <i
          className="fas fa-star"
          style={{
            position: 'absolute',
            fontSize: '20px',
            top: '15px',
            right: '15px',
            zIndex: '100',
          }}
        />
      )}
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
        <span>{plan.customName || formatPlanType(plan, translateMethod)}</span>
      </div>
      <div className="card-body plan-body d-flex flex-column">
        <p className="card-text text-justify">
          <span>{plan.customDescription}</span>
        </p>
        <div className="d-flex flex-column mb-2">
          <span className="plan-quotas">
            {!plan.maxPerSecond && !plan.maxPerMonth && translateMethod('plan.limits.unlimited')}
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

const PUBLIC = 'Public';
const PRIVATE = 'Private';

type Props = {
  value: IApi
  team: ITeamSimple
  tenant: ITenantFull
  save: (api: IApi) => Promise<any>
  creation: boolean
  expertMode: boolean
  injectSubMenu: (x: any) => void
  openApiSelectModal?: () => void
}
export const TeamApiPricings = (props: Props) => {
  const possibleMode = { list: 'LIST', creation: 'CREATION' };
  const [planForEdition, setPlanForEdition] = useState<IUsagePlan>();
  const [mode, setMode] = useState('LIST');
  const [creation, setCreation] = useState(false);
  const { translateMethod } = useContext(I18nContext);

  const dispatch = useDispatch();


  useEffect(() => {
    return () => {
      props.injectSubMenu(null);
    };
  }, []);

  const pathes = {
    type: type.object,
    format: format.form,
    array: true,
    schema: {
      method: {
        type: type.string,
        format: format.select,
        label: translateMethod('http.method'),
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
        label: translateMethod('http.path'),
        defaultValue: '/',
        constraints: [
          constraints.matches(/^\/([^\s]\w*)*$/, translateMethod('constraint.match.path')),
        ],
      },
    },
    flow: ['method', 'path'],
  };

  const freeWithQuotasFlow = [
    {
      label: translateMethod('Quotas'),
      collapsed: false,
      flow: ['maxPerSecond', 'maxPerDay', 'maxPerMonth'],
    },
  ];

  const quotasWithLimitsFlow = [
    {
      label: translateMethod('Quotas'),
      collapsed: false,
      flow: ['maxPerSecond', 'maxPerDay', 'maxPerMonth'],
    },
    {
      label: translateMethod('Billing'),
      collapsed: false,
      flow: ['trialPeriod', 'billingDuration', 'costPerMonth', 'currency'],
    },
  ];

  const quotasWithoutLimitsFlow = [
    {
      label: translateMethod('Quotas'),
      collapsed: false,
      flow: ['maxPerSecond', 'maxPerDay', 'maxPerMonth'],
    },
    {
      label: translateMethod('Billing'),
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
      label: translateMethod('Billing'),
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

  const getRightBillingFlow = (plan: any) => {
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

  useEffect(() => {
    if (mode === possibleMode.creation) {
      setPlanForEdition(undefined);
      setMode(possibleMode.list);
    }
  }, [props.value]);

  const deletePlan = (plan: any) => {
    let plans = cloneDeep(props.value.possibleUsagePlans).filter((p: any) => p._id !== plan._id);
    const newValue = cloneDeep(props.value);
    newValue.possibleUsagePlans = plans;
    props.save(newValue);
  };

  const createNewPlan = () => {
    const newPlan = newPossibleUsagePlan('new plan');
    setPlanForEdition(newPlan);
    setMode(possibleMode.creation);
    setCreation(true);
  };
  const editPlan = (plan: any) => {
    setPlanForEdition(plan);
    setMode(possibleMode.creation);
  };

  const makePlanDefault = (plan: any) => {
    if (props.value.defaultUsagePlan !== plan._id && plan.visibility !== PRIVATE) {
      const updatedApi = { ...props.value, defaultUsagePlan: plan._id };
      props.save(updatedApi);
    }
  };

  const toggleVisibility = (plan: any) => {
    if (props.value.defaultUsagePlan !== plan._id) {
      const originalVisibility = plan.visibility;
      const visibility = originalVisibility === PUBLIC ? PRIVATE : PUBLIC;
      const updatedPlan = { ...plan, visibility };
      savePlan(updatedPlan);
    }
  };

  const savePlan = (updatedPlan: IUsagePlan) => {
    const api = props.value;
    const updatedApi: IApi = {
      ...api,
      possibleUsagePlans: [
        ...api.possibleUsagePlans.filter((p: any) => p._id !== updatedPlan._id),
        updatedPlan,
      ],
    };
    return props.save(updatedApi);
  };

  const clonePlanAndEdit = (plan: any) => {
    const clone = {
      ...cloneDeep(plan),
      _id: nanoid(32),
      customName: `${plan.customName} (copy)`,
    };
    setPlanForEdition(clone);
    setMode(possibleMode.creation);
    setCreation(true);
  };

  const importPlan = () => {
    dispatch(openApiSelectModal({
      api: props.value,
      teamId: props.team._id,
      onClose: (plan: any) => {
        const clone = {
          ...cloneDeep(plan),
          _id: nanoid(32),
          customName: `${plan.customName} (import)`,
        };
        setPlanForEdition(clone);
        setMode(possibleMode.creation);
        setCreation(true);
      },
    }));
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
  const steps = [
    {
      id: 'info',
      label: 'Informations',
      schema: {
        type: {
          type: type.string,
          format: format.select,
          label: translateMethod('Type'),
          onChange: ({ rawValues, setValue, value }: { rawValues: any, setValue: (key: string, value: any) => void, value: string }) => {
            const isDescIsDefault = Object.values(SUBSCRIPTION_PLAN_TYPES)
              .map(({ defaultDescription }) => defaultDescription)
              .some((d) => !rawValues.customDescription || d === rawValues.customDescription);
            if (isDescIsDefault) {
              //@ts-ignore //FIXME ???
              const planType = SUBSCRIPTION_PLAN_TYPES[value]
              setValue('customDescription', planType.defaultDescription);
            }
          },
          options: planTypes,
          transformer: (value: any) => ({
            label: translateMethod(value),
            value
          }),
          constraints: [
            constraints.required(translateMethod('constraints.required.type')),
            constraints.oneOf(planTypes, translateMethod('constraints.oneof.plan.type')),
          ],
        },
        customName: {
          type: type.string,
          label: translateMethod('Name'),
          placeholder: translateMethod('Plan name'),
        },
        customDescription: {
          type: type.string,
          format: format.text,
          label: translateMethod('Description'),
          placeholder: translateMethod('Plan description'),
        },
      },
      flow: ['type', 'customName', 'customDescription'],
    },
    {
      id: 'oto',
      label: translateMethod('Otoroshi Settings'),
      schema: {
        otoroshiTarget: {
          type: type.object,
          format: format.form,
          label: translateMethod('Otoroshi target'),
          schema: {
            otoroshiSettings: {
              type: type.string,
              format: format.select,
              disabled: !creation && !!(planForEdition as any)?.otoroshiTarget?.otoroshiSettings,
              label: translateMethod('Otoroshi instances'),
              optionsFrom: Services.allSimpleOtoroshis(props.tenant._id),
              transformer: (s: any) => ({
                label: s.url,
                value: s._id
              }),
            },
            authorizedEntities: {
              type: type.object,
              visible: {
                ref: 'otoroshiTarget.otoroshiSettings',
                test: (v: any) => !!v,
              },
              render: (props: any) => OtoroshiServicesAndGroupSelector({ ...props, translateMethod }),
              label: translateMethod('Authorized entities'),
              placeholder: translateMethod('Authorized.entities.placeholder'),
              help: translateMethod('authorized.entities.help'),
            },
          },
        },
      },
      flow: ['otoroshiTarget'],
    },
    {
      id: 'customization',
      label: translateMethod('Otoroshi Customization'),
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
                  label: ({ rawValues }: any) => {
                    if (rawValues.aggregationApiKeysSecurity) {
                      return `${translateMethod('Read only apikey')} (${translateMethod('disabled.due.to.aggregation.security')})`;
                    }
                    else {
                      return translateMethod('Apikey with clientId only');
                    }
                  },
                  disabled: ({ rawValues }: any) => !!rawValues.aggregationApiKeysSecurity,
                  onChange: ({ setValue, value }: any) => {
                    if (value) {
                      setValue('aggregationApiKeysSecurity', false);
                    }
                  },
                },
                readOnly: {
                  type: type.bool,
                  label: ({ rawValues }: any) => {
                    if (rawValues.aggregationApiKeysSecurity) {
                      return `${translateMethod('Read only apikey')} (${translateMethod('disabled.due.to.aggregation.security')})`;
                    }
                    else {
                      return translateMethod('Read only apikey');
                    }
                  },
                  disabled: ({ rawValues }: any) => !!rawValues.aggregationApiKeysSecurity,
                  onChange: ({ setValue, value }: any) => {
                    if (value) {
                      setValue('aggregationApiKeysSecurity', false);
                    }
                  },
                },
                constrainedServicesOnly: {
                  type: type.bool,
                  label: translateMethod('Constrained services only'),
                },
                metadata: {
                  type: type.object,
                  label: translateMethod('Automatic API key metadata'),
                  help: translateMethod('automatic.metadata.help', false, 'Automatic metadata will be calculated on subscription acceptation'),
                },
                customMetadata: {
                  type: type.object,
                  array: true,
                  label: translateMethod('Custom Apikey metadata'),
                  render: (props: any) => CustomMetadataInput({ ...props, translateMethod }),
                  help: translateMethod('custom.metadata.help', false, 'custom metadata will have to be filled during subscription validation. Subscripption process will be switched to manual'),
                },
                tags: {
                  type: type.string,
                  array: true,
                  label: translateMethod('Apikey tags'),
                },
                restrictions: {
                  type: type.object,
                  format: format.form,
                  schema: {
                    enabled: {
                      type: type.bool,
                      label: translateMethod('Enable restrictions'),
                    },
                    allowLast: {
                      type: type.bool,
                      visible: {
                        ref: 'otoroshiTarget.apikeyCustomization.restrictions.enabled',
                        test: (v: any) => !!v,
                      },
                      label: translateMethod('Allow at last'),
                      help: translateMethod('allow.least.help', 'Allowed path will be evaluated at last'),
                    },
                    allowed: {
                      label: translateMethod('Allowed pathes'),
                      visible: {
                        ref: 'otoroshiTarget.apikeyCustomization.restrictions.enabled',
                        test: (v: any) => !!v,
                      },
                      ...pathes,
                    },
                    forbidden: {
                      label: translateMethod('Forbidden pathes'),
                      visible: {
                        ref: 'otoroshiTarget.apikeyCustomization.restrictions.enabled',
                        test: (v: any) => !!v,
                      },
                      ...pathes,
                    },
                    notFound: {
                      label: translateMethod('Not found pathes'),
                      visible: {
                        ref: 'otoroshiTarget.apikeyCustomization.restrictions.enabled',
                        test: (v: any) => !!v,
                      },
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
      id: 'quotasAndBilling',
      label: translateMethod('Quotas & Billing'),
      disabled: (plan: any) => plan.type === 'FreeWithoutQuotas',
      flow: getRightBillingFlow,
      schema: {
        maxPerSecond: {
          type: type.number,
          label: translateMethod('Max. per second'),
          placeholder: translateMethod('Max. requests per second'),
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
          label: translateMethod('Max. per day'),
          placeholder: translateMethod('Max. requests per day'),
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
          label: translateMethod('Max. per month'),
          placeholder: translateMethod('Max. requests per month'),
          props: {
            step: 1,
            min: 0,
          },
          constraints: [
            constraints.positive('constraints.positive'),
            constraints.integer('constraints.integer'),
          ],
        },
        costPerMonth: {
          type: type.number,
          label: ({ rawValues }: any) => translateMethod(`Cost per ${rawValues?.billingDuration?.unit.toLocaleLowerCase()}`),
          placeholder: translateMethod('Cost per billing period'),
          props: {
            step: 1,
            min: 0,
          },
          constraints: [constraints.positive('constraints.positive')],
        },
        costPerAdditionalRequest: {
          type: type.number,
          label: translateMethod('Cost per add. req.'),
          placeholder: translateMethod('Cost per additionnal request'),
          props: {
            step: 1,
            min: 0,
          },
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
              label: translateMethod('Currency'),
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
          label: translateMethod('Billing every'),
          schema: {
            value: {
              type: type.number,
              label: translateMethod('Billing period'),
              placeholder: translateMethod('The Billing period'),
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
              label: translateMethod('Billing period unit'),
              options: [
                { label: translateMethod('Hours'), value: 'Hour' },
                { label: translateMethod('Days'), value: 'Day' },
                { label: translateMethod('Months'), value: 'Month' },
                { label: translateMethod('Years'), value: 'Year' },
              ],
              constraints: [
                constraints.required('constraints.required.billing.period'),
                constraints.oneOf(['Hour', 'Day', 'Month', 'Year'], translateMethod('constraints.oneof.period')),
              ],
            },
          },
        },
        trialPeriod: {
          type: type.object,
          format: format.form,
          label: translateMethod('Trial'),
          schema: {
            value: {
              type: type.number,
              label: translateMethod('Trial period'),
              placeholder: translateMethod('The trial period'),
              props: {
                step: 1,
                min: 0,
              },
              constraints: [
                constraints.integer(translateMethod('constraints.integer')),
                constraints.test('positive', translateMethod('constraints.positive'), (v) => v >= 0),
              ],
            },
            unit: {
              type: type.string,
              format: format.buttonsSelect,
              label: translateMethod('Trial period unit'),
              options: [
                { label: translateMethod('Hours'), value: 'Hour' },
                { label: translateMethod('Days'), value: 'Day' },
                { label: translateMethod('Months'), value: 'Month' },
                { label: translateMethod('Years'), value: 'Year' },
              ],
              constraints: [
                constraints.oneOf(['Hour', 'Day', 'Month', 'Year'], translateMethod('constraints.oneof.period')),
                // constraints.when('trialPeriod.value', (value) => value > 0, [constraints.oneOf(['Hour', 'Day', 'Month', 'Year'], translateMethod('constraints.oneof.period'))]) //FIXME
              ],
            },
          },
        },
      },
    },
    {
      id: 'security',
      label: translateMethod('Settings'),
      schema: {
        otoroshiTarget: {
          type: type.object,
          visible: false,
        },
        autoRotation: {
          type: type.bool,
          label: translateMethod('Force apikey auto-rotation'),
        },
        aggregationApiKeysSecurity: {
          type: type.bool,
          visible: !!props.tenant.aggregationApiKeysSecurity,
          label: translateMethod('aggregation api keys security'),
          help: translateMethod('aggregation_apikeys.security.help'),
          onChange: ({ value, setValue }: any) => {
            if (value)
              window
                .confirm(translateMethod('aggregation.api_key.security.notification')) //@ts-ignore //FIXME when type & monkey patch compatibility will be ok
                .then((ok: any) => {
                  if (ok) {
                    setValue('otoroshiTarget.apikeyCustomization.readOnly', false);
                    setValue('otoroshiTarget.apikeyCustomization.clientIdOnly', false);
                  }
                });
          },
        },
        allowMutlipleApiKeys: {
          type: type.bool,
          label: translateMethod('Allow multiple apiKey demands'),
        },
        subscriptionProcess: {
          type: type.string,
          format: format.buttonsSelect,
          disabled: ({ rawValues }: any) => !!rawValues?.otoroshiTarget?.apikeyCustomization?.customMetadata?.length,
          label: ({ rawValues }: any) => translateMethod('Subscription') +
            (rawValues?.otoroshiTarget?.apikeyCustomization?.customMetadata?.length
              ? ` (${translateMethod('Subscription.manual.help')})`
              : ''),
          options: [
            {
              label: translateMethod('Automatic'),
              value: 'Automatic',
            },
            { label: translateMethod('Manual'), value: 'Manual' },
          ],
          constraints: [
            constraints.oneOf(['Automatic', 'Manual'], translateMethod('constraints.oneof.sub.process')),
          ],
        },
        integrationProcess: {
          type: type.string,
          format: format.buttonsSelect,
          label: () => translateMethod('Integration'),
          options: [
            {
              label: translateMethod('Automatic'),
              value: 'Automatic',
            },
            { label: translateMethod('ApiKey'), value: 'ApiKey' },
          ],
          expert: true,
        },
      },
      flow: [
        {
          label: translateMethod('Security'),
          flow: ['autoRotation', 'allowMutlipleApiKeys', 'aggregationApiKeysSecurity'],
          inline: true,
        },
        'subscriptionProcess',
        'integrationProcess',
      ],
    },
  ];

  return (<div className="d-flex col flex-column pricing-content">
    <div className="album">
      <div className="container">
        <div className="d-flex mb-3">
          <button onClick={createNewPlan} type="button" className="btn btn-outline-primary me-1">
            {translateMethod('add a new plan')}
          </button>
          {!!props.value.parent && (<button onClick={importPlan} type="button" className="btn btn-outline-primary me-1" style={{ marginTop: 0 }}>
            {translateMethod('import a plan')}
          </button>)}
          {planForEdition && mode === possibleMode.creation && (<div className="flex-grow-1 d-flex justify-content-end">
            <button onClick={cancelEdition} type="button" className="btn btn-outline-danger me-1" style={{ marginTop: 0 }}>
              {translateMethod('Cancel')}
            </button>
          </div>)}
        </div>
        {planForEdition && mode === possibleMode.creation && (<div className="row">
          <div className="col-md-4">
            <Card
              api={props.value}
              plan={planForEdition}
              isDefault={(planForEdition as any)._id === props.value.defaultUsagePlan}
              creation={true} />
          </div>
          <div className="col-md-8 d-flex">
            <MultiStepForm<IUsagePlan>
              value={planForEdition}
              steps={steps}
              initial="info"
              creation={creation}
              save={savePlan}
              labels={{
                previous: translateMethod('Previous'),
                skip: translateMethod('Skip'),
                next: translateMethod('Next'),
                save: translateMethod('Save'),
              }} />
          </div>
        </div>)}
        {mode === possibleMode.list && (<div className="row">
          {props.value.possibleUsagePlans.map((plan: any) => <div key={plan._id} className="col-md-4">
            <Card api={props.value} plan={plan} isDefault={plan._id === props.value.defaultUsagePlan} makeItDefault={() => makePlanDefault(plan)} toggleVisibility={() => toggleVisibility(plan)} deletePlan={() => deletePlan(plan)} editPlan={() => editPlan(plan)} duplicatePlan={() => clonePlanAndEdit(plan)} />
          </div>)}
        </div>)}
      </div>
    </div>
  </div>);
};
