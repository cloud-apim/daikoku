import React, { useState, useEffect } from 'react';
import Select from 'react-select';
import Creatable from 'react-select/creatable';
import AsyncSelect from 'react-select/async';
import classNames from 'classnames';
import _ from 'lodash';

import { api, apikey, Option } from '../../../utils';
import * as Services from '../../../../services';
import { newPossibleUsagePlan, BeautifulTitle } from '../../../utils';
import { t, Translation } from '../../../../locales';

export const SelectionStepStep = (props) => {
  return (
    <div className="d-flex">
      <button className="btn btn-outline-primary mr-2" onClick={() => props.goToServices()}>
        <Translation i18nkey="Import Otoroshi services" language={props.currentLanguage}>
          Import Otoroshi Services
        </Translation>
      </button>
      <button className="btn btn-outline-primary" onClick={() => props.goToApikeys()}>
        <Translation i18nkey="Import Otoroshi apikeys" language={props.currentLanguage}>
          Import Otoroshi Apikeys
        </Translation>
      </button>
    </div>
  );
};

export const SelectOtoStep = (props) => {
  const [otoInstance, setOtoInstance] = useState(undefined);

  useEffect(() => {
    if (otoInstance) {
      props.setOtoInstance(otoInstance);
    }
  }, [otoInstance]);

  const previousState = JSON.parse(
    localStorage.getItem(`daikoku-initialization-${props.tenant._id}`)
  );

  useEffect(() => {
    if (props.otoroshis.length === 1)
      setOtoInstance({
        label: props.otoroshis[0].url,
        value: props.otoroshis[0]._id,
      });
  }, []);

  return (
    <div className="d-flex flex-row">
      <Select
        placeholder={t('Select an Otoroshi instance', props.currentLanguage)}
        className="add-member-select mr-2 reactSelect"
        isDisabled={!props.otoroshis.length}
        isLoading={!props.otoroshis.length}
        options={props.otoroshis.map((s) => ({
          label: s.url,
          value: s._id,
        }))}
        selected={otoInstance}
        onChange={(slug) => setOtoInstance(slug)}
        value={otoInstance}
        classNamePrefix="reactSelect"
      />
      {!!previousState && previousState.tenant === props.tenant._id && (
        <div className="d-flex flex-column">
          <BeautifulTitle
            placement="bottom"
            title={t('Load a work in progress', props.currentLanguage)}>
            <button className="btn btn-access" onClick={props.loadPreviousState}>
              <i className="fa fa-download" />
            </button>
          </BeautifulTitle>
        </div>
      )}
    </div>
  );
};

export const RecapServiceStep = (props) => {
  return (
    <div>
      <h2>
        <Translation i18nkey="Api imported" language={props.currentLanguage}>
          Apis to import
        </Translation>
      </h2>
      <ul style={{ listStyleType: 'none' }}>
        {props.teams
          .filter((t) => props.createdApis.some((api) => api.team === t._id))
          .map((t, idx) => {
            return (
              <li className="mt-3" key={idx}>
                <h5>
                  <i className="fas fa-user-friends"></i> {t.name}
                </h5>
                <ul>
                  {props.createdApis
                    .filter((s) => s.team === t._id)
                    .map((s, idx) => {
                      return <li key={idx}>{s.name}</li>;
                    })}
                </ul>
              </li>
            );
          })}
      </ul>
      <div className="d-flex justify-content-end">
        <button className="btn btn-outline-primary mr-1" onClick={() => props.goBackToServices()}>
          <i className="fas fa-chevron-left mr-1"></i>
          <Translation i18nkey="Back" language={props.currentLanguage}>
            Back
          </Translation>
        </button>
        <button className="btn btn-outline-danger mr-1" onClick={props.cancel}>
          <Translation i18nkey="Cancel" language={props.currentLanguage}>
            Cancel
          </Translation>
        </button>
        <button className="btn btn-outline-success" onClick={() => props.create()}>
          <Translation i18nkey="Create apis" language={props.currentLanguage}>
            Create APIs
          </Translation>
        </button>
      </div>
    </div>
  );
};

export const RecapSubsStep = (props) => {
  const reset = () => {
    window.confirm(t('initialize_from_otoroshi.confirm', props.currentLanguage)).then((ok) => {
      if (ok) props.cancel();
    });
  };

  return (
    <div className="mt-3">
      <h4 className="ml-3">
        <Translation
          i18nkey="initialize_from_otoroshi.api_keys_imported"
          language={props.currentLanguage}>
          These api keys will be import
        </Translation>
      </h4>
      <ul style={{ listStyleType: 'none' }}>
        {props.apis
          .filter((a) => props.createdSubs.some((s) => s.api._id === a._id))
          .map((a, idx) => {
            return (
              <li className="mt-3" key={idx}>
                <h5>
                  <i className="fas fa-atlas"></i> {a.name}
                </h5>
                <ul>
                  {props.createdSubs
                    .filter((s) => s.api._id === a._id)
                    .filter((s) => s.plan)
                    .map((s, idx) => {
                      return (
                        <li key={idx}>
                          {s.plan.customName || s.plan.type}/{s.clientName}
                        </li>
                      );
                    })}
                </ul>
              </li>
            );
          })}
      </ul>
      <div className="d-flex justify-content-end">
        <button className="btn btn-outline-primary mr-1" onClick={() => props.goBackToServices()}>
          <i className="fas fa-chevron-left mr-1"></i>
          <Translation i18nkey="Back" language={props.currentLanguage}>
            Back
          </Translation>
        </button>
        <button className="btn btn-outline-danger mr-1" onClick={reset}>
          <Translation i18nkey="Reset" language={props.currentLanguage}>
            Reset
          </Translation>
        </button>
        <button className="btn btn-outline-success" onClick={() => props.create()}>
          <Translation i18nkey="Create subscriptions" language={props.currentLanguage}>
            Create subscriptions
          </Translation>
        </button>
      </div>
    </div>
  );
};

export const ServicesStep = (props) => {
  const [service, setService] = useState(props.maybeCreatedApi.getOrElse(props.service));
  const [loading, setLoading] = useState(false);
  const [newTeam, setNewTeam] = useState();
  const [selectedTeam, setSelectedTeam] = useState(
    props.maybeCreatedApi.map((api) => api.team).getOrNull()
  );
  const [error, setError] = useState({});
  const [inputRef, setInputRef] = useState(null);

  useEffect(() => {
    if (newTeam) {
      setLoading(true);
      Services.fetchNewTeam()
        .then((t) => ({ ...t, name: newTeam }))
        .then((t) => Services.createTeam(t))
        .then((t) => {
          props.addNewTeam(t);
          setSelectedTeam(t._id);
          setNewTeam(undefined);
          setLoading(false);
        });
    }
  }, [newTeam]);

  useEffect(() => {
    Services.checkIfApiNameIsUnique(service.name).then(({ exists }) => {
      if (exists) {
        setError({
          name: t('api.unique.name.error', props.currentLanguage, false, 'Api name must be unique'),
        });
      } else {
        setError({});
      }
    });
  }, [service]);

  const nextStep = () => {
    if (props.currentStep === props.totalSteps) {
      props.recap();
    } else {
      props.nextStep();
    }
  };

  const getIt = () => {
    props.addService(service, selectedTeam);
    nextStep();
  };

  const update = () => {
    props.updateService(service, selectedTeam);
    nextStep();
  };

  const reset = () => {
    props.resetService();
    setService(props.service);
    setSelectedTeam(null);
  };

  useEffect(() => {
    return () => {
      document.onkeydown = null;
    };
  }, [window.event]);
  const checkKey = (e) => {
    if (inputRef && document.activeElement !== inputRef) {
      if (e.keyCode === 37 && props.currentStep > 1) {
        props.previousStep();
      } else if (e.keyCode === 39) {
        if (props.maybeCreatedApi && selectedTeam) {
          props.updateService(service, selectedTeam);
          nextStep();
        } else if (selectedTeam) {
          props.addService(service, selectedTeam);
          nextStep();
        } else {
          nextStep();
        }
      }
    }
  };
  document.onkeydown = checkKey;

  const teams = props.teams.map((t) => ({ label: t.name, value: t._id }));
  return (
    <div className="d-flex flex-row flex-wrap">
      <div className="col-6">
        <h2>
          <Translation i18nkey="Otoroshi" language={props.currentLanguage}>
            Otoroshi
          </Translation>
        </h2>
        <div>
          <span style={{ fontWeight: 'bold' }}>
            <Translation
              i18nkey="init.services.title"
              language={props.currentLanguage}
              replacements={[props.infos.index + 1, props.infos.total]}>
              Api {props.infos.index + 1}/{props.infos.total}
            </Translation>
          </span>{' '}
          : {props.service.name}
          <AsyncSelect
            cacheOptions
            defaultOptions
            placeholder={t('Jump to specific service', props.currentLanguage)}
            className="add-member-select reactSelect"
            loadOptions={props.getFilteredServices}
            onChange={({ value }) => props.goToStep(value)}
            classNamePrefix="reactSelect"
          />
        </div>
        <div className="mt-3">
          <span style={{ fontWeight: 'bold' }}>
            <Translation i18nkey="api group" language={props.currentLanguage}>
              Api group
            </Translation>
          </span>{' '}
          : {props.groups.find((g) => g.id === props.service.groupId).name}
        </div>
      </div>
      <div className="col-6">
        <h2>{props.tenant.name}</h2>
        <div className="d-flex flex-row align-items-center mb-3">
          <div className="col-4">
            <span style={{ fontWeight: 'bold' }}>
              <Translation i18nkey="Api name" language={props.currentLanguage}>
                Api name
              </Translation>
            </span>
          </div>
          <div className="d-flex flex-column col-8">
            <input
              type="text"
              tabIndex="0"
              ref={(ref) => setInputRef(ref)}
              className={classNames('form-control', { 'on-error': !!error.name })}
              value={service.name}
              onChange={(e) => setService({ ...service, name: e.target.value })}
            />
            {error.name && <small className="invalid-input-info text-danger">{error.name}</small>}
          </div>
        </div>
        <div className="d-flex flex-row align-items-center mb-3">
          <div className="col-4">
            <div>
              <span style={{ fontWeight: 'bold' }}>
                <Translation i18nkey="Api team" language={props.currentLanguage}>
                  Api team
                </Translation>
              </span>
            </div>
          </div>
          <Creatable
            className="col-8"
            isClearable={true}
            isDisabled={loading}
            isLoading={loading}
            onChange={(slug, { action }) => {
              setSelectedTeam(action === 'clear' ? undefined : slug.value);
            }}
            onCreateOption={setNewTeam}
            options={teams}
            value={teams.find((t) => t.value === selectedTeam)}
            placeholder={t('Select a team', props.currentLanguage)}
            formatCreateLabel={(value) =>
              t('create.team.label', props.currentLanguage, false, `creer l'équipe ${value}`, value)
            }
            classNamePrefix="reactSelect"
          />
        </div>
      </div>
      <div className="d-flex justify-content-between col-12 mt-5">
        <div />
        <div>
          <button
            className="btn btn-access"
            disabled={props.currentStep === 1 ? 'disabled' : null}
            onClick={() => props.goToStep(1)}>
            <i className="fas fa-angle-double-left" />
          </button>
          <button
            className="btn btn-access mr-2"
            disabled={props.currentStep === 1 ? 'disabled' : null}
            onClick={props.previousStep}>
            <i className="fas fa-angle-left" />
          </button>
          {props.maybeCreatedApi.isDefined && (
            <button className="btn btn-outline-success" onClick={reset}>
              <Translation i18nkey="Reset" language={props.currentLanguage}>
                Reset
              </Translation>
            </button>
          )}
          {props.maybeCreatedApi.isDefined && (
            <button
              className="btn btn-outline-success mr-2"
              disabled={!selectedTeam || error.name ? 'disabled' : null}
              onClick={update}>
              <Translation i18nkey="Update" language={props.currentLanguage}>
                Update
              </Translation>
            </button>
          )}
          {!props.maybeCreatedApi.isDefined && (
            <button
              className="btn btn-outline-success mr-2"
              disabled={!selectedTeam || error.name ? 'disabled' : null}
              onClick={getIt}>
              <Translation i18nkey="Import" language={props.currentLanguage}>
                Import this service
              </Translation>
            </button>
          )}
          <button className="btn btn-access ml-2" onClick={nextStep}>
            <i className="fas fa-angle-right" />
          </button>
          <button
            className="btn btn-access"
            disabled={props.currentStep === props.totalSteps ? 'disabled' : null}
            onClick={() => props.goToStep(props.totalSteps)}>
            <i className="fas fa-angle-double-right" />
          </button>
        </div>

        <div>
          <button className="btn btn-outline-danger mr-2" onClick={props.cancel}>
            <Translation i18nkey="Cancel" language={props.currentLanguage}>
              Cancel
            </Translation>
          </button>
          <button className="btn btn-outline-success" onClick={props.recap}>
            <Translation i18nkey="Finish" language={props.currentLanguage}>
              Finish
            </Translation>
          </button>
        </div>
      </div>
    </div>
  );
};

const SelectApi = ({ apis, currentLanguage, setSelectedApi, selectedApi }) => (
  <Select
    options={apis}
    onChange={(slug) => setSelectedApi(slug.value)}
    value={apis.find((a) => !!selectedApi && a.value._id === selectedApi._id)}
    placeholder={t('Select an API', currentLanguage)}
    classNamePrefix="reactSelect"
  />
);

const SelectPlan = ({
  possiblePlans,
  selectedApi,
  loadingPlan,
  setNewPlan,
  currentLanguage,
  selectedPlan,
  setSelectedPlan,
}) =>
  possiblePlans.length > 0 ? (
    <Creatable
      isClearable
      isDisabled={!selectedApi || loadingPlan}
      isLoading={!selectedApi || loadingPlan}
      onChange={(slug, { action }) => setSelectedPlan(action === 'clear' ? undefined : slug.value)}
      onCreateOption={setNewPlan}
      options={possiblePlans}
      value={possiblePlans.find((a) => !!selectedPlan && a.value._id === selectedPlan._id)}
      placeholder={t('Select a plan', currentLanguage)}
      formatCreateLabel={(value) =>
        t('create.plan.label', currentLanguage, false, `Create plan ${value}`, value)
      }
      classNamePrefix="reactSelect"
    />
  ) : null;

const SelectTeam = ({
  loading,
  setNewTeam,
  teams,
  currentLanguage,
  selectedTeam,
  setSelectedTeam,
  selectedApi,
}) =>
  selectedApi ? (
    <Creatable
      isClearable
      isDisabled={loading}
      isLoading={loading}
      onChange={(slug, { action }) => setSelectedTeam(action === 'clear' ? undefined : slug.value)}
      onCreateOption={setNewTeam}
      options={teams}
      value={teams.find((t) => t.value === selectedTeam)}
      placeholder={t('Select a team', currentLanguage)}
      formatCreateLabel={(value) =>
        t('create.team.label', currentLanguage, false, `creer l'équipe ${value}`, value)
      }
      classNamePrefix="reactSelect"
    />
  ) : null;

export const ApiKeyStep = (props) => {
  const [apikeys, setApikeys] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState();

  useEffect(() => {
    if (selectedGroup) setApikeys(props.getFilteredApikeys(selectedGroup));
  }, [selectedGroup]);

  const apis = props.apis.map((a) => ({ label: a.name, value: a }));
  const teams = props.teams.map((t) => ({ label: t.name, value: t._id }));
  const groups = props.groups.map((g) => ({ value: g.id, label: g.name }));

  return (
    <div className="d-flex flex-column">
      <div className="d-flex align-items-center mx-3">
        <span style={{ fontWeight: 'bold' }} className="mr-2">
          {t('initialize_from_otoroshi.api_keys_of', props.currentLanguage)}
        </span>
        <Select
          className="w-50"
          options={groups}
          onChange={setSelectedGroup}
          value={selectedGroup}
          placeholder={t('initialize_from_otoroshi.select_group', props.currentLanguage)}
          classNamePrefix="reactSelect"
        />
      </div>
      {selectedGroup && (
        <div className="d-flex flex-column mt-3">
          <span style={{ fontWeight: 'bold' }} className="m-3">
            {selectedGroup.label} has {apikeys.length} api keys.
          </span>
          {apikeys.length > 0 && (
            <table className="table table-sm">
              <thead>
                <tr>
                  <th className="text-center">
                    {t('initialize_from_otoroshi.otoroshi_api_key', props.currentLanguage)}
                  </th>
                  <th className="text-center">{t('API.s', props.currentLanguage)}</th>
                  <th className="text-center">
                    {t('initialize_from_otoroshi.plan', props.currentLanguage)}
                  </th>
                  <th className="text-center">
                    {t('initialize_from_otoroshi.team', props.currentLanguage)}
                  </th>
                  <th className="text-center">
                    {t('initialize_from_otoroshi.actions', props.currentLanguage)}
                  </th>
                </tr>
              </thead>
              <tbody>
                {apikeys.map((apikey) => (
                  <ApiKey apikey={apikey} key={apikey.clientId} {...props} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="ml-auto">
        {props.createdSubs.length <= 0 && (
          <button className="btn btn-outline-danger mr-2" onClick={props.cancel}>
            <Translation i18nkey="Cancel" language={props.currentLanguage}>
              Cancel
            </Translation>
          </button>
        )}
      </div>
    </div>
  );
};

const ApiKey = (props) => {
  const [selectedApi, setSelectedApi] = useState(
    props
      .maybeCreatedSub(props.apikey)
      .map((sub) => sub.api)
      .getOrNull()
  );
  const [selectedPlan, setSelectedPlan] = useState(
    props
      .maybeCreatedSub(props.apikey)
      .map((sub) => sub.plan)
      .getOrNull()
  );
  const [selectedTeam, setSelectedTeam] = useState(
    props
      .maybeCreatedSub(props.apikey)
      .map((sub) => sub.team)
      .getOrNull()
  );

  const [newTeam, setNewTeam] = useState(undefined);
  const [newPlan, setNewPlan] = useState(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [error, setError] = useState({ plan: false, api: false, team: false });

  useEffect(() => {
    if (selectedApi) {
      const api = props.apis.find((a) => selectedApi._id === a._id);
      setSelectedApi(api);

      if (selectedPlan) {
        setSelectedPlan(api.possibleUsagePlans.find((pp) => pp._id === selectedPlan._id));
      }
    }

    //remove document.OnKeyDown listener
    return () => (document.onkeydown = null);
  }, [props.apis]);

  useEffect(() => {
    if (newTeam) {
      setLoading(true);
      Services.fetchNewTeam()
        .then((t) => ({ ...t, name: newTeam }))
        .then((t) => Services.createTeam(t))
        .then((t) => {
          props.addNewTeam(t);
          setSelectedTeam(t._id);
          setNewTeam(undefined);
          setLoading(false);
        });
    }
  }, [newTeam]);

  const getAuthorizedEntitiesFromOtoroshiApiKey = (autorizedOn) => {
    const regex = /(group|service)_(.*)/;
    return autorizedOn.reduce(({ groups, services }, entitie) => {
      // eslint-disable-next-line no-unused-vars
      const [_value, type, id] = entitie.match(regex);
      switch (type) {
        case 'group':
          return { groups: [...groups, id], services };
        case 'service':
          return { groups, services: [...services, id] };
      }
    }, { groups: [], services: [] });
  };

  //add new plan effect
  useEffect(() => {
    if (newPlan) {
      let plans = _.cloneDeep(selectedApi.possibleUsagePlans);
      const newPossiblePlan = newPossibleUsagePlan(newPlan);
      const plan = {
        ...newPossiblePlan,
        otoroshiTarget: {
          ...newPossiblePlan.otoroshiTarget,
          otoroshiSettings: props.otoroshi,
          authorizedEntities: getAuthorizedEntitiesFromOtoroshiApiKey(props.apikey.authorizedEntities)
        },
      };
      plans.push(plan);
      const value = _.cloneDeep(selectedApi);
      value.possibleUsagePlans = plans;

      setSelectedPlan(plan);
      Promise.resolve(setLoadingPlan(true))
        .then(() => props.updateApi(value))
        .then(() => {
          setNewPlan(undefined);
          setLoadingPlan(false);
        });
    }
  }, [newPlan]);

  //handle error effect
  useEffect(() => {
    setError({ plan: !!selectedPlan, api: !!selectedApi, team: !!selectedTeam });
    update();
  }, [selectedPlan, selectedApi, selectedTeam]);

  const apis = props.apis.map((a) => ({ label: a.name, value: a }));
  const teams = props.teams.map((t) => ({ label: t.name, value: t._id }));
  const possiblePlans = Option(props.apis.find((a) => selectedApi && a._id === selectedApi._id))
    .map((a) => a.possibleUsagePlans)
    .getOrElse([])
    .map((pp) => ({ label: pp.customName || pp.type, value: pp }));

  const getIt = () => {
    props.addSub(props.apikey, selectedTeam, selectedApi, selectedPlan);
  };

  const update = () => {
    if (props.maybeCreatedSub(props.apikey).isDefined)
      props.updateSub(props.apikey, selectedTeam, selectedApi, selectedPlan);
  };

  const remove = () => {
    props.resetSub(props.apikey);
  };

  return (
    <tr>
      <td style={{ width: '21%' }} className="align-middle text-center">
        {props.apikey.clientName}
      </td>
      <td style={{ width: '23%' }} className="align-middle text-center">
        <SelectApi
          apis={apis}
          setSelectedApi={setSelectedApi}
          selectedApi={selectedApi}
          currentLanguage={props.currentLanguage}
        />
      </td>
      <td style={{ width: '23%' }} className="align-middle text-center">
        <SelectPlan
          possiblePlans={possiblePlans}
          selectedPlan={selectedPlan}
          loadingPlan={loadingPlan}
          setSelectedPlan={setSelectedPlan}
          setNewPlan={setNewPlan}
          selectedApi={selectedApi}
          currentLanguage={props.currentLanguage}
        />
      </td>
      <td style={{ width: '23%' }} className="align-middle text-center">
        <SelectTeam
          loading={loading}
          setNewTeam={setNewTeam}
          selectedTeam={selectedTeam}
          teams={teams}
          setSelectedTeam={setSelectedTeam}
          selectedApi={selectedApi}
          currentLanguage={props.currentLanguage}
        />
      </td>
      <td style={{ width: '10%' }} className="align-middle text-center">
        <button
          className={`btn btn-outline-${
            props.maybeCreatedSub(props.apikey).isDefined ? 'warning' : 'success'
          } mr-2`}
          disabled={!selectedTeam || error.name || !selectedPlan ? 'disabled' : null}
          onClick={props.maybeCreatedSub(props.apikey).isDefined ? remove : getIt}>
          {props.maybeCreatedSub(props.apikey).isDefined
            ? t('initialize_from_otoroshi.remove', props.currentLanguage)
            : t('initialize_from_otoroshi.add', props.currentLanguage)}
        </button>
      </td>
    </tr>
  );
};
