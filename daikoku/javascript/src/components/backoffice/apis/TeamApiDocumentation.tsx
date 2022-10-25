import { constraints, Flow, format, Schema, type } from '@maif/react-forms';
import { nanoid } from 'nanoid';
import { Children, useContext, useState } from 'react';
import { useQuery, useQueryClient } from 'react-query';
import { useSelector } from 'react-redux';
import { useDispatch } from 'react-redux';
import { toastr } from 'react-redux-toastr';
import { useParams } from 'react-router-dom';
import classNames from 'classnames';
import { DndContext, DragEndEvent, UniqueIdentifier, useDraggable, useDroppable } from '@dnd-kit/core';
import get from 'lodash/get'
import set from 'lodash/set'

import { I18nContext, openApiDocumentationSelectModal, openFormModal } from '../../../core';
import * as Services from '../../../services';
import { IApi, IDocPage, IDocTitle, isError, IState, ITeamSimple } from '../../../types';
import { AssetChooserByModal, MimeTypeFilter } from '../../frontend';
import { BeautifulTitle, Spinner } from '../../utils';
import { removeArrayIndex, moveArrayIndex } from '../../utils/array';
import { SortableTree } from '../../utils/dnd/SortableTree';
import { Wrapper } from '../../utils/dnd/Wrapper';
import { TreeItem, TreeItems } from '../../utils/dnd/types';

const mimeTypes = [
  { label: '.adoc Ascii doctor', value: 'text/asciidoc' },
  { label: '.avi	AVI : Audio Video Interleaved', value: 'video/x-msvideo' },
  // { label: '.doc	Microsoft Word', value: 'application/msword' },
  // {
  //   label: '.docx	Microsoft Word (OpenXML)',
  //   value: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // },
  { label: '.gif	fichier Graphics Interchange Format (GIF)', value: 'image/gif' },
  { label: '.html	fichier HyperText Markup Language (HTML)', value: 'text/html' },
  { label: '.jpg	image JPEG', value: 'image/jpeg' },
  { label: '.md	Markown file', value: 'text/markdown' },
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
  { label: '.js fichier javascript', value: 'text/javascript' },
  { label: '.css fichier css', value: 'text/css' },
];

const loremIpsum = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Phasellus gravida convallis leo et aliquet. Aenean venenatis, elit et dignissim scelerisque, urna dui mollis nunc, id eleifend velit sem et ante. Quisque pharetra sed tellus id finibus. In quis porta libero. Nunc egestas eros elementum lacinia blandit. Donec nisi lacus, tristique vel blandit in, sodales eget lacus. Phasellus ultrices magna vel odio vestibulum, a rhoncus nunc ornare. Sed laoreet finibus arcu vitae aliquam. Aliquam quis ex dui.';
const longLoremIpsum = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Phasellus gravida convallis leo et aliquet. Aenean venenatis, elit et dignissim scelerisque, urna dui mollis nunc, id eleifend velit sem et ante. Quisque pharetra sed tellus id finibus. In quis porta libero. Nunc egestas eros elementum lacinia blandit. Donec nisi lacus, tristique vel blandit in, sodales eget lacus. Phasellus ultrices magna vel odio vestibulum, a rhoncus nunc ornare. Sed laoreet finibus arcu vitae aliquam. Aliquam quis ex dui.

Cras ut ultrices quam. Nulla eu purus sed turpis consequat sodales. Aenean vitae efficitur velit, vel accumsan felis. Curabitur aliquam odio dictum urna convallis faucibus. Vivamus eu dignissim lorem. Donec sed hendrerit massa. Suspendisse volutpat, nisi at fringilla consequat, eros lacus aliquam metus, eu convallis nulla mauris quis lacus. Aliquam ultricies, mi eget feugiat vestibulum, enim nunc eleifend nisi, nec tincidunt turpis elit id diam. Nunc placerat accumsan tincidunt. Nulla ut interdum dui. Praesent venenatis cursus aliquet. Nunc pretium rutrum felis nec pharetra.

Vivamus sapien ligula, hendrerit a libero vitae, convallis maximus massa. Praesent ante leo, fermentum vitae libero finibus, blandit porttitor risus. Nulla ac hendrerit turpis. Sed varius velit at libero feugiat luctus. Nunc rhoncus sem dolor, nec euismod justo rhoncus vitae. Vivamus finibus nulla a purus vestibulum sagittis. Maecenas maximus orci at est lobortis, nec facilisis erat rhoncus. Sed tempus leo et est dictum lobortis. Vestibulum rhoncus, nisl ut porta sollicitudin, arcu urna egestas arcu, eget efficitur neque ipsum ut felis. Ut commodo purus quis turpis tempus tincidunt. Donec id hendrerit eros. Vestibulum vitae justo consectetur, egestas nisi ac, eleifend odio.

Donec id mi cursus, volutpat dolor sed, bibendum sapien. Etiam vitae mauris sit amet urna semper tempus vel non metus. Integer sed ligula diam. Aenean molestie ultrices libero eget suscipit. Phasellus maximus euismod eros ut scelerisque. Ut quis tempus metus. Sed mollis volutpat velit eget pellentesque. Integer hendrerit ultricies massa eu tincidunt. Quisque at cursus augue. Sed diam odio, molestie sed dictum eget, efficitur nec nulla. Nullam vulputate posuere nunc nec laoreet. Integer varius sed erat vitae cursus. Vivamus auctor augue enim, a fringilla mauris molestie eget.

Proin vehicula ligula vel enim euismod, sed congue mi egestas. Nullam varius ut felis eu fringilla. Quisque sodales tortor nec justo tristique, sit amet consequat mi tincidunt. Suspendisse porttitor laoreet velit, non gravida nibh cursus at. Pellentesque faucibus, tellus in dapibus viverra, dolor mi dignissim tortor, id convallis ipsum lorem id nisl. Sed id nisi felis. Aliquam in ullamcorper ipsum, vel consequat magna. Donec nec mollis lacus, a euismod elit.`;

function AssetButton(props: any) {
  const { translate } = useContext(I18nContext);

  return (
    <div className="mb-3 row">
      <label className="col-xs-12 col-sm-2 col-form-label" />
      <div
        className="col-sm-10"
        style={{ width: '100%', marginLeft: 0, display: 'flex', justifyContent: 'flex-end' }}
      >
        <AssetChooserByModal
          team={props.team}
          teamId={props.team._id}
          label={translate('Set from asset')}
          onSelect={(asset: any) => {
            props.onChange(asset.link);
            props.setValue('contentType', asset.contentType)
          }}
        />
      </div>
    </div>
  );
}

type TeamApiDocumentationProps = {
  team: ITeamSimple,
  api: IApi,
  versionId?: string,
  creationInProgress?: boolean,
  onChange: (value: IApi) => void,
  reloadState: () => void,
  saveApi: (value: IApi) => Promise<any>
}


export const TeamApiDocumentation = (props: TeamApiDocumentationProps) => {
  const { team, api, versionId } = props;

  const params = useParams();
  const { translate } = useContext(I18nContext);
  const dispatch = useDispatch();

  const currentTeam = useSelector<IState, ITeamSimple>(s => s.context.currentTeam)

  const queryClient = useQueryClient();
  const detailsQuery = useQuery(['details'], () => Services.getDocDetails(params.apiId!, versionId!));

  const flow: Flow = [
    'title',
    'level',
    'contentType',
    'remoteContentEnabled',
    'remoteContentUrl',
    'remoteContentHeaders',
    'content',
  ];

  const schema: Schema = {
    title: {
      type: type.string,
      label: translate('Page title'),
      constraints: [
        constraints.required(translate("constraints.required.name"))
      ]
    },
    level: {
      type: type.number,
      label: translate('Page level'),
      defaultValue: 0,
      props: {
        min: 0, step: 1
      },
    },
    content: {
      type: type.string,
      format: format.markdown,
      visible: ({
        rawValues
      }: any) => !rawValues.remoteContentEnabled,
      label: translate('Page content'),
      props: {
        height: '800px',
        team: team,
        actions: (insert: any) => {
          return <>
            <button
              type="button"
              className="btn-for-descriptionToolbar"
              aria-label={translate('Lorem Ipsum')}
              title={translate('Lorem Ipsum')}
              onClick={() => insert(loremIpsum)}
            >
              <i className={`fas fa-feather-alt`} />
            </button>
            <button
              type="button"
              className="btn-for-descriptionToolbar"
              aria-label={translate('Long Lorem Ipsum')}
              title={translate('Long Lorem Ipsum')}
              onClick={() => insert(longLoremIpsum)}
            >
              <i className={`fas fa-feather`} />
            </button>
            <BeautifulTitle
              placement="bottom"
              title={translate('image url from asset')}
            >
              <AssetChooserByModal
                typeFilter={MimeTypeFilter.image}
                onlyPreview
                tenantMode={false}
                team={team}
                teamId={team._id}
                icon="fas fa-file-image"
                classNames="btn-for-descriptionToolbar"
                onSelect={(asset: any) => insert(asset.link)}
                label={translate("Insert URL")}
              />
            </BeautifulTitle>
          </>;
        }
      }
    },
    remoteContentEnabled: {
      type: type.bool,
      label: translate('Remote content'),
    },
    contentType: {
      type: type.string,
      format: format.select,
      label: translate('Content type'),
      options: mimeTypes,
    },
    remoteContentUrl: {
      type: type.string,
      visible: ({
        rawValues
      }: any) => !!rawValues.remoteContentEnabled,
      label: translate('Content URL'),
      render: ({
        onChange,
        value,
        setValue
      }: any) => {
        return (
          <div className='flex-grow-1 ms-3'>
            <input className='mrf-input mb-3' value={value} onChange={onChange} />
            <div className="col-12 d-flex justify-content-end">
              <AssetButton onChange={onChange} team={team} value={value} setValue={setValue} />
            </div>
          </div>
        )
      }
    },
    remoteContentHeaders: {
      type: type.object,
      visible: ({
        rawValues
      }: any) => !!rawValues.remoteContentEnabled,
      label: translate('Content headers'),
    },
  };

  const updatePage = (selectedPage: IDocTitle) => {
    Services.getDocPage(api._id, selectedPage._id)
      .then((page) => {
        if (isError(page)) {
          toastr.error(translate('Error'), page.error);
        } else {
          dispatch(openFormModal({
            title: translate('doc.page.update.modal.title'),
            flow: flow,
            schema: schema,
            value: page,
            onSubmit: savePage,
            actionLabel: translate('Save')
          }))
        }
      });
  }

  const savePage = (page?: IDocPage) => {
    if (page) {
      return Services.saveDocPage(team._id, page)
        .then(() => {
          queryClient.invalidateQueries('details')
          toastr.success(translate('Success'), translate("doc.page.save.successfull"))
        });
    }
  }

  const movePage = (page: IDocTitle, move: number) => {
    if (detailsQuery.data) {
      const index = detailsQuery.data.pages.findIndex(id => id === page._id)
      if (index === 0 && move < 0) {
        toastr.error(translate('Error'), translate('doc.page.move.error'))
      } else if (index === detailsQuery.data.pages.length - 1 && move > 0) {
        toastr.error(translate('Error'), translate('doc.page.move.error'))
      } else {
        const pages = moveArrayIndex(detailsQuery.data.pages, index, index + move)

        const updatedApi = { ...api, documentation: { ...api.documentation, pages } }
        Services.saveTeamApi(
          currentTeam._id,
          updatedApi,
          updatedApi.currentVersion
        ).then(() => {
          toastr.success(translate('Success'), translate('doc.page.move.successfull'))
          queryClient.invalidateQueries('details')
        })
      }

    }
  }

  const moveLevel = (page: IDocTitle, move: number) => {
    if (detailsQuery.data) {
      const level = parseInt(page.level)

      if (level === 0 && move < 0) {
        toastr.error(translate('Error'), translate('doc.page.move.error'))
      } else {

        Services.getDocPage(props.api._id, page._id)
          .then((res) => {
            if (!isError(res)) {
              savePage({ ...res, level: res.level + move })
            }
          })
      }

    }
  }

  const moveUp = (page: IDocTitle) => {
    movePage(page, -1)
  }

  const moveDown = (page: IDocTitle) => {
    movePage(page, 1)
  }

  const moveRight = (page: IDocTitle) => {
    moveLevel(page, 1)
  }

  const moveLeft = (page: IDocTitle) => {
    moveLevel(page, -1)
  }

  const addNewPage = () => {
    Services.createDocPage(team._id, {
      _id: nanoid(32),
      _tenant: api._tenant,
      title: 'New page',
      level: 0,
      lastModificationAt: Date.now(),
      content: '# New page\n\nA new page',
    }).then((page) => {
      dispatch(openFormModal({
        title: translate('doc.page.create.modal.title'),
        flow: flow,
        schema: schema,
        value: page,
        onSubmit: saveNewPage,
        actionLabel: translate('Save')
      }))
    })
  };

  const saveNewPage = (page: IDocPage) => {
    if (detailsQuery.data) {
      const index = detailsQuery.data.pages.length
      const pages = [...detailsQuery.data.pages];
      pages.splice(index, 0, page._id);

      return Services.saveDocPage(team._id, page)
        .then(() => {
          const updatedApi = { ...api, documentation: { ...api.documentation, pages } }
          return Services.saveTeamApi(
            currentTeam._id,
            updatedApi,
            updatedApi.currentVersion
          )
        })
        .then(() => {
          toastr.success(translate('Success'), translate('doc.page.creation.successfull'))
          queryClient.invalidateQueries('details')
        })
    } else {
      toastr.error(translate('Error'), translate('doc.page.error.unknown'))
    }
  }

  const deletePage = (page: IDocTitle) => {
    if (detailsQuery.data) {
      (window
        .confirm(translate('delete.documentation.page.confirm'))) //@ts-ignore //FIXME: remove after fix typing monkey patch of window.confirm
        .then((ok: boolean) => {
          if (ok) {
            Services.deleteDocPage(team._id, page._id)
              .then(() => {
                const index = detailsQuery.data.pages.findIndex(id => id === page._id)
                const pages = removeArrayIndex(detailsQuery.data.pages, index)

                const updatedApi = { ...api, documentation: { ...api.documentation, pages } }
                return Services.saveTeamApi(
                  currentTeam._id,
                  updatedApi,
                  updatedApi.currentVersion
                )
              })
              .then(() => {
                toastr.success(translate('Success'), translate('doc.page.deletion.successfull'))
                queryClient.invalidateQueries('details')
              })
          }
        });
    } else {
      toastr.error(translate('Error'), translate('doc.page.error.unknown'))
    }

  }

  const importPage = () => {
    dispatch(openApiDocumentationSelectModal({
      api,
      teamId: team._id,
      onClose: () => {
        toastr.success(translate('Success'), translate('doc.page.import.successfull'))
        queryClient.invalidateQueries('details')
      },
    }));
  }

  if (api === null) {
    return null;
  } else if (detailsQuery.isLoading) {
    return <Spinner />
  } else if (detailsQuery.data) {
    return (
      <div className="row">
        <div className="col-12 col-sm-6 col-lg-3 p-1">
          <div className="d-flex flex-column">
            <div className="">
              <div className="d-flex justify-content-between align-items-center">
                <div className="btn-group">
                  <button onClick={addNewPage} type="button" className="btn btn-sm btn-outline-primary">
                    <i className="fas fa-plus" />
                  </button>
                  <button onClick={importPage} type="button" className="btn btn-sm btn-outline-primary">
                    <i className="fas fa-download" />
                  </button>
                </div>
              </div>
            </div>
            <div className='d-flex flex-column'>
              <TestDnD items={detailsQuery.data.titles} />
            </div>
          </div>
        </div>
      </div>
    );
  } else {
    return <div>Error while fetching doc details</div>
  }
};

const TestDnD = ({ items }: { items: Array<IDocTitle> }) => {
  type Result = {
    result: object,
    info: {
      previousItem?: IDocTitle,
      path?: string,
      groupPath: string
    }
  }

  //@ts-ignore
  const result: Result = items.reduce<Result>((acc, item) => {
    if (item.level === '0') {
      return ({
        info: {
          previousItem: item,
          path: item._id,
          groupPath: undefined,
        },
        result: { ...acc.result, [item._id]: { ...item, id: item.title } }
      })
    } else {
      const compare = item.level.localeCompare(acc.info.previousItem?.level || '0')
      if (compare === 1) {
        return ({
          info: {
            previousItem: item,
            path: `${acc.info.path}.${item._id}`,
            groupPath: acc.info.path,
          },
          result: set(acc.result, acc.info.path!, { ...get(acc.result, acc.info.path!), [item._id]: { ...item, id: item.title } })
        })
      } else if (compare === 0) {
        return ({
          info: {
            previousItem: item,
            path: `${acc.info.groupPath}.${item._id}`,
            groupPath: acc.info.groupPath,
          },
          result: set(acc.result, acc.info.groupPath, { ...get(acc.result, acc.info.groupPath), [item._id]: { ...item, id: item.title } })
        })
      } else {
        const offset = parseInt(acc.info.previousItem?.level || '0', 10) - parseInt(item.level, 10)
        const newPath = acc.info.groupPath.split('.').slice(0, acc.info.groupPath.split('.').length - offset).join('.')
        const newGroupPath = acc.info.groupPath.split('.').slice(0, acc.info.groupPath.split('.').length - offset - 1).join('.')

        return ({
          info: {
            previousItem: item,
            path: `${newPath}.${item._id}`,
            groupPath: newGroupPath,
          },
          result: set(acc.result, newPath, { ...get(acc.result, newPath), [item._id]: { ...item, id: item.title } })
        })
      }
    }
  }, { result: {}, info: { previousItem: undefined, path: undefined, groupPath: '' } })

  const isAnObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);


  const getValueWithChildren = (item: object) => {
    return Object.entries(item) //@ts-ignore
      .reduce((acc, curr) => {
        if (isAnObject(curr[1])) {
          return { ...acc, children: [...acc.children, getValueWithChildren(curr[1])] }
        } else {
          return { ...acc, [curr[0]]: curr[1] }
        }
      }, { children: [] })
  }


  const docs = Object.values(result.result)
    .map((value) => {
      return getValueWithChildren(value)
    })


  return (
    <Wrapper>
      <SortableTree collapsible indicator removable defaultItems={docs} handleUpdateItems={console.debug} handleRemoveItem={console.warn} />
    </Wrapper>
  )
}
