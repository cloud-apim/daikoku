import React, { useContext, useEffect, useState } from 'react';
import { SketchPicker } from 'react-color';
import { toastr } from 'react-redux-toastr';
import { I18nContext } from '../../../../core';

export function TeamApiIssueTags({ value, onChange }) {
  const [showTagForm, showNewTagForm] = useState(false);
  const [api, setApi] = useState(value);

  const { translateMethod } = useContext(I18nContext);

  function deleteTag(id) {
    setApi({
      ...api,
      issuesTags: [...api.issuesTags.filter((iss) => iss.id !== id)],
    });
  }

  return (
    <div style={{ paddingBottom: '250px' }}>
      {showTagForm ? (
        <NewTag
          issuesTags={api.issuesTags}
          handleCreate={(newTag) => {
            setApi({ ...api, issuesTags: [...api.issuesTags, newTag] });
            showNewTagForm(false);
          }}
          onCancel={() => showNewTagForm(false)}
        />
      ) : (
        <div className="mb-3 row">
          <label className="col-xs-12 col-sm-2">Actions</label>
          <div className="col-sm-10">
            <button className="btn btn-success" onClick={() => showNewTagForm(true)}>
              {translateMethod('issues.new_tag')}
            </button>
          </div>
        </div>
      )}
      <div className="mb-3 row pt-3">
        <label className="col-xs-12 col-sm-2">{translateMethod('issues.tags')}</label>
        <div className="col-sm-10">
          {api.issuesTags.map((issueTag, i) => (
            <div key={`issueTag${i}`} className="d-flex align-items-center mt-2">
              <span
                className="badge badge-primary d-flex align-items-center justify-content-center px-3 py-2"
                style={{
                  backgroundColor: issueTag.color,
                  color: '#fff',
                  borderRadius: '12px',
                }}>
                {issueTag.name}
              </span>
              <input
                type="text"
                className="form-control mx-3"
                value={issueTag.name}
                onChange={(e) =>
                  setApi({
                    ...api,
                    issuesTags: api.issuesTags.map((issue, j) => {
                      if (i === j) issue.name = e.target.value;
                      return issue;
                    }),
                  })
                }
              />
              <ColorTag
                className="pe-3"
                initialColor={issueTag.color}
                handleColorChange={(color) =>
                  setApi({
                    ...api,
                    issuesTags: api.issuesTags.map((issue, j) => {
                      if (i === j) issue.color = color;
                      return issue;
                    }),
                  })
                }
                presetColors={[]}
              />
              <div className="ml-auto">
                <button
                  className="btn btn-sm btn-outline-danger"
                  type="button"
                  onClick={() => deleteTag(issueTag.id)}>
                  {translateMethod('Delete')}
                </button>
              </div>
            </div>
          ))}
          {api.issuesTags.length === 0 && <p>{translateMethod('issues.no_tags')}</p>}
        </div>
      </div>
      <div className="mb-3 row">
        <label className="col-xs-12 col-sm-2" />
        <div className="col-sm-10 d-flex">
          <button className="btn btn-success ml-auto" onClick={() => onChange(api)}>
            {translateMethod('Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewTag({ issuesTags, handleCreate, onCancel }) {
  const [tag, setTag] = useState({ name: '', color: '#2980b9' });

  const { translateMethod } = useContext(I18nContext);

  function confirmTag() {
    if (tag.name.length <= 0) toastr.error('Tag name must be filled');
    else if (issuesTags.find((t) => t.name === tag.name)) toastr.error('Tag name already existing');
    else {
      handleCreate(tag);
      setTag({ name: '', color: '#2980b9' });
    }
  }

  return (
    <div className="mb-3 row">
      <label className="col-xs-12 col-sm-2">{translateMethod('issues.new_tag')}</label>
      <div className="col-sm-10">
        <div className="d-flex align-items-end">
          <div className="pe-3" style={{ flex: 0.5 }}>
            <label htmlFor="tag">{translateMethod('issues.tag_name')}</label>
            <input
              className="form-control"
              type="text"
              id="tag"
              value={tag.name}
              onChange={(e) => setTag({ ...tag, name: e.target.value })}
              placeholder={translateMethod('issues.tag_name')}
            />
          </div>
          <div className="px-3">
            <label htmlFor="color">{translateMethod('issues.tag_color')}</label>
            <ColorTag
              initialColor={tag.color || '#2980b9'}
              handleColorChange={(color) => setTag({ ...tag, color })}
              presetColors={[]}
            />
          </div>
          <div className="ml-auto">
            <button className="btn btn-outline-danger me-2" type="button" onClick={onCancel}>
              {translateMethod('Cancel')}
            </button>
            <button className="btn btn-outline-success" type="button" onClick={confirmTag}>
              {translateMethod('issues.create_tag')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ColorTag({ initialColor, handleColorChange, presetColors, className }) {
  const sketchColorToReadableColor = (c) => {
    if (c.r) {
      return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
    } else {
      return c;
    }
  };

  const [color, setColor] = useState(sketchColorToReadableColor(initialColor));
  const [displayColorPicker, setDisplayColorPicker] = useState(false);
  const [pickerValue, setPickerValue] = useState(null);

  const styles = {
    color: {
      width: '36px',
      height: '14px',
      borderRadius: '2px',
      background: `${color}`,
    },
    swatch: {
      padding: '5px',
      background: '#fff',
      borderRadius: '1px',
      boxShadow: '0 0 0 1px rgba(0,0,0,.1)',
      display: 'inline-block',
      cursor: 'pointer',
    },
    popover: {
      position: 'absolute',
      zIndex: '2',
    },
    cover: {
      position: 'fixed',
      top: '0px',
      right: '0px',
      bottom: '0px',
      left: '0px',
    },
  };

  useEffect(() => {
    if (pickerValue) {
      if (pickerValue.rgb.a === 1) {
        setColor(pickerValue.hex);
        handleColorChange(pickerValue.hex);
      } else {
        setColor(pickerValue.rgb);
        handleColorChange(pickerValue.rgb);
      }
    }
  }, [pickerValue]);

  return (
    <div className={className}>
      <div style={styles.swatch} onClick={() => setDisplayColorPicker(true)}>
        <div style={styles.color} />
      </div>
      {displayColorPicker ? (
        <div style={styles.popover}>
          <div style={styles.cover} onClick={() => setDisplayColorPicker(false)} />
          <SketchPicker
            presetColors={_.uniq(presetColors).sort()}
            color={color}
            onChange={(value) => setPickerValue(value)}
          />
        </div>
      ) : null}
    </div>
  );
}
