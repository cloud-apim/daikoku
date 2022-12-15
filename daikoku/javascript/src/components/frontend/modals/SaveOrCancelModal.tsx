import React, { useContext } from 'react';
import { I18nContext } from '../../../core';

type Props = {
  closeModal: (...args: any[]) => any;
  dontsave: (...args: any[]) => any;
  save: (...args: any[]) => any;
  message?: string;
  title?: string;
};

export const SaverOrCancelModal = (props: Props) => {
  const { translate } = useContext(I18nContext);

  const actionAndClose = (action: (() => void | Promise<void>)) => {
    const res = action()
    if (res instanceof Promise) {
      res.then(() => props.closeModal());
    } else {
      props.closeModal();
    }
  };

  return (
    <div className="modal-content">
      <div className="modal-header">
        <h5 className="modal-title">{props.title}</h5>
        <button type="button" className="btn-close" aria-label="Close" onClick={props.closeModal} />
      </div>
      <div className="modal-body">
        <div className="modal-description">{props.message}</div>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-outline-danger" onClick={() => props.closeModal()}>
          {translate('Cancel')}
        </button>
        <button
          type="button"
          className="btn btn-outline-danger"
          onClick={() => actionAndClose(props.dontsave)}
        >
          {translate("Don't save")}
        </button>
        <button
          type="button"
          className="btn btn-outline-success"
          onClick={() => actionAndClose(props.save)}
        >
          {translate('Save')}
        </button>
      </div>
    </div>
  );
};
