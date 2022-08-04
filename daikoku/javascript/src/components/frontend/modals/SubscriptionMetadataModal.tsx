import React, { useState, useEffect, useContext } from 'react';
import Creatable from 'react-select/creatable';
import { toastr } from 'react-redux-toastr';
import sortBy from 'lodash/sortBy';

import { Spinner, formatPlanType, Option } from '../../utils';
import * as Services from '../../../services';
import { ObjectInput, Collapse, BooleanInput, NumberInput } from '../../inputs';
import { I18nContext } from '../../../core';

type Props = {
    closeModal: (...args: any[]) => any;
    save: (...args: any[]) => any;
};

export const SubscriptionMetadataModal = (props: Props) => {
  const [loading, setLoading] = useState(true);
  const [api, setApi] = useState(undefined);
  const [plan, setPlan] = useState(undefined);
  const [metadata, setMetadata] = useState({});
  const [customMetadata, setCustomMetadata] = useState({});
  const [customMaxPerSecond, setCustomMaxPerSecond] = useState(undefined);
  const [customMaxPerDay, setCustomMaxPerDay] = useState(undefined);
  const [customMaxPerMonth, setCustomMaxPerMonth] = useState(undefined);
  const [customReadOnly, setCustomReadOnly] = useState(undefined);
  const [isValid, setIsValid] = useState(false);
  const [loadingInput, setLoadingInput] = useState(false);

    const { translateMethod, Translation } = useContext(I18nContext);

  useEffect(() => {
    if (api) {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (api) {
      setPlan((api as any).possibleUsagePlans.find((pp: any) => pp._id === (props as any).plan));
    }
  }, [api]);

  useEffect(() => {
    if (plan || (props as any).config) {
      const maybeSubMetadata = Option((props as any).subscription)
    .orElse((props as any).config)
    .map((s: any) => s.customMetadata)
    .map((v: any) => Object.entries(v))
    .getOrElse([]);

      const [maybeMetadata, maybeCustomMetadata] = maybeSubMetadata.reduce(
                ([accMeta, accCustomMeta], item: any) => {
          if (
            plan &&
    (plan as any).otoroshiTarget.apikeyCustomization.customMetadata.some((x: any) => x.key === item[0])
          ) {
            return [[...accMeta, item], accCustomMeta];
          }
          return [accMeta, [...accCustomMeta, item]];
        },
        [[], []]
      );

      setMetadata({ ...Object.fromEntries(maybeMetadata), ...metadata });
      setCustomMetadata({ ...Object.fromEntries(maybeCustomMetadata), ...customMetadata });
      setCustomMaxPerSecond(Option((props as any).subscription)
    .orElse((props as any).config)
    .map((s: any) => s.customMaxPerSecond)
    .getOrNull());
      setCustomMaxPerDay(Option((props as any).subscription)
    .orElse((props as any).config)
    .map((s: any) => s.customMaxPerDay)
    .getOrNull());
      setCustomMaxPerMonth(Option((props as any).subscription)
    .orElse((props as any).config)
    .map((s: any) => s.customMaxPerMonth)
    .getOrNull());
      setCustomReadOnly(Option((props as any).subscription)
    .orElse((props as any).config)
    .map((s: any) => s.customReadOnly)
    .getOrNull());
    }
  }, [plan]);

  const validate = () => Object.entries({ ...customMetadata, ...metadata }).every(([_, value]) => !!value) &&
    (!plan ||
        (plan as any).otoroshiTarget.apikeyCustomization.customMetadata.length ===
            Object.keys(metadata).length);

  useEffect(() => {
    setIsValid(validate());
  }, [metadata, customMetadata]);

  useEffect(() => {
    if (!!(props as any).api && typeof (props as any).api === 'object') {
      setApi((props as any).api);
    } else {
      Services.getVisibleApiWithId((props as any).api).then((api) => {
    if (api.error) {
        toastr.error(api.error);
        props.closeModal();
    }
    else {
        setApi(api);
    }
    setLoading(false);
});
    }
  }, []);

  const actionAndClose = (action: any) => {
    const subProps = {
      customMetadata: {
        ...customMetadata,
        ...metadata,
      },
      customMaxPerSecond,
      customMaxPerDay,
      customMaxPerMonth,
      customReadOnly,
    };
    if (isValid) {
      if (action instanceof Promise) {
                action(subProps).then(() => props.closeModal());
      } else {
        props.closeModal();
        action(subProps);
      }
    }
  };

  const renderInput = (key: any, possibleValues: any) => {
    const createOption = (newValue: any) => {
      setLoadingInput(true);
            Services.saveTeamApi(api.team, {
        ...api,
    possibleUsagePlans: [
                ...api.possibleUsagePlans.filter((p: any) => p._id !== (props as any).plan),
        {
                        ...plan,
            otoroshiTarget: {
                                ...plan.otoroshiTarget,
                apikeyCustomization: {
                                        ...plan.otoroshiTarget.apikeyCustomization,
                    customMetadata: [
                                                ...plan.otoroshiTarget.apikeyCustomization.customMetadata.filter((m: any) => m.key !== key),
                        { key, possibleValues: [...possibleValues, newValue] },
                    ],
                },
            },
        },
    ],
}, api.currentVersion).then((api) => {
    setMetadata({ ...metadata, [key]: newValue });
    setLoadingInput(false);
    setApi(api);
});
    };

    if (!possibleValues || possibleValues.length == 0) {
      return (
                <input
          className="form-control flex-grow-1"
                    value={metadata[key] || ''}
          onChange={(e) => setMetadata({ ...metadata, [key]: e.target.value })}
          required
        />
      );
    } else {
      return (
                <Creatable
          className="reactSelect flex-grow-1"
          isClearable={true}
          isDisabled={loadingInput}
          isLoading={loadingInput}
                    onChange={(e) => setMetadata({ ...metadata, [key]: e.value })}
          onCreateOption={(v) => createOption(v)}
          options={possibleValues.sort().map((v: any) => ({
            label: v,
            value: v
          }))}
                    value={{ label: metadata[key], value: metadata[key] }}
          formatCreateLabel={(value) =>
            translateMethod('create.metadata.option.label', false, `Create option ${value}`, value)
          }
          classNamePrefix="reactSelect"
        />
      );
    }
  };

    return (<div className="modal-content">
            <div className="modal-header">
                {!api && (<h5 className="modal-title">
                        <Translation i18nkey="Subscription metadata">Subscription metadata</Translation>
          </h5>)}
                {api && (<h5 className="modal-title">
                        <Translation i18nkey="Subscription metadata title" replacements={[(api as any).name]}>
              Subscription metadata - {(api as any).name}
            </Translation>
          </h5>)}
                <button type="button" className="btn-close" aria-label="Close" onClick={props.closeModal}/>
      </div>
            <div className="modal-body">
                {loading && <Spinner />}
                {!loading && (<>
                        {!(props as any).description && (props as any).creationMode && (<div className="modal-description">
                                <Translation i18nkey="subscription.metadata.modal.creation.description" replacements={[
                (props as any).team.name,
                                plan.customName || formatPlanType(plan, translateMethod),
            ]}>
                  {(props as any).team.name} ask you an apikey for plan{' '}
                                    {plan.customName || formatPlanType(plan, translateMethod)}
                </Translation>
              </div>)}
                        {!(props as any).description && !(props as any).creationMode && (<div className="modal-description">
                                <Translation i18nkey="subscription.metadata.modal.update.description" replacements={[
                (props as any).team.name,
                                plan.customName || formatPlanType(plan, translateMethod),
            ]}>
                  Team: {(props as any).team.name} - Plan:{' '}
                                    {plan.customName || formatPlanType(plan, translateMethod)}
                </Translation>
              </div>)}
                        {(props as any).description && <div className="modal-description">{(props as any).description}</div>}
                        {!!plan && (<Collapse label={translateMethod('mandatory.metadata.label', false, `Mandatory metadata (${(plan as any).otoroshiTarget.apikeyCustomization.customMetadata.length})`, (plan as any).otoroshiTarget.apikeyCustomization.customMetadata.length)} collapsed={false}>
                {sortBy((plan as any).otoroshiTarget.apikeyCustomization.customMetadata, ['key']).map(({ key, possibleValues }, idx) => {
                                return (<div className="d-flex flex-row mb-1" key={idx}>
                                                <input className="form-control me-1" value={key} disabled="disabled"/>
                        {renderInput(key, possibleValues)}
                      </div>);
            })}
              </Collapse>)}
                        <Collapse label={translateMethod('Additional metadata')} collapsed={true}>
                            <ObjectInput value={customMetadata} onChange={(values: any) => {
            setCustomMetadata({ ...values });
        }}/>
            </Collapse>
                        <Collapse label={translateMethod('Custom quotas')} collapsed={true}>
                            <NumberInput step="1" min="0" label={translateMethod('Max. requests per second')} value={customMaxPerSecond} onChange={(value: any) => setCustomMaxPerSecond(Number(value))}/>
                            <NumberInput step="1" min="0" label={translateMethod('Max. requests per day')} value={customMaxPerDay} onChange={(value: any) => setCustomMaxPerDay(Number(value))}/>
                            <NumberInput step="1" min="0" label={translateMethod('Max. requests per month')} value={customMaxPerMonth} onChange={(value: any) => setCustomMaxPerMonth(Number(value))}/>
            </Collapse>
                        <Collapse label={translateMethod('Other custom props')} collapsed={true}>
                            <BooleanInput label={translateMethod('Read only apikey')} value={customReadOnly} onChange={(readOnly: any) => setCustomReadOnly(readOnly)}/>
            </Collapse>
          </>)}

                <div className="modal-footer">
                    <button type="button" className="btn btn-outline-danger" onClick={() => props.closeModal()}>
                        <Translation i18nkey="Cancel">Cancel</Translation>
          </button>
                    <button type="button" className="btn btn-outline-success" disabled={isValid ? undefined : 'disabled'} onClick={() => actionAndClose(props.save)}>
            {(props as any).creationMode ? translateMethod('Accept') : translateMethod('Update')}
          </button>
        </div>
      </div>
    </div>);
};
