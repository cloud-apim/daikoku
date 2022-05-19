import React, { useContext, useState } from 'react';
import { Form, type, constraints, format } from '@maif/react-forms';

import * as Services from '../../../../services';
import { I18nContext } from '../../../../locales/i18n-context';
import { NavContext } from '../../../../contexts';

export const GuestPanel = () => {
  const { translateMethod, Translation } = useContext(I18nContext);
  const { loginAction, loginProvider } = useContext(NavContext);

  const [loginError, setLoginError] = useState(false);

  const schema = {
    username: {
      type: type.string,
      label: translateMethod('Email address'),
      placeholder: translateMethod('Email address'),
      format: format.email,
      constraints: [
        constraints.required(translateMethod('constraints.required.email')),
        constraints.email(translateMethod('constraints.matches.email')),
      ],
    },
    password: {
      type: type.string,
      label: translateMethod('Password'),
      format: format.password,
      constraints: [constraints.required(translateMethod('constraints.required.password'))],
    },
  };

  const submit = (data) => {
    setLoginError(false);

    const { username, password } = data;

    Services.login(username, password, loginAction).then((res) => {
      if (res.status === 400) {
        setLoginError(true);
      } else if (res.redirected) {
        window.location.href = res.url;
      }
    });
  };

  return (
    <div className="ms-3 mt-2 col-8 d-flex flex-column panel">
      <div className="mb-3" style={{ height: '40px' }}></div>
      <div className="blocks">
        <div className="mb-3 block">
          {loginProvider === 'Local' && (
            <div className="ms-2 block__entries d-flex flex-column">
              {loginError && (
                <span className="badge bg-danger">
                  {translateMethod('incorrect.email.or.password')}
                </span>
              )}
              <Form
                schema={schema}
                onSubmit={submit}
                footer={({ valid }) => {
                  return (
                    <div className="d-flex justify-content-end mt-3">
                      <button
                        type="submit"
                        className="btn btn-outline-success ms-2"
                        onClick={valid}
                      >
                        <span>{translateMethod('Login')}</span>
                      </button>
                    </div>
                  );
                }}
              />
              <div className="d-flex flex-row mt-3">
                {loginProvider == 'Local' && (
                  <a className="text-center" href="/signup">
                    {' '}Create an account.
                  </a>
                )}
                <a className="text-center" href="/reset">
                  <Translation i18nkey="Forgot your password ?">Forgot your password ?</Translation>
                </a>
              </div>
            </div>
          )}
          {loginProvider !== 'Local' && (
            <div className="ms-2 block__entries d-flex flex-column">
              <a href={`/auth/${loginProvider}/login`} className="block__entry__link">
                {translateMethod('Login')}
              </a>
              <a
                href={`${loginProvider === 'Local' ? '/signup' : `/auth/${loginProvider}/login`}`}
                className="block__entry__link"
              >
                {translateMethod('Register')}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
