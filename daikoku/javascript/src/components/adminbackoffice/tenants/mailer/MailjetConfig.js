import React, { useContext } from 'react';
import { I18nContext } from '../../../../core';
import { MailTemplateButton } from './MailTemplateButton';
const LazyForm = React.lazy(() => import('../../../inputs/Form'));

export function MailjetConfig({ currentLanguage, value, onChange }) {
  const { translateMethod } = useContext(I18nContext);

  const formFlow = ['apiKeyPublic', 'apiKeyPrivate', 'fromTitle', 'fromEmail', 'template'];

  const formSchema = {
    apiKeyPublic: {
      type: 'string',
      props: {
        label: translateMethod('Mailjet apikey public'),
      },
    },
    apiKeyPrivate: {
      type: 'string',
      props: {
        label: translateMethod('Mailjet apikey private'),
      },
    },
    fromTitle: {
      type: 'string',
      props: {
        label: translateMethod('Email title'),
      },
    },
    fromEmail: {
      type: 'string',
      props: {
        label: translateMethod('Email from'),
      },
    },
    template: {
      type: () => <MailTemplateButton />,
    },
  };

  return (
    <React.Suspense>
      <LazyForm
        currentLanguage={currentLanguage}
        value={value}
        onChange={onChange}
        flow={formFlow}
        schema={formSchema}
        style={{ marginTop: 50 }}
      />
    </React.Suspense>
  );
}
