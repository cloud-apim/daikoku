import React, { useContext, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import moment from 'moment'
import { SelectInput } from '@maif/react-forms/lib/inputs'
import { constraints, Form, type } from '@maif/react-forms'
import { I18nContext } from '../../../core'

export default React.memo(
    React.forwardRef(({ setFinalValue, updatePage, setContentType, pages, inValue, savePath }, ref) => {
        const { translateMethod } = useContext(I18nContext)
        const params = useParams()
        const navigate = useNavigate()

        const r = useRef()

        useEffect(() => {
            setValue(inValue || {
                name: '',
                path: '',
                contentType: 'text/html',
                visible: true,
                authenticated: false,
                metadata: {},
                tags: []
            })
        }, [inValue])

        const schema = {
            lastPublishedDate: {
                type: type.string,
                constraints: [
                    constraints.nullable()
                ]
            },
            body: {
                type: type.string,
                constraints: [
                    constraints.nullable()
                ]
            },
            name: {
                type: type.string,
                placeholder: translateMethod('cms.create.name_placeholder'),
                label: translateMethod('Name'),
                constraints: [
                    constraints.required()
                ]
            },
            path: {
                type: type.string,
                placeholder: '/index',
                help: translateMethod('cms.create.path_placeholder'),
                label: translateMethod('Path'),
                constraints: [
                    constraints.matches("^/", translateMethod('cms.create.path_slash_constraints')),
                    constraints.test(
                        'path',
                        translateMethod('cms.create.path_paths_constraints'),
                        value => value === savePath ? true : !pages.find(p => p.path === value)
                    )
                ]
            },
            contentType: {
                type: type.string,
                label: translateMethod('Content type'),
                render: ({ rawValues, value, onChange, error }) => <SelectInput
                    value={value}
                    possibleValues={[
                        { label: 'HTML document', value: 'text/html' },
                        { label: 'CSS stylesheet', value: 'text/css' },
                        { label: 'Javascript script', value: 'text/javascript' },
                        { label: 'Markdown document', value: 'text/markdown' },
                        { label: 'Text plain', value: 'text/plain' },
                        { label: 'XML content', value: 'text/xml' },
                        { label: 'JSON content', value: 'application/json' }
                    ]}
                    onChange={contentType => {
                        setContentType(contentType)
                        onChange(contentType)
                    }}
                />
            },
            visible: {
                type: type.bool,
                label: translateMethod('Visible'),
                help: translateMethod('cms.create.visible_label')
            },
            authenticated: {
                type: type.bool,
                label: translateMethod('cms.create.authenticated'),
                help: translateMethod('cms.create.authenticated_help')
            },

            // metadata: {
            //     type: type.object,
            //     array: true,
            //     label: 'Metadata',
            //     help: translateMethod('cms.create.metadata_help')
            // },
            // tags: {
            //     type: type.string,
            //     format: format.select,
            //     createOption: true,
            //     isMulti: true,
            //     label: 'Tags',
            //     help: translateMethod('cms.create.tags_help')
            // }
        }

        const flow = [
            'name',
            'path',
            'contentType',
            'visible',
            'authenticated',
            // {
            //     label: translateMethod('cms.create.advanced'),
            //     flow: ['tags', 'metadata'],
            //     collapsed: true
            // }
        ]

        const [value, setValue] = useState({})

        useImperativeHandle(ref, () => ({
            handleSubmit() {
                r.current.handleSubmit()
            },
        }));

        return (
            <>
                <button
                    id="toggle-sidebar"
                    type="button"
                    className="navbar-toggle btn btn-sm btn-access-negative float-left me-2"
                    data-toggle="collapse"
                    data-target="#sidebar"
                    aria-expanded="false"
                    aria-controls="sidebar"
                >
                    <span className="sr-only">Toggle sidebar</span>
                    <span className="chevron" />
                </button>
                <nav className="col-md-3 d-md-block sidebar collapse" id="sidebar">
                    <div className="sidebar-sticky" style={{
                        display: 'flex',
                        flexDirection: 'column'
                    }}>
                        <h6 className="sidebar-heading d-flex justify-content-between align-items-center px-3 mt-4 mb-1 text-muted">
                            {params.id ? translateMethod('cms.create.edited_page') : translateMethod('cms.create.new_page')}
                        </h6>
                        <ul className="nav flex-column mb-2 px-3">
                            <li className="nav-item">
                                <Form
                                    schema={schema}
                                    value={value}
                                    flow={flow}
                                    onSubmit={v => {
                                        setValue(v)
                                        setFinalValue(v)
                                    }}
                                    ref={r}
                                    footer={() => null}
                                />
                            </li>
                        </ul>
                        <div className="px-2 mb-4 mt-auto">
                            {value.lastPublishedDate && <div>
                                <span>{translateMethod('cms.create.last_update')}</span>
                                <span>{value.lastPublishedDate && moment(value.lastPublishedDate).format('DD/MM/yy kk:mm')}</span>
                            </div>}
                            <div className='d-flex mt-3'>
                                <button className="btn btn-sm btn-primary me-1" style={{ flex: 1 }} type="button"
                                    onClick={() => navigate('/settings/pages', { state: { reload: true } })}>
                                    {translateMethod('cms.create.back_to_pages')}
                                </button>
                                <button className="btn btn-sm btn-success" style={{ flex: 1 }} type="button"
                                    onClick={updatePage}>
                                    {params.id ? translateMethod('cms.create.save_modifications') : translateMethod('cms.create.create_page')}
                                </button>
                            </div>
                        </div>
                    </div>
                </nav>
            </>
        )
    }),
    (prevProps, nextProps) => JSON.stringify(prevProps.inValue) === JSON.stringify(nextProps.inValue) && prevProps.savePath === nextProps.savePath
)