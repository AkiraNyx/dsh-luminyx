/**
 * 人格设定 · 浏览器半（设置页）
 *
 * 只做一件事：在「设置」里放一个「人格设定」区块，用来
 *   - 选当前人格包、开关注入
 *   - 直接编辑人格正文 / 常驻事实 / 档案（JSONL）
 *   - 管理长期记忆（增、删、保留 N 条）
 *   - 调注入段 order、长度上限、召回参数
 *
 * 不画任何花哨界面：全部走原生 token，跟设置页其它区块一个语气。
 * 所有数据都来自宿主半的 /persona/api/*，这里不重复任何业务规则。
 */
(() => {
  try {
    window.__ModuleLoader__.load({
      id: 'dsh-luminyx',
      factory: (require) => {
        var module = { exports: {} };
        var exports = module.exports;
        Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

        var react = require('react');
        var el = react.createElement;

        var inject = ['slots'];
        var PLUGIN_ID = 'dsh-luminyx';
        var API = '/persona/api';

        /* ── 请求层 ─────────────────────────────────────────────────────── */

        function request(path, options) {
          var init = Object.assign({}, options || {});
          if (init.body !== undefined && typeof init.body !== 'string') {
            init.headers = Object.assign({ 'content-type': 'application/json' }, init.headers || {});
            init.body = JSON.stringify(init.body);
          }
          return fetch(API + path, init).then(function (response) {
            return response
              .json()
              .catch(function () {
                return {};
              })
              .then(function (payload) {
                if (!response.ok) {
                  var message = (payload && payload.error) || response.statusText || '请求失败';
                  throw new Error(message);
                }
                return payload;
              });
          });
        }

        var getJson = function (path) {
          return request(path);
        };
        var putJson = function (path, body) {
          return request(path, { method: 'PUT', body: body });
        };
        var postJson = function (path, body) {
          return request(path, { method: 'POST', body: body });
        };

        /* ── 样式 ───────────────────────────────────────────────────────── */

        var CSS = `
.psn-root,.psn-root *,.psn-root *::before,.psn-root *::after{box-sizing:border-box}
.psn-root{display:flex;flex-direction:column;gap:14px;padding-bottom:8px;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-primary);font-family:inherit}
.psn-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.psn-title{font-size:15px;font-weight:600;letter-spacing:.01em;color:var(--dsw-alias-label-primary)}
.psn-brand{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dsw-alias-label-dimmed);padding-left:2px;user-select:none}
.psn-ver{font-size:11px;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.psn-sub{color:var(--dsw-alias-label-tertiary);font-size:12px}
.psn-spacer{flex:1 1 auto}
.psn-card{border:1px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-settings-card-fill);padding:12px;display:flex;flex-direction:column;gap:10px}
.psn-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.psn-row.psn-tight{gap:6px}
.psn-label{font-size:12px;color:var(--dsw-alias-label-secondary);min-width:64px}
.psn-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);overflow:hidden}
.psn-seg>button{border:0;background:transparent;padding:5px 12px;font-size:12px;line-height:1.4;cursor:pointer;color:var(--dsw-alias-label-secondary);font-family:inherit;transition:background .12s ease,color .12s ease}
.psn-seg>button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.psn-seg>button[data-on="1"]{background:var(--dsw-alias-interactive-bg-hover);font-weight:600;color:var(--dsw-alias-label-primary)}
.psn-btn{border:1px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-sm);padding:5px 11px;font-size:12px;cursor:pointer;font-family:inherit;transition:background .12s ease,border-color .12s ease,color .12s ease}
.psn-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l4)}
.psn-btn:disabled{opacity:.4;cursor:default}
.psn-btn.psn-primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground);font-weight:600}
.psn-btn.psn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);border-color:transparent}
.psn-btn.psn-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-border-l3)}
.psn-btn.psn-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger)}
.psn-input,.psn-textarea,.psn-select{border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;padding:6px 9px;outline:none;transition:border-color .12s ease}
.psn-input:focus,.psn-textarea:focus,.psn-select:focus{border-color:var(--dsw-alias-brand-primary)}
.psn-input::placeholder,.psn-textarea::placeholder{color:var(--dsw-alias-label-dimmed)}
.psn-input[data-num="1"]{width:84px;font-variant-numeric:tabular-nums;text-align:right}
.psn-select{min-width:190px;cursor:pointer}
.psn-select option{background-color:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.psn-textarea{width:100%;min-height:260px;resize:vertical;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:12.5px;line-height:1.6;tab-size:2}
.psn-textarea.psn-prose{font-family:inherit;font-size:13px;line-height:1.7}
.psn-textarea.psn-short{min-height:96px;max-height:380px}
.psn-tabs{display:flex;gap:1px;align-items:flex-end;border-bottom:1px solid var(--dsw-alias-settings-card-stroke);margin-bottom:-1px;overflow-x:auto}
.psn-tabs>button{border:1px solid transparent;border-bottom:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12.5px;font-family:inherit;padding:6px 12px;cursor:pointer;border-radius:var(--dsw-radius-sm) var(--dsw-radius-sm) 0 0;white-space:nowrap;transition:background .12s ease,color .12s ease}
.psn-tabs>button:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.psn-tabs>button[data-on="1"]{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-settings-card-fill);border-color:var(--dsw-alias-settings-card-stroke);font-weight:600}
.psn-panel{border:1px solid var(--dsw-alias-settings-card-stroke);border-radius:0 var(--dsw-radius-md) var(--dsw-radius-md) var(--dsw-radius-md);background:var(--dsw-alias-settings-card-fill);padding:12px;display:flex;flex-direction:column;gap:10px}
.psn-hint{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.psn-preview{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.psn-preview-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 9px;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-settings-card-fill)}
.psn-preview-name{font-size:12.5px;font-weight:600}
.psn-preview-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.psn-preview-body{margin:0;padding:9px;max-height:220px;overflow:auto;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:11.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary)}
.psn-tag{flex:0 0 auto;font-size:10.5px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary)}
.psn-tag-on{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.psn-tag-warn{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.psn-hint code{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);font-size:11px;padding:1px 4px;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-secondary)}
.psn-toggle{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;cursor:pointer;user-select:none;color:var(--dsw-alias-label-secondary)}
.psn-switch{position:relative;width:32px;height:18px;border-radius:999px;background:var(--dsw-alias-border-l4);transition:background .15s ease;flex:0 0 auto}
.psn-switch[data-on="1"]{background:var(--dsw-alias-button-primary-fill)}
.psn-switch>i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);transition:transform .15s ease;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.psn-switch[data-on="1"]>i{transform:translateX(14px)}
.psn-list{display:flex;flex-direction:column;gap:6px;max-height:340px;overflow:auto;padding-right:2px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent}
.psn-list::-webkit-scrollbar{width:8px;height:8px}
.psn-list::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:999px}
.psn-list::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2)}
.psn-mem{display:flex;align-items:flex-start;gap:8px;padding:7px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:transparent;transition:background .12s ease}
.psn-mem:hover{background:var(--dsw-alias-interactive-bg-hover)}
.psn-mem-text{flex:1 1 auto;word-break:break-word;color:var(--dsw-alias-label-primary)}
.psn-imp{font-size:10px;letter-spacing:.12em;color:var(--dsw-alias-label-tertiary);flex:0 0 auto;padding-top:2px;font-variant-numeric:tabular-nums}
.psn-time{font-size:11px;color:var(--dsw-alias-label-dimmed);font-variant-numeric:tabular-nums;flex:0 0 auto;padding-top:2px}
.psn-x{flex:0 0 auto;width:26px;height:26px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:14px;line-height:1;padding:0;border-radius:var(--dsw-radius-xs);transition:background .12s ease,color .12s ease}
.psn-x:hover{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.psn-chip{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap;background:transparent}
.psn-chip b{font-variant-numeric:tabular-nums;font-weight:600;color:var(--dsw-alias-label-primary)}
.psn-empty{padding:22px 10px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12.5px}
.psn-adopt{display:flex;flex-direction:column;align-items:center;gap:8px;line-height:1.65}
.psn-toast{font-size:12px;padding:5px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l2)}
.psn-toast[data-kind="error"]{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);border-color:transparent}
.psn-toast[data-kind="ok"]{color:var(--dsw-alias-state-success-primary);border-color:transparent}
.psn-lore{display:flex;flex-direction:column;gap:5px}
.psn-lore-row{display:flex;gap:8px;align-items:baseline;padding:6px 9px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2);cursor:pointer;background:transparent;transition:background .12s ease}
.psn-lore-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.psn-lore-ch{font-size:11.5px;color:var(--dsw-alias-label-tertiary);min-width:88px;flex:0 0 auto}
.psn-lore-title{flex:1 1 auto;font-weight:500;color:var(--dsw-alias-label-primary)}
.psn-pre{white-space:pre-wrap;word-break:break-word;margin:0;font-family:inherit;font-size:12.5px;line-height:1.7;max-height:320px;overflow:auto;padding:9px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.psn-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.psn-blocks{display:flex;flex-direction:column;gap:9px}
.psn-block{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);padding:9px;display:flex;flex-direction:column;gap:7px;max-width:100%;overflow:hidden;transition:border-color .12s ease}
.psn-block:focus-within{border-color:var(--dsw-alias-border-l4)}
.psn-block-head{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:nowrap}
.psn-block-head .psn-input{height:30px;padding:0 9px;font-size:12.5px;line-height:1.4}
.psn-block-title{flex:1 1 auto;min-width:0;font-weight:600}
.psn-select-mini{flex:0 0 auto;width:auto;min-width:0;height:30px;padding:0 6px;font-size:12px;line-height:1.4}
.psn-block .psn-textarea{background:var(--dsw-alias-settings-card-fill);display:block;width:100%}
.psn-presets{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding-top:2px}
.psn-preset{border:1px dashed var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit;font-size:11.5px;padding:4px 9px;border-radius:999px;cursor:pointer;transition:background .12s ease,color .12s ease,border-color .12s ease}
.psn-preset:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l4)}
.psn-preset:disabled{opacity:.5;cursor:not-allowed}
.psn-preamble{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.psn-preamble>summary{cursor:pointer;padding:3px 0;user-select:none}
.psn-preamble>summary:hover{color:var(--dsw-alias-label-secondary)}
.psn-preamble .psn-pre{margin-top:5px;font-size:11.5px;max-height:180px}
.psn-facts{display:flex;flex-direction:column;gap:5px;max-height:420px;overflow:auto;padding-right:2px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent}
.psn-fact-row{display:flex;align-items:center;gap:7px}
.psn-fact-row .psn-imp{min-width:16px;text-align:right}
.psn-block-off{opacity:.62}
.psn-block-off .psn-block-title{text-decoration:line-through;text-decoration-color:var(--dsw-alias-label-dimmed)}
.psn-mute{flex:0 0 auto;height:26px;padding:0 8px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:11px;line-height:1;cursor:pointer;transition:background .12s ease,color .12s ease,border-color .12s ease}
.psn-mute:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.psn-mute:disabled{opacity:.4;cursor:not-allowed}
.psn-mute-on{background:var(--dsw-alias-interactive-bg-hover-danger);border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.psn-chip-warn{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.psn-subcard{margin-top:12px;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-settings-card-fill);padding:12px 14px;display:flex;flex-direction:column;gap:9px}
.psn-snaps{display:flex;flex-direction:column;gap:4px;max-height:260px;overflow:auto;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent}
.psn-snap-row{display:flex;align-items:center;gap:9px;padding:4px 6px;border-radius:var(--dsw-radius-sm)}
.psn-snap-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.psn-snap-time{font-family:var(--ds-font-family-code);font-size:11.5px;color:var(--dsw-alias-label-secondary);flex:0 0 auto}
.psn-snap-note{font-size:11.5px;color:var(--dsw-alias-label-tertiary);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.psn-btn-sm{height:26px;padding:0 9px;font-size:11.5px}
.psn-mask{position:fixed;inset:0;z-index:60;background:var(--dsw-alias-bg-mask,rgba(0,0,0,.5));display:flex;align-items:center;justify-content:center;padding:24px}.psn-modal{width:100%;max-width:640px;max-height:min(78vh,760px);display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);box-shadow:var(--dsw-elevation-prominent);padding:16px 18px;overflow:auto;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent}
.psn-modal-head{display:flex;align-items:center;gap:8px}
.psn-modal-foot{padding-top:2px}
.psn-import-area{min-height:200px;flex:1 1 auto}
.psn-import-preview{border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);padding:8px 10px;font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.5}
`;

        function usePluginCss() {
          react.useEffect(function () {
            if (typeof document === 'undefined') return;
            var selector = 'style[data-plugin-css="' + PLUGIN_ID + '"]';
            if (document.querySelector(selector)) return;
            var tag = document.createElement('style');
            tag.dataset.plugin = PLUGIN_ID;
            tag.dataset.pluginCss = PLUGIN_ID;
            tag.textContent = CSS;
            document.head.appendChild(tag);
          }, []);
        }

        /* ── 小部件 ─────────────────────────────────────────────────────── */

        function Switch(props) {
          return el(
            'label',
            { className: 'psn-toggle' },
            el(
              'span',
              { className: 'psn-switch', 'data-on': props.checked ? '1' : '0' },
              el('i', null)
            ),
            el('input', {
              type: 'checkbox',
              checked: Boolean(props.checked),
              disabled: Boolean(props.disabled),
              style: { display: 'none' },
              onChange: function (event) {
                props.onChange(event.target.checked);
              },
            }),
            el('span', null, props.label)
          );
        }

        function Segmented(props) {
          return el(
            'div',
            { className: 'psn-seg' },
            props.options.map(function (option) {
              return el(
                'button',
                {
                  key: option.value,
                  type: 'button',
                  'data-on': props.value === option.value ? '1' : '0',
                  onClick: function () {
                    props.onChange(option.value);
                  },
                },
                option.label
              );
            })
          );
        }

        function Toast(props) {
          if (!props.toast) return null;
          return el(
            'span',
            { className: 'psn-toast', 'data-kind': props.toast.kind || 'info' },
            props.toast.text
          );
        }

        function formattedTime(value) {
          if (!value) return '';
          var date = new Date(value);
          if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
          return (
            date.getFullYear() +
            '-' +
            String(date.getMonth() + 1).padStart(2, '0') +
            '-' +
            String(date.getDate()).padStart(2, '0') +
            ' ' +
            String(date.getHours()).padStart(2, '0') +
            ':' +
            String(date.getMinutes()).padStart(2, '0')
          );
        }

        function importanceMarks(value) {
          var level = Math.max(1, Math.min(5, Number(value) || 1));
          var out = '';
          for (var i = 0; i < 5; i += 1) out += i < level ? '●' : '○';
          return out;
        }

        /* ── 主组件 ─────────────────────────────────────────────────────── */

        /* ── 结构化文档：块与条目 ──────────────────────────────────────── */

        // 宿主会随 /pack 一起下发 sectionPresets，这里只做首帧兜底。
        var FALLBACK_PRESETS = ['身份', '语气', '相处方式', '不做的事', '连续性'];

        function emptyDoc() {
          return {
            persona: { preamble: '', blocks: [] },
            facts: { preamble: '', items: [] },
          };
        }

        function emptyBlock() {
          return { title: '', items: [] };
        }

        function cloneJson(value) {
          return JSON.parse(JSON.stringify(value));
        }

        /* ── 文档读写兜底 ──────────────────────────────────────────────── */

        // 宿主版本旧、或 /pack 没带结构化文档时，浏览器这边按同一套规则自己解析。
        // 同一套序列化还用在保存上：doc 交给新宿主，content 兜老宿主，两种情形都不会写坏文件。
        var DOC_HEAD_RE = /^##\s+(.*)$/;
        var DOC_LIST_RE = /^[-*+]\s+(.*)$/;
        var DOC_QUOTE_RE = /^>\s?(.*)$/;

        function docItem(line) {
          var list = DOC_LIST_RE.exec(line);
          if (list) return { text: list[1].trim(), style: 'bullet' };
          var quote = DOC_QUOTE_RE.exec(line);
          if (quote) return { text: quote[1].trim(), style: 'quote' };
          return { text: line.trim(), style: 'plain' };
        }

        function docLine(item) {
          var text = String((item && item.text) || '').trim();
          if (!text) return '';
          var style = item && (item.style === 'quote' || item.style === 'plain') ? item.style : 'bullet';
          if (style === 'quote') return '> ' + text;
          if (style === 'plain') return text;
          return '- ' + text;
        }

        function parseDoc(kind, text) {
          var head = [];
          var items = [];
          var blocks = [];
          var current = null;
          String(text || '')
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .forEach(function (line) {
              var trimmed = line.replace(/\s+$/, '');
              if (kind === 'persona') {
                var head2 = DOC_HEAD_RE.exec(trimmed);
                if (head2) {
                  current = { id: 'b' + (blocks.length + 1), title: head2[1].trim(), items: [] };
                  blocks.push(current);
                  return;
                }
                if (!trimmed.trim()) return;
                if (!current) {
                  head.push(trimmed);
                  return;
                }
                current.items.push(docItem(trimmed));
                return;
              }
              if (!trimmed.trim()) return;
              var meta =
                DOC_QUOTE_RE.test(trimmed) || DOC_HEAD_RE.test(trimmed) || /^#\s/.test(trimmed);
              if (meta) {
                head.push(trimmed.trim());
                return;
              }
              items.push(docItem(trimmed));
            });
          return kind === 'persona'
            ? { preamble: head.join('\n').trim(), blocks: blocks }
            : { preamble: head.join('\n').trim(), items: items };
        }

        function serializeDoc(kind, target) {
          var chunks = [];
          var preamble = String((target && target.preamble) || '').trim();
          if (preamble) chunks.push(preamble);
          if (kind === 'persona') {
            (target.blocks || []).forEach(function (block) {
              var title = String((block && block.title) || '').trim();
              var body = (block.items || []).map(docLine).filter(Boolean).join('\n');
              if (!title && !body) return;
              if (!title) {
                chunks.push(body);
                return;
              }
              chunks.push(body ? '## ' + title + '\n\n' + body : '## ' + title);
            });
          } else {
            var body2 = (target.items || []).map(docLine).filter(Boolean).join('\n');
            if (body2) chunks.push(body2);
          }
          return chunks.length ? chunks.join('\n\n') + '\n' : '';
        }

        function PersonaSettings() {
          usePluginCss();

          var statePair = react.useState(null);
          var overview = statePair[0];
          var setOverview = statePair[1];

          // 首次读盘回来之前，不能把「还没有激活的人格包」当成结论展示。
          var loadedPair = react.useState(false);
          var loaded = loadedPair[0];
          var setLoaded = loadedPair[1];

          var packPair = react.useState(null);
          var pack = packPair[0];
          var setPack = packPair[1];

          var tabPair = react.useState('persona');
          var tab = tabPair[0];
          var setTab = tabPair[1];

          var draftPair = react.useState({ persona: '', facts: '', lore: '' });
          var draft = draftPair[0];
          var setDraft = draftPair[1];

          // 结构化视图：人格正文按块、常驻事实按条目。落盘仍是 markdown，
          // 解析和序列化都在宿主 lib/persona.js 里，浏览器只搬数据。
          var docPair = react.useState(emptyDoc());
          var doc = docPair[0];
          var setDoc = docPair[1];

          var presetsPair = react.useState(FALLBACK_PRESETS);
          var presets = presetsPair[0];
          var setPresets = presetsPair[1];

          var metaPair = react.useState({ name: '', address: '', description: '' });
          var meta = metaPair[0];
          var setMeta = metaPair[1];

          var memPair = react.useState({ rows: [], total: 0 });
          var memoryState = memPair[0];
          var setMemoryState = memPair[1];

          var lorePair = react.useState({ chapters: [], stats: null, hits: null });
          var loreState = lorePair[0];
          var setLoreState = lorePair[1];

          var toastPair = react.useState(null);
          var toast = toastPair[0];
          var setToast = toastPair[1];

          var busyPair = react.useState(false);
          var busy = busyPair[0];
          var setBusy = busyPair[1];

          var dirtyPair = react.useState(false);
          var dirty = dirtyPair[0];
          var setDirty = dirtyPair[1];

          var createPair = react.useState(null);
          var createForm = createPair[0];
          var setCreateForm = createPair[1];

          var memDraftPair = react.useState({ text: '', importance: 3 });
          var memInput = memDraftPair[0];
          var setMemInput = memDraftPair[1];

          var loreQueryPair = react.useState('');
          var loreQuery = loreQueryPair[0];
          var setLoreQuery = loreQueryPair[1];

          // 注入预览：设置页里那两段最终送进提示词的文本。
          var previewPair = react.useState(null);
          var preview = previewPair[0];
          var setPreview = previewPair[1];

          // 模块级开关：按标题停用某个模块，块仍留在文件里。
          var mutedPair = react.useState([]);
          var muted = mutedPair[0];
          var setMuted = mutedPair[1];

          var snapPair = react.useState({ list: [], limit: 20 });
          var snapState = snapPair[0];
          var setSnapState = snapPair[1];

          // Markdown 导入：{ kind, text, doc, count }
          var importPair = react.useState(null);
          var importForm = importPair[0];
          var setImportForm = importPair[1];

          var flash = react.useCallback(function (text, kind) {
            setToast({ text: text, kind: kind || 'info' });
          }, []);

          react.useEffect(
            function () {
              if (!toast) return undefined;
              var timer = setTimeout(function () {
                setToast(null);
              }, toast.kind === 'error' ? 6000 : 2600);
              return function () {
                clearTimeout(timer);
              };
            },
            [toast]
          );

          var refreshOverview = react.useCallback(
            function () {
              return getJson('/overview')
                .then(function (data) {
                  setOverview(data);
                  setLoaded(true);
                  return data;
                })
                .catch(function (error) {
                  flash('读取概览失败：' + error.message, 'error');
                  setLoaded(true);
                  return null;
                });
            },
            [flash]
          );

          var loadPack = react.useCallback(
            function (id) {
              if (!id) {
                setPack(null);
                setDraft({ persona: '', facts: '', lore: '' });
                setDoc(emptyDoc());
                setPresets(FALLBACK_PRESETS);
                setMeta({ name: '', address: '', description: '' });
                setDirty(false);
                return Promise.resolve(null);
              }
              return getJson('/pack?id=' + encodeURIComponent(id))
                .then(function (data) {
                  setPack(data);
                  setDraft({ persona: data.persona || '', facts: data.facts || '', lore: data.loreJsonl || '' });
                  setDoc({
                    persona: data.personaDoc || parseDoc('persona', data.persona),
                    facts: data.factsDoc || parseDoc('facts', data.facts),
                  });
                  setPresets(data.sectionPresets && data.sectionPresets.length ? data.sectionPresets : FALLBACK_PRESETS);
                  setMuted(data.muted || []);
                  setMeta({
                    name: data.name || '',
                    address: data.address || '',
                    description: data.description || '',
                  });
                  setLoreState({ chapters: data.chapters || [], stats: null, hits: null });
                  setDirty(false);
                  return data;
                })
                .catch(function (error) {
                  flash('读取人格包失败：' + error.message, 'error');
                  return null;
                });
            },
            [flash]
          );

          var loadMemory = react.useCallback(
            function () {
              return getJson('/memory')
                .then(function (data) {
                  setMemoryState({ rows: data.rows || [], total: data.total || 0 });
                  return data;
                })
                .catch(function () {
                  setMemoryState({ rows: [], total: 0 });
                  return null;
                });
            },
            []
          );

          var loadSnapshots = react.useCallback(function (id) {
            if (!id) {
              setSnapState({ list: [], limit: 20 });
              return Promise.resolve(null);
            }
            return getJson('/snapshots?id=' + encodeURIComponent(id))
              .then(function (data) {
                setSnapState({ list: data.list || [], limit: data.limit || 20 });
                return data;
              })
              .catch(function () {
                setSnapState({ list: [], limit: 20 });
                return null;
              });
          }, []);

          react.useEffect(
            function () {
              refreshOverview().then(function (data) {
                if (!data) return;
                loadPack(data.activeId);
                loadMemory();
                loadSnapshots(data.activeId);
              });
            },
            [refreshOverview, loadPack, loadMemory, loadSnapshots]
          );

          var activeId = overview && overview.activeId ? overview.activeId : '';
          var settings = (overview && overview.settings) || null;
          var packs = (overview && overview.packs) || [];
          var locked = Boolean(overview && overview.locked);

          // 设置页看的是「当前真正会注入什么」，所以每次切到设置页、改设置、改文件都重新拉一次。
          react.useEffect(
            function () {
              if (tab !== 'settings' || !loaded) return undefined;
              var alive = true;
              getJson('/preview')
                .then(function (data) {
                  if (alive) setPreview(data);
                })
                .catch(function () {
                  /* 预览拉不到不影响设置本身 */
                });
              return function () {
                alive = false;
              };
            },
            [tab, loaded, activeId, settings, dirty]
          );

          function patchSettings(patch) {
            setBusy(true);
            putJson('/settings', patch)
              .then(function (data) {
                setOverview(function (previous) {
                  return previous ? Object.assign({}, previous, { settings: data.settings }) : previous;
                });
                flash('设置已保存', 'ok');
              })
              .catch(function (error) {
                flash('保存设置失败：' + error.message, 'error');
              })
              .finally(function () {
                setBusy(false);
              });
          }

          function pickPack(id) {
            setBusy(true);
            putJson('/active', { id: id })
              .then(function () {
                return refreshOverview();
              })
              .then(function () {
                return loadPack(id);
              })
              .then(function () {
                return loadMemory();
              })
              .then(function () {
                return loadSnapshots(id);
              })
              .catch(function (error) {
                flash('切换失败：' + error.message, 'error');
              })
              .finally(function () {
                setBusy(false);
              });
          }

          // 停用/启用一个模块：块留在 persona.md 里，只是不进提示词。
          function toggleMuted(title, mute) {
            var name = String(title || '').trim();
            if (!name || !activeId) return;
            if (dirty) {
              flash('先保存当前改动，再切换模块开关', 'info');
              return;
            }
            setBusy(true);
            putJson('/muted', { id: activeId, title: name, mute: Boolean(mute) })
              .then(function (data) {
                setMuted(data.muted || []);
                return loadPack(activeId).then(function () {
                  refreshOverview();
                });
              })
              .then(function () {
                flash(mute ? '已停用「' + name + '」' : '已启用「' + name + '」', 'ok');
              })
              .catch(function (error) {
                flash('切换模块开关失败：' + error.message, 'error');
              })
              .finally(function () {
                setBusy(false);
              });
          }

          function runSnapshot(action, stamp, note) {
            if (!activeId) return;
            setBusy(true);
            postJson('/snapshot', { id: activeId, action: action, stamp: stamp, note: note })
              .then(function (data) {
                setSnapState({ list: data.list || [], limit: snapState.limit || 20 });
                if (action === 'create') {
                  flash('已备份当前版本', 'ok');
                  return null;
                }
                if (action === 'remove') {
                  flash('已删除那份快照', 'ok');
                  return null;
                }
                return loadPack(activeId).then(function () {
                  refreshOverview();
                  flash('已回滚到 ' + stamp, 'ok');
                });
              })
              .catch(function (error) {
                flash('快照操作失败：' + error.message, 'error');
              })
              .finally(function () {
                setBusy(false);
              });
          }

          function openImport(kind) {
            setImportForm({ kind: kind, text: '', doc: null, count: 0 });
          }

          function parseImportText() {
            if (!importForm) return;
            var text = importForm.text || '';
            if (!text.trim()) {
              flash('先粘一段内容进来', 'info');
              return;
            }
            setBusy(true);
            var kind = importForm.kind;
            postJson('/doc/parse', { kind: kind, text: text })
              .then(function (data) {
                setImportForm({
                  kind: kind,
                  text: text,
                  doc: data.doc,
                  count: data.count || 0,
                });
              })
              .catch(function (error) {
                flash('解析失败：' + error.message, 'error');
              })
              .finally(function () {
                setBusy(false);
              });
          }

          // 把解析结果并进草稿。替换还是追加，用户自己选。
          function applyImport(mode) {
            if (!importForm || !importForm.doc) return;
            var incoming = importForm.doc;
            var count = importForm.count || 0;
            var next = { persona: doc.persona, facts: doc.facts };
            if (importForm.kind === 'facts') {
              var items = incoming.items || [];
              next.facts = mode === 'append'
                ? { preamble: doc.facts.preamble || '', items: (doc.facts.items || []).concat(items) }
                : { preamble: incoming.preamble || '', items: items };
            } else {
              var blocks = incoming.blocks || [];
              next.persona = mode === 'append'
                ? { preamble: doc.persona.preamble || '', blocks: (doc.persona.blocks || []).concat(blocks) }
                : { preamble: incoming.preamble || '', blocks: blocks };
            }
            setDoc(next);
            setDirty(true);
            setImportForm(null);
            flash(
              '已导入 ' + count + (importForm.kind === 'facts' ? ' 条事实' : ' 个模块') + '，记得点保存',
              'ok'
            );
          }

          function saveFile(file) {
            if (!activeId) return;
            var structured = file === 'persona' || file === 'facts';
            var payload = { id: activeId, file: file };
            if (structured) {
              payload.doc = doc[file];
              // 同时带一份序列化文本：宿主万一还是旧版本、不认得 doc，也只按文本写，不会把文件写空。
              payload.content = serializeDoc(file, doc[file]);
            } else {
              payload.content = draft[file === 'pack.json' ? 'persona' : file];
            }
            setBusy(true);
            putJson('/pack', payload)
              .then(function (data) {
                flash(
                  file === 'persona' ? '人格正文已保存' : file === 'facts' ? '常驻事实已保存' : '档案已保存',
                  'ok'
                );
                // 用宿主规范化后的结果回填：标题去空白、空块丢弃都在那一刻定稿。
                if (data && data.doc) {
                  setDoc(function (previous) {
                    var next = cloneJson(previous);
                    next[file] = data.doc;
                    return next;
                  });
                  setDraft(function (previous) {
                    var next = Object.assign({}, previous);
                    next[file] = data.text || '';
                    return next;
                  });
                }
                if (file === 'lore') return loadPack(activeId);
                // 保存时宿主会先留一份快照，所以列表要跟着刷新，否则用户看到的还是旧的一份。
                return Promise.all([refreshOverview(), loadSnapshots(activeId)]);
              })
              .catch(function (error) {
                flash('保存失败：' + error.message, 'error');
              })
              .finally(function () {
                setBusy(false);
                setDirty(false);
              });
          }

          function saveMeta() {
            if (!activeId) return;
            setBusy(true);
            // pack.json 是整体替换：把界面上没暴露的字段原样带回去，免得丢掉 version / tags / createdAt。
            putJson('/pack', {
              id: activeId,
              file: 'pack.json',
              meta: {
                name: meta.name,
                address: meta.address,
                description: meta.description,
                version: pack ? pack.version : undefined,
                signature: pack ? pack.signature : undefined,
                tags: pack ? pack.tags : undefined,
                aliases: pack ? pack.aliases : undefined,
                createdAt: pack ? pack.createdAt : undefined,
              },
            })
              .then(function () {
                flash('人格包信息已保存', 'ok');
                return loadPack(activeId);
              })
              .then(function () {
                return refreshOverview();
              })
              .catch(function (error) {
                flash('保存失败：' + error.message, 'error');
              })
              .finally(function () {
                setBusy(false);
              });
          }

          function submitCreate() {
            if (!createForm) return;
            var id = String(createForm.id || '').trim();
            var nameText = String(createForm.name || '').trim();
            if (!id || !nameText) {
              flash('id 和名称都要填', 'error');
              return;
            }
            setBusy(true);
            postJson('/pack', {
              action: 'create',
              id: id,
              name: nameText,
              address: createForm.address || '',
              description: createForm.description || '',
            })
              .then(function () {
                setCreateForm(null);
                flash('已新建人格包 ' + id, 'ok');
                return refreshOverview();
              })
              .then(function (data) {
                if (data) pickPack(id);
              })
              .catch(function (error) {
                flash('新建失败：' + error.message, 'error');
              })
              .finally(function () {
                setBusy(false);
              });
          }

          function duplicatePack() {
            if (!activeId) return;
            var newId = window.prompt('新人格包的 id（字母、数字、- 和 _）', activeId + '-copy');
            if (!newId) return;
            setBusy(true);
            postJson('/pack', { action: 'duplicate', id: activeId, newId: newId })
              .then(function () {
                flash('已复制为 ' + newId, 'ok');
                return refreshOverview();
              })
              .catch(function (error) {
                flash('复制失败：' + error.message, 'error');
              })
              .finally(function () {
                setBusy(false);
              });
          }

          function removePack() {
            if (!activeId) return;
            var confirmed = window.confirm('删除人格包「' + (pack ? pack.name : activeId) + '」？目录会被整个移除。');
            if (!confirmed) return;
            setBusy(true);
            postJson('/pack', { action: 'delete', id: activeId })
              .then(function () {
                flash('已删除 ' + activeId, 'ok');
                setPack(null);
                setDraft({ persona: '', facts: '', lore: '' });
                setDoc(emptyDoc());
                return refreshOverview();
              })
              .then(function (data) {
                if (data && data.activeId) loadPack(data.activeId);
                else loadPack('');
              })
              .catch(function (error) {
                flash('删除失败：' + error.message, 'error');
              })
              .finally(function () {
                setBusy(false);
              });
          }

          function addMemory() {
            if (!memInput.text.trim()) return;
            setBusy(true);
            postJson('/memory', {
              action: 'add',
              text: memInput.text,
              importance: Number(memInput.importance) || 3,
            })
              .then(function () {
                setMemInput({ text: '', importance: memInput.importance });
                flash('记忆已写入', 'ok');
                return loadMemory();
              })
              .catch(function (error) {
                flash('写入失败：' + error.message, 'error');
              })
              .finally(function () {
                setBusy(false);
              });
          }

          function forgetMemory(id) {
            setBusy(true);
            postJson('/memory', { action: 'forget', id: id })
              .then(function (data) {
                flash('已忘掉 ' + data.removed + ' 条', 'ok');
                return loadMemory();
              })
              .catch(function (error) {
                flash('删除失败：' + error.message, 'error');
              })
              .finally(function () {
                setBusy(false);
              });
          }

          function pruneMemory() {
            var raw = window.prompt('只保留最近多少条记忆？', '50');
            if (!raw) return;
            var keep = Number(raw);
            if (!Number.isFinite(keep) || keep < 0) {
              flash('需要一个非负整数', 'error');
              return;
            }
            setBusy(true);
            postJson('/memory', { action: 'prune', keep: keep })
              .then(function (result) {
                flash('已清理 ' + (result.removed || 0) + ' 条', 'ok');
                return loadMemory();
              })
              .catch(function (error) {
                flash('清理失败：' + error.message, 'error');
              })
              .finally(function () {
                setBusy(false);
              });
          }

          function searchLore() {
            setBusy(true);
            postJson('/lore', { action: 'search', query: loreQuery, limit: 8 })
              .then(function (data) {
                setLoreState(function (previous) {
                  return Object.assign({}, previous, { hits: data.hits || [] });
                });
              })
              .catch(function (error) {
                flash('检索失败：' + error.message, 'error');
              })
              .finally(function () {
                setBusy(false);
              });
          }

          function readLoreEntry(entry) {
            setBusy(true);
            postJson('/lore', { action: 'read', id: entry.id })
              .then(function (data) {
                var first = (data.entries && data.entries[0]) || (data && data.entry) || null;
                if (first && first.text) {
                  window.alert((first.title || first.id || '条目') + '\n\n' + first.text);
                } else {
                  flash('这条没有正文', 'info');
                }
              })
              .catch(function (error) {
                flash('读取失败：' + error.message, 'error');
              })
              .finally(function () {
                setBusy(false);
              });
          }

          /* ── 渲染 ─────────────────────────────────────────────────── */

          var tabs = [
            { value: 'persona', label: '人格正文' },
            { value: 'facts', label: '常驻事实' },
            { value: 'lore', label: '设定档案' },
            { value: 'memory', label: '长期记忆' },
            { value: 'meta', label: '包信息' },
            { value: 'settings', label: '注入设置' },
          ];

          function textareaFor(file, placeholder, extraClass) {
            return el('textarea', {
              className: 'psn-textarea ' + (extraClass || ''),
              spellCheck: false,
              value: draft[file],
              placeholder: placeholder,
              onChange: function (event) {
                var value = event.target.value;
                setDraft(function (previous) {
                  var next = Object.assign({}, previous);
                  next[file] = value;
                  return next;
                });
                setDirty(true);
              },
              onKeyDown: function (event) {
                if ((event.metaKey || event.ctrlKey) && event.key === 's') {
                  event.preventDefault();
                  saveFile(file);
                }
              },
            });
          }

          /* ── 结构化编辑：人格正文按块，常驻事实按条目 ──────────────── */

          function updateDoc(file, mutator) {
            var next = cloneJson(doc);
            mutator(next[file]);
            setDoc(next);
            // 文本视图跟着走：字数显示、以及退回纯文本保存时用的都是它。
            setDraft(function (previous) {
              var updated = Object.assign({}, previous);
              updated[file] = serializeDoc(file, next[file]);
              return updated;
            });
            setDirty(true);
          }

          // 块里的条目形如 { text, style }，style 取 bullet / plain / quote。
          // 块级「格式」不是独立字段：它是块内条目样式一致时的那个值。
          var BLOCK_STYLES = [
            { value: 'bullet', label: '逐条要点', hint: '一条一条写，适合身份、语气、规矩这类。' },
            { value: 'plain', label: '成段描述', hint: '写成连贯的段落，适合背景、经历、世界观。' },
            { value: 'quote', label: '原样摘录', hint: '照抄原话或原文，一个字都不改。' },
          ];

          function blockHint(style) {
            for (var i = 0; i < BLOCK_STYLES.length; i += 1) {
              if (BLOCK_STYLES[i].value === style) return BLOCK_STYLES[i].hint;
            }
            return '这三种写法的注入效果一样，只是文件里排出来不一样。';
          }

          function blockStyleOf(block) {
            var seen = [];
            (block.items || []).forEach(function (item) {
              var style = item && item.style ? item.style : 'bullet';
              if (seen.indexOf(style) < 0) seen.push(style);
            });
            if (seen.length === 1) return seen[0];
            if (!seen.length) return 'bullet';
            return 'mixed';
          }

          function blockText(block) {
            return (block.items || [])
              .map(function (item) { return String((item && item.text) || ''); })
              .join('\n');
          }

          function setBlockText(index, value) {
            var lines = String(value).split('\n');
            updateDoc('persona', function (target) {
              var block = target.blocks[index];
              if (!block) return;
              var previous = block.items || [];
              var primary = blockStyleOf(block) === 'mixed' ? 'bullet' : blockStyleOf(block);
              block.items = lines.map(function (text, lineIndex) {
                var old = previous[lineIndex];
                return { text: text, style: old && old.style ? old.style : primary };
              });
            });
          }

          function setBlockStyle(index, style) {
            updateDoc('persona', function (target) {
              var block = target.blocks[index];
              if (!block) return;
              block.items = (block.items || []).map(function (item) {
                return { text: String((item && item.text) || ''), style: style };
              });
            });
          }

          function addBlock(title) {
            updateDoc('persona', function (target) {
              var block = emptyBlock('bullet');
              block.title = title || '';
              block.items = [{ text: '', style: 'bullet' }];
              target.blocks.push(block);
            });
          }

          function patchBlockTitle(index, title) {
            updateDoc('persona', function (target) {
              var block = target.blocks[index];
              if (block) block.title = title;
            });
          }

          function removeBlock(index) {
            updateDoc('persona', function (target) {
              target.blocks.splice(index, 1);
            });
          }

          function moveBlock(index, delta) {
            updateDoc('persona', function (target) {
              var next = index + delta;
              if (next < 0 || next >= target.blocks.length) return;
              var moved = target.blocks.splice(index, 1)[0];
              target.blocks.splice(next, 0, moved);
            });
          }

          function blockEditor(block, index, total) {
            var style = blockStyleOf(block);
            var title = String(block.title || '').trim();
            var off = Boolean(title) && muted.indexOf(title) >= 0;
            return el(
              'div',
              { className: 'psn-block' + (off ? ' psn-block-off' : ''), key: 'block-' + index },
              el(
                'div',
                { className: 'psn-block-head' },
                el('input', {
                  className: 'psn-input psn-block-title',
                  value: block.title || '',
                  placeholder: '模块名，例如 身份 / 语气 / 不做的事',
                  onChange: function (event) { patchBlockTitle(index, event.target.value); },
                }),
                el(
                  'select',
                  {
                    className: 'psn-select psn-select-mini',
                    value: style,
                    title: '按这块内容的样子选；三种选法的注入效果一样',
                    onChange: function (event) { setBlockStyle(index, event.target.value); },
                  },
                  style === 'mixed' ? el('option', { value: 'mixed', disabled: true }, '混合') : null,
                  BLOCK_STYLES.map(function (option) {
                    return el('option', { value: option.value, key: 'style-' + option.value }, option.label);
                  })
                ),
                el('button', {
                  className: 'psn-mute' + (off ? ' psn-mute-on' : ''),
                  title: off ? '重新启用这个模块' : '停用这个模块：内容留在文件里，只是不进提示词',
                  disabled: busy || !title,
                  onClick: function () { toggleMuted(title, !off); },
                }, off ? '已停用' : '停用'),
                el('button', {
                  className: 'psn-x',
                  title: '上移',
                  disabled: index === 0,
                  onClick: function () { moveBlock(index, -1); },
                }, '↑'),
                el('button', {
                  className: 'psn-x',
                  title: '下移',
                  disabled: index === total - 1,
                  onClick: function () { moveBlock(index, 1); },
                }, '↓'),
                el('button', {
                  className: 'psn-x',
                  title: '删除这个模块',
                  onClick: function () { removeBlock(index); },
                }, '×')
              ),
              el(
                'textarea',
                {
                  className: 'psn-textarea psn-short',
                  spellCheck: false,
                  value: blockText(block),
                  placeholder: blockHint(style),
                  onChange: function (event) { setBlockText(index, event.target.value); },
                  onKeyDown: function (event) {
                    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
                      event.preventDefault();
                      saveFile('persona');
                    }
                  },
                }
              )
            );
          }

          function adoptPreamble() {
            updateDoc('persona', function (target) {
              var text = String(target.preamble || '').trim();
              var chunks = text ? text.split(/\n\s*\n/) : [];
              var blocks = chunks
                .map(function (chunk) {
                  var lines = chunk.split('\n');
                  var head = /^#{1,6}\s*(.+)$/.exec(lines[0].trim());
                  if (head) lines = lines.slice(1);
                  return {
                    title: head ? head[1].trim() : '',
                    items: lines.map(function (line) {
                      var bullet = /^[-*+]\s+(.*)$/.exec(line);
                      if (bullet) return { text: bullet[1].trim(), style: 'bullet' };
                      var quote = /^>\s?(.*)$/.exec(line);
                      if (quote) return { text: quote[1].trim(), style: 'quote' };
                      return { text: line.trim(), style: 'plain' };
                    }),
                  };
                })
                .filter(function (block) {
                  return block.title || block.items.some(function (item) { return item.text; });
                });
              target.blocks = (target.blocks || []).concat(blocks);
              target.preamble = '';
            });
          }

          function renderPersonaPanel() {
            var personaDoc = doc.persona || emptyDoc().persona;
            var blocks = personaDoc.blocks || [];
            var preamble = String(personaDoc.preamble || '');
            return el(
              'div',
              { className: 'psn-panel' },
              el(
                'div',
                { className: 'psn-row' },
                el('span', { className: 'psn-hint' }, '注入为系统提示段 '),
                el('code', null, 'persona:main'),
                el('span', { className: 'psn-hint' }, '· order ' + ((settings && settings.order && settings.order.persona) || 9100)),
                el('span', { className: 'psn-spacer' }),
                el('span', { className: 'psn-chip' }, '模块 ', el('b', null, String(blocks.length))),
                muted.length
                  ? el(
                      'span',
                      { className: 'psn-chip psn-chip-warn', title: '这些模块留在文件里，但不进提示词' },
                      '停用 ',
                      el('b', null, String(muted.length))
                    )
                  : null,
                el('span', { className: 'psn-chip' }, '字数 ', el('b', null, String((draft.persona || '').length))),
                dirty ? el('span', { className: 'psn-toast' }, '有未保存改动') : null,
                el(
                  'button',
                  {
                    className: 'psn-btn',
                    disabled: busy || !activeId,
                    title: '把现成的一份设定粘进来，自动按 ## 切成模块',
                    onClick: function () { openImport('persona'); },
                  },
                  '从 Markdown 导入'
                ),
                el(
                  'button',
                  { className: 'psn-btn psn-primary', disabled: busy || !activeId, onClick: function () { saveFile('persona'); } },
                  '保存 ⌘S'
                )
              ),
              preamble
                ? el(
                    'details',
                    { className: 'psn-preamble' },
                    el('summary', null, '开头说明（第一个模块之前的文字，会一起注入）'),
                    el('pre', { className: 'psn-pre' }, preamble)
                  )
                : null,
              blocks.length
                ? el(
                    'div',
                    { className: 'psn-blocks' },
                    blocks.map(function (block, index) {
                      return blockEditor(block, index, blocks.length);
                    })
                  )
                : el(
                    'div',
                    { className: 'psn-empty' },
                    preamble
                      ? el(
                          'div',
                          { className: 'psn-adopt' },
                          el(
                            'div',
                            null,
                            '现在是整块写法：' +
                              String((draft.persona || '').length) +
                              ' 字全在文件头里，还没切成模块。'
                          ),
                          el(
                            'button',
                            {
                              className: 'psn-btn psn-primary',
                              disabled: busy || !activeId,
                              onClick: adoptPreamble,
                            },
                            '按空行自动切成模块'
                          ),
                          el(
                            'div',
                            { className: 'psn-hint' },
                            '切完可以改模块名、调顺序；不切也能正常注入，只是没法分块维护。'
                          )
                        )
                      : '还没有模块。从下面的常用模块挑一个开始，或者自己命名一个。'
                  ),
              el(
                'div',
                { className: 'psn-presets' },
                el('span', { className: 'psn-hint' }, '添加模块：'),
                presets.map(function (name) {
                  return el(
                    'button',
                    {
                      key: 'preset-' + name,
                      className: 'psn-preset',
                      disabled: busy || !activeId,
                      onClick: function () { addBlock(name); },
                    },
                    '+ ' + name
                  );
                }),
                el(
                  'button',
                  {
                    key: 'preset-custom',
                    className: 'psn-preset',
                    disabled: busy || !activeId,
                    onClick: function () { addBlock(''); },
                  },
                  '+ 自定义'
                )
              ),
              el(
                'div',
                { className: 'psn-hint' },
                '每块保存为 markdown 的 ',
                el('code', null, '## 标题'),
                ' + 正文，顺序就是注入顺序。删掉一块即删掉那个模块，其它不变。'
              )
            );
          }

          function renderFactsPanel() {
            var factsDoc = doc.facts || emptyDoc().facts;
            var items = factsDoc.items || [];
            var preamble = String(factsDoc.preamble || '');
            return el(
              'div',
              { className: 'psn-panel' },
              el(
                'div',
                { className: 'psn-row' },
                el('span', { className: 'psn-hint' }, '注入为系统提示段 '),
                el('code', null, 'persona:facts'),
                el('span', { className: 'psn-hint' }, '· order ' + ((settings && settings.order && settings.order.facts) || 9120)),
                el('span', { className: 'psn-spacer' }),
                el('span', { className: 'psn-chip' }, '条目 ', el('b', null, String(items.length))),
                el('span', { className: 'psn-chip' }, '字数 ', el('b', null, String((draft.facts || '').length))),
                dirty ? el('span', { className: 'psn-toast' }, '有未保存改动') : null,
                el(
                  'button',
                  {
                    className: 'psn-btn',
                    disabled: busy || !activeId,
                    title: '一条一行地粘进来，直接用',
                    onClick: function () { openImport('facts'); },
                  },
                  '从 Markdown 导入'
                ),
                el(
                  'button',
                  { className: 'psn-btn psn-primary', disabled: busy || !activeId, onClick: function () { saveFile('facts'); } },
                  '保存 ⌘S'
                )
              ),
              preamble
                ? el(
                    'details',
                    { className: 'psn-preamble' },
                    el('summary', null, '开头说明（说明性文字，不算条目）'),
                    el('pre', { className: 'psn-pre' }, preamble)
                  )
                : null,
              items.length
                ? el(
                    'div',
                    { className: 'psn-facts' },
                    items.map(function (item, index) {
                      return el(
                        'div',
                        { className: 'psn-fact-row', key: 'fact-' + index },
                        el('span', { className: 'psn-imp' }, index + 1),
                        el('input', {
                          className: 'psn-input',
                          style: { flex: '1 1 auto' },
                          value: String((item && item.text) || ''),
                          placeholder: '一条短句，例如：称呼用户「你」',
                          onChange: function (event) {
                            var value = event.target.value;
                            updateDoc('facts', function (target) {
                              var old = target.items[index] || { style: 'bullet' };
                              target.items[index] = { text: value, style: old.style || 'bullet' };
                            });
                          },
                          onKeyDown: function (event) {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              updateDoc('facts', function (target) {
                                target.items.splice(index + 1, 0, { text: '', style: 'bullet' });
                              });
                            } else if ((event.metaKey || event.ctrlKey) && event.key === 's') {
                              event.preventDefault();
                              saveFile('facts');
                            }
                          },
                        }),
                        el('button', {
                          className: 'psn-x',
                          title: '删掉这条',
                          onClick: function () {
                            updateDoc('facts', function (target) {
                              target.items.splice(index, 1);
                            });
                          },
                        }, '×')
                      );
                    })
                  )
                : el('div', { className: 'psn-empty' }, '还没有条目。加一条最想让它永远记住的事。'),
              el(
                'div',
                { className: 'psn-row' },
                el(
                  'button',
                  {
                    className: 'psn-btn',
                    disabled: busy || !activeId,
                    onClick: function () {
                      updateDoc('facts', function (target) {
                        target.items.push({ text: '', style: 'bullet' });
                      });
                    },
                  },
                  '+ 加一条'
                ),
                el('span', { className: 'psn-hint' }, '回车在下方插入新条目')
              ),
              el('div', { className: 'psn-hint' }, '这段比档案更常驻，也更贵——只放每次对话都用得上的东西。')
            );
          }

          function renderLorePanel() {
            return el(
              'div',
              { className: 'psn-panel' },
              el(
                'div',
                { className: 'psn-row' },
                el(
                  'span',
                  { className: 'psn-hint' },
                  'JSONL 档案 · ' +
                    String((pack && pack.loreCount) || 0) +
                    ' 条 · 每行一个 ' +
                    '{ id, chapter, title, text }'
                ),
                el('span', { className: 'psn-spacer' }),
                el(
                  'button',
                  { className: 'psn-btn psn-primary', disabled: busy || !activeId, onClick: function () { saveFile('lore'); } },
                  '保存 ⌘S'
                )
              ),
              textareaFor('lore', '{"id":"c1-01","chapter":"第一章","title":"标题","text":"正文"}', 'psn-short'),
              el(
                'div',
                { className: 'psn-row psn-tight' },
                el('input', {
                  className: 'psn-input',
                  style: { flex: '1 1 220px' },
                  placeholder: '在档案里搜索关键词（模型侧用 persona_lore）',
                  value: loreQuery,
                  onChange: function (event) { setLoreQuery(event.target.value); },
                  onKeyDown: function (event) { if (event.key === 'Enter') searchLore(); },
                }),
                el('button', { className: 'psn-btn', disabled: busy || !activeId, onClick: searchLore }, '搜索'),
                el('span', { className: 'psn-chip' }, '章节 ', el('b', null, String((loreState.chapters || []).length)))
              ),
              el(
                'div',
                { className: 'psn-lore' },
                (loreState.hits || []).length
                  ? loreState.hits.map(function (hit, index) {
                      return el(
                        'div',
                        {
                          key: (hit.id || 'hit') + index,
                          className: 'psn-lore-row',
                          onClick: function () { readLoreEntry(hit); },
                          title: '点击查看全文',
                        },
                        el('span', { className: 'psn-lore-ch' }, hit.chapter || '—'),
                        el('span', { className: 'psn-lore-title' }, hit.title || hit.id || '(无标题)'),
                        el('span', { className: 'psn-hint' }, String((hit.text || '').slice(0, 40)).replace(/\s+/g, ' '))
                      );
                    })
                  : el(
                      'div',
                      { className: 'psn-hint' },
                      (loreState.chapters || []).length
                        ? '章节：' +
                            loreState.chapters
                              .slice(0, 12)
                              .map(function (chapter) { return chapter.chapter + '(' + chapter.count + ')'; })
                              .join('、')
                        : '还没有档案。模型的 persona_lore 也会读这里。'
                    )
              ),
              snapshotCard()
            );
          }

          // 导入弹层：粘一份现成的设定，先识别成模块给人看，再决定替换还是追加。
          function importPreviewText() {
            if (!importForm || !importForm.doc) return '';
            var incoming = importForm.doc;
            if (importForm.kind === 'facts') {
              var facts = incoming.items || [];
              if (!facts.length) return '没识别到条目，检查是不是只粘了说明行。';
              return (
                '识别到 ' + facts.length + ' 条事实：' +
                facts.slice(0, 3).map(function (item) { return String((item && item.text) || '').slice(0, 14); }).join('、') +
                (facts.length > 3 ? ' …' : '')
              );
            }
            var blocks = incoming.blocks || [];
            if (!blocks.length) return '没识别到 `##` 标题，整段会作为开头说明（同样会注入）。';
            return (
              '识别到 ' + blocks.length + ' 个模块：' +
              blocks.slice(0, 8).map(function (block) { return block.title || '(无标题)'; }).join('、') +
              (blocks.length > 8 ? ' …' : '')
            );
          }

          function importLayers() {
            var isFacts = importForm.kind === 'facts';
            return el(
              'div',
              { className: 'psn-mask', onClick: function () { setImportForm(null); } },
              el(
                'div',
                { className: 'psn-modal', onClick: function (event) { event.stopPropagation(); } },
                el(
                  'div',
                  { className: 'psn-modal-head' },
                  el('span', { className: 'psn-label' }, isFacts ? '导入常驻事实' : '导入人格正文'),
                  el('span', { className: 'psn-spacer' }),
                  el('button', { className: 'psn-x', title: '关闭', onClick: function () { setImportForm(null); } }, '×')
                ),
                el(
                  'div',
                  { className: 'psn-hint' },
                  isFacts
                    ? '一条一行，粘进来直接变条目；`*` 开头的行仍算说明行。'
                    : '按 `## 标题` 切块；第一个标题之前的文字作为开头说明；`//` 开头的行是注释，不注入。'
                ),
                el('textarea', {
                  className: 'psn-area psn-import-area',
                  value: importForm.text || '',
                  placeholder: isFacts
                    ? '称呼用户「你」\n长期稳定的偏好\n一条一行，短、可核对'
                    : '## 身份\n我是「示例人格」，一个长期协作的搭档。\n\n## 语气\n口语、清楚、不端着。',
                  onChange: function (event) {
                    setImportForm({ kind: importForm.kind, text: event.target.value, doc: null, count: 0 });
                  },
                }),
                importForm.doc ? el('div', { className: 'psn-import-preview' }, importPreviewText()) : null,
                el(
                  'div',
                  { className: 'psn-row psn-modal-foot' },
                  el('button', { className: 'psn-btn', onClick: function () { setImportForm(null); } }, '取消'),
                  el('button', { className: 'psn-btn', disabled: busy, onClick: parseImportText }, importForm.doc ? '重新识别' : '识别'),
                  importForm.doc
                    ? el('button', { className: 'psn-btn', disabled: busy, onClick: function () { applyImport('append'); } }, '追加到末尾')
                    : null,
                  importForm.doc
                    ? el('button', { className: 'psn-btn psn-primary', disabled: busy, onClick: function () { applyImport('replace'); } }, '替换全部')
                    : null
                )
              )
            );
          }

          function shortTime(iso) {
            if (!iso) return '';
            var date = new Date(iso);
            if (isNaN(date.getTime())) return '';
            var pad = function (value) { return String(value).length < 2 ? '0' + value : String(value); };
            return (
              pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' +
              pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
            );
          }

          // 快照面板：改之前总有一份能退回去的版本。
          function snapshotCard() {
            var list = snapState.list || [];
            var limit = snapState.limit || 20;
            return el(
              'div',
              { className: 'psn-subcard' },
              el(
                'div',
                { className: 'psn-row' },
                el('span', { className: 'psn-label' }, '版本快照'),
                el('span', { className: 'psn-hint' }, '保存前自动留一份，最多 ' + limit + ' 份 · 现有 ' + list.length),
                el('span', { className: 'psn-spacer' }),
                el(
                  'button',
                  {
                    className: 'psn-btn',
                    disabled: busy || !activeId,
                    onClick: function () { runSnapshot('create', '', '手动备份'); },
                  },
                  '立即备份'
                )
              ),
              list.length
                ? el(
                    'div',
                    { className: 'psn-snaps' },
                    list.map(function (row, index) {
                      return el(
                        'div',
                        { className: 'psn-snap-row', key: 'snap-' + row.stamp },
                        el('span', { className: 'psn-snap-time' }, shortTime(row.time) || row.stamp),
                        el('span', { className: 'psn-snap-note' }, row.note || (index === 0 ? '最近一次保存前' : '')),
                        el(
                          'span',
                          { className: 'psn-hint' },
                          String((row.chars && row.chars.persona) || 0) + ' 字'
                        ),
                        el('span', { className: 'psn-spacer' }),
                        el(
                          'button',
                          {
                            className: 'psn-btn psn-btn-sm',
                            disabled: busy,
                            title: '把正文与事实换回这一份（当前版本会先自动备份）',
                            onClick: function () { runSnapshot('restore', row.stamp); },
                          },
                          '回滚到这里'
                        ),
                        el(
                          'button',
                          {
                            className: 'psn-x',
                            title: '删除这份快照',
                            disabled: busy,
                            onClick: function () { runSnapshot('remove', row.stamp); },
                          },
                          '×'
                        )
                      );
                    })
                  )
                : el('div', { className: 'psn-hint' }, '还没有快照。点「立即备份」留一份；之后每次保存也会自动留。')
            );
          }

          function renderMemoryPanel() {
            return el(
              'div',
              { className: 'psn-panel' },
              el(
                'div',
                { className: 'psn-row' },
                el('span', { className: 'psn-hint' }, '长期记忆 · ' + String(memoryState.total) + ' 条 · 存放在人格包目录的 memory.jsonl'),
                el('span', { className: 'psn-spacer' }),
                el('button', { className: 'psn-btn', disabled: busy || !activeId, onClick: pruneMemory }, '清理…'),
                el('button', { className: 'psn-btn', disabled: busy, onClick: loadMemory }, '刷新')
              ),
              el(
                'div',
                { className: 'psn-row psn-tight' },
                el('input', {
                  className: 'psn-input',
                  style: { flex: '1 1 260px' },
                  placeholder: '写一条值得记住的事…',
                  value: memInput.text,
                  onChange: function (event) {
                    var value = event.target.value;
                    setMemInput(function (previous) { return Object.assign({}, previous, { text: value }); });
                  },
                  onKeyDown: function (event) { if (event.key === 'Enter') addMemory(); },
                }),
                el(
                  'div',
                  { className: 'psn-seg' },
                  [1, 2, 3, 4, 5].map(function (level) {
                    return el(
                      'button',
                      {
                        key: level,
                        type: 'button',
                        'data-on': Number(memInput.importance) === level ? '1' : '0',
                        title: ['日常偏好', '日常偏好', '明确约定', '重要经历', '底线与禁忌'][level - 1],
                        onClick: function () {
                          setMemInput(function (previous) { return Object.assign({}, previous, { importance: level }); });
                        },
                      },
                      String(level)
                    );
                  })
                ),
                el('button', { className: 'psn-btn psn-primary', disabled: busy || !activeId, onClick: addMemory }, '记住')
              ),
              memoryState.rows.length
                ? el(
                    'div',
                    { className: 'psn-list' },
                    memoryState.rows.map(function (row) {
                      return el(
                        'div',
                        { key: row.id || row.text, className: 'psn-mem' },
                        el('span', { className: 'psn-imp', title: '重要度 ' + row.importance }, importanceMarks(row.importance)),
                        el('span', { className: 'psn-mem-text' }, row.text),
                        el('span', { className: 'psn-time' }, formattedTime(row.createdAt)),
                        el(
                          'button',
                          {
                            className: 'psn-x',
                            title: '删掉这条',
                            disabled: busy,
                            onClick: function () { forgetMemory(row.id); },
                          },
                          '×'
                        )
                      );
                    })
                  )
                : el('div', { className: 'psn-empty' }, '还没有记忆。模型可以用 persona_remember 自己写，你也能在这里手填。')
            );
          }

          function renderMetaPanel() {
            return el(
              'div',
              { className: 'psn-panel' },
              el(
                'div',
                { className: 'psn-grid2' },
                el(
                  'label',
                  { className: 'psn-row psn-tight' },
                  el('span', { className: 'psn-label' }, '名称'),
                  el('input', {
                    className: 'psn-input',
                    style: { flex: '1 1 140px' },
                    value: meta.name,
                    onChange: function (event) {
                      var value = event.target.value;
                      setMeta(function (previous) { return Object.assign({}, previous, { name: value }); });
                    },
                  })
                ),
                el(
                  'label',
                  { className: 'psn-row psn-tight' },
                  el('span', { className: 'psn-label' }, '称呼'),
                  el('input', {
                    className: 'psn-input',
                    style: { flex: '1 1 140px' },
                    placeholder: '人格对用户的默认称呼，可留空',
                    value: meta.address,
                    onChange: function (event) {
                      var value = event.target.value;
                      setMeta(function (previous) { return Object.assign({}, previous, { address: value }); });
                    },
                  })
                )
              ),
              el(
                'label',
                { className: 'psn-row psn-tight', style: { alignItems: 'flex-start' } },
                el('span', { className: 'psn-label' }, '简介'),
                el('input', {
                  className: 'psn-input',
                  style: { flex: '1 1 240px' },
                  value: meta.description,
                  onChange: function (event) {
                    var value = event.target.value;
                    setMeta(function (previous) { return Object.assign({}, previous, { description: value }); });
                  },
                })
              ),
              el(
                'div',
                { className: 'psn-row' },
                el('span', { className: 'psn-hint' }, pack ? '目录：' + pack.dir : '未选择人格包'),
                el('span', { className: 'psn-spacer' }),
                el('button', { className: 'psn-btn psn-primary', disabled: busy || !activeId, onClick: saveMeta }, '保存信息')
              )
            );
          }

          function numberField(label, value, onChange, hint) {
            return el(
              'label',
              { className: 'psn-row psn-tight' },
              el('span', { className: 'psn-label' }, label),
              el('input', {
                className: 'psn-input',
                'data-num': '1',
                type: 'number',
                value: String(value),
                onChange: function (event) { onChange(Number(event.target.value)); },
              }),
              hint ? el('span', { className: 'psn-hint' }, hint) : null
            );
          }

          function renderSettingsPanel() {
            var order = (settings && settings.order) || { persona: 9100, facts: 9120 };
            var maxChars = (settings && settings.maxChars) || { persona: 24000, facts: 6000 };
            var recall = (settings && settings.recall) || { limit: 5, minScore: 0.12 };
            return el(
              'div',
              { className: 'psn-panel' },
              el(
                'div',
                { className: 'psn-row' },
                el(
                  Switch,
                  {
                    label: '启用插件',
                    checked: settings ? settings.enabled : true,
                    disabled: busy || !settings,
                    onChange: function (value) { patchSettings({ enabled: value }); },
                  }
                ),
                el(
                  Switch,
                  {
                    label: '注入人格正文',
                    checked: settings ? settings.injectPersona : true,
                    disabled: busy || !settings,
                    onChange: function (value) { patchSettings({ injectPersona: value }); },
                  }
                ),
                el(
                  Switch,
                  {
                    label: '注入常驻事实',
                    checked: settings ? settings.injectFacts : true,
                    disabled: busy || !settings,
                    onChange: function (value) { patchSettings({ injectFacts: value }); },
                  }
                ),
                el(
                  Switch,
                  {
                    label: '暴露 persona_* 工具',
                    checked: settings ? settings.exposeTools : true,
                    disabled: busy || !settings,
                    onChange: function (value) { patchSettings({ exposeTools: value }); },
                  }
                )
              ),
              el('div', { className: 'psn-hint' }, '段顺序（order）：数值越大越靠近提示词末尾。默认插在工具清单之后、结构化输出之前。'),
              el(
                'div',
                { className: 'psn-grid2' },
                numberField('人格段', order.persona, function (value) { patchSettings({ order: { persona: value } }); }),
                numberField('事实段', order.facts, function (value) { patchSettings({ order: { facts: value } }); })
              ),
              el('div', { className: 'psn-hint' }, '长度上限（字符）：超出的部分截断并标注，避免一个人格包把上下文吃光。'),
              el(
                'div',
                { className: 'psn-grid2' },
                numberField('正文上限', maxChars.persona, function (value) { patchSettings({ maxChars: { persona: value } }); }),
                numberField('事实上限', maxChars.facts, function (value) { patchSettings({ maxChars: { facts: value } }); })
              ),
              el('div', { className: 'psn-hint' }, '档案检索参数（persona_lore 每次取回的条数与最低相关度）。'),
              el(
                'div',
                { className: 'psn-grid2' },
                numberField('召回条数', recall.limit, function (value) { patchSettings({ recall: { limit: value } }); }),
                numberField('最低分', recall.minScore, function (value) { patchSettings({ recall: { minScore: value } }); })
              ),
              previewCard()
            );
          }

          function previewCard() {
            if (!preview || !preview.id) {
              return el(
                'div',
                { className: 'psn-card' },
                el('div', { className: 'psn-empty' }, '还没有激活的人格包，没有可预览的注入内容。')
              );
            }
            return el(
              'div',
              { className: 'psn-card' },
              el(
                'div',
                { className: 'psn-row' },
                el('span', { className: 'psn-label' }, '注入预览'),
                el(
                  'span',
                  { className: 'psn-sub' },
                  '当前真正会送进系统提示词的两段，共 ' + preview.total + ' 字'
                ),
                el('span', { className: 'psn-spacer' }),
                el(
                  'button',
                  {
                    className: 'psn-btn',
                    disabled: busy,
                    onClick: function () {
                      getJson('/preview')
                        .then(setPreview)
                        .catch(function (error) { flash('预览失败：' + error.message, 'error'); });
                    },
                  },
                  '重新读取'
                )
              ),
              (preview.sections || []).map(function (section) {
                return el(
                  'div',
                  { className: 'psn-preview', key: 'pv-' + section.name },
                  el(
                    'div',
                    { className: 'psn-preview-head' },
                    el('span', { className: 'psn-preview-name' }, section.label),
                    el('span', { className: 'psn-preview-meta' }, section.name),
                    el('span', { className: 'psn-preview-meta' }, 'order ' + section.order),
                    el(
                      'span',
                      { className: 'psn-preview-meta' },
                      section.chars + ' / ' + section.limit + ' 字'
                    ),
                    section.on
                      ? el('span', { className: 'psn-tag psn-tag-on' }, '注入中')
                      : el('span', { className: 'psn-tag' }, '已关闭'),
                    section.truncated
                      ? el('span', { className: 'psn-tag psn-tag-warn' }, '超出上限，已截断')
                      : null
                  ),
                  el('pre', { className: 'psn-preview-body' }, section.on && section.text ? section.text : '（这段不会注入）')
                );
              })
            );
          }

          function renderActivePanel() {
            if (!loaded) {
              return el('div', { className: 'psn-card' }, el('div', { className: 'psn-empty' }, '正在读取人格包…'));
            }
            if (!activeId || !pack) {
              return el(
                'div',
                { className: 'psn-card' },
                el('div', { className: 'psn-empty' }, '还没有激活的人格包。选一个，或者新建一个。'),
                el(
                  'div',
                  { className: 'psn-row', style: { justifyContent: 'center' } },
                  el(
                    'button',
                    {
                      className: 'psn-btn psn-primary',
                      onClick: function () {
                        setCreateForm({ id: '', name: '', address: '', description: '' });
                      },
                    },
                    '新建人格包'
                  )
                )
              );
            }
            var body = {
              persona: renderPersonaPanel,
              facts: renderFactsPanel,
              lore: renderLorePanel,
              memory: renderMemoryPanel,
              meta: renderMetaPanel,
              settings: renderSettingsPanel,
            }[tab];
            return body ? body() : null;
          }

          return el(
            'div',
            { className: 'psn-root' },
            el(
              'div',
              { className: 'psn-head' },
              el('span', { className: 'psn-title' }, '人格设定'),
              el('span', { className: 'psn-brand', title: '插件：Luminyx（夜光）' }, 'Luminyx'),
              el('span', { className: 'psn-ver' }, 'v' + ((overview && overview.version) || '0.0.0')),
              el('span', { className: 'psn-spacer' }),
              el(Toast, { toast: toast }),
              el(
                'button',
                { className: 'psn-btn', disabled: busy, onClick: function () { refreshOverview().then(function (data) { if (data) { loadPack(data.activeId); loadMemory(); } }); } },
                '刷新'
              )
            ),
            el(
              'div',
              { className: 'psn-card' },
              el(
                'div',
                { className: 'psn-row' },
                el('span', { className: 'psn-label' }, '人格包'),
                el(
                  'select',
                  {
                    className: 'psn-select',
                    value: activeId,
                    disabled: busy || locked,
                    onChange: function (event) { pickPack(event.target.value); },
                  },
                  el('option', { value: '' }, '— 不激活 —'),
                  packs.map(function (entry) {
                    return el(
                      'option',
                      { key: entry.id, value: entry.id },
                      entry.name + (entry.builtin ? ' · 内置' : '') + ' (' + entry.id + ')'
                    );
                  })
                ),
                el(
                  'button',
                  {
                    className: 'psn-btn',
                    disabled: busy,
                    onClick: function () { setCreateForm({ id: '', name: '', address: '', description: '' }); },
                  },
                  '新建'
                ),
                el('button', { className: 'psn-btn', disabled: busy || !activeId, onClick: duplicatePack }, '复制'),
                el('button', { className: 'psn-btn psn-danger', disabled: busy || !activeId || (pack && pack.builtin), onClick: removePack }, '删除'),
                el('span', { className: 'psn-spacer' }),
                locked
                  ? el('span', { className: 'psn-chip' }, '部署已固定 packId')
                  : null,
                overview && overview.active
                  ? el(
                      'span',
                      { className: 'psn-chip' },
                      '记忆 ',
                      el('b', null, String((overview.active.memory && overview.active.memory.count) || 0)),
                      ' · 档案 ',
                      el('b', null, String((overview.active.lore && overview.active.lore.total) || 0))
                    )
                  : null
              ),
              createForm
                ? el(
                    'div',
                    { className: 'psn-card', style: { background: 'transparent', gap: '8px' } },
                    el(
                      'div',
                      { className: 'psn-row psn-tight' },
                      el('input', {
                        className: 'psn-input',
                        placeholder: 'id（字母数字-_，作为目录名）',
                        value: createForm.id,
                        style: { flex: '1 1 160px' },
                        onChange: function (event) {
                          var value = event.target.value;
                          setCreateForm(function (previous) { return Object.assign({}, previous, { id: value }); });
                        },
                      }),
                      el('input', {
                        className: 'psn-input',
                        placeholder: '显示名称',
                        value: createForm.name,
                        style: { flex: '1 1 160px' },
                        onChange: function (event) {
                          var value = event.target.value;
                          setCreateForm(function (previous) { return Object.assign({}, previous, { name: value }); });
                        },
                      }),
                      el('input', {
                        className: 'psn-input',
                        placeholder: '默认称呼（可空）',
                        value: createForm.address,
                        style: { flex: '1 1 120px' },
                        onChange: function (event) {
                          var value = event.target.value;
                          setCreateForm(function (previous) { return Object.assign({}, previous, { address: value }); });
                        },
                      }),
                      el('button', { className: 'psn-btn psn-primary', disabled: busy, onClick: submitCreate }, '创建'),
                      el('button', { className: 'psn-btn', onClick: function () { setCreateForm(null); } }, '取消')
                    )
                  )
                : null
            ),
            el(
              'div',
              { className: 'psn-tabs' },
              tabs.map(function (item) {
                return el(
                  'button',
                  {
                    key: item.value,
                    type: 'button',
                    'data-on': tab === item.value ? '1' : '0',
                    onClick: function () { setTab(item.value); },
                  },
                  item.label
                );
              })
            ),
            renderActivePanel(),
            importForm ? importLayers() : null,
            el(
              'div',
              { className: 'psn-hint' },
              '人格包与记忆都在 ',
              el('code', null, '~/.dsh/persona/'),
              ' 下，纯文件；改完立刻生效，不用重启。'
            )
          );
        }

        /* ── 注册 ───────────────────────────────────────────────────────── */

        function apply(ctx) {
          ctx.slots.inject('settings.section', function () {
            return ctx.slots.register(
              {
                name: 'settings.section',
                id: 'persona',
                order: 60,
                label: function () {
                  return '人格设定';
                },
              },
              PersonaSettings
            );
          });
        }

        exports.name = PLUGIN_ID;
        exports.inject = inject;
        exports.apply = apply;
        return module.exports;
      },
    });
  } catch (err) {
    console.warn('[dsh-luminyx] client runtime error:', err);
  }
})();
