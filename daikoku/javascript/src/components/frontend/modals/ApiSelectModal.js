import Select from 'react-select';
import React, { useContext, useEffect, useState } from 'react';
import * as Services from '../../../services';
import { I18nContext } from '../../../core';

export const ApiSelectModal = ({ closeModal, teamId, api, onClose }) => {
  const [apis, setApis] = useState([]);
  const [plan, setPlan] = useState();

  const { translateMethod } = useContext(I18nContext);

  useEffect(() => {
    Services.getAllPlanOfApi(teamId, api._humanReadableId, api.currentVersion).then((apis) => {
      setApis(
        apis.flatMap((api) =>
          api.possibleUsagePlans.reduce((a, plan) => {
            const value = { apiId: api._id, version: api.currentVersion, planId: plan._id };
            const groupName = `${api._humanReadableId}/${api.currentVersion}`;
            const optGroup = a.find((grp) => grp.label === groupName);
            if (!optGroup)
              return [
                ...a,
                {
                  options: [{ label: plan.customName || plan.type, value }],
                  label: groupName,
                },
              ];

            return a.map((group) => {
              if (group.label === groupName)
                group.options.push({ label: plan.customName || plan.type, value });

              return group;
            });
          }, [])
        )
      );
    });
  }, []);

  function clonePlan() {
    Services.cloneApiPlan(teamId, api._id, plan.value.apiId, plan.value.planId)
      .then(() => onClose())
      .then(() => closeModal());
  }

  return (
    <div className="modal-content">
      <div className="modal-header">
        <h5 className="modal-title">{translateMethod('api_select_modal.title')}</h5>
        <button type="button" className="btn-close" aria-label="Close" onClick={closeModal}>
          <span aria-hidden="true">&times;</span>
        </button>
      </div>
      <div className="modal-body">
        <Select
          placeholder={translateMethod('Search')}
          options={apis}
          onChange={setPlan}
          classNamePrefix="reactSelect"
        />
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-outline-danger" onClick={closeModal}>
          {translateMethod('Close', 'Close')}
        </button>
        <button type="button" className="btn btn-outline-success" onClick={clonePlan}>
          {translateMethod('Choose', 'Close')}
        </button>
      </div>
    </div>
  );
};
