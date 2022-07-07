import React, { useContext, useEffect, useState } from 'react';
import * as Services from '../../../services';
import sortBy from 'lodash/sortBy';
import { useNavigate } from 'react-router-dom';

import { PaginatedComponent, AvatarWithAction, Can, manage, tenant } from '../../utils';
import { I18nContext } from '../../../core';
import { useTenantBackOffice } from '../../../contexts';

export const TeamList = () => {
  useTenantBackOffice();

  const [state, setState] = useState({
    teams: [],
  });
  const navigate = useNavigate();

  const createNewTeam = () => {
    Services.fetchNewTeam().then((newTeam) => {
      navigate(`/settings/teams/${newTeam._id}`, {
        state: {
          newTeam,
        },
      });
    });
  };

  useEffect(() => {
    updateTeams();
  }, []);

  const { translateMethod, Translation } = useContext(I18nContext);

  const deleteTeam = (teamId) => {
    window
      .confirm(translateMethod('delete team', 'Are you sure you want to delete this team ?'))
      .then((ok) => {
        if (ok) {
          Services.deleteTeam(teamId).then(() => {
            updateTeams();
          });
        }
      });
  };

  const updateTeams = () => {
    Services.teams().then((teams) => setState({ ...state, teams }));
  };

  const filteredTeams = state.search
    ? state.teams.filter(({ name }) => name.toLowerCase().includes(state.search))
    : state.teams;

  const actions = (team) => {
    const basicActions = [
      {
        action: () => deleteTeam(team._id),
        iconClass: 'fas fa-trash delete-icon',
        tooltip: translateMethod('Delete team'),
      },
      {
        redirect: () => navigate(`/settings/teams/${team._humanReadableId}`),
        iconClass: 'fas fa-pen',
        tooltip: translateMethod('Edit team'),
      },
    ];

    if (team.type === 'Personal') {
      return basicActions;
    }

    return [
      ...basicActions,
      {
        redirect: () => navigate(`/settings/teams/${team._humanReadableId}/members`),
        iconClass: 'fas fa-users',
        tooltip: translateMethod('Team members'),
      },
    ];
  };

  return (
    <Can I={manage} a={tenant} dispatchError>
      <div className="row">
        <div className="d-flex justify-content-between align-items-center">
          <h1>
            <Translation i18nkey="Teams">Teams</Translation>
            <a
              className="btn btn-sm btn-access-negative mb-1 ms-1"
              title={translateMethod('Create a new team')}
              href="#"
              onClick={(e) => {
                e.preventDefault();
                createNewTeam();
              }}
            >
              <i className="fas fa-plus-circle" />
            </a>
          </h1>
          <div className="col-5">
            <input
              placeholder={translateMethod('Find a team')}
              className="form-control"
              onChange={(e) => {
                setState({ ...state, search: e.target.value });
              }}
            />
          </div>
        </div>
        <PaginatedComponent
          items={sortBy(filteredTeams, [(team) => team.name.toLowerCase()])}
          count={8}
          formatter={(team) => {
            return (
              <AvatarWithAction
                key={team._id}
                avatar={team.avatar}
                infos={
                  <>
                    <span className="team__name text-truncate">{team.name}</span>
                  </>
                }
                actions={actions(team)}
              />
            );
          }}
        />
      </div>
    </Can>
  );
};
