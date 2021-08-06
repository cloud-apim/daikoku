import React, { Component } from 'react';

import * as Services from '../../../services';
import { ApiList } from './ApiList';
import { connect } from 'react-redux';
import { Can, read, team } from '../../utils';
import { updateUser } from '../../../core';
import { setError, updateTeamPromise } from '../../../core';

class TeamHomeComponent extends Component {
  state = {
    searched: '',
    team: null,
    apis: [],
  };

  fetchData = (teamId) => {
    Promise.all([
      Services.myVisibleApisOfTeam(teamId),
      Services.team(teamId),
      Services.teams(),
      Services.myTeams(),
    ]).then(([apis, team, teams, myTeams]) => {
      if (apis.error || team.error) {
        this.props.setError({ error: { status: 404, message: apis.error } });
      } else {
        this.setState({ apis, team, teams, myTeams });
      }
    });
  };

  componentDidMount() {
    this.fetchData(this.props.match.params.teamId);
  }

  componentDidCatch(e) {
    console.log('TeamHomeError', e);
  }

  askForApiAccess = (api, teams) => {
    return Services.askForApiAccess(teams, api._id).then(() =>
      this.fetchData(this.props.match.params.teamId)
    );
  };

  toggleStar = (api) => {
    Services.toggleStar(api._id).then((res) => {
      if (!res.error) {
        const alreadyStarred = this.props.connectedUser.starredApis.includes(api._id);
        this.setState({
          apis: this.state.apis.map((a) => {
            if (a._id === api._id) a.stars += alreadyStarred ? -1 : 1;
            return a;
          }),
        });

        this.props.updateUser({
          ...this.props.connectedUser,
          starredApis: alreadyStarred
            ? this.props.connectedUser.starredApis.filter((id) => id !== api._id)
            : [...this.props.connectedUser.starredApis, api._id],
        });
      }
    });
  };

  redirectToApiPage = (api) => {
    if (api.visibility === 'Public' || api.authorized) {
      const apiOwner = this.state.teams.find((t) => t._id === api.team);

      const route = version => `/${apiOwner ? apiOwner._humanReadableId : api.team}/${api._humanReadableId}/${version}`

      // if (api.isDefault)
      this.props.history.push(route(api.currentVersion));
      // else 
      //     Services.getDefaultApiVersion(api._humanReadableId)
      // .then(res => this.props.history.push(route(res.defaultVersion)))
    }
  };

  redirectToTeamPage = (team) => {
    this.props.history.push(`/${team._humanReadableId}`);
  };

  redirectToEditPage = (api) => {
    this.props.history.push(
      `/${this.props.match.params.teamId}/settings/apis/${api._humanReadableId}/${api.currentVersion}/infos`
    );
  };

  redirectToTeamSettings = (team) => {
    this.props.history.push(`/${team._humanReadableId}/settings`);
    // this.props
    //   .updateTeam(team)
    //   .then(() => this.props.history.push(`/${team._humanReadableId}/settings`));
  };

  render() {
    if (!this.state.team) {
      return null;
    }

    document.title = `${this.props.tenant.name} - ${this.state.team.name}`;

    return (
      <main role="main" className="row">
        <section className="organisation__header col-12 mb-4 p-3">
          <div className="container">
            <div className="row text-center">
              <div className="col-sm-4">
                <img
                  className="organisation__avatar"
                  src={this.state.team.avatar || '/assets/images/daikoku.svg'}
                  alt="avatar"
                />
              </div>
              <div className="col-sm-7 d-flex flex-column justify-content-center">
                <h1 className="jumbotron-heading">{this.state.team.name}</h1>
                <div className="lead">{this.state.team.description}</div>
              </div>
              <div className="col-sm-1 d-flex flex-column">
                <Can I={read} a={team} team={this.state.team}>
                  <div>
                    <a
                      href="#"
                      className="float-right team__settings btn btn-sm btn-access-negative"
                      onClick={() => this.redirectToTeamSettings(this.state.team)}>
                      <i className="fas fa-cogs" />
                    </a>
                  </div>
                </Can>
              </div>
            </div>
          </div>
        </section>
        <ApiList
          apis={this.state.apis}
          teams={this.state.teams}
          teamVisible={false}
          askForApiAccess={this.askForApiAccess}
          toggleStar={this.toggleStar}
          redirectToApiPage={this.redirectToApiPage}
          redirectToEditPage={this.redirectToEditPage}
          redirectToTeamPage={this.redirectToTeamPage}
          history={this.props.history}
          myTeams={this.state.myTeams}
          showTeam={false}
          team={this.state.teams.find(
            (team) => team._humanReadableId === this.props.match.params.teamId
          )}
        />
      </main>
    );
  }
}

const mapStateToProps = (state) => ({
  ...state.context,
});

const mapDispatchToProps = {
  updateTeam: (team) => updateTeamPromise(team),
  setError: (error) => setError(error),
  updateUser: (u) => updateUser(u),
};

export const TeamHome = connect(mapStateToProps, mapDispatchToProps)(TeamHomeComponent);
