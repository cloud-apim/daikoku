import React, { Component } from 'react';
import { Help } from './Help';
import AceEditor from 'react-ace';
import Beautify from 'ace-builds/src-noconflict/ext-beautify';
import 'ace-builds/src-noconflict/mode-html';
import 'ace-builds/src-noconflict/mode-json';
import 'ace-builds/src-noconflict/mode-javascript';
import 'ace-builds/src-noconflict/mode-css';
import 'ace-builds/src-noconflict/mode-markdown';
import 'ace-builds/src-noconflict/theme-monokai';
import 'ace-builds/src-noconflict/theme-tomorrow';
import 'ace-builds/src-noconflict/ext-searchbox';
import 'ace-builds/src-noconflict/ext-language_tools';

import hljs from 'highlight.js';

window.hljs = window.hljs || hljs;

export default class CodeInput extends Component {
  state = {
    value: null,
  };

  onChange = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    try {
      this.setState({ value: null }, () => {
        this.props.onChange(e);
      });
    } catch (ex) {
      this.setState({ value: e });
    }
  };

  render() {
    let code = this.state.value || this.props.value;
    return (
      <div className="mb-3 row">
        <label htmlFor={`input-${this.props.label}`} className="col-sm-2 control-label mb-2">
          <Help text={this.props.help} label={this.props.label} />
        </label>
        <div className="col-sm-10">
          <AceEditor
            commands={Beautify.commands}
            mode={this.props.mode || 'javascript'}
            theme="monokai"
            onChange={this.onChange}
            value={code}
            name="scriptParam"
            editorProps={{ $blockScrolling: true }}
            onLoad={(editorInstance) => {
              editorInstance.container.style.resize = 'both';
              // mouseup = css resize end
              document.addEventListener('mouseup', (e) => editorInstance.resize());
            }}
            height={this.props.height}
            width={this.props.width}
            showGutter={true}
            tabSize={2}
            highlightActiveLine={true}
            enableBasicAutocompletion={true}
            enableLiveAutocompletion={true}
          />
        </div>
      </div>
    );
  }
}
