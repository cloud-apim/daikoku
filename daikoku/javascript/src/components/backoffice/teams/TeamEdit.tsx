import React, { useContext, useEffect } from 'react';
import { connect } from 'react-redux';
import { toastr } from 'react-redux-toastr';
import { useNavigate } from 'react-router-dom';
import { Form, type, format, constraints } from '@maif/react-forms';
import md5 from 'js-md5';

import { I18nContext, updateTeamPromise } from '../../../core';
import * as Services from '../../../services';
import { AssetChooserByModal, MimeTypeFilter } from '../../frontend'
import { useTeamBackOffice } from '../../../contexts';


const Avatar = ({
  rawValues,
  value,
  getValue,
  onChange,
  team
}: any) => {
  const { Translation, translate } = useContext(I18nContext);

  const setGravatarLink = () => {
    const email = getValue('contact').toLowerCase().trim();
    const url = `https://www.gravatar.com/avatar/${md5(email)}?size=128&d=robohash`;
    onChange(url);
  };


  return (
    <div className="d-flex flex-row align-items-center">
      <div className="float-right mb-4 position-relative">
        <img
          src={`${rawValues?.avatar}${rawValues?.avatar?.startsWith('http') ? '' : `?${Date.now()}`
            }`}
          style={{
            width: 100,
            borderRadius: '50%',
            backgroundColor: 'white',
          }}
          alt="avatar"
          className="mx-3"
        />
      </div>
      <div className="d-flex flex-column flex-grow-1">
        <input
          type="text"
          className="form-control mb-1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <div className='d-flex justify-content-end'>
          <button type="button" className="btn btn-outline-primary me-1" onClick={setGravatarLink} disabled={!rawValues.contact}>
            <i className="fas fa-user-circle me-1" />
            <Translation i18nkey="Set avatar from Gravatar">Set avatar from Gravatar</Translation>
          </button>
          <AssetChooserByModal
            typeFilter={MimeTypeFilter.image}
            onlyPreview
            tenantMode={false}
            team={team}
            label={translate('Set avatar from asset')}
            onSelect={(asset: any) => onChange(asset.link)}
          />
        </div>
      </div>
    </div>
  );
};

export const teamSchema = (team: any, translate: (props: any) => string) => ({
  name: {
    type: type.string,
    label: translate('Name'),
    disabled: team.type === 'Personal' || team.type === 'Admin',
    constraints: [
      constraints.required(translate('constraints.required.name'))
    ]
  },

  description: {
    type: type.string,
    label: translate('Description'),
    disabled: team.type === 'Personal' || team.type === 'Admin',
  },

  contact: {
    type: type.string,
    label: translate('Team contact'),
    disabled: team.type === 'Personal' || team.type === 'Admin',
  },

  avatar: {
    type: type.string,
    label: translate('Team avatar'),
    render: (v: any) => Avatar({ ...v, team: team }),
    disabled: team.type === 'Personal' || team.type === 'Admin',
  },

  apiKeyVisibility: {
    type: type.string,
    format: format.buttonsSelect,
    label: translate('apikeys visibility'),
    disabled: team.type === 'Personal' || team.type === 'Admin',
    defaultValue: 'User',
    options: [
      { label: translate('Administrator'), value: 'Administrator' },
      { label: translate('ApiEditor'), value: 'ApiEditor' },
      { label: translate('User'), value: 'User' },
    ],
  }
});

export const TeamEditForm = ({
  team,
  updateTeam
}: any) => {
  const { translate } = useContext(I18nContext);



  if (!team) {
    return null;
  }

  useEffect(() => {
    document.title = `${team.name} - ${translate('Edition')}`;
  }, []);

  return (
    <Form
      schema={teamSchema(team, translate)}
      value={team}
      onSubmit={(team) => updateTeam(team)}
      options={{
        actions: { submit: { label: translate('Save') } }
      }}
    />
  );
};

const TeamEditComponent = ({
  currentTeam
}: any) => {
  const navigate = useNavigate();
  useTeamBackOffice(currentTeam);

  const { translate } = useContext(I18nContext);


  const save = (data: any) => {
    Services.updateTeam(data)
      .then((updatedTeam) => {
        if (data._humanReadableId !== updatedTeam._humanReadableId) {
          navigate(`/${updatedTeam._humanReadableId}/settings/edition`);
        }
        toastr.success(
          translate('Success'),
          translate({ key: 'team.updated.success', replacements: [updatedTeam.name] })
        );
      });
  };

  return (
    <TeamEditForm team={currentTeam} updateTeam={save} />
  );
};

const mapStateToProps = (state: any) => ({
  ...state.context
});

const mapDispatchToProps = {
  updateTeam: (team: any) => updateTeamPromise(team),
};

export const TeamEdit = connect(mapStateToProps, mapDispatchToProps)(TeamEditComponent);
