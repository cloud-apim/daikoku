import { useQuery } from '@tanstack/react-query';
import {useContext} from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate} from 'react-router-dom';


import { I18nContext, updateTeam } from '../../../core';
import * as Services from '../../../services';
import { converter } from '../../../services/showdown';
import { IApiWithAuthorization, isError, IState, ITenant, IUserSimple } from '../../../types';
import { ApiList } from './ApiList';
import { api as API, CanIDoAction, manage, Spinner } from '../../utils';

export const MyHome = () => {


  const dispatch = useDispatch();
  const connectedUser = useSelector<IState, IUserSimple>(s => s.context.connectedUser)
  const tenant = useSelector<IState, ITenant>(s => s.context.tenant)
  const apiCreationPermitted = useSelector<IState, boolean>(s => s.context.apiCreationPermitted)

  const myTeamsRequest = useQuery(['myTeams'], () => Services.myTeams())

  const navigate = useNavigate();

  const { translate } = useContext(I18nContext);




  const redirectToApiPage = (apiWithAutho: IApiWithAuthorization) => {
    const api = apiWithAutho.api
    const route = (version: string) => api.apis
      ? `/${api.team._humanReadableId}/apigroups/${api._humanReadableId}/apis`
      : `/${api.team._humanReadableId}/${api._humanReadableId}/${version}/description`;

    if (api.isDefault) {
      navigate(route(api.currentVersion));
    } else {
      Services.getDefaultApiVersion(api._humanReadableId)
        .then((res) =>
          navigate(route(res.defaultVersion))
        );
    }
  };

  const redirectToEditPage = (apiWithAutho: IApiWithAuthorization) => {
    const api = apiWithAutho.api

    if (api.team && CanIDoAction(connectedUser, manage, API, api.team, apiCreationPermitted)) {
      Promise.resolve(dispatch(updateTeam(api.team)))
        .then(() => {
          const url = api.apis
            ? `/${api.team._humanReadableId}/settings/apigroups/${api._humanReadableId}/infos`
            : `/${api.team._humanReadableId}/settings/apis/${api._humanReadableId}/${api.currentVersion}/infos`;
          navigate(url);
        });
    }
  };

  if (myTeamsRequest.isLoading ) {
    return (
      <Spinner />
    )
  } else if (myTeamsRequest.data && !isError(myTeamsRequest.data)) {
    return (
      <main role="main">
        <section className="organisation__header col-12 mb-4 p-3">
          <div className="container">
            <div className="row text-center">
              <div className="col-sm-4">
                <img
                  className="organisation__avatar"
                  src={tenant.logo ? tenant.logo : '/assets/images/daikoku.svg'}
                  alt="avatar"
                />
              </div>
              <div className="col-sm-7 d-flex flex-column justify-content-center">
                <h1 className="jumbotron-heading">
                  {tenant.title ? tenant.title : translate('Your APIs center')}
                </h1>
                <Description description={tenant.description} />
              </div>
            </div>
          </div>
        </section>
        <ApiList
          myTeams={myTeamsRequest.data}
          teamVisible={true}
          redirectToApiPage={redirectToApiPage}
          redirectToEditPage={redirectToEditPage}
        />
      </main>
    );
  } else {
    //FIXME: better display of error
    return (
      <div>Error while fetching teams</div>
    )
  }

}

const Description = (props: any) => {
  const { Translation } = useContext(I18nContext);

  if (!props.description) {
    return (
      <p className="lead">
        <Translation i18nkey="Daikoku description start">Daikoku is the perfect</Translation>
        <a href="https: //www.otoroshi.io">Otoroshi</a>
        <Translation i18nkey="Daikoku description end">
          companion to manage, document, and expose your beloved APIs to your developpers community.
          Publish a new API in a few seconds
        </Translation>
      </p>
    );
  }

  return (
    <div dangerouslySetInnerHTML={{ __html: converter.makeHtml(props.description || '') }}></div>
  );
};
