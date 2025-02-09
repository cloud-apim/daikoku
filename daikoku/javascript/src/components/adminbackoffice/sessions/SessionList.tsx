import React, { useContext, useRef } from 'react';
import { useSelector } from 'react-redux';
import moment from 'moment';

import * as Services from '../../../services';

import { Table, TableRef } from '../../inputs';
import { Can, manage, daikoku } from '../../utils';
import { I18nContext } from '../../../contexts/i18n-context';
import { ModalContext, useDaikokuBackOffice } from '../../../contexts';
import { ISession, IState, IUserSimple } from '../../../types';
import { createColumnHelper } from '@tanstack/react-table';

export const SessionList = () => {
  const connectedUser = useSelector<IState, IUserSimple>((s) => s.context.connectedUser);
  useDaikokuBackOffice();

  const { translate, Translation } = useContext(I18nContext);
  const { confirm } = useContext(ModalContext);

  const tableRef = useRef<TableRef>()

  const columnHelper = createColumnHelper<ISession>();
  const columns = [
    columnHelper.accessor(row => `${row.userName} - ${row.userEmail}`, {
      header: translate('User'),
      meta: { style: { textAlign: 'left' } },
    }),
    columnHelper.accessor(row => (row.impersonatorId ? `${row.impersonatorName} - ${row.impersonatorEmail}` : ''), {
      header: translate('Impersonator'),
      meta: { style: { textAlign: 'left' } },
    }),
    columnHelper.accessor(row => moment(row.created).format('YYYY-MM-DD HH:mm:ss.SSS'), {
      header: translate('Created at'),
      meta: { style: { textAlign: 'left' } },
    }),
    columnHelper.accessor(row => moment(row.expires).format('YYYY-MM-DD HH:mm:ss.SSS'), {
      header: translate('Expires'),
      meta: { style: { textAlign: 'left' } },
    }),
    columnHelper.display({
      header: translate('Actions'),
      meta: { style: { textAlign: 'center', width: '120px' } },
      enableColumnFilter: false,
      enableSorting: false,
      cell: (info) => {
        const session = info.row.original;
        return (
          <div className="btn-group">
            <button
              type="button"
              className="btn btn-sm btn-outline-danger"
              title="Delete this session"
              onClick={() => deleteSession(session)}
            >
              <i className="fas fa-trash" />
            </button>
          </div>
        );
      },
    }),
  ];

  const deleteSession = (session: ISession) => {
    (confirm({ message: translate('destroy.session.confirm') }))
      .then((ok) => {
        if (ok) {
          Services.deleteSession(session._id)
            .then(() => {
              if (tableRef.current) {
                tableRef.current.update();
                if (connectedUser._id === session.userId) {
                  window.location.reload();
                }
              }
            });
        }
      });
  };

  const deleteSessions = () => {
    (confirm({ message: translate('destroy.all.sessions.confirm') }))
      .then((ok) => {
        if (ok) {
          Services.deleteSessions().then(() => {
            if (tableRef.current) {
              tableRef.current.update();
              window.location.reload();
            }
          });
        }
      });
  };

  return (
    <Can I={manage} a={daikoku} dispatchError>
      <div className="row">
        <div className="col">
          <h1>
            <Translation i18nkey="User sessions">User sessions</Translation>
          </h1>
          <div className="section p-2">
            <Table
              columns={columns}
              fetchItems={() => Services.getSessions()}
              ref={tableRef}
              injectTopBar={() => (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger"
                  title="Delete all session"
                  style={{ marginLeft: 10 }}
                  onClick={() => deleteSessions()}
                >
                  <i className="fas fa-trash me-1" />
                  <Translation i18nkey="Delete all sessions">Delete all sessions</Translation>
                </button>
              )}
            />
          </div>
        </div>
      </div>
    </Can>
  );
};
