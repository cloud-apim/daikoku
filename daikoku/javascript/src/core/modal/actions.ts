import { TeamSelectorModalProps } from '../../components';
import { CLOSE_MODAL, OPEN_MODAL } from './';

export const openCreationTeamModal = (modalProps: any) => (dispatch: any) => {
  return dispatch({
    type: OPEN_MODAL,
    modalProps,
    modalType: 'teamCreation',
  });
};

export const openTeamSelectorModal = (modalProps: TeamSelectorModalProps) => {
  return {
    type: OPEN_MODAL,
    modalProps,
    modalType: 'teamSelector',
  };
};

export const openAssetSelectorModal = (modalProps: any) => (dispatch: any) => {
  return dispatch({
    type: OPEN_MODAL,
    modalProps,
    modalType: 'assetSelector',
  });
};

export const openSaveOrCancelModal = (modalProps: any) => {
  return {
    type: OPEN_MODAL,
    modalProps,
    modalType: 'saveOrCancelModal',
  };
};

export const openLoginOrRegisterModal = (modalProps: any) => (dispatch: any) => {
  return dispatch({
    type: OPEN_MODAL,
    modalProps,
    modalType: 'loginOrRegisterModal',
  });
};

export const openSubMetadataModal = (modalProps: any) => ({
  type: OPEN_MODAL,
  modalProps,
  modalType: 'subscriptionMetadataModal',
});

export const openContactModal = (name = undefined, email = undefined, tenant: any, team = undefined, api = undefined) =>
  (dispatch: any) => {
    return dispatch({
      type: OPEN_MODAL,
      modalProps: { name, email, tenant, team, api },
      modalType: 'contactModal',
    });
  };

export const openTestingApiKeyModal = (modalProps: any) => ({
  type: OPEN_MODAL,
  modalProps,
  modalType: 'testingApiKey',
});

export const openInvitationTeamModal = (modalProps: any) => (dispatch: any) => dispatch({
  type: OPEN_MODAL,
  modalProps,
  modalType: 'teamInvitation',
});

export const openJoinTeamModal = (modalProps: any) => (dispatch: any) => dispatch({
  type: OPEN_MODAL,
  modalProps,
  modalType: 'joinTeamInvitation',
});

export const openApiKeySelectModal = (modalProps: any) => (dispatch: any) => dispatch({
  type: OPEN_MODAL,
  modalProps,
  modalType: 'apiKeySelectModal',
});

export const openApiSelectModal = (modalProps: any) => ({
  type: OPEN_MODAL,
  modalProps,
  modalType: 'apiSelectModal',
});

export const openApiDocumentationSelectModal = (modalProps: any) => ({
  type: OPEN_MODAL,
  modalProps,
  modalType: 'apiDocumentationSelectModal',
});

export const openFormModal = (modalProps: any) => ({
  type: OPEN_MODAL,
  modalProps,
  modalType: 'formModal'
});

export const closeModal = () => ({
    type: CLOSE_MODAL,
});
