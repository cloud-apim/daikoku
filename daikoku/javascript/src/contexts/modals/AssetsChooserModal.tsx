import classNames from 'classnames';
import { useContext, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useDispatch } from 'react-redux';

import { I18nContext } from '../../core';
import * as Services from '../../services';
import { IAsset, ITeamSimple } from '../../types';
import { isError, ResponseError } from '../../types/api';
import { BeautifulTitle } from '../../components/utils';
import { IAssetSelectorModalProps, IBaseModalProps } from './types';
import { ModalContext } from '../modalContext';

export const MimeTypeFilter = {
  image: (value: string) => value.startsWith('image'),
  css: (value: string) => value.indexOf('css') > -1,
  javascript: (value: string) => value.indexOf('javascript') > -1,
  font: (value: string) => value.indexOf('font') > -1,
};

export const AssetSelectorModal = (props: IAssetSelectorModalProps & IBaseModalProps) => {
  const [selectedAsset, setSelectedAsset] = useState<IAsset>();
  const [search, setSearch] = useState<string>();

  const { translate, Translation } = useContext(I18nContext);

  const dispatch = useDispatch();

  const selectAssetAndCloseModal = () => {
    if (selectedAsset) {
      props.onSelect(selectedAsset);
      if (!props.noClose) {
        props.close();
      }
    }
  };

  const filteredAssets = props.assets.filter(
    (asset) => !search || asset.title.toLowerCase().includes(search)
  );

  return (<div className="modal-content">
    <div className="modal-header">
      <h5 className="modal-title">
        <Translation i18nkey="Select an asset">Select an asset</Translation>
      </h5>
      <button type="button" className="btn-close" aria-label="Close" onClick={props.close} />
    </div>
    <div className="modal-body">
      <div className="asset-selection-body">
        <input placeholder={translate('Find an assets')} className="form-control" onChange={(e) => setSearch(e.target.value)} />
        <div className={classNames({
          'asset-selection__container--column': !props.onlyPreview,
          'asset-selection__container--row': props.onlyPreview,
          tiles: props.onlyPreview,
        })}>
          {filteredAssets.map((asset, idx) => {
            if (props.onlyPreview) {
              return (<div className={classNames('tile', {
                selected: asset.value === selectedAsset?.value,
              })} key={idx}>
                <img onClick={() => setSelectedAsset(asset)} onDoubleClick={() => {
                  setSelectedAsset(asset);
                  selectAssetAndCloseModal();
                }} src={asset.contentType.includes('svg')
                  ? asset.link
                  : `/asset-thumbnails/${asset.value}`} alt={translate('Thumbnail')} />
              </div>);
            }
            return (<div key={idx} className={classNames('asset-selection', {
              selected: asset.value === selectedAsset?.value,
            })} onClick={() => setSelectedAsset(asset)}>
              <span className="ms-2">{asset.title}</span>
            </div>);
          })}
        </div>
      </div>

      <div className={classNames('asset__preview', { open: !!selectedAsset?.title })}>
        {selectedAsset?.title && (<div>
          <p>file: {selectedAsset.title}</p>
          {selectedAsset.desc && selectedAsset.desc !== 'undefined' && (<em>{selectedAsset.desc}</em>)}
        </div>)}
      </div>
    </div>
    <div className="modal-footer">
      <button type="button" className="btn btn-outline-danger" onClick={props.close}>
        <Translation i18nkey="Close">Close</Translation>
      </button>
      <button type="button" className="btn btn-outline-success" onClick={() => selectAssetAndCloseModal()}>
        <Translation i18nkey="Select">Select</Translation>
      </button>
    </div>
  </div>);
}

type AssetChooserProps = {
  team?: ITeamSimple,
  tenantMode?: boolean,
  typeFilter?: (value: string) => boolean,
  onlyPreview?: boolean,
  label: string,
  classNames?: string,
  onSelect: (asset: IAsset) => void,
  icon?: string
  noClose?: boolean
}

export const AssetChooserByModal = (props: AssetChooserProps) => {
  const { Translation } = useContext(I18nContext);
  const { openAssetSelectorModal } = useContext(ModalContext);

  const assetsRequest = useQuery({ queryKey: ['assets'], queryFn: () => getAssets(props.team) })


  const getTenantAssets = () => Services.listTenantAssets(props.team?._id)
    .then((response) => {
      if (isError(response)) {
        return [];
      } else {
        return response.map((asset) => ({
          label: asset.meta.filename + ' - ' + asset.meta.title,
          value: asset.meta.asset,
          filename: asset.meta.filename,
          title: asset.meta.title,
          desc: asset.meta.desc,
          contentType: asset.meta['content-type'],
          meta: asset.meta,
          link: `/tenant-assets/${asset.meta.asset}`
        }))
      }
    });

  const getTeamAssets = (team: ITeamSimple) => Services.listAssets(team._id)
    .then((response) => {
      if (isError(response)) {
        return [];
      } else {
        return response.map((asset) => ({
          label: asset.meta.filename + ' - ' + asset.meta.title,
          value: asset.meta.asset,
          filename: asset.meta.filename,
          title: asset.meta.title,
          desc: asset.meta.desc,
          contentType: asset.meta['content-type'],
          meta: asset.meta,
          link: `/team-assets/${team._id}/${asset.meta.asset}`
        }))
      }
    });

  const getAssets = (team?: ITeamSimple) => {
    let fetchAssets = (): Promise<Array<IAsset> | ResponseError> => new Promise((resolve) => resolve([]));
    if (props.tenantMode) {
      fetchAssets = () => getTenantAssets();
    } else if (!props.tenantMode && team?._id) {
      fetchAssets = () => getTeamAssets(team);
    }

    return fetchAssets()
  };

  if (assetsRequest.isLoading) {
    return (
      <button type="button" className="btn btn-outline-success ms-1" disabled>
        <Translation i18nkey="loading">loading...</Translation>
      </button>
    );
  } else if (assetsRequest.data && !isError(assetsRequest.data)) {
    const assets = assetsRequest.data
    return (
      <button
        type="button"
        className={props.classNames ? props.classNames : classNames('btn btn-access-negative ms-1', { disabled: !assets.length })}
        onClick={() => assets.length &&
          openAssetSelectorModal({
            assets,
            onSelect: (asset) => props.onSelect(asset),
            onlyPreview: !!props.onlyPreview,
            noClose: !!props.noClose
          })
        }
      >
        <i
          className={
            props.icon
              ? props.icon
              : classNames('fas me-1', {
                'fa-user-circle': !!props.onlyPreview,
                'fa-file': !props.onlyPreview,
              })
          }
        />{' '}
        {props.label}
      </button>
    );
  } else {
    return (<BeautifulTitle title={(assetsRequest.error ?? '') as string}>
      <button type="button" className="btn btn-outline-primary ms-1 cursor-help" disabled>
        <i className={classNames('fas', {
          'fa-user-circle me-1': !!props.onlyPreview,
          'fa-file me-1': !props.onlyPreview,
        })} />
        {props.label}
      </button>
    </BeautifulTitle>);
  }


}
