import React, { useState, useEffect, useContext } from 'react';
import { getApolloContext } from '@apollo/client';
import hljs from 'highlight.js';
import { connect } from 'react-redux';
import { toastr } from 'react-redux-toastr';
import { useParams, useNavigate, useMatch } from 'react-router-dom';
import Select from 'react-select';

import * as Services from '../../../services';
import { ApiDocumentation, ApiPricing, ApiSwagger, ApiRedoc, ApiPost, ApiIssue } from '.';
import { converter } from '../../../services/showdown';
import { Can, manage, apikey, ActionWithTeamSelector, CanIDoAction, Option } from '../../utils';
import { formatPlanType } from '../../utils/formatters';
import { setError, updateUser, I18nContext } from '../../../core';
import StarsButton from './StarsButton';
import { LoginOrRegisterModal } from '../modals';
import { useApiFrontOffice } from '../../../contexts';

import 'highlight.js/styles/monokai.css';

(window as any).hljs = hljs;

export const ApiDescription = ({
  api
}: any) => {
  useEffect(() => {
    (window as any).$('pre code').each((i: any, block: any) => {
      hljs.highlightElement(block);
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

type Version = {
  label: string,
  value: string
}

export const ApiHeader = ({
  api,
  ownerTeam,
  connectedUser,
  toggleStar,
  tab
}: any) => {
  const navigate = useNavigate();
  const params = useParams();

  const [versions, setApiVersions] = useState<Array<Version>>([]);

  useEffect(() => {
    Services.getAllApiVersions(ownerTeam._id, params.apiId)
      .then((versions) =>
        setApiVersions(versions.map((v: any) => ({
          label: v,
          value: v
        })))
      );
  }, []);

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
            <div
              style={{ position: 'absolute', right: 0, bottom: 0 }}
              className="d-flex align-items-center"
            >
              {versions.length > 1 && tab !== 'issues' && (
                <div style={{ minWidth: '125px', fontSize: 'initial' }}>
                  <Select
                    name="versions-selector"
                    value={{ label: params.versionId, value: params.versionId }}
                    options={versions}
                    onChange={(e) =>
                      navigate(`/${params.teamId}/${params.apiId}/${e?.value}/${tab}`)
                    }
                    classNamePrefix="reactSelect"
                    className="me-2"
                    menuPlacement="auto"
                    menuPosition="fixed"
                  />
                </div>
              )}
              <StarsButton
                stars={api.stars}
                starred={connectedUser.starredApis.includes(api._id)}
                toggleStar={toggleStar}
              />
            </div>
          </h1>
          <p className="lead">{api.smallDescription}</p>
        </div>
      </section>
    );
  }
};

type ApiHomeProps = {
  setError?: (error: { error: { status: number, message: string } }) => void, //FIXME: get it from useSelector hook instead inject props by redux
  connectedUser?: any, //FIXME: get it from useSelector hook instead inject props by redux
  updateUser?: (user: any) => void, //FIXME: get it from useSelector hook instead inject props by redux
  tenant?: any, //FIXME: get it from useSelector hook instead inject props by redux
  groupView: boolean
}
const ApiHomeComponent = ({
  setError,
  connectedUser,
  updateUser,
  tenant,
  groupView
}: ApiHomeProps) => {
  const [api, setApi] = useState<any>(undefined);
  const [subscriptions, setSubscriptions] = useState([]);
  const [pendingSubscriptions, setPendingSubscriptions] = useState([]);
  const [ownerTeam, setOwnerTeam] = useState(undefined);
  const [myTeams, setMyTeams] = useState<Array<any>>([]);
  const [showAccessModal, setAccessModalError] = useState<any>();
  const [showGuestModal, setGuestModal] = useState(false);

  const navigate = useNavigate();
  const defaultParams = useParams();
  const apiGroupMatch = useMatch('/:teamId/apigroups/:apiGroupId/apis/:apiId/:versionId/:tab');
  const params = Option(apiGroupMatch)
    .map((match: any) => match.params)
    .getOrElse(defaultParams);

  const { translateMethod, Translation } = useContext(I18nContext);

  const { client } = useContext(getApolloContext());

  const { addMenu } = groupView ? { addMenu: () => { } } : useApiFrontOffice(api, ownerTeam);

  useEffect(() => {
    updateSubscriptions(params.apiId);
  }, [params.apiId, params.versionId]);

  useEffect(() => {
    if (api) {
      Services.team((api as any).team)
        .then((ownerTeam) => setOwnerTeam(ownerTeam));
    }
  }, [api, params.versionId]);

  useEffect(() => {
    if (myTeams && subscriptions && !groupView) {
      const subscribingTeams = myTeams
        .filter((team) => subscriptions.some((sub) => (sub as any).team === (team as any)._id));
      const viewApiKeyLink = (
        <Can I={manage} a={apikey} teams={subscribingTeams}>
          <ActionWithTeamSelector
            title={translateMethod(
              'teamapi.select.title',
              false,
              'Select the team to view your api key'
            )}
            teams={subscribingTeams.filter((t) => CanIDoAction(connectedUser, manage, apikey, t))}
            action={(teams) => {
              const team: any = myTeams.find((t) => teams.includes((t as any)._id));
              if (!team) {
                return;
              }
              navigate(
                `/${team._humanReadableId}/settings/apikeys/${api._humanReadableId}/${api.currentVersion}`
              );
            }}
            withAllTeamSelector={false}
          >
            <span className="block__entry__link">
              <Translation i18nkey="View your api keys">View your api keys</Translation>
            </span>
          </ActionWithTeamSelector>
        </Can>
      );

      addMenu({
        blocks: {
          actions: { links: { viewApiKey: { label: 'view apikey', component: viewApiKeyLink } } },
        },
      });
    }
  }, [subscriptions, myTeams]);

  const updateSubscriptions = (apiId: any) => {
    //FIXME: handle case if appolo client is not setted
    if (!client) {
      return;
    }
    Promise.all([
      Services.getVisibleApi(apiId, params.versionId),
      Services.getMySubscriptions(apiId, params.versionId),
      client.query({
        query: Services.graphql.myTeams,
      }),
    ]).then(
      ([
        api,
        { subscriptions, requests },
        {
          data: { myTeams },
        },
      ]) => {
        if (api.error) {
          if (api.visibility && api.visibility === 'PublicWithAuthorizations') {
            Services.getMyTeamsStatusAccess(params.teamId, apiId, params.versionId).then((res) => {
              if (res.error) setGuestModal(true);
              else
                setAccessModalError({
                  error: api.error,
                  api: res,
                });
            });
          } else {
            //FIXME: remove line after using redux hook
            //@ts-ignore
            setError({ error: { status: api.status || 404, message: api.error } });
          }
        } else {
          setApi(api);
          setSubscriptions(subscriptions);
          setPendingSubscriptions(requests);
          setMyTeams(
            myTeams.map((team: any) => ({
              ...team,

              users: team.users.map((us: any) => ({
                ...us,
                ...us.user
              }))
            }))
          );
        }
      }
    );
  };

  const askForApikeys = (teams: any, plan: any, apiKey: any) => {
    const planName = formatPlanType(plan, translateMethod);

    return (
      apiKey
        ? Services.extendApiKey(api._id, apiKey._id, teams, plan._id)
        : Services.askForApiKey(api._id, teams, plan._id)
    )
      .then((results) => {
        if (results.error) {
          return toastr.error(translateMethod('Error'), results.error);
        }
        return results.forEach((result: any) => {
          if (result.error) {
            return toastr.error(translateMethod('Error'), result.error);
          } else if (result.creation === 'done') {
            const team: any = myTeams.find((t) => t._id === result.subscription.team);
            return toastr.success(
              translateMethod('Done'),
              translateMethod(
                'subscription.plan.accepted',
                false,
                `API key for ${planName} plan and the team ${team?.name} is available`,
                planName,
                team.name
              )
            );
          } else if (result.creation === 'waiting') {
            const team = myTeams.find((t) => (t as any)._id === result.subscription.team);
            return toastr.info(
              translateMethod('Pending request'),
              translateMethod(
                'subscription.plan.waiting',
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

  const toggleStar = () => {
    Services.toggleStar(api._id).then((res) => {
      if (!res.error) {
        const alreadyStarred = connectedUser.starredApis.includes(api._id);
        api.stars += alreadyStarred ? -1 : 1;
        setApi(api);

        //FIXME: remove line after use readuc hooks
        //@ts-ignore
        updateUser({
          ...connectedUser,
          starredApis: alreadyStarred
            ? connectedUser.starredApis.filter((id: any) => id !== api._id)
            : [...connectedUser.starredApis, api._id],
        });
      }
    });
  };

  if (showGuestModal)
    return (
      <div className="m-3">
        <LoginOrRegisterModal
          tenant={tenant}
          showOnlyMessage={true}
          asFlatFormat
          message={translateMethod('guest_user_not_allowed')}
        />
      </div>
    );

  if (showAccessModal) {
    const teams = showAccessModal.api.myTeams.filter((t: any) => t.type !== 'Admin');
    const pendingTeams = showAccessModal.api.authorizations
      .filter((auth: any) => auth.pending)
      .map((auth: any) => auth.team);
    const authorizedTeams = showAccessModal.api.authorizations
      .filter((auth: any) => auth.authorized)
      .map((auth: any) => auth.team);

    return (<div className="mx-auto mt-3 d-flex flex-column justify-content-center">
      <h1 style={{ margin: 0 }}>{translateMethod(showAccessModal.error)}</h1>
      {(teams.length === 1 &&
        (pendingTeams.includes(teams[0]._id) || authorizedTeams.includes(teams[0]._id))) ||
        showAccessModal.api.authorizations.every((auth: any) => auth.pending && !auth.authorized) ? (<>
          <h2 className="text-center my-3">{translateMethod('request_already_pending')}</h2>
          <button className="btn btn-outline-info mx-auto" style={{ width: 'fit-content' }} onClick={() => navigate(-1)}>
            {translateMethod('go_back')}
          </button>
        </>) : (<>
          <span className="text-center my-3">{translateMethod('request_api_access')}</span>
          <ActionWithTeamSelector title="Api access" description={translateMethod('api.access.request', false, `You will send an access request to the API "${params.apIid}". For which team do you want to send the request ?`, [params.apIid])} pendingTeams={pendingTeams} authorizedTeams={authorizedTeams} teams={teams} action={(teams) => {
            Services.askForApiAccess(teams, showAccessModal.api._id).then((_) => {
              toastr.info(translateMethod('Info'), translateMethod('ask.api.access.info', false, '', showAccessModal.api.name));
              updateSubscriptions(showAccessModal.api._id);
            });
          }}>
            <button className="btn btn-success mx-auto" style={{ width: 'fit-content' }}>
              {translateMethod('notif.api.access', null, false, [params.apiId])}
            </button>
          </ActionWithTeamSelector>
        </>)}
    </div>);
  }

  if (!api || !ownerTeam) {
    return null;
  }
  const teamId = params.teamId;

  document.title = `${tenant.title} - ${api ? (api as any).name : 'API'}`;

  return (<main role="main">
    <ApiHeader api={api} ownerTeam={ownerTeam} connectedUser={connectedUser} toggleStar={toggleStar} tab={params.tab} />
    <div className="album py-2 col-12 min-vh-100">
      <div className="container">
        <div className="row pt-3">
          {params.tab === 'description' && (<ApiDescription api={api} ownerTeam={ownerTeam} subscriptions={subscriptions} />)}
          {params.tab === 'pricing' && (<ApiPricing connectedUser={connectedUser} api={api} myTeams={myTeams} ownerTeam={ownerTeam} subscriptions={subscriptions} askForApikeys={askForApikeys} pendingSubscriptions={pendingSubscriptions} updateSubscriptions={updateSubscriptions} tenant={tenant} />)}
          {params.tab === 'documentation' && <ApiDocumentation api={api} ownerTeam={ownerTeam} />}
          {params.tab === 'testing' && (<ApiSwagger api={api} teamId={teamId} ownerTeam={ownerTeam} testing={(api as any).testing} tenant={tenant} connectedUser={connectedUser} />)}
          {params.tab === 'swagger' && (<ApiRedoc api={api} teamId={teamId} ownerTeam={ownerTeam} tenant={tenant} connectedUser={connectedUser} />)}
          {params.tab === 'news' && (<ApiPost api={api} ownerTeam={ownerTeam} versionId={params.versionId} />)}
          {(params.tab === 'issues' || params.tab === 'labels') && (<ApiIssue api={api} onChange={(editedApi: any) => setApi(editedApi)} ownerTeam={ownerTeam} connectedUser={connectedUser} />)}
        </div>
      </div>
    </div>
  </main>);
};

const mapStateToProps = (state: any) => ({
  ...state.context
});

const mapDispatchToProps = {
  setError: (e: any) => setError(e),
  updateUser: (u: any) => updateUser(u),
};

export const ApiHome = connect(mapStateToProps, mapDispatchToProps)(ApiHomeComponent);
