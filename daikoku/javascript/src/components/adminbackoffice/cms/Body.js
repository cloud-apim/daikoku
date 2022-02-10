import { Form, type } from '@maif/react-forms';
import React, { useContext, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { I18nContext } from '../../../core';
import { ContentSideView } from './ContentSideView';
import DragAndDropWrapper from './DragAndDropWrapper';

export default React.forwardRef(({ contentType, setFinalValue, show, pages, inValue, publish }, ref) => {
    const { translateMethod } = useContext(I18nContext)
    const r = useRef()

    useEffect(() => {
        setValue({
            draft: inValue || `<DOCTYPE html>
        <html>
            <head></head>
            <body>
                <h1>${translateMethod('cms.create.default_draft_body')}</h1>
            </body>
        </html>`
        })
    }, [inValue])

    const [value, setValue] = useState({});

    useImperativeHandle(ref, () => ({
        handleSubmit() {
            r.current.handleSubmit()
        },
    }));

    const handleDrop = file => {
        const reader = new FileReader()
        reader.onload = async (e) => {
            const text = (e.target.result)
            setValue({ draft: text })
        };
        reader.readAsText(file)
    }

    const schema = {
        draft: {
            type: type.string,
            label: null,
            help: translateMethod('cms.create.draft_help'),
            render: formProps =>
                <DragAndDropWrapper handleDrop={handleDrop}>
                    <ContentSideView {...formProps} pages={pages} contentType={contentType}
                        publish={publish}
                    />
                </DragAndDropWrapper>
        }
    }

    const flow = ['draft']

    return (
        <div style={{
            display: show ? 'block' : 'none'
        }}>
            <Form
                schema={schema}
                value={value}
                flow={flow}
                onSubmit={body => {
                    setValue(body)
                    setFinalValue(body)
                }}
                ref={r}
                footer={() => null}
            />
        </div>
    )
})