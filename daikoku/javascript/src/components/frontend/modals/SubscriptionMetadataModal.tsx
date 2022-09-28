import React, { useState, useEffect, useContext, useRef } from 'react';
import { Form, type, format, constraints, FormRef } from '@maif/react-forms';
import Creatable from 'react-select/creatable';
import { toastr } from 'react-redux-toastr';
import sortBy from 'lodash/sortBy';

import { Spinner, formatPlanType, Option } from '../../utils';
import * as Services from '../../../services';
import { I18nContext } from '../../../core';

type Props = {
  closeModal: (...args: any[]) => any;
  save: (...args: any[]) => any;
  config: any,
  subscription: any,
  plan: any,
  api: any,
  creationMode: any,
  team: any,
  description: any
};

type FormData = {
  metadata: { [key: string]: string },
  customMetadata: { [key: string]: string },
  customQuotas: {
    customMaxPerSecond: number,
    customMaxPerDay: number,
    customMaxPerMonth: number,
  },
  customReadOnly: boolean
}

//FIXME: test if works like before react-forms usage ;)
export const SubscriptionMetadataModal = (props: Props) => {
  const [loading, setLoading] = useState(true);
  const [api, setApi] = useState<any>(undefined);
  const [plan, setPlan] = useState<any>(undefined);
  const [isValid, setIsValid] = useState(false);
  const [value, setValue] = useState<FormData>();

  const { translateMethod, Translation } = useContext(I18nContext);

  const formRef = useRef<FormRef>()

  useEffect(() => {
    if (api) {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (api) {
      setPlan(api.possibleUsagePlans.find((pp: any) => pp._id === props.plan));
    }
  }, [api]);

  useEffect(() => {
    if (plan || props.config) {
      const maybeSubMetadata = Option(props.subscription)
        .orElse(props.config)
        .map((s: any) => s.customMetadata)
        .map((v: any) => Object.entries(v))
        .getOrElse([]);

      const [maybeMetadata, maybeCustomMetadata] = maybeSubMetadata.reduce(
        ([accMeta, accCustomMeta]: any, item: any) => {
          if (
            plan &&
            plan.otoroshiTarget.apikeyCustomization.customMetadata.some((x: any) => x.key === item[0])
          ) {
            return [[...accMeta, item], accCustomMeta];
          }
          return [accMeta, [...accCustomMeta, item]];
        },
        [[], []]
      );

      setValue({
        metadata: Object.fromEntries(maybeMetadata),
        customMetadata: Object.fromEntries(maybeCustomMetadata),
        customQuotas: {
          customMaxPerSecond: Option(props.subscription)
            .orElse(props.config)
            .map((s: any) => s.customMaxPerSecond)
            .getOrNull(),
          customMaxPerDay: Option(props.subscription)
            .orElse(props.config)
            .map((s: any) => s.customMaxPerDay)
            .getOrNull(),
          customMaxPerMonth: Option(props.subscription)
            .orElse(props.config)
            .map((s: any) => s.customMaxPerMonth)
            .getOrNull(),
        },
        customReadOnly: Option(props.subscription)
          .orElse(props.config)
          .map((s: any) => s.customReadOnly)
          .getOrNull()
      })
    }
  }, [plan]);

  useEffect(() => {
    if (!!props.api && typeof props.api === 'object') {
      setApi(props.api);
    } else {
      Services.getVisibleApiWithId(props.api).then((api) => {
        if (api.error) {
          toastr.error(translateMethod('Error'), api.error);
          props.closeModal();
        }
        else {
          setApi(api);
        }
        setLoading(false);
      });
    }
  }, []);

  const actionAndClose = (formData) => {
    const subProps = {
      customMetadata: {
        ...formData.customMetadata,
        ...formData.metadata,
      },
      customMaxPerSecond: formData.customQuotas.customMaxPerSecond,
      customMaxPerDay: formData.customMaxPerDay,
      customMaxPerMonth: formData.customMaxPerMonth,
      customReadOnly: formData.customReadOnly,
    };
    if (isValid) {
      if (props.save instanceof Promise) {
        props.save(subProps)
          .then(() => props.closeModal());
      } else {
        props.closeModal();
        props.save(subProps);
      }
    }
  };

  const schema = {
    metadata: {
      type: type.object,
      format: format.form,
      visible: !!plan,
      label: translateMethod('mandatory.metadata.label', false, `Mandatory metadata (${plan.otoroshiTarget.apikeyCustomization.customMetadata.length})`, plan.otoroshiTarget.apikeyCustomization.customMetadata.length),
      schema: sortBy(plan.otoroshiTarget.apikeyCustomization.customMetadata, ['key'])
        .map((meta: { key: string, possibleValues: Array<string> }) => {
          return {
            key: meta.key,
            schemaEntry: {
              type: type.string,
              format: format.select,
              createOption: true,
              options: meta.possibleValues,
              constraints: [
                constraints.required(translateMethod('constraints.required.value'))
              ]
            }
          }
        })
        .reduce((acc, curr) => {
          return { ...acc, [curr.key]: curr.schemaEntry }
        }, {}),
    },
    customMedata: {
      type: type.object,
      label: translateMethod('Additional metadata'),
    },
    customQuotas: {
      type: type.object,
      format: format.form,
      label: translateMethod('Custom quotas'),
      schema: {
        customMaxPerSecond: {
          type: type.number,
          label: translateMethod('Max. requests per second'),
          constraints: [
            constraints.min(0, translateMethod('constraints.min.0')) //todo: translate
          ]
        },
        customMaxPerDay: {
          type: type.number,
          label: translateMethod('Max. requests per day'),
          constraints: [
            constraints.min(0, translateMethod('constraints.min.0')) //todo: translate
          ]
        },
        customMaxPerMonth: {
          type: type.number,
          label: translateMethod('Max. requests per month'),
          constraints: [
            constraints.min(0, translateMethod('constraints.min.0')) //todo: translate
          ]
        },
      }
    },
    customReadOnly: {
      type: type.bool,
      label: translateMethod('Read only apikey')
    }
  }

  return (<div className="modal-content">
    <div className="modal-header">
      {!api && (<h5 className="modal-title">
        <Translation i18nkey="Subscription metadata">Subscription metadata</Translation>
      </h5>)}
      {api && (<h5 className="modal-title">
        <Translation i18nkey="Subscription metadata title" replacements={[api.name]}>
          Subscription metadata - {api.name}
        </Translation>
      </h5>)}
      <button type="button" className="btn-close" aria-label="Close" onClick={props.closeModal} />
    </div>
    <div className="modal-body">
      {loading && <Spinner />}
      {!loading && (
        <>
          {!props.description && props.creationMode && (<div className="modal-description">
            <Translation i18nkey="subscription.metadata.modal.creation.description" replacements={[
              props.team.name,
              plan.customName || formatPlanType(plan, translateMethod),
            ]}>
              {props.team.name} ask you an apikey for plan{' '}
              {plan.customName || formatPlanType(plan, translateMethod)}
            </Translation>
          </div>)}
          {!props.description && !props.creationMode && (<div className="modal-description">
            <Translation i18nkey="subscription.metadata.modal.update.description" replacements={[
              props.team.name,
              plan.customName || formatPlanType(plan, translateMethod),
            ]}>
              Team: {props.team.name} - Plan:{' '}
              {plan.customName || formatPlanType(plan, translateMethod)}
            </Translation>
          </div>)}
          {props.description && <div className="modal-description">{props.description}</div>}

          <Form
            schema={schema}
            onSubmit={actionAndClose}
            ref={formRef}
            value={value}
            footer={() => <></>}
          />
        </>
      )}

      <div className="modal-footer">
        <button type="button" className="btn btn-outline-danger" onClick={() => props.closeModal()}>
          <Translation i18nkey="Cancel">Cancel</Translation>
        </button>
        <button
          type="button"
          className="btn btn-outline-success"
          disabled={isValid ? undefined : true}
          onClick={() => formRef.current?.handleSubmit()}>
          {props.creationMode ? translateMethod('Accept') : translateMethod('Update')}
        </button>
      </div>
    </div>
  </div>);
};
