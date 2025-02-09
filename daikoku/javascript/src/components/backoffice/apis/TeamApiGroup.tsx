import { Form, constraints, format, type } from '@maif/react-forms';
import { useContext, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { toastr } from 'react-redux-toastr';
import { useLocation, useMatch, useNavigate, useParams } from 'react-router-dom';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDispatch } from 'react-redux';
import {
  TeamApiConsumption,
  TeamApiPricings,
  TeamApiSettings,
  TeamApiSubscriptions,
  TeamPlanConsumption,
} from '.';
import { ModalContext, useApiGroupBackOffice } from '../../../contexts';
import { I18nContext, toggleExpertMode } from '../../../core';
import * as Services from '../../../services';
import { IApi, IState, IStateContext, ITeamSimple, IUsagePlan, isError } from '../../../types';
import { api as API, Can, Spinner, manage } from '../../utils';

type LocationState = {
  newApiGroup?: IApi
}

export const TeamApiGroup = () => {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const match = useMatch('/:teamId/settings/apigroups/:apiGroupId/stats/plan/:planId');

  const { currentTeam, expertMode, tenant } = useSelector<IState, IStateContext>(s => s.context);
  const dispatch = useDispatch();

  const state: LocationState = location.state as LocationState
  const creation = state?.newApiGroup;

  const [additionalHeader, setAdditionalHeader] = useState<string>()

  const queryClient = useQueryClient();
  const apiGroupRequest = useQuery({
    queryKey: ['apiGroup', params.apiGroupId!],
    queryFn: () => Services.teamApi(currentTeam._id, params.apiGroupId!, '1.0.0'),
    enabled: !creation
  })

  const methods = useApiGroupBackOffice(apiGroupRequest.data, !!creation);

  useEffect(() => {
    if (apiGroupRequest.isLoading) {
      document.title = translate('???');
    } else if (apiGroupRequest.data) {
      if (!isError(apiGroupRequest.data)) {
        const apiGroup = apiGroupRequest.data



        document.title = `${currentTeam.name} - ${apiGroup ? apiGroup.name : translate('API group')}`;
      }
    }
  }, [apiGroupRequest.data]);



  const save = (group: IApi) => {
    if (creation) {
      return Services.createTeamApi(currentTeam._id, group).then((createdGroup) => {
        if (createdGroup.error) {
          toastr.error(translate('Error'), translate(createdGroup.error));
          return createdGroup;
        } else if (createdGroup.name) {
          toastr.success(
            translate('Success'),
            translate({ key: 'group.created.success', replacements: [createdGroup.name] })
          );

          navigate(`/${currentTeam._humanReadableId}/settings/apigroups/${createdGroup._humanReadableId}/infos`);
        }
      });
    } else {
      return Services.saveTeamApiWithId(
        currentTeam._id,
        group,
        group.currentVersion,
        group._humanReadableId
      ).then((res) => {
        if (isError(res)) {
          toastr.error(translate('error'), translate(res.error));
          return res;
        } else {
          toastr.success(translate('Success'), translate('Group saved'));
          queryClient.invalidateQueries({ queryKey: ['apiGroup'] })

          if (res._humanReadableId !== group._humanReadableId) {
            navigate(`/${currentTeam._humanReadableId}/settings/apigrouups/${res._humanReadableId}/infos`);
          }
        }
      });
    }
  };

  const setDefaultPlan = (apiGroup: IApi, plan: IUsagePlan) => {
    if (apiGroup && apiGroup.defaultUsagePlan !== plan._id && plan.visibility !== 'Private') {
      const updatedApi = { ...apiGroup, defaultUsagePlan: plan._id }
      Services.saveTeamApiWithId(
        currentTeam._id,
        updatedApi,
        apiGroup.currentVersion,
        updatedApi._humanReadableId
      ).then((response) => {
        if (isError(response)) {
          toastr.error(translate('Error'), translate(response.error));
        } else {
          queryClient.invalidateQueries({ queryKey: ['apiGroup'] })
        }
      })
    }
  }

  const { translate } = useContext(I18nContext);
  const { alert } = useContext(ModalContext);

  const schema = (apiGroup: IApi): ({ [key: string]: any }) => ({
    name: {
      type: type.string,
      label: translate('Name'),
      placeholder: translate('Name'),
      constraints: [
        constraints.required(translate('constraints.required.name')),
        constraints.test('name_already_exist', translate('api.already.exists'), (name, context) => Services.checkIfApiNameIsUnique(name, context.parent._id).then((r) => !r.exists)),
      ],
    },
    smallDescription: {
      type: type.string,
      format: format.text,
      label: translate('Small desc.'),
    },
    description: {
      type: type.string,
      format: format.markdown,
      label: translate('Description'),
    },
    state: {
      type: type.string,
      format: format.buttonsSelect,
      label: translate('State'),
      options: [
        { label: translate('Created'), value: 'created' },
        { label: translate('Published'), value: 'published' },
        { label: translate('Deprecated'), value: 'deprecated' },
        { label: translate('Blocked'), value: 'blocked' }],
      defaultValue: 'created',
    },
    tags: {
      type: type.string,
      array: true,
      label: translate('Tags'),
      expert: true,
    },
    categories: {
      type: type.string,
      format: format.select,
      isMulti: true,
      createOption: true,
      label: translate('Categories'),
      optionsFrom: '/api/categories',
      transformer: (t: string) => ({
        label: t,
        value: t
      }),
      expert: true,
    },
    visibility: {
      type: type.string,
      format: format.buttonsSelect,
      label: translate('Visibility'),
      options: [
        { label: translate('Public'), value: 'Public' },
        { label: translate('Private'), value: 'Private' },
        {
          label: translate('PublicWithAuthorizations'),
          value: 'PublicWithAuthorizations',
        },
      ],
    },
    authorizedTeams: {
      type: type.string,
      format: format.select,
      isMulti: true,
      defaultValue: [],
      visible: {
        ref: 'visibility',
        test: (v: string) => v !== 'Public',
      },
      label: translate('Authorized teams'),
      optionsFrom: '/api/me/teams',
      transformer: (t: ITeamSimple) => ({
        label: t.name,
        value: t._id
      }),
    },
    apis: {
      type: type.string,
      label: translate({ key: 'API', plural: true }),
      format: format.select,
      isMulti: true,
      optionsFrom: () => Services.teamApis(currentTeam._id)
        .then((apis) => {
          if (!isError(apis)) {
            return apis.filter((api) => api._id !== apiGroup?._id && !api.apis)
          }
        }),
      transformer: (api) => ({
        label: `${api.name} - ${api.currentVersion}`,
        value: api._id
      }),
    },
  });

  const simpleOrExpertMode = (entry: string, expert: boolean) => {
    return !!expert || !schema[entry]?.expert;
  };
  const flow = [
    {
      label: translate('Basic.informations'),
      flow: ['name', 'state', 'smallDescription', 'apis'].filter((entry) =>
        simpleOrExpertMode(entry, expertMode)
      ),
      collapsed: false,
    },
    {
      label: translate('Description'),
      flow: ['description'],
      collapsed: true,
    },
    {
      label: translate('Tags and categories'),
      flow: ['tags', 'categories'].filter((entry) => simpleOrExpertMode(entry, expertMode)),
      collapsed: true,
    },
    {
      label: translate('Visibility'),
      flow: ['visibility', 'authorizedTeams'].filter((entry) =>
        simpleOrExpertMode(entry, expertMode)
      ),
      collapsed: true,
    },
  ];

  const { tab } = params;

  if (!creation && apiGroupRequest.isLoading) {
    return <Spinner />;
  } else if (creation || (apiGroupRequest.data && !isError(apiGroupRequest.data))) {
    const apiGroup = creation || apiGroupRequest.data as IApi
    return (
      <Can I={manage} a={API} team={currentTeam} dispatchError>
        <div className="d-flex flex-row justify-content-between align-items-center">
          {creation ? (<h2>{apiGroup.name}</h2>) : (<div className="d-flex align-items-center justify-content-between" style={{ flex: 1 }}>
            <h2 className="me-2">{apiGroup.name}{additionalHeader ? ` - ${additionalHeader}` : ''}</h2>
          </div>)}
          <button onClick={() => dispatch(toggleExpertMode())} className="btn btn-sm btn-outline-primary">
            {expertMode && translate('Standard mode')}
            {!expertMode && translate('Expert mode')}
          </button>
        </div>
        <div className="row">
          <div className="section col container-api">
            <div className="mt-2">
              {params.tab === 'infos' && (<div>
                <Form
                  schema={schema(apiGroup)}
                  flow={flow}
                  onSubmit={save}
                  value={apiGroup} />
              </div>)}
              {params.tab === 'plans' && (<div>
                <TeamApiPricings
                  api={apiGroup}
                  reload={() => queryClient.invalidateQueries({ queryKey: ["apigroup"] })}
                  team={currentTeam}
                  tenant={tenant}
                  setDefaultPlan={plan => setDefaultPlan(apiGroup, plan)}
                  creation={!!creation}
                  expertMode={expertMode}
                  injectSubMenu={(component) => methods.addMenu({
                    blocks: {
                      links: { links: { plans: { childs: { menu: { component } } } } },
                    },
                  })}
                  openApiSelectModal={() => alert({ message: 'oops' })}
                  setHeader={(planName) => setAdditionalHeader(planName)} />

              </div>)}
              {tab === 'settings' && <TeamApiSettings api={apiGroup} apiGroup />}
              {tab === 'stats' && !match && <TeamApiConsumption api={apiGroup} apiGroup />}
              {tab === 'stats' && match && match.params.planId && (<TeamPlanConsumption apiGroup />)}
              {tab === 'subscriptions' && <TeamApiSubscriptions api={apiGroup} />} {/* FIXME: a props APIGROUP has been removed...maybe add it in team api sub component */}
            </div>
          </div>
        </div>
      </Can>
    );
  } else {
    return <div>Error while fetching api group details</div>
  }


};
