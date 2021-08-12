import React, { useContext } from 'react';
import { Link } from 'react-router-dom';
import { connect } from 'react-redux';
import { v4 as uuid } from 'uuid';
import faker from 'faker';

import * as Services from '../../../services';
import { Table } from '../../inputs';
import { UserBackOffice } from '../../backoffice';
import { Can, manage, tenant } from '../../utils';
import { Translation } from '../../../locales';
import { toastr } from 'react-redux-toastr';
import { I18nContext } from '../../../core/i18n-context';

export function TenantOtoroshisComponent(props) {
  const { translateMethod } = useContext(I18nContext);

  let table;

  const columns = [
    {
      Header: translateMethod('Url'),
      style: { textAlign: 'left' },
      accessor: (item) => item.url,
    },
    {
      Header: translateMethod('Host'),
      style: { textAlign: 'left' },
      accessor: (item) => item.host,
    },
    {
      Header: translateMethod('Actions'),
      style: { textAlign: 'center' },
      disableSortBy: true,
      disableFilters: true,
      accessor: (item) => item._id,
      Cell: ({
        cell: {
          row: { original },
        },
      }) => {
        const otoroshi = original;
        return (
          <div className="btn-group">
            {isTenantAdmin() && (
              <Link to={`/settings/otoroshis/${otoroshi._id}`}>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary"
                  title={translateMethod('Edit this settings')}>
                  <i className="fas fa-edit" />
                </button>
              </Link>
            )}
            {isTenantAdmin() && (
              <button
                type="button"
                className="btn btn-sm btn-outline-danger"
                title={translateMethod('Delete this settings')}
                onClick={() => onDelete(otoroshi._id)}>
                <i className="fas fa-trash" />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const isTenantAdmin = () => {
    if (props.connectedUser.isDaikokuAdmin) {
      return true;
    }
    return props.tenant.admins.indexOf(props.connectedUser._id) > -1;
  };

  const onDelete = (id) => {
    window
      .confirm(
        t(
          'otoroshi.settings.delete.confirm',
          false,
          'Are you sure you want to delete those otoroshi settings ?'
        )
      )
      .then((ok) => {
        if (ok) {
          Services.deleteOtoroshiSettings(props.tenant._id, id).then(() => {
            toastr.success(
              t(
                'otoroshi.settings.deleted.success',
                false,
                'Otoroshi settings successfuly deleted'
              )
            );
            table.update();
          });
        }
      });
  };

  const createNewSettings = () => {
    const settings = {
      _id: uuid(),
      url: 'https://otoroshi-api.foo.bar',
      host: 'otoroshi-api.foo.bar',
      clientId: faker.random.alphaNumeric(16),
      clientSecret: faker.random.alphaNumeric(64),
    };
    props.history.push(`/settings/otoroshis/${settings._id}`, { newSettings: settings });
  };

  return (
    <UserBackOffice tab="Otoroshi">
      <Can I={manage} a={tenant} dispatchError>
        <div className="row">
          <div className="col">
            <h1>
              <Translation i18nkey="Otoroshi settings">
                Otoroshi settings
              </Translation>
              <a
                className="btn btn-sm btn-access-negative mb-1 ml-1"
                title={translateMethod('Create new settings')}
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  createNewSettings();
                }}>
                <i className="fas fa-plus-circle" />
              </a>
            </h1>
            <div className="section p-2">
              <Table
                currentLanguage={props.currentLanguage}
                selfUrl="otoroshis"
                defaultTitle="Otoroshi instances"
                defaultValue={() => ({})}
                defaultSort="Url"
                itemName="otoroshi"
                columns={columns}
                fetchItems={() => Services.allOtoroshis(props.tenant._id)}
                showActions={false}
                showLink={false}
                extractKey={(item) => item._id}
                injectTable={(t) => (table = t)}
              />
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

export const TenantOtoroshis = connect(mapStateToProps)(TenantOtoroshisComponent);
