import React, { useState, useEffect } from 'react';
import hljs from 'highlight.js';
import { connect } from 'react-redux';
import { toastr } from 'react-redux-toastr';
import { Link } from 'react-router-dom';

import * as Services from '../../../services';
import {
  ApiCartidge,
  ApiConsole,
  ApiDocumentation,
  ApiPricing,
  ApiSwagger,
  ApiRedoc,
  ApiPost,
  ApiIssue,
} from '.';
import { converter } from '../../../services/showdown';
import { Can, manage, api as API, Option } from '../../utils';
import { formatPlanType } from '../../utils/formatters';
import { setError, openContactModal, updateUser } from '../../../core';

import 'highlight.js/styles/monokai.css';
import { Translation, t } from '../../../locales';
import StarsButton from './StarsButton';
import Select from 'react-select';
window.hljs = hljs;

const ApiDescription = ({ api }) => {
  useEffect(() => {
    window.$('pre code').each((i, block) => {
      hljs.highlightBlock(block);
    });
  }, []);

  return (
    <div className="d-flex col flex-column p-3 section">
      <div
        className="api-description"
        dangerouslySetInnerHTML={{ __html: converter.makeHtml(api.description) }}
      />
    </div>
  );
};

const ApiHeader = ({
  api,
  ownerTeam,
  editUrl,
  history,
  connectedUser,
  toggleStar,
  currentLanguage,
  params,
  tab
}) => {
  const handleBtnEditClick = () => history.push(editUrl);

  const [versions, setApiVersions] = useState([]);

  useEffect(() => {
    //fo custom header component
    var els = document.querySelectorAll('.btn-edit');

    if (els.length) {
      els.forEach((el) => el.addEventListener('click', handleBtnEditClick, false));
      return () => {
        els.forEach((el) => el.removeEventListener('click', handleBtnEditClick, false));
      };
    }

    Services.getAllApiVersions(ownerTeam._id, params.apiId)
      .then(versions => setApiVersions(versions.map(v => ({ label: v, value: v }))))
  }, []);

  const EditButton = () => (
    <Can I={manage} a={API} team={ownerTeam}>
      <Link to={editUrl} className="team__settings ml-2">
        <button type="button" className="btn btn-sm btn-access-negative">
          <i className="fas fa-edit" />
        </button>
      </Link>
    </Can>
  );

  if (api.header) {
    const apiHeader = api.header
      .replace('{{title}}', api.name)
      .replace('{{description}}', api.smallDescription);

    return (
      <section className="api__header col-12 mb-4">
        <div
          className="api-description"
          dangerouslySetInnerHTML={{ __html: converter.makeHtml(apiHeader) }}
        />
      </section>
    );
  } else {
    return (
      <section className="api__header col-12 mb-4 p-3">
        <div className="container">
          <h1 className="jumbotron-heading" style={{ position: 'relative' }}>
            {api.name}
            <EditButton />
            <div style={{ position: 'absolute', right: 0, bottom: 0 }} className="d-flex align-items-center">
              {versions.length > 1 && <div style={{ minWidth: '125px', fontSize: 'initial' }}>
                <Select
                  name="versions-selector"
                  value={{ label: params.versionId, value: params.versionId }}
                  options={versions}
                  onChange={e => history.push(`/${params.teamId}/${params.apiId}/${e.value}/${tab}`)}
                  classNamePrefix="reactSelect"
                  className="mr-2"
                  menuPlacement="auto"
                  menuPosition="fixed"
                />
              </div>}
              <StarsButton
                stars={api.stars}
                starred={connectedUser.starredApis.includes(api._id)}
                toggleStar={toggleStar}
                currentLanguage={currentLanguage}
              />
            </div>
          </h1>
          <p className="lead">{api.smallDescription}</p>
        </div>
      </section>
    );
  }
};

const ApiHomeComponent = ({
  tab,
  openContactModal,
  match,
  history,
  setError,
  currentLanguage,
  connectedUser,
  updateUser,
  tenant,
}) => {
  const [api, setApi] = useState(undefined);
  const [subscriptions, setSubscriptions] = useState([]);
  const [pendingSubscriptions, setPendingSubscriptions] = useState([]);
  const [ownerTeam, setOwnerTeam] = useState(undefined);
  const [myTeams, setMyTeams] = useState([]);

  useEffect(() => {
    updateSubscriptions(match.params.apiId);
  }, [match.params.apiId, match.params.versionId]);

  useEffect(() => {
    if (api) {
      Services.team(api.team).then((ownerTeam) => setOwnerTeam(ownerTeam));
    }
  }, [api, match.params.versionId]);

  const updateSubscriptions = (apiId) => {
    Promise.all([
      Services.getVisibleApi(apiId, match.params.versionId),
      Services.getMySubscriptions(apiId, match.params.versionId),
      Services.myTeams(),
    ]).then(([api, { subscriptions, requests }, teams]) => {
      if (api.error) {
        setError({ error: { status: 404, message: api.error } });
      } else {
        setApi(api);
        setSubscriptions(subscriptions);
        setPendingSubscriptions(requests);
        setMyTeams(teams);
      }
    });
  };

  const askForApikeys = (teams, plan, apiKey) => {
    const planName = formatPlanType(plan, currentLanguage);

    return (apiKey ? Services.extendApiKey(api._id, apiKey._id, teams, plan._id) : Services.askForApiKey(api._id, teams, plan._id))
      .then((results) => {
        if (results.error) {
          return toastr.error(t('Error', currentLanguage), results.error);
        }
        return results.forEach((result) => {
          const team = myTeams.find((t) => t._id === result.subscription.team);

          if (result.error) {
            return toastr.error(t('Error', currentLanguage), result.error);
          } else if (result.creation === 'done') {
            return toastr.success(
              t('Done', currentLanguage),
              t(
                'subscription.plan.accepted',
                currentLanguage,
                false,
                `API key for ${planName} plan and the team ${team.name} is available`,
                planName,
                team.name
              )
            );
          } else if (result.creation === 'waiting') {
            return toastr.info(
              t('Pending request', currentLanguage),
              t(
                'subscription.plan.waiting',
                currentLanguage,
                false,
                `The API key request for ${planName} plan and the team ${team.name} is pending acceptance`,
                planName,
                team.name
              )
            );
          }
        });
      })
      .then(() => updateSubscriptions(api._id));
  };

  const editUrl = (api) => {
    return Option(myTeams.find((team) => api.team === team._id)).fold(
      () => '#',
      (adminTeam) => `/${adminTeam._humanReadableId}/settings/apis/${api._humanReadableId}/${api.currentVersion}/infos`
    );
  };

  const toggleStar = () => {
    Services.toggleStar(api._id).then((res) => {
      if (res.status === 204) {
        const alreadyStarred = connectedUser.starredApis.includes(api._id);
        api.stars += alreadyStarred ? -1 : 1;
        setApi(api);

        updateUser({
          ...connectedUser,
          starredApis: alreadyStarred
            ? connectedUser.starredApis.filter((id) => id !== api._id)
            : [...connectedUser.starredApis, api._id],
        });
      }
    });
  };

  if (!api || !ownerTeam) {
    return null;
  }
  const apiId = api._humanReadableId;
  const versionId = match.params.versionId;
  const teamId = match.params.teamId;

  //for contact modal
  const { isGuest, name, email } = connectedUser;
  const userName = isGuest ? undefined : name;
  const userEmail = isGuest ? undefined : email;

  document.title = `${tenant.name} - ${api ? api.name : 'API'}`;

  return (
    <main role="main" className="row">
      <ApiHeader
        api={api}
        ownerTeam={ownerTeam}
        editUrl={editUrl(api)}
        history={history}
        connectedUser={connectedUser}
        toggleStar={toggleStar}
        currentLanguage={currentLanguage}
        params={match.params}
        tab={tab}
      />
      <div className="container">
        <div className="row">
          <div className="col mt-3 onglets">
            <ul className="nav nav-tabs flex-column flex-sm-row">
              <li className="nav-item">
                <Link
                  className={`nav-link ${tab === 'description' ? 'active' : ''}`}
                  to={`/${match.params.teamId}/${apiId}/${versionId}`}>
                  <Translation i18nkey="Description" language={currentLanguage}>
                    Description
                  </Translation>
                </Link>
              </li>
              <li className="nav-item">
                <Link
                  className={`nav-link ${tab === 'pricing' ? 'active' : ''}`}
                  to={`/${match.params.teamId}/${apiId}/${versionId}/pricing`}>
                  <Translation i18nkey="Plan" language={currentLanguage} isPlural={true}>
                    Plans
                  </Translation>
                </Link>
              </li>
              <li className="nav-item">
                <Link
                  className={`nav-link ${tab === 'documentation' || tab === 'documentation-page' ? 'active' : ''
                    }`}
                  to={`/${match.params.teamId}/${apiId}/${versionId}/documentation`}>
                  <Translation i18nkey="Documentation" language={currentLanguage}>
                    Documentation
                  </Translation>
                </Link>
              </li>
              <li className="nav-item">
                <Link
                  className={`nav-link ${tab === 'redoc' ? 'active' : ''}`}
                  to={`/${match.params.teamId}/${apiId}/${versionId}/redoc`}>
                  <Translation i18nkey="Api Reference" language={currentLanguage}>
                    Api Reference
                  </Translation>
                </Link>
              </li>
              <li className="nav-item">
                <Link
                  className={`nav-link ${tab === 'swagger' ? 'active' : ''}`}
                  to={`/${match.params.teamId}/${apiId}/${versionId}/swagger`}>
                  <Translation i18nkey="Try it !" language={currentLanguage}>
                    Try it !
                  </Translation>
                </Link>
              </li>
              {!!api.posts.length && (
                <li className="nav-item">
                  <Link
                    className={`nav-link ${tab === 'news' ? 'active' : ''}`}
                    to={`/${match.params.teamId}/${apiId}/${versionId}/news`}>
                    <Translation i18nkey="News" language={currentLanguage}>
                      News
                    </Translation>
                  </Link>
                </li>
              )}
              <li className="nav-item">
                <Link
                  className={`nav-link ${tab === 'issues' ? 'active' : ''}`}
                  to={`/${match.params.teamId}/${apiId}/${versionId}/issues`}>
                  <Translation i18nkey="issues" language={currentLanguage}>
                    Issues
                  </Translation>
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>
      <div className="album py-2 col-12 min-vh-100">
        <div className="container">
          <div className="row pt-3">
            {['pricing', 'description'].includes(tab) && (
              <ApiCartidge
                connectedUser={connectedUser}
                myTeams={myTeams}
                ownerTeam={ownerTeam}
                api={api}
                subscriptions={subscriptions}
                askForApikeys={(teams, plan) => askForApikeys(teams, plan)}
                currentLanguage={currentLanguage}
                tenant={tenant}
                openContactModal={() =>
                  openContactModal(userName, userEmail, tenant._id, api.team, api._id)
                }
                redirectToApiKeysPage={(team) => {
                  history.push(
                    `/${team._humanReadableId}/settings/apikeys/${api._humanReadableId}/${api.currentVersion}`
                  );
                }}
              />
            )}
            {tab === 'description' && (
              <ApiDescription api={api} ownerTeam={ownerTeam} subscriptions={subscriptions} />
            )}
            {tab === 'pricing' && (
              <ApiPricing
                connectedUser={connectedUser}
                api={api}
                myTeams={myTeams}
                ownerTeam={ownerTeam}
                subscriptions={subscriptions}
                askForApikeys={askForApikeys}
                pendingSubscriptions={pendingSubscriptions}
                updateSubscriptions={updateSubscriptions}
                currentLanguage={currentLanguage}
                tenant={tenant}
              />
            )}
            {tab === 'documentation' && (
              <ApiDocumentation
                api={api}
                ownerTeam={ownerTeam}
                match={match}
                currentLanguage={currentLanguage}
              />
            )}
            {tab === 'documentation-page' && (
              <ApiDocumentation
                api={api}
                ownerTeam={ownerTeam}
                match={match}
                currentLanguage={currentLanguage}
              />
            )}
            {tab === 'swagger' && (
              <ApiSwagger
                api={api}
                teamId={teamId}
                ownerTeam={ownerTeam}
                match={match}
                testing={api.testing}
                tenant={tenant}
                connectedUser={connectedUser}
                currentLanguage={currentLanguage}
              />
            )}
            {tab === 'redoc' && (
              <ApiRedoc
                api={api}
                teamId={teamId}
                ownerTeam={ownerTeam}
                match={match}
                tenant={tenant}
                connectedUser={connectedUser}
                currentLanguage={currentLanguage}
              />
            )}
            {tab === 'console' && (
              <ApiConsole
                api={api}
                teamId={teamId}
                ownerTeam={ownerTeam}
                match={match}
                subscriptions={subscriptions}
                updateSubscriptions={updateSubscriptions}
              />
            )}
            {tab === 'news' && (
              <ApiPost
                api={api}
                ownerTeam={ownerTeam}
                match={match}
                versionId={match.params.versionId}
                currentLanguage={currentLanguage}
              />
            )}
            {tab === 'issues' && (
              <ApiIssue
                api={api}
                onChange={(editedApi) => setApi(editedApi)}
                history={history}
                ownerTeam={ownerTeam}
                connectedUser={connectedUser}
                match={match}
                currentLanguage={currentLanguage}
              />
            )}
          </div>
        </div>
      </div>
    </main>
  );
};

const mapStateToProps = (state) => ({
  ...state.context,
});

const mapDispatchToProps = {
  setError,
  openContactModal,
  updateUser,
};

export const ApiHome = connect(mapStateToProps, mapDispatchToProps)(ApiHomeComponent);
