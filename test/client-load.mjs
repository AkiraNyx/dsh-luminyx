/**
 * 浏览器半自测：node test/client-load.mjs
 *
 * 设置页整块 UI 都在 client.js 里，一旦 UMD 包裹、slot 描述或首屏渲染出错，
 * 用户看到的就是设置页白屏，而宿主日志里什么都没有。所以这里验三件事：
 *   1) window.__ModuleLoader__.load 被正确调用，id / factory 形状对
 *   2) factory(require) 能拿到 name / inject / apply
 *   3) apply(ctx) 只注册 settings.section，且组件能在「数据未到」的首屏状态渲染出内容
 *
 * 渲染用一层极简 React 垫片：组件本身是纯函数，hooks 只需要按调用顺序返回稳定值，
 * 拿到 element 树后自己转成字符串。这样不需要 react-dom，也能覆盖真实的读取分支。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const APP_MANIFEST = process.env.DSH_APP_MANIFEST || 'E:/DSH NEXT/resources/app/package.json'
const appRequire = createRequire(APP_MANIFEST)

const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')

let passed = 0
let failed = 0

function check(label, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${label}`)
  } catch (error) {
    failed += 1
    console.log(`  ✗ ${label}`)
    console.log(`      ${error && error.message ? error.message : error}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

/* ── React 垫片 ──────────────────────────────────────────────────────── */

const hookCalls = []
let stateIndex = 0
let stateOverrides = []

const ReactShim = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    const merged = Object.assign({}, props || {})
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children
    return { type, props: merged }
  },
  useState(initial) {
    const overridden = stateIndex < stateOverrides.length ? stateOverrides[stateIndex] : undefined
    stateIndex += 1
    const value = overridden !== undefined ? overridden : typeof initial === 'function' ? initial() : initial
    hookCalls.push(['useState', value])
    return [value, () => {}]
  },
  useEffect(fn) {
    // 首屏不执行副作用：这时候还没有接口数据，正是要测的状态。
    hookCalls.push(['useEffect', typeof fn])
  },
  useMemo(fn) {
    return fn()
  },
  useCallback(fn) {
    return fn
  },
  useRef(value) {
    return { current: value }
  },
}

function render(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(render).join('')
  if (typeof node === 'function') return render(node({}))
  const { type, props } = node
  const attrs = props || {}
  if (type === ReactShim.Fragment) return render(attrs.children)
  if (typeof type === 'function') return render(type(attrs))
  if (typeof type !== 'string') return render(attrs.children)
  const className = attrs.className ? ` class="${attrs.className}"` : ''
  return `<${type}${className}>${render(attrs.children)}</${type}>`
}

/* ── 1. 加载 ─────────────────────────────────────────────────────────── */

section('1. 模块加载')

let captured = null
const warnings = []

globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      captured = spec
    },
  },
  prompt: () => null,
  confirm: () => false,
  alert: () => {},
}

const originalWarn = console.warn
console.warn = (...args) => warnings.push(args.map(String).join(' '))
// eslint-disable-next-line no-new-func
new Function('window', source)(globalThis.window)
console.warn = originalWarn

check('没有触发 client runtime error', () => {
  assert.deepEqual(warnings, [])
})

check('向 __ModuleLoader__ 注册了自己', () => {
  assert.ok(captured, 'load() 应被调用')
  assert.equal(captured.id, 'dsh-luminyx')
  assert.equal(typeof captured.factory, 'function')
})

check('运行时依赖的 react 在 DSH 里可解析', () => {
  const react = appRequire('react')
  assert.equal(typeof react.createElement, 'function')
  assert.equal(typeof react.useState, 'function')
})

const mod = captured.factory((name) => {
  if (name === 'react') return ReactShim
  return appRequire(name)
})

check('exports 形状正确', () => {
  assert.equal(mod.name, 'dsh-luminyx')
  assert.deepEqual(mod.inject, ['slots'])
  assert.equal(typeof mod.apply, 'function')
})

/* ── 2. 注册 ─────────────────────────────────────────────────────────── */

section('2. 落到设置页')

const registered = []
const ctx = {
  slots: {
    inject(name, fn) {
      assert.equal(name, 'settings.section', '只应注入 settings.section')
      fn()
    },
    register(description, Component) {
      registered.push({ description, Component })
      return () => {}
    },
  },
}

check('apply 不抛错', () => {
  mod.apply(ctx)
})

check('注册了且只注册了一个 settings.section', () => {
  assert.equal(registered.length, 1)
  assert.equal(registered[0].description.name, 'settings.section')
})

check('slot 描述字段齐全', () => {
  const { description } = registered[0]
  assert.equal(description.id, 'persona')
  assert.equal(description.order, 60)
  assert.equal(typeof description.label, 'function')
  assert.equal(description.label(), '人格设定')
  assert.equal(typeof registered[0].Component, 'function')
})

/* ── 3. 首屏渲染 ─────────────────────────────────────────────────────── */

section('3. 首屏渲染')

let html = ''

check('数据未到时渲染不抛错', () => {
  html = render(ReactShim.createElement(registered[0].Component))
  assert.ok(html.length > 0)
})

check('渲染出了面板骨架', () => {
  assert.ok(html.includes('psn-'), '应带上自己的 class 前缀')
})

check('首屏是加载态', () => {
  assert.ok(/读取|载入|加载/.test(html), `首屏应显示加载态，实际：${html.slice(0, 300)}`)
})

check('首屏没有依赖数据的控件', () => {
  assert.ok(!html.includes('新建人格包'), '数据没到之前不该出现创建入口')
})

check('组件按顺序声明了成对的 hook', () => {
  const states = hookCalls.filter(([kind]) => kind === 'useState').length
  const effects = hookCalls.filter(([kind]) => kind === 'useEffect').length
  assert.ok(states >= 8, `useState 数量偏少：${states}`)
  assert.ok(effects >= 1, '至少应有一个 useEffect 拉数据')
})

/* ── 4. 有数据时的主面板 ─────────────────────────────────────────────── */

section('4. 数据到齐后的主面板')

const overviewFixture = {
  plugin: { name: 'dsh-luminyx', version: '0.1.0' },
  activeId: 'example',
  locked: false,
  settings: {
    enabled: true,
    injectPersona: true,
    injectFacts: true,
    exposeTools: true,
    order: { persona: 9100, facts: 9120 },
    maxChars: { persona: 6000, facts: 3000 },
    recall: { limit: 3, minScore: 0.05 },
  },
  packs: [
    { id: 'example', name: '示例人格', address: '你', builtin: true, tags: ['demo'], personaChars: 120 },
  ],
}

const packFixture = {
  id: 'example',
  name: '示例人格',
  address: '你',
  description: '自测用',
  version: '1.0.0',
  builtin: true,
  persona: '# 示例人格\n\n正文一段。',
  facts: '- 一条常驻事实',
  loreJsonl: '{"id":"l1","title":"章节","text":"档案内容"}\n',
  loreCount: 1,
  chapters: [{ id: 'l1', title: '章节', text: '档案内容' }],
  files: { meta: true, persona: true, facts: true, lore: true },
  personaDoc: {
    preamble: '# 示例人格',
    blocks: [
      { id: 'b1', title: '身份', items: [{ text: '我是示例。', style: 'plain' }] },
      { id: 'b2', title: '语气', items: [{ text: '称呼「你」。', style: 'bullet' }] },
    ],
  },
  factsDoc: {
    preamble: '',
    items: [{ text: '一条常驻事实', style: 'bullet' }],
  },
  sectionPresets: ['身份', '语气', '不做的事'],
  muted: ['语气'],
}

hookCalls.length = 0
stateIndex = 0
// useState 顺序：overview / loaded / pack / tab / draft / doc / presets / meta ...
stateOverrides = [
  overviewFixture,
  true,
  packFixture,
  'persona',
  { persona: '# 示例人格\n\n正文一段。', facts: '- 一条常驻事实', lore: '' },
  { persona: packFixture.personaDoc, facts: packFixture.factsDoc },
  packFixture.sectionPresets,
]
// 索引 17 是「停用模块」状态：用示例把「语气」停掉，验证按钮与视觉标记。
stateOverrides[17] = ['语气']

let ready = ''

check('数据到齐后渲染不抛错', () => {
  stateIndex = 0
  ready = render(ReactShim.createElement(registered[0].Component))
  assert.ok(ready.length > 0)
})

check('主面板不再显示空态', () => {
  assert.ok(!ready.includes('还没有激活的人格包'), '有包时不该提示没有包')
  assert.ok(!ready.includes('正在读取人格包'))
})

check('主面板出现四个页签', () => {
  for (const label of ['人格正文', '常驻事实', '设定档案', '长期记忆']) {
    assert.ok(ready.includes(label), `缺少页签：${label}`)
  }
})

check('主面板带出包信息与开关', () => {
  assert.ok(ready.includes('示例人格'), '应显示包名')
  assert.ok(ready.includes('9100') || ready.includes('注入人格正文'), '应显示注入设置')
})

check('人格正文页是分块编辑器，不再是整块输入区', () => {
  assert.ok(ready.includes('添加模块'), '应有添加模块入口')
  assert.ok(ready.includes('+ 身份'), '应能一键加预设模块')
  assert.ok(ready.includes('+ 自定义'), '应能建自定义模块')
  assert.ok(ready.includes('顺序就是注入顺序'), '应有块顺序说明')
  const blockCount = (ready.match(/class="psn-block[ "]/g) || []).length
  assert.equal(blockCount, 2, '应渲染出两个模块卡片')
})

check('模块能停用，停用的块有明显区分', () => {
  assert.ok(ready.includes('从 Markdown 导入'), '人格正文页应有导入入口')
  assert.ok(ready.includes('已停用'), '被停用的模块按钮应显示已停用')
  assert.ok(ready.includes('psn-chip-warn'), '顶部应统计停用数量')
  assert.ok(ready.includes('psn-block-off'), '停用的块应带视觉标记')
  const offBlocks = (ready.match(/psn-block psn-block-off/g) || []).length
  assert.equal(offBlocks, 1, '只有一只块处于停用态')
})

check('块格式下拉按用途命名，不出现排版术语', () => {
  assert.ok(ready.includes('逐条要点'), '应有「逐条要点」')
  assert.ok(ready.includes('成段描述'), '应有「成段描述」')
  assert.ok(ready.includes('原样摘录'), '应有「原样摘录」')
  for (const word of ['>列表<', '>段落<', '>引用<']) {
    assert.ok(!ready.includes(word), `不该出现排版术语：${word}`)
  }
})

/* ── 5. 快照与导入弹层 ───────────────────────────────────────────────── */

section('5. 快照与导入弹层')

check('档案页带出版本快照区', () => {
  stateOverrides[3] = 'lore'
  stateOverrides[18] = {
    list: [
      { stamp: '20261028-120000', time: '2026-10-28T12:00:00.000Z', note: '保存前自动', chars: { persona: 1200, facts: 200 } },
    ],
    limit: 20,
  }
  stateIndex = 0
  const html = render(ReactShim.createElement(registered[0].Component))
  assert.ok(html.includes('版本快照'), '应有快照区标题')
  assert.ok(html.includes('立即备份'), '应有手动备份入口')
  assert.ok(html.includes('回滚到这里'), '每份快照应带回滚按钮')
  assert.ok(html.includes('1200 字'), '应显示该份快照的字数')
  assert.ok(html.includes('10-28'), '时间戳应转成本地可读格式')
})

check('导入弹层：先识别，再决定替换或追加', () => {
  stateOverrides[3] = 'persona'
  stateOverrides[19] = { kind: 'persona', text: '## 身份\n一段\n\n## 语气\n一段', doc: null, count: 0 }
  stateIndex = 0
  const before = render(ReactShim.createElement(registered[0].Component))
  assert.ok(before.includes('导入人格正文'), '弹层标题应说明导入的是什么')
  assert.ok(before.includes('识别'), '应有识别按钮')
  assert.ok(!before.includes('替换全部'), '还没识别时不该出现替换按钮')

  stateOverrides[19] = {
    kind: 'persona',
    text: '## 身份\n一段\n\n## 语气\n一段',
    doc: { preamble: '', blocks: [{ id: 'i1', title: '身份', items: [] }, { id: 'i2', title: '语气', items: [] }] },
    count: 2,
  }
  stateIndex = 0
  const after = render(ReactShim.createElement(registered[0].Component))
  assert.ok(after.includes('识别到 2 个模块'), '识别后应告诉用户切出了几个模块')
  assert.ok(after.includes('身份、语气'), '应列出模块名方便核对')
  assert.ok(after.includes('替换全部'), '识别后应能整体替换')
  assert.ok(after.includes('追加到末尾'), '识别后应能追加')
})

check('事实导入走条目语义，不出现模块二字', () => {
  stateOverrides[3] = 'facts'
  stateOverrides[19] = {
    kind: 'facts',
    text: '一条\n两条',
    doc: { preamble: '', items: [{ text: '一条', style: 'bullet' }, { text: '两条', style: 'bullet' }] },
    count: 2,
  }
  stateIndex = 0
  const html = render(ReactShim.createElement(registered[0].Component))
  assert.ok(html.includes('导入常驻事实'), '标题应区分事实')
  assert.ok(html.includes('识别到 2 条事实'), '事实按条计数')
})

stateOverrides = []

/* ── 汇总 ────────────────────────────────────────────────────────────── */

console.log(`\n全部通过：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exitCode = 1
