/* eslint-disable react/display-name */
import React, { useState, useEffect, useContext, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { toastr } from 'react-redux-toastr';
import { constraints, format, type } from '@maif/react-forms';

import * as Services from '../../../services';
import { Table, TableRef } from '../../inputs';
import { Can, manage, asset, tenant as TENANT } from '../../utils';
import { I18nContext } from '../../../core';
import { ModalContext } from '../../../contexts';
import { createColumnHelper } from '@tanstack/react-table';
import { IAsset, IState, IStateContext } from '../../../types';


const mimeTypes = [
  { label: '.adoc Ascii doctor', value: 'text/asciidoc' },
  { label: '.avi	AVI : Audio Video Interleaved', value: 'video/x-msvideo' },
  { label: '.gif	fichier Graphics Interchange Format (GIF)', value: 'image/gif' },
  { label: '.jpg	image JPEG', value: 'image/jpeg' },
  { label: '.jpeg	image JPEG', value: 'image/jpeg' },
  { label: '.svg  image SVG', value: 'image/svg+xml' },
  { label: '.md	Markdown file', value: 'text/markdown' },
  { label: '.mpeg	vidéo MPEG', value: 'video/mpeg' },
  {
    label: '.odp OpenDocument presentation document ',
    value: 'application/vnd.oasis.opendocument.presentation',
  },
  {
    label: '.ods OpenDocument spreadsheet document ',
    value: 'application/vnd.oasis.opendocument.spreadsheet',
  },
  {
    label: '.odt OpenDocument text document ',
    value: 'application/vnd.oasis.opendocument.text',
  },
  { label: '.png	fichier Portable Network Graphics', value: 'image/png' },
  { label: '.pdf	Adobe Portable Document Format (PDF)', value: 'application/pdf' },
  { label: '.webm fichier vidéo WEBM', value: 'video/webm' },
  {
    label: '.html	fichier HyperText Markup Language (HTML)',
    value: 'text/html',
    tenantModeOnly: true,
  },
  { label: '.js fichier javascript', value: 'text/javascript', tenantModeOnly: true },
  { label: '.css fichier css', value: 'text/css', tenantModeOnly: true },
  { label: '.woff Web Open Font Format', value: 'application/font-woff', tenantModeOnly: true },
  { label: '.woff2 Web Open Font Format 2', value: 'application/font-woff', tenantModeOnly: true },
  {
    label: '.eot Embedded OpenType ',
    value: 'application/vnd.ms-fontobject',
    tenantModeOnly: true,
  },
];

const maybeCreateThumbnail = (id: any, file: any) => {
  return new Promise((s) => {
    if (
      file.type === 'image/gif' ||
      file.type === 'image/png' ||
      file.type === 'image/jpeg' ||
      file.type === 'image.jpg'
    ) {
      const reader = new FileReader();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      reader.onload = function (event) {
        var img = new Image();
        img.onload = function () {
          canvas.width = 128; //img.width;
          canvas.height = 128; //img.height;
          ctx?.drawImage(img, 0, 0, 128, 128);
          const base64 = canvas.toDataURL();
          canvas.toBlob((blob) => {
            Services.storeThumbnail(id, blob).then(() => {
              s(base64);
            });
          });
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    } else {
      s('data:image/png;base64,');
    }
  });
};

const ReplaceButton = (props: any) => {
  const [file, setFile] = useState<File>();
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  const { translate } = useContext(I18nContext);

  useEffect(() => {
    if (file) {
      maybeCreateThumbnail(props.asset.meta.asset, file)
        .then(() => {
          if (props.tenantMode) {
            Services.updateTenantAsset(props.asset.meta.asset, props.asset.contentType, file);
          } else {
            Services.updateAsset(
              props.teamId,
              props.asset.meta.asset,
              props.asset.contentType,
              file
            );
          }
        })
        .then(() => props.postAction());
    }
  }, [file]);

  const trigger = () => {
    if (input) {
      input.click();
    }
  };

  return (
    <>
      <button type="button" onClick={trigger} className="btn btn-sm btn-outline-primary">
        <i className="fas fa-retweet" />
      </button>
      <input
        ref={(r) => setInput(r)}
        type="file"
        multiple
        className="form-control hide"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (e.target.files && e.target.files.length > 1) {
            props.displayError(translate('error.replace.files.multi'));
          } else if (file && props.asset.contentType !== file.type) {
            props.displayError(translate('error.replace.files.content.type'));
          } else {
            setFile(file);
          }
        }}
      />
    </>
  );
};

export const AssetsList = ({
  tenantMode
}: { tenantMode: boolean }) => {
  const tableRef = useRef<TableRef>();
  const { currentTeam, tenant } = useSelector<IState, IStateContext>((state) => state.context);

  const { translate } = useContext(I18nContext);
  const { confirm, openFormModal } = useContext(ModalContext);

  useEffect(() => {
    document.title = `${tenantMode ? tenant.title : currentTeam.name} - ${translate({ key: 'Asset', plural: true })}`;
  }, []);

  const acceptableMimeTypes = mimeTypes
    .filter((mt) => (tenantMode ? true : !mt.tenantModeOnly))
  const schema = {
    filename: {
      type: type.string,
      label: translate('Asset filename'),
      constraints: [
        constraints.required(translate('constraints.required.name'))
      ]
    },
    title: {
      type: type.string,
      label: translate('Asset title'),
      constraints: [
        constraints.required(translate('constraints.required.title'))
      ]
    },
    description: {
      type: type.string,
      label: translate('Description')
    },
    contentType: {
      type: type.string,
      format: format.select,
      label: translate('Content-Type'),
      options: acceptableMimeTypes,
      constraints: [
        constraints.required(translate('constraints.file.type.required')),
        constraints.oneOf(acceptableMimeTypes.map(m => m.value), translate("constraints.file.type.forbidden"))
      ]
    },
    file: {
      type: type.file,
      label: translate('File'),
      onChange: ({
        value,
        setValue
      }: any) => {
        const file = value[0]
        setValue('filename', file.name)
        setValue('title', file.name.slice(0, file.name.lastIndexOf('.')))
        setValue('contentType', file.type)
      },
      constraints: [
        constraints.required(translate("constraints.required.file")),
        constraints.test('test.file.type',
          translate("constraints.file.type.forbidden"),
          (v) => acceptableMimeTypes.some(mimeType => mimeType.value === v[0].type))
      ]
    },
  };

  const columnHelper = createColumnHelper<IAsset>()
  const columns = [
    columnHelper.accessor(row => row.meta.filename || '--', {
      header: translate('Filename'),
      meta: { style: { textAlign: 'left' } },
    }),
    columnHelper.accessor(row => row.meta.title || '--', {
      header: translate('Title'),
      meta: { style: { textAlign: 'left' } },
    }),
    columnHelper.accessor(row => row.meta.desc || '--', {
      header: translate('Description'),
      meta: { style: { textAlign: 'left' } },
    }),
    columnHelper.display({
      header: translate('Thumbnail'),
      meta: { style: { textAlign: 'left' } },
      enableSorting: false,
      enableColumnFilter: false,
      cell: (info) => {
        const item = info.row.original;
        const type = item.meta['content-type'];
        if (
          type === 'image/gif' ||
          type === 'image/png' ||
          type === 'image/jpeg' ||
          type === 'image.jpg' ||
          type === 'image/svg+xml'
        ) {
          return (
            <img
              src={`/asset-thumbnails/${item.meta.asset}?${new Date().getTime()}`}
              width="64"
              height="64"
              alt="thumbnail"
            />
          );
        }
        {
          return null;
        }
      },
    }),
    columnHelper.accessor(row => row.contentType || '--', {
      header: translate('Content-Type'),
      meta: { style: { textAlign: 'left' } },
    }),
    columnHelper.display({
      header: translate('Actions'),
      meta: { style: { textAlign: 'center', width: '180px' } },
      enableSorting: false,
      enableColumnFilter: false,
      cell: (info) => {
        const item = info.row.original;
        return (
          <div className="btn-group">
            {item.contentType.startsWith('text') && (
              <button
                type="button"
                onClick={() => readAndUpdate(item)}
                className="btn btn-sm btn-outline-primary"
              >
                <i className="fas fa-pen" />
              </button>
            )}
            <ReplaceButton
              asset={item}
              tenantMode={tenantMode}
              teamId={currentTeam ? currentTeam._id : undefined}
              displayError={(error) => toastr.error(translate('Error'), error)}
              postAction={() => tableRef.current?.update()}
            />
            <a href={assetLink(item.meta.asset, false)} target="_blank" rel="noreferrer noopener">
              <button
                className="btn btn-sm btn-outline-primary"
                style={{ borderRadius: '0px', marginLeft: '0.15rem' }}
              >
                <i className="fas fa-eye" />
              </button>
            </a>
            <a href={assetLink(item.meta.asset, true)} target="_blank" rel="noreferrer noopener">
              <button
                className="btn btn-sm btn-outline-primary me-1"
                style={{ borderRadius: '0px', marginLeft: '0.15rem' }}
              >
                <i className="fas fa-download" />
              </button>
            </a>
            <button
              type="button"
              onClick={() => deleteAsset(item)}
              className="btn btn-sm btn-outline-danger"
            >
              <i className="fas fa-trash" />
            </button>
          </div>
        );
      },
    }),
  ];

  const readAndUpdate = (asset: IAsset) => {
    let link;
    if (tenantMode) {
      link = `/tenant-assets/${asset.meta.asset}?download=true`;
    } else {
      link = `/api/teams/${currentTeam._id}/assets/${asset.meta.asset}?download=true`;
    }

    fetch(link, {
      method: 'GET',
      credentials: 'include',
    })
      .then((response) => response.text())
      .then((content) =>
        openFormModal({
          title: translate('asset.update'),
          schema: {
            content: {
              type: type.string,
              format: format.markdown,
              label: null,
            }
          },
          onSubmit: (data) => {
            const textFileAsBlob = new Blob([data.content], { type: 'text/plain' });
            const file = new File([textFileAsBlob], asset.filename);

            if (tenantMode) {
              Services.updateTenantAsset(asset.meta.asset, asset.contentType, file)
                .then((r) => {
                  if (r.error) {
                    toastr.error(translate('Error'), r.error)
                  } else {
                    toastr.success(translate('Success'), translate('asset.update.successful'))
                  }
                });
            } else {
              Services.updateAsset(currentTeam._id, asset.meta.asset, asset.contentType, file)
                .then((r) => {
                  if (r.error) {
                    toastr.error(translate('Error'), r.error)
                  } else {
                    toastr.success(translate('Success'), translate('asset.update.successful'))
                  }
                })
            }
          },
          value: { content },
          actionLabel: translate('Update')
        })
      );
  };

  const assetLink = (asset: string, download = true) => {
    if (tenantMode) {
      return `/tenant-assets/${asset}?download=${download}`;
    } else {
      return `/api/teams/${currentTeam._id}/assets/${asset}?download=${download}`;
    }
  };

  const serviceDelete = (asset: string) => {
    if (tenantMode) {
      return Services.deleteTenantAsset(asset);
    } else {
      return Services.deleteAsset(currentTeam._id, asset);
    }
  };

  const deleteAsset = (asset: IAsset) => {
    confirm({ message: translate('delete asset'), okLabel: translate('Yes') })
      .then((ok) => {
        if (ok) {
          serviceDelete(asset.meta.asset)
            .then(() => tableRef.current?.update());
        }
      });
  };

  const fetchAssets = () => {
    let getAssets;
    if (tenantMode) {
      getAssets = Services.listTenantAssets();
    } else {
      getAssets = Services.listAssets(currentTeam._id);
    }
    return getAssets
  };

  const addAsset = (asset: any) => {
    const file = asset.file[0];
    if (tenantMode) {
      return Services.storeTenantAsset(
        asset.filename,
        asset.title,
        asset.description || '--',
        asset.contentType,
        file
      )
        .then((r) => maybeCreateThumbnail(r.id, file))
        .then(() => tableRef.current?.update())
    } else {
      return Services.storeAsset(
        currentTeam._id,
        asset.filename,
        asset.title,
        asset.description || '--',
        asset.contentType,
        file
      )
        .then((asset) => maybeCreateThumbnail(asset.id, file))
        .then(() => tableRef.current?.update())
    }
  }

  return (
    <Can I={manage} a={tenantMode ? TENANT : asset} team={currentTeam} dispatchError>
      <div className="row">
        <div className="col-12 mb-3 d-flex justify-content-end">
          <button
            className='btn btn-outline-success'
            onClick={() => openFormModal({
              title: translate("Add asset"),
              schema,
              onSubmit: addAsset,
              actionLabel: translate('Add asset')
            })}>

            {translate("Add asset")}
          </button>
        </div>
      </div>
      <div className="row">
        <div className="col">
          <Table
            columns={columns}
            fetchItems={() => fetchAssets()}
            ref={tableRef}
          />
        </div>
      </div>
    </Can>
  );
};
