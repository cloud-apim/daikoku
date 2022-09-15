import React, { useContext } from 'react';
import { constraints, Form, format, Schema, type } from '@maif/react-forms';
import { useQuery } from '@tanstack/react-query';

import * as Services from '../../../../services';
import { I18nContext } from '../../../../core';
import { ITenant } from '../../../../types';
import { MultiStepForm, Spinner } from '../../../utils';

export const MailForm = (props: { tenant: ITenant }) => {
  const { translateMethod } = useContext(I18nContext)
  const { isLoading, data } = useQuery(['tenant'], () => Services.oneTenant(props.tenant._id))


  const basicMailSchema = {
    fromTitle: {
      type: type.string,
      label: translateMethod('Email title'),
    },
    fromEmail: {
      type: type.string,
      label: translateMethod('Email from'),
      constraints: [
        constraints.email(translateMethod('constraints.matches.email'))
      ]
    },
  }

  const steps = [{
    id: 'type',
    label: 'Authentication type',
    schema: {
      type: {
        type: type.string,
        format: format.buttonsSelect,
        label: translateMethod('Mailer type'),
        options: [
          { label: 'Console', value: 'console' },
          { label: 'SMTP Client', value: 'smtpClient' },
          { label: 'Mailgun', value: 'mailgun' },
          { label: 'Mailjet', value: 'mailjet' },
          { label: 'Sendgrid', value: 'sendgrid' },
        ],
        constraints: [
          constraints.required()
        ]
      }
    },
  }, {
    id: 'rest',
    label: 'params',
    flow: (data) => {
      switch (data.type) {
        case 'console':
          return ['fromTitle', 'fromEmail'];
        case 'smtpClient':
          return ['host', 'port', 'fromTitle', 'fromEmail']
        case 'mailgun':
          return ['domain', 'eu', 'key', 'fromTitle', 'fromEmail']
        case 'mailjet':
          return ['apiKeyPublic', 'apiKeyPrivate', 'fromTitle', 'fromEmail']
        case 'sendgrid':
          return ['apiKey', 'fromTitle', 'fromEmail']
      }
    },
    schema: (data) => {
      switch (data.type) {
        case 'console':
          return basicMailSchema;
        case 'smtpClient':
          return {
            host: {
              type: type.string,
              label: translateMethod('smtp_client.host'),
            },
            port: {
              type: type.number,
              label: translateMethod('smtp_client.port'),
            },
            ...basicMailSchema,
          };
        case 'mailgun':
          return {
            domain: {
              type: type.string,
              label: translateMethod('Mailgun domain'),
            },
            eu: {
              type: type.bool,
              label: translateMethod('European server'),
            },
            key: {
              type: type.string,
              label: translateMethod('Mailgun key'),
            },
            ...basicMailSchema
          }
        case 'mailjet':
          return {
            apiKeyPublic: {
              type: type.string,
              label: translateMethod('Mailjet apikey public'),
            },
            apiKeyPrivate: {
              type: type.string,
              label: translateMethod('Mailjet apikey private'),
            },
            ...basicMailSchema
          }
        case 'sendgrid':
          return {
            apiKey: {
              type: type.string,
              label: translateMethod('send_grid.api_key'),
            },
            ...basicMailSchema
          }
      }
    }
  }]
  const save = (d) => Promise.resolve(console.debug(d)) //todo: real save


  if (isLoading) {
    return (
      <Spinner />
    )
  }

  return (
    <MultiStepForm value={data?.mailerSettings} steps={steps} initial="type" creation={false} save={save} labels={{
      previous: translateMethod('Previous'),
      skip: translateMethod('Skip'),
      next: translateMethod('Next'),
      save: translateMethod('Save'),
    }} />
  )
}