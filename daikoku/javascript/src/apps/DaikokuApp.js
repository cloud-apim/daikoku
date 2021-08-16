import React, { useContext, useEffect, useState } from 'react';
import { BrowserRouter as Router, Route, withRouter, Switch, useParams } from 'react-router-dom';
import { Redirect } from 'react-router';
import { ConnectedRouter } from 'connected-react-router';
import { connect, useDispatch, useSelector } from 'react-redux';
import ReduxToastr from 'react-redux-toastr';

import { ModalRoot } from '../components/frontend/modals/ModalRoot';
import { TopBar, Spinner, Error, Footer, Discussion } from '../components/utils';
import * as Services from '../services';
import { updateTeamPromise, history, setError } from '../core';

import 'react-redux-toastr/src/styles/index.scss';

import {
  TeamChooser,
  TeamHome,
  MyHome,
  MaybeHomePage,
  ApiHome,
  UnauthenticatedHome,
  UnauthenticatedTopBar,
  UnauthenticatedFooter,
  FrontOffice,
  JoinTeam,
} from '../components/frontend';

import {
  TeamBackOfficeHome,
  TeamApiKeys,
  TeamApiKeysForApi,
  TeamApis,
  TeamApi,
  TeamMembers,
  NotificationList,
  MyProfile,
  TeamApiKeyConsumption,
  TeamApiConsumption,
  TeamPlanConsumption,
  TeamConsumption,
  TeamBilling,
  TeamIncome,
  TeamEdit,
  AssetsList,
  TeamApiSubscriptions,
  MessagesProvider,
} from '../components/backoffice';

import {
  TenantOtoroshi,
  TenantOtoroshis,
  TenantList,
  TenantEdit,
  TenantStyleEdit,
  UserList,
  UserEdit,
  AuditTrailList,
  SessionList,
  ImportExport,
  TeamEditForAdmin,
  TeamMembersForAdmin,
  TeamList,
  TenantAdminList,
  InitializeFromOtoroshi,
  MailingInternalization,
  AdminMessages,
} from '../components/adminbackoffice';

import { ResetPassword, Signup, TwoFactorAuthentication } from './DaikokuHomeApp';
import { MessagesEvents } from '../services/messages';
import { I18nContext } from '../core/i18n-context';

const DaikokuAppComponent = ({ user, tenant, loginProvider, loginAction, currentLanguage }) => {
  useEffect(() => {
    if (!user.isGuest) {
      MessagesEvents.start();
      return () => {
        MessagesEvents.stop();
      };
    }
  }, []);

  const { setLanguage, setTranslationMode, translateMethod } = useContext(I18nContext)

  useEffect(() => {
    setLanguage(currentLanguage)
    setTranslationMode(tenant.tenantMode && tenant.tenantMode === "Translation")
  }, [currentLanguage, tenant])

  if (!user) {
    return (
      <Router>
        <div
          role="root-container"
          className="container-fluid"
          style={{
            minHeight: '100vh',
            position: 'relative',
            paddingBottom: '6rem',
          }}>
          <Route
            exact
            path="/"
            render={(p) => (
              <UnauthenticatedTopBar
                tenant={tenant}
                location={p.location}
                history={p.history}
                match={p.match}
              />
            )}
          />
          <Route
            exact
            path="/"
            render={(p) => (
              <UnauthenticatedHome tenant={tenant} match={p.match} history={p.history} />
            )}
          />
          <Route
            exact
            path="/"
            render={(p) => (
              <UnauthenticatedFooter tenant={tenant} match={p.match} history={p.history} />
            )}
          />
        </div>
      </Router>
    );
  }
  return (
    <ConnectedRouter history={history}>
      <MessagesProvider>
        <div role="root-container" className="container-fluid main-content-container">
          <ModalRoot />
          <ReduxToastr
            timeOut={4000}
            newestOnTop={false}
            position="top-right"
            transitionIn="fadeIn"
            transitionOut="fadeOut"
            closeOnToastrClick
          />
          <Route
            path={[
              '/notifications',
              '/teams',
              '/settings',
              '/consumptions',
              '/:teamId/settings',
              '/:teamId/:apiId/:versionId',
              '/:teamId',
              '/',
            ]}
            render={(p) => (
              <TopBar
                location={p.location}
                history={p.history}
                match={p.match}
                loginAction={loginAction}
                loginProvider={loginProvider}
              />
            )}
          />
          <Switch>
            <UnauthenticatedRoute
              title={`${tenant.name} - ${translateMethod('Verification code')}`}
              exact
              path="/2fa"
              tenant={tenant}
              render={(p) => (
                <TwoFactorAuthentication
                  match={p.match}
                  history={p.history}
                  currentLanguage={currentLanguage}
                  title={`${tenant.name} - ${translateMethod('Verification code')}`}
                />
              )}
            />
            <UnauthenticatedRoute
              title={`${tenant.name} - ${translateMethod('Reset password')}`}
              exact
              path="/reset"
              tenant={tenant}
              render={(p) => <ResetPassword match={p.match} history={p.history} />}
            />
            <UnauthenticatedRoute
              title={`${tenant.name} - ${translateMethod('Signup')}`}
              exact
              path="/signup"
              tenant={tenant}
              render={(p) => <Signup match={p.match} history={p.history} />}
            />
            <RouteWithTitle
              exact
              title={`${tenant.name} - ${translateMethod('Notifications')}`}
              path="/notifications"
              render={(p) => (
                <NotificationList match={p.match} history={p.history} location={p.location} />
              )}
            />
            <FrontOfficeRoute
              exact
              path="/join"
              title={`${tenant.name} - ${translateMethod('Join team')}`}
              render={(p) => <JoinTeam connectedUser={p.connectedUser} />}
            />
            <FrontOfficeRoute
              title={`${tenant.name} - ${translateMethod('Apis')}`}
              exact
              path="/apis"
              render={(p) => <MyHome match={p.match} history={p.history} />}
            />
            <FrontOfficeRoute
              title={`${tenant.name} - ${translateMethod('Home')}`}
              exact
              path="/"
              render={(p) => (
                <MaybeHomePage
                  match={p.match}
                  history={p.history}
                  connectedUser={p.connectedUser}
                />
              )}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('Message', true)}`}
              exact
              path="/settings/messages"
              render={(p) => (
                <AdminMessages match={p.match} history={p.history} location={p.location} />
              )}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('Otoroshi')}`}
              exact
              path="/settings/otoroshis/:otoroshiId"
              render={(p) => (
                <TenantOtoroshi match={p.match} history={p.history} location={p.location} />
              )}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('Otoroshis', true)}`}
              exact
              path="/settings/otoroshis"
              render={(p) => (
                <TenantOtoroshis match={p.match} history={p.history} location={p.location} />
              )}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('Tenant edit')}`}
              exact
              path="/settings/tenants/:tenantId"
              render={(p) => (
                <TenantEdit match={p.match} history={p.history} location={p.location} />
              )}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('Style')}`}
              exact
              path="/settings/tenants/:tenantId/style"
              render={(p) => (
                <TenantStyleEdit match={p.match} history={p.history} location={p.location} />
              )}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('Tenants', true)}`}
              exact
              path="/settings/tenants"
              render={(p) => (
                <TenantList match={p.match} history={p.history} location={p.location} />
              )}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('Admins')}`}
              exact
              path="/settings/tenants/:tenantId/admins"
              render={(p) => (
                <TenantAdminList
                  match={p.match}
                  history={p.history}
                  location={p.location}
                  tenantMode={false}
                />
              )}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('User')}`}
              exact
              path="/settings/users/:userId"
              render={(p) => <UserEdit match={p.match} history={p.history} location={p.location} />}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('Users', true)}`}
              exact
              path="/settings/users"
              render={(p) => <UserList match={p.match} history={p.history} location={p.location} />}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('Audit trail')}`}
              exact
              path="/settings/audit"
              render={(p) => (
                <AuditTrailList match={p.match} history={p.history} location={p.location} />
              )}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('User sessions')}`}
              exact
              path="/settings/sessions"
              render={(p) => (
                <SessionList match={p.match} history={p.history} location={p.location} />
              )}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('Import / Export')}`}
              exact
              path="/settings/import-export"
              render={(p) => (
                <ImportExport match={p.match} history={p.history} location={p.location} />
              )}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('My profile')}`}
              exact
              path="/settings/me"
              render={(p) => (
                <MyProfile match={p.match} history={p.history} location={p.location} />
              )}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('Team')}`}
              exact
              path="/settings/teams/:teamSettingId"
              render={(p) => (
                <TeamEditForAdmin match={p.match} history={p.history} location={p.location} />
              )}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('Team members')}`}
              exact
              path="/settings/teams/:teamSettingId/members"
              render={(p) => (
                <TeamMembersForAdmin match={p.match} history={p.history} location={p.location} />
              )}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('Teams')}`}
              exact
              path="/settings/teams"
              render={(p) => <TeamList match={p.match} history={p.history} location={p.location} />}
            />
            <Route
              exact
              path="/settings/assets"
              render={(p) => (
                <AssetsList
                  match={p.match}
                  history={p.history}
                  location={p.location}
                  tenantMode={true}
                />
              )}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('Admins')}`}
              exact
              path="/settings/admins"
              render={(p) => (
                <TenantAdminList
                  match={p.match}
                  history={p.history}
                  location={p.location}
                  tenantMode={true}
                />
              )}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('Init')}`}
              exact
              path="/settings/init"
              render={(p) => (
                <InitializeFromOtoroshi match={p.match} history={p.history} location={p.location} />
              )}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('Internalization')}`}
              exact
              path={['/settings/internationalization', '/settings/internationalization/:domain']}
              render={(p) => (
                <MailingInternalization
                  match={p.match}
                  history={p.history}
                  location={p.location}
                  tenant={tenant}
                />
              )}
            />
            {!tenant.hideTeamsPage && (
              <FrontOfficeRoute
                title={`${tenant.name} - ${translateMethod('Teams')}`}
                exact
                path="/teams"
                render={(p) => (
                  <TeamChooser match={p.match} history={p.history} location={p.location} />
                )}
              />
            )}

            {/* NEW ROUTING HERE !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! */}
            {/* NEW ROUTING HERE !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! */}
            {/* NEW ROUTING HERE !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!! */}

            <TeamBackOfficeRoute
              exact
              path="/:teamId/settings/edition"
              render={(p) => <TeamEdit match={p.match} history={p.history} location={p.location} />}
            />
            <TeamBackOfficeRoute
              exact
              path="/:teamId/settings/consumption"
              render={(p) => (
                <TeamConsumption match={p.match} history={p.history} location={p.location} />
              )}
            />
            <TeamBackOfficeRoute
              exact
              path="/:teamId/settings/billing"
              render={(p) => (
                <TeamBilling match={p.match} history={p.history} location={p.location} />
              )}
            />
            <TeamBackOfficeRoute
              exact
              path="/:teamId/settings/income"
              render={(p) => (
                <TeamIncome match={p.match} history={p.history} location={p.location} />
              )}
            />
            <TeamBackOfficeRoute
              exact
              path="/:teamId/settings/apikeys/:apiId/:versionId"
              render={(p) => (
                <TeamApiKeysForApi match={p.match} history={p.history} location={p.location} />
              )}
            />
            <TeamBackOfficeRoute
              exact
              path="/:teamId/settings/subscriptions/apis/:apiId/:versionId"
              render={(p) => (
                <TeamApiSubscriptions match={p.match} history={p.history} location={p.location} />
              )}
            />
            <TeamBackOfficeRoute
              exact
              path="/:teamId/settings/apikeys/:apiId/:versionId/subscription/:subscription/consumptions"
              render={(p) => (
                <TeamApiKeyConsumption match={p.match} history={p.history} location={p.location} />
              )}
            />
            <TeamBackOfficeRoute
              exact
              path="/:teamId/settings/apikeys"
              render={(p) => (
                <TeamApiKeys match={p.match} history={p.history} location={p.location} />
              )}
            />
            <TeamBackOfficeRoute
              exact
              path="/:teamId/settings/apis"
              render={(p) => <TeamApis match={p.match} history={p.history} location={p.location} />}
            />

            <TeamBackOfficeRoute
              exact
              path="/:teamId/settings/consumptions/apis/:apiId/:versionId"
              render={(p) => (
                <TeamApiConsumption match={p.match} history={p.history} location={p.location} />
              )}
            />
            <TeamBackOfficeRoute
              exact
              path="/:teamId/settings/consumptions/apis/:apiId/:versionId/plan/:planId"
              render={(p) => (
                <TeamPlanConsumption match={p.match} history={p.history} location={p.location} />
              )}
            />
            <TeamBackOfficeRoute
              title={`${tenant.name} - ${translateMethod('member', true)}`}
              exact
              path="/:teamId/settings/members"
              render={(p) => (
                <TeamMembers match={p.match} history={p.history} location={p.location} />
              )}
            />
            <TeamBackOfficeRoute
              exact
              path="/:teamId/settings/assets"
              render={(p) => (
                <AssetsList
                  match={p.match}
                  history={p.history}
                  location={p.location}
                  tenantMode={false}
                />
              )}
            />
            <TeamBackOfficeRoute
              exact
              path="/:teamId/settings"
              render={(p) => (
                <TeamBackOfficeHome match={p.match} history={p.history} location={p.location} />
              )}
            />
            <TeamBackOfficeRoute
              exact
              path="/:teamId/settings/apis/:apiId/:versionId"
              render={(p) => <TeamApi match={p.match} history={p.history} location={p.location} />}
            />

            <TeamBackOfficeRoute
              exact
              title={`${tenant.name} - ${translateMethod('API')}`}
              path="/:teamId/settings/apis/:apiId/:versionId/:tab"
              render={(p) => <TeamApi match={p.match} history={p.history} location={p.location} />}
            />

            <FrontOfficeRoute
              exact
              path="/:teamId/:apiId/:versionId/documentation/:pageId"
              render={(p) => (
                <ApiHome match={p.match} history={p.history} tab="documentation-page" />
              )}
            />
            <FrontOfficeRoute
              exact
              path="/:teamId/:apiId/:versionId/documentation"
              render={(p) => <ApiHome match={p.match} history={p.history} tab="documentation" />}
            />
            <FrontOfficeRoute
              exact
              path="/:teamId/:apiId/:versionId/pricing"
              render={(p) => <ApiHome match={p.match} history={p.history} tab="pricing" />}
            />
            <FrontOfficeRoute
              exact
              path="/:teamId/:apiId/:versionId/swagger"
              render={(p) => <ApiHome match={p.match} history={p.history} tab="swagger" />}
            />
            <FrontOfficeRoute
              exact
              path="/:teamId/:apiId/:versionId/redoc"
              render={(p) => <ApiHome match={p.match} history={p.history} tab="redoc" />}
            />
            <FrontOfficeRoute
              exact
              path="/:teamId/:apiId/:versionId/console"
              render={(p) => <ApiHome match={p.match} history={p.history} tab="console" />}
            />
            <FrontOfficeRoute
              exact
              path={['/:teamId/:apiId/:versionId', '/:teamId/:apiId/:versionId/description']}
              render={(p) => <ApiHome match={p.match} history={p.history} tab="description" />}
            />
            <FrontOfficeRoute
              exact
              path="/:teamId/:apiId/:versionId/news"
              render={(p) => <ApiHome match={p.match} history={p.history} tab="news" />}
            />
            <FrontOfficeRoute
              path={['/:teamId/:apiId/:versionId/labels', '/:teamId/:apiId/:versionId/issues']}
              render={(p) => <ApiHome match={p.match} history={p.history} tab="issues" />}
            />
            <FrontOfficeRoute
              exact
              path="/:teamId"
              render={(p) => <TeamHome match={p.match} history={p.history} location={p.location} />}
            />
            <RouteWithTitle
              title={`${tenant.name} - ${translateMethod('404 Error')}`}
              path="*"
              render={() => <Error error={{ status: 404 }} />}
            />
          </Switch>
          <Route
            path="/"
            render={(p) => <Discussion location={p.location} history={p.history} match={p.match} />}
          />
          <Switch>
            <Route
              path={['/settings', '/notifications', '/:teamId/settings']}
              render={() => null}
            />
            <Route
              path={['/']}
              render={(p) => (
                <Footer
                  isBackOffice={false}
                  location={p.location}
                  history={p.history}
                  match={p.match}
                />
              )}
            />
          </Switch>
        </div>
      </MessagesProvider>
    </ConnectedRouter>
  );
};

const mapStateToProps = (state) => ({
  ...state.context,
  error: state.error,
});

const mapDispatchToProps = {
  // updateTeam: (team) => updateTeamPromise(team),
  setError: (error) => setError(error),
};

export const DaikokuApp = connect(mapStateToProps)(DaikokuAppComponent);

//custom component route to get team object if it's not present in  redux store...

const TeamBackOfficeRouteComponent = (p) => {
  const RouteTeam = (props) => {
    const { component: ComponentToRender, render } = props;

    const { currentTeam } = useSelector(state => state.context)
    const dispatch = useDispatch()

    const params = useParams()

    const needReloading = !currentTeam || params.teamId !== currentTeam._humanReadableId

    const [loading, setLoading] = useState(needReloading);
    const [teamError, setTeamError] = useState(null);

    useEffect(() => {
      if (needReloading)
        getMyTeam()
    }, [params.teamId]);

    useEffect(() => {
      if (teamError) {
        setLoading(false);
      }
    }, [teamError]);

    function getMyTeam() {
      console.log("getMyTeam")
      Services.oneOfMyTeam(params.teamId)
        .then((team) => {
          if (team.error)
            setTeamError(team.error);
          else
            dispatch(updateTeamPromise(team));

          setLoading(false)
        })
    }

    if (loading) {
      return <Spinner />;
    } else if (teamError) {
      return <Error error={{ status: 404 }} />;
    } else {
      console.log("Render team api")
      return ComponentToRender ? <ComponentToRender {...props} /> : render(props);
    }
  }

  return <Route {...p} render={(props) => <RouteTeam {...p} {...props} />} />
};

const TeamBackOfficeRoute = TeamBackOfficeRouteComponent;
// withRouter(
//   connect(mapStateToProps, mapDispatchToProps)(TeamBackOfficeRouteComponent)
// );

const FrontOfficeRoute = (props) => {
  return <RouteWithTitle {...props} render={(p) => <FrontOffice>{props.render(p)}</FrontOffice>} />;
};

const RouteWithTitle = (props) => {
  useEffect(() => {
    if (props.title) {
      document.title = props.title;
    }
  }, [props.title]);

  return <Route {...props} />;
};

const UnauthenticatedRouteComponent = ({
  component: ComponentToRender,
  render,
  connectedUser,
  ...rest
}) => {
  if (connectedUser._humanReadableId) {
    return <Redirect to="/" />;
  }
  return (
    <RouteWithTitle
      {...rest}
      render={(props) => (
        <UnauthenticatedHome {...rest}>
          {ComponentToRender ? <ComponentToRender {...props} /> : render(props)}
        </UnauthenticatedHome>
      )}
    />
  );
};

const UnauthenticatedRoute = withRouter(connect(mapStateToProps)(UnauthenticatedRouteComponent));
