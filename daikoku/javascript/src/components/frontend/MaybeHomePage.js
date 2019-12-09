import React from 'react';
import { connect } from 'react-redux';
import { Redirect } from 'react-router';
import { converter } from '../../services/showdown';
import { Translation } from '../../locales';

const MaybeHomePageComponent = ({ tenant, currentLanguage }) => {
  if (!tenant.homePageVisible) {
    return <Redirect to="/apis" />;
  }
  return (
    <main role="main">
      <section className="organisation__header  mb-4 p-3 d-flex align-items-center justify-content-around">
        <div className="row d-flex justify-content-start align-items-center">
          <div
            style={{
              width: '100px',
              height: '100px',
              borderRadius: '50px',
              border: '3px solid #fff',
              boxShadow: '0px 0px 0px 3px lightgrey',
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
            }}>
            <img
              src={tenant.logo}
              style={{ width: 200, borderRadius: '50%', backgroundColor: 'white' }}
              alt="avatar"
            />
          </div>
          <h1 className="h1-rwd-reduce ml-2">{tenant.name}</h1>
        </div>

        <div>
          <a className="btn btn-access-negative my-2 ml-2" href={`/apis`}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 1024 1024"
              className="nav-icon">
              <path
                d="M917.7 148.8l-42.4-42.4c-1.6-1.6-3.6-2.3-5.7-2.3s-4.1.8-5.7 2.3l-76.1 76.1a199.27 199.27 0 0 0-112.1-34.3c-51.2 0-102.4 19.5-141.5 58.6L432.3 308.7a8.03 8.03 0 0 0 0 11.3L704 591.7c1.6 1.6 3.6 2.3 5.7 2.3 2 0 4.1-.8 5.7-2.3l101.9-101.9c68.9-69 77-175.7 24.3-253.5l76.1-76.1c3.1-3.2 3.1-8.3 0-11.4zM769.1 441.7l-59.4 59.4-186.8-186.8 59.4-59.4c24.9-24.9 58.1-38.7 93.4-38.7 35.3 0 68.4 13.7 93.4 38.7 24.9 24.9 38.7 58.1 38.7 93.4 0 35.3-13.8 68.4-38.7 93.4zm-190.2 105a8.03 8.03 0 0 0-11.3 0L501 613.3 410.7 523l66.7-66.7c3.1-3.1 3.1-8.2 0-11.3L441 408.6a8.03 8.03 0 0 0-11.3 0L363 475.3l-43-43a7.85 7.85 0 0 0-5.7-2.3c-2 0-4.1.8-5.7 2.3L206.8 534.2c-68.9 69-77 175.7-24.3 253.5l-76.1 76.1a8.03 8.03 0 0 0 0 11.3l42.4 42.4c1.6 1.6 3.6 2.3 5.7 2.3s4.1-.8 5.7-2.3l76.1-76.1c33.7 22.9 72.9 34.3 112.1 34.3 51.2 0 102.4-19.5 141.5-58.6l101.9-101.9c3.1-3.1 3.1-8.2 0-11.3l-43-43 66.7-66.7c3.1-3.1 3.1-8.2 0-11.3l-36.6-36.2zM441.7 769.1a131.32 131.32 0 0 1-93.4 38.7c-35.3 0-68.4-13.7-93.4-38.7a131.32 131.32 0 0 1-38.7-93.4c0-35.3 13.7-68.4 38.7-93.4l59.4-59.4 186.8 186.8-59.4 59.4z"
                fill="#495057"
              />
            </svg>
            <Translation i18nkey="Apis" language={currentLanguage}>
              Apis
            </Translation>
          </a>
        </div>
      </section>

      <section className="container">
        <div className="row">
          <div style={{ width: '100%' }}>
            <div
              className="tenant-home-page"
              dangerouslySetInnerHTML={{ __html: converter.makeHtml(tenant.unloggedHome || '') }}
            />
          </div>
        </div>
      </section>
    </main>
  );
};

const mapStateToProps = state => ({
  ...state.context,
});

export const MaybeHomePage = connect(mapStateToProps)(MaybeHomePageComponent);
