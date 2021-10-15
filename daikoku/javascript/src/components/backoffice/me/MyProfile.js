import React, { useContext, useEffect, useState } from 'react';
import * as Services from '../../../services';
import bcrypt from 'bcryptjs';
import md5 from 'js-md5';
import { connect } from 'react-redux';
import { toastr } from 'react-redux-toastr';
import { Form, type, format, constraints } from '@maif/react-forms';

import { UserBackOffice } from '../../backoffice';
import { I18nContext, updateUser } from '../../../core';
import { tenant } from '../..';


function TwoFactorAuthentication({ user }) {
  const [modal, setModal] = useState(false);
  const [error, setError] = useState();
  const [backupCodes, setBackupCodes] = useState('');

  const { translateMethod } = useContext(I18nContext);

  const getQRCode = () => {
    Services.getQRCode().then((res) =>
      setModal({
        ...res,
        code: '',
      })
    );
  };

  const disable2FA = () => {
    window.confirm(translateMethod('2fa.disable_confirm_message')).then((ok) => {
      if (ok) {
        Services.disable2FA().then(() => {
          toastr.success(translateMethod('2fa.successfully_disabled_from_pr'));
          window.location.reload();
        });
      }
    });
  };

  function copyToClipboard() {
    navigator.clipboard.writeText(user?.twoFactorAuthentication.backupCodes);
    toastr.success(translateMethod('2fa.copied'));
  }

  function verify() {
    if (!modal.code || modal.code.length !== 6) {
      setError(translateMethod('2fa.code_error'));
      setModal({ ...modal, code: '' });
    } else {
      Services.selfVerify2faCode(modal.code).then((res) => {
        if (res.error) {
          setError(translateMethod('2fa.wrong_code'));
          setModal({ ...modal, code: '' });
        } else {
          toastr.success(res.message);
          setBackupCodes(res.backupCodes);
        }
      });
    }
  }

  return modal ? (
    <div>
      {backupCodes ? (
        <div className="d-flex flex-column justify-content-center align-items-center w-50 mx-auto">
          <span className="my-3">{translateMethod('2fa.backup_codes_message')}</span>
          <div className="d-flex w-100 mb-3">
            <input type="text" disabled={true} value={backupCodes} className="form-control" />
            <button
              className="btn btn-outline-success ml-1"
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(backupCodes);
                toastr.success('Copied');
              }}>
              <i className="fas fa-copy" />
            </button>
          </div>
          <button
            className="btn btn-outline-success"
            type="button"
            onClick={() => window.location.reload()}>
            {translateMethod('2fa.confirm')}
          </button>
        </div>
      ) : (
        <div className="d-flex flex-column justify-content-center align-items-center p-3">
          <div className="d-flex justify-content-center align-items-center p-3">
            <div className="d-flex flex-column justify-content-center align-items-center">
              <span className="my-3 text-center w-75 mx-auto">
                {translateMethod('2fa.advice_scan')}
              </span>
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(modal.qrcode)}`}
                style={{
                  maxWidth: '250px',
                  height: '250px',
                }}
              />
            </div>
            <div className="w-75">
              <span className="my-3 text-center">
                {translateMethod('2fa.advice_enter_manually')}
              </span>
              <textarea
                type="text"
                style={{
                  resize: 'none',
                  background: 'none',
                  fontWeight: 'bold',
                  border: 0,
                  color: 'black',
                  letterSpacing: '3px',
                }}
                disabled={true}
                value={modal.rawSecret.match(/.{1,4}/g).join(' ')}
                className="form-control"
              />
            </div>
          </div>
          <div className="w-75 mx-auto">
            <span className="mt-3">{translateMethod('2fa.enter_6_digits')}</span>
            <span className="mb-3">{translateMethod('2fa.enter_a_code')}</span>
            {error && (
              <div className="alert alert-danger" role="alert">
                {error}
              </div>
            )}
            <input
              type="number"
              value={modal.code}
              placeholder={translateMethod('2fa.insert_code')}
              onChange={(e) => {
                if (e.target.value.length < 7) {
                  setError(null);
                  setModal({ ...modal, code: e.target.value });
                }
              }}
              className="form-control my-3"
            />

            <button className="btn btn-outline-success" type="button" onClick={verify}>
              {translateMethod('2fa.complete_registration')}
            </button>
          </div>
        </div>
      )}
    </div>
  ) : (
    <>
      <div className="form-group row">
        <div className="col-sm-10">
          {user?.twoFactorAuthentication?.enabled ? (
            <button onClick={disable2FA} className="btn btn-outline-danger" type="button">
              {translateMethod('2fa.disable_action')}
            </button>
          ) : (
            <button onClick={getQRCode} className="btn btn-outline-success" type="button">
              {translateMethod('2fa.enable_action')}
            </button>
          )}
        </div>
      </div>
      {user?.twoFactorAuthentication?.enabled && (
        <div className="form-group row">
          <label className="col-xs-12 col-sm-2 col-form-label">
            {translateMethod('2fa.backup_codes')}
          </label>
          <div className="col-sm-10">
            <div className="d-flex">
              <input
                type="text"
                disabled={true}
                value={user?.twoFactorAuthentication.backupCodes}
                className="form-control"
              />
              <button
                className="btn btn-outline-success ml-1"
                type="button"
                onClick={copyToClipboard}>
                <i className="fas fa-copy" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


const Avatar = ({ setValue, rawValues, value, error, onChange, tenant }) => {
  const { Translation } = useContext(I18nContext);

  const setFiles = (files) => {
    const file = files[0];
    const filename = file.name;
    const contentType = file.type;
    return Services.storeUserAvatar(filename, contentType, file).then((res) => {
      if (res.error) {
        toastr.error(res.error);
      } else {
        setValue('pictureFromProvider', false);
        onChange(`/user-avatar/${tenant._humanReadableId}/${res.id}`);
      }
    });
  };

  const setPictureFromProvider = () => {
    setValue('pictureFromProvider', true);
  };

  const changePicture = (picture) => {
    if (rawValues.pictureFromProvider) {
      setValue('pictureFromProvider', false);
      onChange(picture);
    } else {
      onChange(picture);
    }
  };

  const setGravatarLink = () => {
    const email = rawValues.email.toLowerCase().trim();
    const url = `https://www.gravatar.com/avatar/${md5(email)}?size=128&d=robohash`;
    changePicture(url);
  };

  const isOtherOriginThanLocal = rawValues?.origins?.some((o) => o.toLowerCase !== 'local');

  if (!isOtherOriginThanLocal) {
    return null;
  }
  return (
    <div className="d-flex flex-row align-items-center">
      <div className='d-flex align-items-center'>
        <img
          src={`${rawValues?.picture}${rawValues?.picture?.startsWith('http') ? '' : `?${Date.now()}`}`}
          style={{
            width: 100,
            borderRadius: '50%',
            backgroundColor: 'white',
            position: 'relative',
          }}
          alt="avatar"
          className="mr-3"
        />
        <PictureUpload setFiles={setFiles} />
      </div>
      <div className="d-flex flex-column flex-grow-1">
        <input
          type="text"
          className="form-control"
          value={value}
          onChange={(e) => changePicture(e.target.value)}
        />
        <div className="d-flex mt-1 justify-content-end">
          <button type="button" className="btn btn-outline-primary mr-1" onClick={setGravatarLink}>
            <i className="fas fa-user-circle mr-1" />
            <Translation i18nkey="Set avatar from Gravatar">Set avatar from Gravatar</Translation>
          </button>
          {isOtherOriginThanLocal && (
            <button
              type="button"
              className="btn btn-outline-primary"
              onClick={setPictureFromProvider}
              disabled={rawValues.pictureFromProvider ? 'disabled' : null}>
              <i className="fas fa-user-circle mr-1" />
              <Translation i18nkey="Set avatar from auth. provider">
                Set avatar from auth. Provider
              </Translation>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};


function PictureUpload(props) {
  const [uploading, setUploading] = useState(false);

  const { Translation } = useContext(I18nContext);

  const setFiles = (e) => {
    const files = e.target.files;
    setUploading(true);
    props.setFiles(files);
    setUploading(false);
  };

  const trigger = () => {
    input.click();
  };

  let input;

  return (
    <div className="changePicture">
      <input
        ref={(r) => (input = r)}
        type="file"
        className="form-control hide"
        onChange={setFiles}
      />
      <button
        type="button"
        className="btn btn-outline-secondary"
        disabled={uploading}
        onClick={trigger}
        style={{ width: 100, height: 100, borderRadius: '50%' }}>
        {uploading && <i className="fas fa-spinner" />}
        {!uploading && (
          <div className="text-white">
            <Translation i18nkey="Change your picture">Change your picture</Translation>
          </div>
        )}
      </button>
    </div>
  );
}

function MyProfileComponent(props) {
  const [user, setUser] = useState();
  const [tab, setTab] = useState('infos');

  const { translateMethod, setLanguage, language, Translation, languages } =
    useContext(I18nContext);

  const formSchema = {
    name: {
      type: type.string,
      label: translateMethod('Name'),
      constraints: [
        constraints.required('A name is required')
      ]
    },
    email: {
      type: type.string,
      format: format.email,
      label: translateMethod('Email address'),
      constraints: [
        constraints.required('An email address is required')
      ]

    },
    picture: {
      type: type.string,
      label: translateMethod('Avatar'),
      render: v => Avatar({ ...v, tenant: props.tenant }),
      constraints: [
        constraints.required('Please, provide an avatar'),
        constraints.url('not an url')
      ]
    },
    defaultLanguage: {
      type: type.string,
      format: format.select,
      label: translateMethod('Default language'),
      defaultValue: 'Français', //FIXME: get tenant default language
      options: languages,
    },
  };

  const formFlow = [
    'picture',
    'name',
    'email',
    'defaultLanguage',
  ];

  const changePasswordSchema = {
    oldPassword: {
      type: type.string,
      format: format.password,
      label: 'Old Password',
      constraints: [
        constraints.required('Your old password is required'),
        constraints.test('hash', 'wrong password', (value) => {
          return bcrypt.compareSync(value, user.password);
        })
      ]
    },
    newPassword: {
      type: type.string,
      format: format.password,
      label: 'New password',
      constraints: [
        constraints.required('Your new password is required'),
        constraints.matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[#$^+=!*()@%&]).{8,1000}$/, 'Your new password must have 8 letters min with Capital, number and special caracter')
      ]
    },
    confirmNewPassword: {
      type: type.string,
      format: format.password,
      label: 'Confirm new password',
      constraints: [
        constraints.required('confirm password is required'),
        constraints.oneOf([constraints.ref('newPassword')], 'confirm and password must be equal')
      ]
    },
  };

  useEffect(() => {
    Services.me(props.connectedUser._id).then((user) => {
      setUser(user);
      if (user.defaultLanguage && user.defaultLanguage !== language)
        setLanguage(user.defaultLanguage);
    });
  }, []);

  const save = data => {
    Services.updateUserById(data).then((user) => {
      setUser(user);
      props.updateUser(user);

      if (language !== user.defaultLanguage) setLanguage(user.defaultLanguage);

      toastr.success(
        translateMethod('user.updated.success', false, 'user successfully updated', user.name)
      );
    });
  };

  const removeUser = () => {
    window
      .confirm(
        translateMethod(
          'delete account',
          false,
          'Are you sure you want to delete your account ? This action cannot be undone ...'
        )
      )
      .then((ok) => {
        if (ok) {
          Services.deleteSelfUserById().then(() => {
            props.history.push('/logout');
          });
        }
      });
  };

  const updatePassword = ({ newPassword }) => {

    const hashedPassword = bcrypt.hashSync(newPassword, bcrypt.genSaltSync(10));
    Services.updateUserById({ ...user, password: hashedPassword })
      .then((user) => {
        setUser(user);
        props.updateUser(user);

        toastr.success(
          translateMethod('user.password.updated.success', false, 'Your password has been successfully updated')
        );
      });

  };

  return (
    <UserBackOffice tab="Me" isLoading={!user}>
      <div className="col">
        <div className="">
          <ul className="nav nav-tabs flex-column flex-sm-row mb-3 mt-3">
            <li className="nav-item">
              <span
                className={`nav-link cursor-pointer ${tab === 'infos' ? 'active' : ''}`}
                onClick={() => setTab('infos')}>
                <Translation i18nkey="Informations">Informations</Translation>
              </span>
            </li>
            <li className="nav-item">
              <span
                className={`nav-link cursor-pointer ${tab === 'security' ? 'active' : ''}`}
                onClick={() => setTab('security')}>
                <Translation i18nkey="Security">AccountSecurity</Translation>
              </span>
            </li>
          </ul>
          {tab === 'infos' && <Form
            flow={formFlow}
            schema={formSchema}
            value={user}
            onChange={save}
            footer={({ valid }) => {
              return (
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <a className="btn btn-outline-primary" href="#" onClick={() => props.history.goBack()}>
                    <i className="fas fa-chevron-left mr-1" />
                    <Translation i18nkey="Back">Back</Translation>
                  </a>
                  <button
                    type="button"
                    className="btn btn-outline-danger"
                    style={{ marginLeft: 5 }}
                    onClick={removeUser}>
                    <i className="fas fa-trash mr-1" />
                    <Translation i18nkey="Delete my profile">Delete my profile</Translation>
                  </button>
                  <button
                    style={{ marginLeft: 5 }}
                    type="button"
                    className="btn btn-outline-success"
                    onClick={valid}>
                    <span>
                      <i className="fas fa-save mr-1" />
                      <Translation i18nkey="Save">Save</Translation>
                    </span>
                  </button>
                </div>
              );
            }}
          />}
          {tab === 'security' && (
            <div className='d-flex flex-row'>
              <div className='col-sm-6 d-flex flex-column flex-grow-1'>
                <h4>Change password</h4>
                <Form
                  schema={changePasswordSchema}
                  onChange={updatePassword}
                  footer={({ valid }) => {
                    return (
                      <div className='d-flex flex-row align-items-center'>
                        <button
                          style={{ marginLeft: 5 }}
                          type="button"
                          className="btn btn-outline-success"
                          onClick={valid}>
                          <span>
                            <i className="fas fa-save mr-1" />
                            <Translation i18nkey="update.password">Update password</Translation>
                          </span>
                        </button>
                        {/* FIXME: forgot password link */}
                      </div>
                    );
                  }}
                />
              </div>
              <div className='d-flex flex-column  flex-grow-1'>
                <h4>Two-factor authentication</h4>
                <TwoFactorAuthentication user={user} />
              </div>
            </div>
          )}
        </div>
      </div>
    </UserBackOffice>
  );
}

const mapStateToProps = (state) => ({
  ...state.context,
});

const mapDispatchToProps = {
  updateUser: (u) => updateUser(u),
};

export const MyProfile = connect(mapStateToProps, mapDispatchToProps)(MyProfileComponent);
