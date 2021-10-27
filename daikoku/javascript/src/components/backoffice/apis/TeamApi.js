import React, { useState, useEffect, useRef, useContext } from 'react';
import { Link, useHistory, useLocation, useParams } from 'react-router-dom';
import { connect } from 'react-redux';
import { toastr } from 'react-redux-toastr';

import * as Services from '../../../services';
import { TeamBackOffice } from '../..';
import { Can, manage, api as API, Spinner } from '../../utils';
import {
  TeamApiDescription,
  TeamApiDocumentation,
  TeamApiInfo,
  TeamApiOtoroshiPlaceholder,
  TeamApiPricing,
  TeamApiSwagger,
  TeamApiTesting,
  TeamApiPost,
} from '.';

import { setError, openSubMetadataModal, openTestingApiKeyModal, I18nContext } from '../../../core';

const reservedCharacters = [';', '/', '?', ':', '@', '&', '=', '+', '$', ','];

function TeamApiComponent(props) {
  const [state, setState] = useState({
    api: null,
    create: false,
    error: null,
    otoroshiSettings: [],
    changed: false,
  });

  const params = useParams();
  const teamApiDocumentationRef = useRef();

  const { translateMethod, Translation } = useContext(I18nContext);
  const location = useLocation();
  const history = useHistory();

  useEffect(() => {
    if (location && location.state && location.state.newApi) {
      Services.allSimpleOtoroshis(props.tenant._id).then((otoroshiSettings) =>
        setState({
          ...state,
          otoroshiSettings,
          api: location.state.newApi,
          create: true,
        })
      );
    } else {
      reloadState();
    }
  }, [params.tab, params.versionId]);

  useEffect(() => {
    if (state.changed) {
      setState({ ...state, changed: false });
      save();
    }
  }, [state.changed]);

  function reloadState() {
    Promise.all([
      Services.teamApi(props.currentTeam._id, params.apiId, params.versionId),
      Services.allSimpleOtoroshis(props.tenant._id),
    ]).then(([api, otoroshiSettings]) => {
      if (!api.error) setState({ ...state, api, otoroshiSettings });
      else toastr.error(api.error);
    });
  }

  function save() {
    if (params.tab === 'documentation') teamApiDocumentationRef.current.saveCurrentPage();

    const editedApi = transformPossiblePlansBack(state.api);
    if (state.create) {
      return Services.createTeamApi(props.currentTeam._id, editedApi)
        .then((api) => {
          if (api.name) {
            toastr.success(
              translateMethod('api.created.success', false, `Api "${api.name}" created`, api.name)
            );
            return api;
          } else return Promise.reject(api.error);
        })
        .then((api) => {
          setState({ ...state, create: false, api });
          props.history.push(
            `/${props.currentTeam._humanReadableId}/settings/apis/${api._humanReadableId}/${api.currentVersion}/infos`
          );
        })
        .catch((error) => toastr.error(translateMethod(error)));
    } else {
      return Services.checkIfApiNameIsUnique(editedApi.name, editedApi._id).then((r) => {
        if (!r.exists) {
          if (editedApi.currentVersion.split('').find((c) => reservedCharacters.includes(c))) {
            toastr.error(
              "Can't set version with special characters : " + reservedCharacters.join(' | ')
            );
            return Promise.resolve();
          } else
            return Services.saveTeamApiWithId(
              props.currentTeam._id,
              editedApi,
              apiVersion.value,
              editedApi._humanReadableId
            ).then((res) => {
              if (res.error) toastr.error(translateMethod(res.error));
              else {
                toastr.success(translateMethod('Api saved'));
                if (
                  res._humanReadableId !== params.apiId ||
                  res.currentVersion !== params.versionId
                )
                  history.push(
                    `/${props.currentTeam._humanReadableId}/settings/apis/${res._humanReadableId}/${res.currentVersion}/infos`
                  );
              }
            });
        } else toastr.error(`api with name "${editedApi.name}" already exists`);
      });
    }
  }

  function deleteApi() {
    window.confirm(translateMethod('delete.api.confirm')).then((ok) => {
      if (ok) {
        Services.deleteTeamApi(props.currentTeam._id, state.api._id)
          .then(() => props.history.push(`/${props.currentTeam._humanReadableId}/settings/apis`))
          .then(() => toastr.success(translateMethod('deletion successful')));
      }
    });
  }

  function transformPossiblePlansBack(api) {
    if (!api) {
      return api;
    }
    const def = {
      otoroshiTarget: {
        otoroshiSettings: null,
        authorizedEntities: { groups: [], services: [] },
        apikeyCustomization: {
          clientIdOnly: false,
          constrainedServicesOnly: false,
          tags: [],
          metadata: {},
          customMetadata: [],
          restrictions: {
            enabled: false,
            allowLast: true,
            allowed: [],
            forbidden: [],
            notFound: [],
          },
        },
      },
    };
    const possibleUsagePlans = api.possibleUsagePlans || [];
    api.possibleUsagePlans = possibleUsagePlans.map((plan) => {
      plan.otoroshiTarget = plan.otoroshiTarget || { ...def.otoroshiTarget };
      plan.otoroshiTarget.apikeyCustomization = plan.otoroshiTarget.apikeyCustomization || {
        ...def.otoroshiTarget.apikeyCustomization,
      };
      plan.otoroshiTarget.apikeyCustomization.restrictions = plan.otoroshiTarget.apikeyCustomization
        .restrictions || { ...def.otoroshiTarget.apikeyCustomization.restrictions };
      return plan;
    });
    return api;
  }

  function transformPossiblePlans(api) {
    if (!api) {
      return api;
    }
    const def = {
      otoroshiTarget: {
        otoroshiSettings: null,
        authorizedEntities: { groups: [], services: [] },
        apikeyCustomization: {
          clientIdOnly: false,
          constrainedServicesOnly: false,
          tags: [],
          metadata: {},
          customMetadata: [],
          restrictions: {
            enabled: false,
            allowLast: true,
            allowed: [],
            forbidden: [],
            notFound: [],
          },
        },
      },
    };
    const possibleUsagePlans = api.possibleUsagePlans || [];
    api.possibleUsagePlans = possibleUsagePlans.map((plan) => {
      plan.otoroshiTarget = plan.otoroshiTarget || { ...def.otoroshiTarget };
      plan.otoroshiTarget.apikeyCustomization = plan.otoroshiTarget.apikeyCustomization || {
        ...def.otoroshiTarget.apikeyCustomization,
      };
      plan.otoroshiTarget.apikeyCustomization.restrictions = plan.otoroshiTarget.apikeyCustomization
        .restrictions || { ...def.otoroshiTarget.apikeyCustomization.restrictions };
      return plan;
    });
    return api;
  }

  const teamId = props.currentTeam._id;
  const disabled = {}; //TODO: deepEqual(state.originalApi, state.api) ? { disabled: 'disabled' } : {};
  const tab = params.tab || 'infos';
  const editedApi = transformPossiblePlans(state.api);

  if (props.tenant.creationSecurity && !props.currentTeam.apisCreationPermission) {
    props.setError({ error: { status: 403, message: 'unauthorized' } });
  }

  return (
    <TeamBackOffice
      tab="Apis"
      isLoading={!editedApi}
      title={`${props.currentTeam.name} - ${state.api ? state.api.name : translateMethod('API')}`}>
      <Can I={manage} a={API} team={props.currentTeam} dispatchError>
        {!editedApi && <Spinner />}
        {editedApi && (
          <>
            <div className="row">
              <div className="section col container-api">
                <div className="mt-2">
                  {editedApi && tab === 'infos' && (
                    <TeamApiInfo
                      tenant={props.tenant}
                      team={props.currentTeam}
                      creating={
                        props.location && props.location.state && !!props.location.state.newApi
                      }
                      value={editedApi}
                      onChange={(api) => setState({ ...state, api })}
                    />
                  )}
                  {editedApi && tab === 'description' && (
                    <TeamApiDescription
                      value={editedApi}
                      team={props.currentTeam}
                      onChange={(api) => setState({ ...state, api })}
                    />
                  )}
                  {editedApi && tab === 'swagger' && (
                    <TeamApiSwagger
                      value={editedApi}
                      onChange={(api) => setState({ ...state, api })}
                    />
                  )}
                  {editedApi && tab === 'pricing' && (
                    <TeamApiPricing
                      teamId={teamId}
                      value={editedApi}
                      onChange={(api) => setState({ ...state, api })}
                      otoroshiSettings={state.otoroshiSettings}
                      {...props}
                    />
                  )}
                  {editedApi && tab === 'plans' && (
                    <TeamApiPricing
                      teamId={teamId}
                      value={editedApi}
                      onChange={(api) => setState({ ...state, api })}
                      tenant={props.tenant}
                      reload={() =>
                        Services.teamApi(
                          props.currentTeam._id,
                          params.apiId,
                          params.versionId
                        ).then((api) => setState({ ...state, api }))
                      }
                      params={params}
                    />
                  )}
                  {false && editedApi && tab === 'otoroshi' && (
                    <TeamApiOtoroshiPlaceholder
                      value={editedApi}
                      onChange={(api) => setState({ ...state, api })}
                    />
                  )}
                  {editedApi && tab === 'documentation' && (
                    <TeamApiDocumentation
                      creationInProgress={state.create}
                      team={props.currentTeam}
                      teamId={teamId}
                      value={editedApi}
                      onChange={(api) => setState({ ...state, api })}
                      save={save}
                      versionId={props.match.params.versionId}
                      params={params}
                      reloadState={reloadState}
                      ref={teamApiDocumentationRef}
                    />
                  )}
                  {editedApi && tab === 'testing' && (
                    <TeamApiTesting
                      creationInProgress={state.create}
                      team={props.currentTeam}
                      teamId={teamId}
                      value={editedApi}
                      onChange={(api) => setState({ ...state, api })}
                      onAction={(api) => setState({ ...state, api, changed: true })}
                      save={save}
                      otoroshiSettings={state.otoroshiSettings}
                      openSubMetadataModal={props.openSubMetadataModal}
                      openTestingApiKeyModal={props.openTestingApiKeyModal}
                      params={params}
                    />
                  )}
                  {editedApi && tab === 'news' && (
                    <TeamApiPost
                      value={editedApi}
                      team={props.currentTeam}
                      api={state.api}
                      onChange={(api) => setState({ ...state, api })}
                      params={params}
                    />
                  )}
                </div>
              </div>
            </div>
            {!props.location.pathname.includes('/news') && (
              <div className="row form-back-fixedBtns">
                {!state.create && (
                  <button type="button" className="btn btn-outline-danger ml-1" onClick={deleteApi}>
                    <i className="fas fa-trash mr-1" />
                    <Translation i18nkey="Delete">Delete</Translation>
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-outline-success ml-1"
                  {...disabled}
                  onClick={save}>
                  {!state.create && (
                    <span>
                      <i className="fas fa-save mr-1" />
                      <Translation i18nkey="Save">Save</Translation>
                    </span>
                  )}
                  {state.create && (
                    <span>
                      <i className="fas fa-save mr-1" />
                      <Translation i18nkey="Create">Create</Translation>
                    </span>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </Can>
    </TeamBackOffice>
  );
}

const mapStateToProps = (state) => ({
  ...state.context,
});

const mapDispatchToProps = {
  setError: (error) => setError(error),
  openSubMetadataModal: (props) => openSubMetadataModal(props),
  openTestingApiKeyModal: (props) => openTestingApiKeyModal(props),
};

export const TeamApi = connect(mapStateToProps, mapDispatchToProps)(TeamApiComponent);
