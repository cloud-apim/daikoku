import React, { Component } from 'react';
import { Help } from './Help';

export class ObjectInput extends Component {
  changeValue = (e: any, name: any) => {
    if (e && e.preventDefault) e.preventDefault();
    const newValues = { ...(this.props as any).value, [name]: e.target.value };
    (this.props as any).onChange(newValues);
  };

  changeKey = (e: any, oldName: any) => {
    if (e && e.preventDefault) e.preventDefault();
    const newValues = { ...(this.props as any).value };
    const oldValue = newValues[oldName];
    delete newValues[oldName];
    newValues[e.target.value] = oldValue;
    (this.props as any).onChange(newValues);
  };

  addFirst = (e: any) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!(this.props as any).value || Object.keys((this.props as any).value).length === 0) {
      (this.props as any).onChange((this.props as any).defaultValue || { '': '' });
    }
  };

  addNext = (e: any) => {
    if (e && e.preventDefault) e.preventDefault();
    const newItem = (this.props as any).defaultValue || { '': '' };
    const newValues = { ...(this.props as any).value, ...newItem };
    (this.props as any).onChange(newValues);
  };

  remove = (e: any, name: any) => {
    if (e && e.preventDefault) e.preventDefault();
    const newValues = { ...(this.props as any).value };
    delete newValues[name];
    (this.props as any).onChange(newValues);
  };

  render() {
    const values = Object.keys((this.props as any).value || {}).map((k) => [k, (this.props as any).value[k]]);
        return (<div>
                {values.length === 0 && (<div className="mb-3 row align-items-center">
                        <label htmlFor={`input-${(this.props as any).label}`} className="col-xs-12 col-sm-2 col-form-label">
                            <Help text={(this.props as any).help} label={(this.props as any).label}/>
            </label>
                        <div className="col-sm-10">
                            <button disabled={(this.props as any).disabled} type="button" className="btn btn-outline-primary" onClick={this.addFirst}>
                                <i className="fas fa-plus"/>{' '}
              </button>
            </div>
          </div>)}
                {values.map((value, idx) => (<div key={`form-group-${idx}`} className="row mb-2 align-items-center">
                        {idx === 0 && (this.props as any).label && (<label className="col-xs-12 col-sm-2 col-form-label">
                                <Help text={(this.props as any).help} label={(this.props as any).label}/>
              </label>)}
                        {idx > 0 && (this.props as any).label && (<label className="col-xs-12 col-sm-2 col-form-label">&nbsp;</label>)}
                        <div className={`col-sm-${(this.props as any).label ? '10' : '12'}`}>
                            <div className="input-group">
                                <input disabled={(this.props as any).disabled} type="text" className="form-control" placeholder={(this.props as any).placeholderKey} value={value[0]} onChange={(e) => this.changeKey(e, value[0])}/>
                                <input disabled={(this.props as any).disabled} type="text" className="form-control" placeholder={(this.props as any).placeholderValue} value={value[1]} onChange={(e) => this.changeValue(e, value[0])}/>

                                <button disabled={(this.props as any).disabled} type="button" className="input-group-text btn btn-outline-danger" onClick={(e) => this.remove(e, value[0])}>
                                    <i className="fas fa-trash"/>
                </button>
                                {idx === values.length - 1 && (<button disabled={(this.props as any).disabled} type="button" className="input-group-text btn btn-outline-primary" onClick={this.addNext}>
                                        <i className="fas fa-plus"/>{' '}
                  </button>)}
              </div>
            </div>
          </div>))}
      </div>);
  }
}

export class VerticalObjectInput extends Component {
  changeValue = (e: any, name: any) => {
    if (e && e.preventDefault) e.preventDefault();
    const newValues = { ...(this.props as any).value, [name]: e.target.value };
    (this.props as any).onChange(newValues);
  };

  changeKey = (e: any, oldName: any) => {
    if (e && e.preventDefault) e.preventDefault();
    const newValues = { ...(this.props as any).value };
    const oldValue = newValues[oldName];
    delete newValues[oldName];
    newValues[e.target.value] = oldValue;
    (this.props as any).onChange(newValues);
  };

  addFirst = (e: any) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!(this.props as any).value || Object.keys((this.props as any).value).length === 0) {
      (this.props as any).onChange((this.props as any).defaultValue || { '': '' });
    }
  };

  addNext = (e: any) => {
    if (e && e.preventDefault) e.preventDefault();
    const newItem = (this.props as any).defaultValue || { '': '' };
    const newValues = { ...(this.props as any).value, ...newItem };
    (this.props as any).onChange(newValues);
  };

  remove = (e: any, name: any) => {
    if (e && e.preventDefault) e.preventDefault();
    const newValues = { ...(this.props as any).value };
    delete newValues[name];
    (this.props as any).onChange(newValues);
  };

  render() {
    const values = Object.keys((this.props as any).value || {}).map((k) => [k, (this.props as any).value[k]]);
        return (<div>
                {values.length === 0 && (<div className="mb-3 row">
                        <div className="col-xs-12">
                            <label htmlFor={`input-${(this.props as any).label}`} className="col-form-label">
                                <Help text={(this.props as any).help} label={(this.props as any).label}/>
              </label>
                            <div>
                                <button disabled={(this.props as any).disabled} type="button" className="btn btn-primary" onClick={this.addFirst}>
                                    <i className="fas fa-plus"/>{' '}
                </button>
              </div>
            </div>
          </div>)}
                {values.map((value, idx) => (<div key={`from-group-${idx}`} className="mb-3 row" style={{ marginBottom: 5, flexWrap: 'nowrap' }}>
                        <div className="col-xs-12">
                            {idx === 0 && (<label className="col-form-label">
                                    <Help text={(this.props as any).help} label={(this.props as any).label}/>
                </label>)}
                            {idx > 0 && false && <label className="col-form-label">&nbsp;</label>}
                            <div className="input-group">
                                <input disabled={(this.props as any).disabled} type="text" className="form-control" style={{ width: '50%' }} placeholder={(this.props as any).placeholderKey} value={value[0]} onChange={(e) => this.changeKey(e, value[0])}/>
                                <input disabled={(this.props as any).disabled} type="text" className="form-control" style={{ width: '50%' }} placeholder={(this.props as any).placeholderValue} value={value[1]} onChange={(e) => this.changeValue(e, value[0])}/>
                                <span className="btn-group">
                                    <button disabled={(this.props as any).disabled} type="button" className="btn btn-sm btn-danger" style={{ marginRight: 0 }} onClick={(e) => this.remove(e, value[0])}>
                                        <i className="fas fa-trash"/>
                  </button>
                </span>
              </div>
                            {idx === values.length - 1 && (<div style={{
                display: 'flex',
                width: '100%',
                justifyContent: 'center',
                alignItems: 'center',
                marginTop: 5,
            }}>
                                    <button disabled={(this.props as any).disabled} type="button" className="btn btn-sm btn-block btn-primary" style={{ marginRight: 0 }} onClick={this.addNext}>
                                        <i className="fas fa-plus"/>{' '}
                  </button>
                </div>)}
            </div>
          </div>))}
      </div>);
  }
}
