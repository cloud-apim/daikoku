/* eslint-disable react/jsx-no-target-blank */
import React, { useContext, useState } from 'react';
import * as Services from '../../../services';
import { UserBackOffice } from '../../backoffice';
import { connect } from 'react-redux';
import { Can, manage, daikoku } from '../../utils';
import { SwitchButton } from '../../inputs';
import { I18nContext } from '../../../locales/i18n-context';

export function ImportExportComponent(props) {
  const { translateMethod, Translation } = useContext(I18nContext);

  let input;

  const [state, setState] = useState({
    exportAuditTrail: true,
    uploading: false,
    migration: {
      processing: false,
      error: '',
      onSuccessMessage: '',
    },
  });

  const importState = () => {
    if (input) {
      input.click();
    }
  };

  const actuallyImportState = (e) => {
    const files = e.target.files;
    setState({ ...state, uploading: true });
    Services.uploadExportFile(files[0]).then(() => {
      setState({ ...state, uploading: false });
      window.location.reload();
    });
  };

  const migrate = () => {
    setState({
      ...state,
      migration: {
        processing: true,
        error: '',
        onSuccessMessage: '',
      },
    });
    Services.migrateMongoToPostgres().then((res) => {
      setState({
        ...state,
        migration: {
          processing: false,
          error: res.error || '',
          onSuccessMessage: res.error ? '' : res.message,
        },
      });
    });
  };

  const { processing, error, onSuccessMessage } = state.migration;
  return (
    <UserBackOffice tab="Import / Export">
      <Can I={manage} a={daikoku} dispatchError>
        <div className="row">
          <div className="col">
            <h1>
              <Translation i18nkey="Import / Export">Import / Export</Translation>
            </h1>
            <div className="section p-3">
              <a
                href={`/api/state/export?download=true&export-audit-trail=${!!state.exportAuditTrail}`}
                target="_blank"
                className="btn btn-outline-primary"
              >
                <i className="fas fa-download mr-1" />
                <Translation i18nkey="download state">download state</Translation>
              </a>
              <button
                type="button"
                style={{ marginLeft: 10 }}
                onClick={importState}
                className="btn btn-outline-primary"
              >
                <i className="fas fa-upload mr-1" />
                {state.uploading
                  ? translateMethod('importing ...')
                  : translateMethod('import state')}
              </button>
              <div className="d-flex justify-content-start">
                <SwitchButton
                  onSwitch={(enabled) => setState({ ...state, exportAuditTrail: enabled })}
                  checked={state.exportAuditTrail}
                  label={translateMethod('audittrail.export.label')}
                />
              </div>
              <input
                type="file"
                className="hide"
                ref={(r) => (input = r)}
                onChange={actuallyImportState}
              />
            </div>
            <h2 className="my-2">
              <Translation i18nkey="Mongo migration">Mongo migration</Translation>
            </h2>
            <div className="section p-3">
              <button type="button" onClick={migrate} className="btn btn-outline-primary">
                <i className="fas fa-database mr-1" />
                {processing
                  ? translateMethod('migration in progress ...')
                  : translateMethod('migrate database')}
              </button>
              {error.length > 0 && (
                <div className="alert alert-danger my-0 mt-3" role="alert">
                  {error}
                </div>
              )}
              {onSuccessMessage.length > 0 && (
                <div className="alert alert-success my-0 mt-3" role="alert">
                  {onSuccessMessage}
                </div>
              )}
            </div>
          </div>
        </div>
      </Can>
    </UserBackOffice>
  );
}

const mapStateToProps = (state) => ({
  ...state.context,
});

export const ImportExport = connect(mapStateToProps)(ImportExportComponent);
