import React from 'react';
import ReactDOM from 'react-dom';

import jQuery from 'jquery';
import { Provider } from 'react-redux';

import { store } from './core/store'

import { I18nProvider } from './contexts/i18n-context';

import 'bootstrap/dist/css/bootstrap.css';
import './style/main.scss';

import 'bootstrap';

import { DaikokuHomeApp } from './apps/DaikokuHomeApp';

(window as any).$ = jQuery;
(window as any).jQuery = jQuery;

export function initNotLogged(tenant: any) {
  const storeInst = store({ tenant });

  ReactDOM.render(
    <Provider store={storeInst}>
      <I18nProvider tenant={tenant}>
        <DaikokuHomeApp tenant={tenant} />
      </I18nProvider>
    </Provider>,
    document.getElementById('app')
  );
}
