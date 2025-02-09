
import React from 'react';
import ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux';
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import SwaggerEditor, { plugins } from 'swagger-editor'; //!!! don't remove this line !!!

import jQuery from 'jquery';


import 'react-tooltip/dist/react-tooltip.css'
import 'bootstrap/dist/css/bootstrap.css';
import '@maif/react-forms/lib/index.css';
import './style/main.scss';

import 'bootstrap';

import { store } from './core';
import { LoginPage, queryClient } from './components';
import { customizeFetch } from './services/customize';
import { I18nProvider } from './contexts/i18n-context';

import { DaikokuApp, DaikokuHomeApp } from './apps';

import { ApolloClient, InMemoryCache, ApolloProvider } from '@apollo/client';

const client = new ApolloClient({
  uri: '/api/search',
  cache: new InMemoryCache(),
  defaultOptions: {
    query: {
      fetchPolicy: 'network-only',
    },
  },
});

(window as any).$ = jQuery;
(window as any).jQuery = jQuery;

export function init(
  user: any,
  tenant: any,
  impersonator: any,
  session: any,
  loginCallback: any,
  isTenantAdmin: any,
  apiCreationPermitted: any
) {
  const expertMode = JSON.parse(localStorage.getItem('expertMode') || 'false');
  const storeInst = store({
    connectedUser: user,
    tenant,
    impersonator,
    isTenantAdmin,
    apiCreationPermitted,
    expertMode,
  });

  customizeFetch(storeInst);

  const container = document.getElementById('app');
  const root = createRoot(container!)

  root.render(
    <Provider store={storeInst}>
      <ApolloProvider client={client}>
        <QueryClientProvider client={queryClient}>
          <I18nProvider tenant={tenant} user={user}>
            <DaikokuApp
              session={session}
              user={user}
              tenant={tenant}
              loginProvider={tenant.authProvider}
              loginAction={loginCallback}
            />
          </I18nProvider>
        </QueryClientProvider>
      </ApolloProvider>
    </Provider>,
    
  );
}

export function login(provider: any, callback: any, tenant: any) {
  const storeInst = store({ tenant });
  ReactDOM.render(
    <Provider store={storeInst}>
      <I18nProvider tenant={tenant}>
        <LoginPage provider={provider} action={callback} tenant={tenant} method="post" />
      </I18nProvider>
    </Provider>,
    document.getElementById('app')
  );
}

export function initNotLogged(tenant: any) {
  const storeInst = store({ tenant });

  const container = document.getElementById('app');
  const root = createRoot(container!)

  root.render(
    <Provider store={storeInst}>
      <I18nProvider tenant={tenant}>
        <DaikokuHomeApp tenant={tenant} />
      </I18nProvider>
    </Provider>
  );
}
