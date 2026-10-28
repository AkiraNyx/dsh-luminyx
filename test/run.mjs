/**
 * 自测：node test/run.mjs
 *
 * 覆盖四层：
 *   1) 纯函数（rank / chunk / meta）
 *   2) 文件层（pack / lore / memory / state）—— 跑在临时 DSH_HOME 里，不碰真实数据
 *   3) 装配层：用 mock ctx 调 apply()，验证注入了两段、注册了 6 个工具、切包后段文本立刻变
 *   4) 界面接口：起一个真 http server 挂上路由，用 fetch 走一遍设置页要用的每个接口
 *
 * 任何一条断言失败以非零码退出。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-test-'))
process.env.DSH_HOME = HOME

const { DEFAULT_SETTINGS, readSettings, writeSettings, readActiveId, writeActiveId, personaRoot, userPacksRoot } =
  await import('../lib/state.js')
const packLib = await import('../lib/pack.js')
const loreLib = await import('../lib/lore.js')
const memoryLib = await import('../lib/memory.js')
const rankLib = await import('../lib/rank.js')
const personaLib = await import('../lib/persona.js')
const snapshotLib = await import('../lib/snapshot.js')

let passed = 0
let failed = 0

function check(label, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${label}`)
  } catch (error) {
    failed += 1
    console.log(`  ✗ ${label}\n      ${error.message}`)
  }
}

async function checkAsync(label, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ✓ ${label}`)
  } catch (error) {
    failed += 1
    console.log(`  ✗ ${label}\n      ${error.message}`)
  }
}

function section(name) {
  console.log(`\n${name}`)
}

/* ── 1. 纯函数 ─────────────────────────────────────────────────────────── */

section('1. 纯函数')

check('clampText 不截断短文本', () => {
  assert.equal(rankLib.clampText('abc', 10), 'abc')
})

check('clampText 超长时截断并标注', () => {
  const out = rankLib.clampText('a'.repeat(50), 10)
  assert.match(out, /^a{10}/)
  assert.match(out, /截断|truncat/i)
})

check('similarity 命中关键词得分更高', () => {
  const text = '用户偏好结论先行，讨厌铺垫'
  const hit = rankLib.similarity(text, '结论 铺垫')
  const miss = rankLib.similarity(text, '香蕉 苹果')
  assert.ok(hit > miss, `期望 ${hit} > ${miss}`)
})

check('rank 按相关度排序并带分数', () => {
  const docs = [
    { id: 'a', text: '用户偏好结论先行' },
    { id: 'b', text: '周末喜欢爬山' },
  ]
  const hits = rankLib.rank('结论 先行', docs, { limit: 2, minScore: 0 })
  assert.equal(hits[0].doc.id, 'a')
  assert.ok(hits[0].score > 0)
})

/* ── 2. 文件层 ─────────────────────────────────────────────────────────── */

section('2. 文件层')

check('默认设置符合预期', () => {
  const settings = readSettings()
  assert.equal(settings.enabled, true)
  assert.equal(settings.order.persona, DEFAULT_SETTINGS.order.persona)
  assert.equal(settings.maxChars.persona, DEFAULT_SETTINGS.maxChars.persona)
})

check('设置可写可读，且嵌套字段合并而非覆盖', () => {
  writeSettings({ order: { persona: 9200 } })
  writeSettings({ injectFacts: false })
  const settings = readSettings()
  assert.equal(settings.order.persona, 9200)
  assert.equal(settings.order.facts, DEFAULT_SETTINGS.order.facts)
  assert.equal(settings.injectFacts, false)
})

check('active.json 往返', () => {
  writeActiveId('demo')
  assert.equal(readActiveId(), 'demo')
  writeActiveId('')
  assert.equal(readActiveId(), '')
})

check('内置包被发现', () => {
  const all = packLib.listPacks()
  const example = all.find((entry) => entry.id === 'example')
  assert.ok(example, '示例内置包应存在')
  assert.equal(example.builtin, true)
  assert.ok(example.name.length > 0)
})

check('内置包能加载出人格正文、事实与档案', () => {
  const pack = packLib.loadPack('example')
  assert.ok(pack.persona.includes('我'), 'persona.md 应有内容')
  assert.ok(pack.facts.length > 0, 'facts.md 应有内容')
  assert.ok(pack.lore.length >= 1, 'lore.jsonl 应有至少一条')
  assert.ok(pack.lore.every((entry) => entry.id && entry.text))
})

check('非法 id 被拒绝', () => {
  assert.throws(() => packLib.assertValidId('../etc'), /id/)
  assert.throws(() => packLib.assertValidId('UPPER'), /id/)
  assert.throws(() => packLib.assertValidId(''), /id/)
})

check('新建人格包会生成四个文件', () => {
  const created = packLib.createPack({ id: 'demo', name: '演示', address: '你' })
  assert.equal(created.id, 'demo')
  for (const file of ['pack.json', 'persona.md', 'facts.md', 'lore.jsonl']) {
    assert.ok(fs.existsSync(path.join(created.dir, file)), `缺少 ${file}`)
  }
})

check('重复 id 不能新建', () => {
  assert.throws(() => packLib.createPack({ id: 'demo', name: '再来一个' }), /已存在/)
})

check('保存人格正文后立即可读', () => {
  packLib.savePackFile('demo', 'persona', '# 新正文\n\n我是演示人格。')
  const pack = packLib.loadPack('demo')
  assert.ok(pack.persona.includes('演示人格'))
})

check('编辑内置包会先 fork 到用户目录', () => {
  const target = packLib.packFilePath('example', 'facts')
  assert.ok(target.startsWith(userPacksRoot()), `应写到用户目录，实际 ${target}`)
})

check('复制人格包', () => {
  const copy = packLib.duplicatePack('demo', 'demo-copy', '演示副本')
  assert.equal(copy.id, 'demo-copy')
  const loaded = packLib.loadPack('demo-copy')
  assert.ok(loaded.persona.includes('演示人格'))
})

check('删除人格包', () => {
  packLib.removePack('demo-copy')
  assert.equal(packLib.loadPack('demo-copy'), null)
})

check('markdown 分块按标题切且不丢正文', () => {
  const chunks = packLib.chunkMarkdown('# 一\n\n甲。\n\n## 二\n\n乙。\n\n丙。\n')
  assert.equal(chunks.length, 2)
  assert.ok(chunks[0].text.includes('甲'))
  assert.ok(chunks[1].text.includes('乙') && chunks[1].text.includes('丙'))
})

check('档案检索命中关键词并带分数', () => {
  const pack = packLib.loadPack('example')
  const hits = loreLib.searchLore(pack, '情绪 低落', { limit: 3 })
  assert.ok(hits.length >= 1, '应命中至少一条')
  assert.ok(hits[0].score > 0)
})

check('档案按章节读取', () => {
  const pack = packLib.loadPack('example')
  const chapters = loreLib.listChapters(pack)
  assert.ok(chapters.length >= 1)
  const read = loreLib.readLore(pack, { chapter: chapters[0].chapter, limit: 5 })
  assert.ok(read.entries.length >= 1)
})

check('记忆写入 / 列出 / 遗忘 / 清理', () => {
  const pack = packLib.loadPack('demo')
  const file = pack.memoryFile
  memoryLib.addMemory(file, { text: '用户偏好先看结论', importance: 3 })
  memoryLib.addMemory(file, { text: '用户讨厌铺垫', importance: 2 })
  memoryLib.addMemory(file, { text: '用户在做 DSH 插件', importance: 4 })
  assert.equal(memoryLib.countMemory(file), 3)

  const rows = memoryLib.listMemory(file)
  assert.equal(rows.length, 3)

  const forgotten = memoryLib.forgetMemory(file, { query: '铺垫' })
  assert.ok(forgotten.removed && forgotten.removed.text.includes('铺垫'), '应删掉最匹配的那条')
  assert.equal(memoryLib.countMemory(file), 2)

  const pruned = memoryLib.pruneMemory(file, { keep: 1 })
  assert.equal(pruned.removed, 1)
  assert.equal(memoryLib.countMemory(file), 1)
})

check('记忆召回按相关度排序', () => {
  const pack = packLib.loadPack('demo')
  const file = pack.memoryFile
  memoryLib.addMemory(file, { text: '周末喜欢爬山', importance: 2 })
  memoryLib.addMemory(file, { text: '工作时先给结论', importance: 3 })
  const hits = memoryLib.recall(file, '结论', { limit: 2, minScore: 0 })
  assert.ok(hits.length >= 1)
  assert.ok(hits[0].entry.text.includes('结论'))
})

/* ── 3. 装配层：mock ctx 跑 apply() ───────────────────────────────────── */

section('3. 装配层')

const sections = []
const tools = new Map()
const effects = []
const warnings = []

function makeCtx(options = {}) {
  const webServer = options.webServer || null
  return {
    logger: {
      warn: (message) => warnings.push(String(message)),
      info: () => {},
      debug: () => {},
    },
    systemPrompt: {
      section(spec) {
        sections.push(spec)
        return () => {
          const index = sections.indexOf(spec)
          if (index >= 0) sections.splice(index, 1)
        }
      },
    },
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    inject(names, fn) {
      // 没有 webServer 时回调不应被调用，也不应抛。
      if (names.includes('webServer')) {
        if (!webServer) return () => {}
        return fn({ webServer })
      }
      return fn({})
    },
    effect(fn) {
      effects.push(fn)
      const dispose = fn()
      return dispose
    },
  }
}

writeSettings({ ...DEFAULT_SETTINGS, injectFacts: true, injectPersona: true, exposeTools: true })
writeActiveId('example')

const plugin = await import('../index.js')
const ctx = makeCtx()
plugin.apply(ctx, {})

check('注入了两个系统提示段', () => {
  const names = sections.map((entry) => entry.name).sort()
  assert.deepEqual(names, ['persona:facts', 'persona:main'])
})

check('段的 order 落在工具清单之后、结构化输出之前', () => {
  for (const entry of sections) {
    assert.ok(entry.order > 5000, `${entry.name} order 应大于工具 SDK 段`)
    assert.ok(entry.order < 9900, `${entry.name} order 应小于结构化输出段`)
  }
})

check('段文本为函数且返回人格正文', () => {
  const main = sections.find((entry) => entry.name === 'persona:main')
  assert.equal(typeof main.text, 'function')
  const text = main.text({})
  assert.ok(text.includes('示例人格'), `实际：${String(text).slice(0, 60)}`)
  assert.equal(main.interpolate, false)
})

check('段文本每次求值都重新读盘（改文件即生效）', () => {
  const main = sections.find((entry) => entry.name === 'persona:main')
  const before = main.text({})
  packLib.savePackFile('example', 'persona', '# 即时生效\n\n我是改过之后的正文。')
  const after = main.text({})
  assert.notEqual(before, after)
  assert.ok(after.includes('即时生效'))
})

check('注册了 6 个 persona 工具', () => {
  assert.deepEqual([...tools.keys()].sort(), [
    'persona_forget',
    'persona_lore',
    'persona_packs',
    'persona_recall',
    'persona_remember',
    'persona_status',
  ])
})

check('每个工具都有 output.schema 与 render', () => {
  for (const [name, definition] of tools) {
    assert.ok(definition.output && definition.output.schema, `${name} 缺 output.schema`)
    assert.equal(typeof definition.output.render, 'function', `${name} 缺 output.render`)
    assert.equal(typeof definition.execute, 'function', `${name} 缺 execute`)
    assert.equal(definition.parameters.type, 'object', `${name} parameters 应为 object`)
  }
})

await checkAsync('persona_status 报告当前激活包', async () => {
  const result = await tools.get('persona_status').execute({})
  assert.equal(result.active.id, 'example')
  assert.equal(result.injecting.persona, true)
})

await checkAsync('persona_recall 能从记忆里捞到刚写的内容', async () => {
  const pack = packLib.loadPack('example')
  memoryLib.addMemory(pack.memoryFile, { text: '用户在写 dsh 人格插件', importance: 4 })
  const result = await tools.get('persona_recall').execute({ query: '人格插件', limit: 3 })
  assert.ok(result.hits.length >= 1)
  assert.ok(result.hits[0].text.includes('人格插件'))
})

await checkAsync('persona_remember 写一条记忆', async () => {
  const before = memoryLib.countMemory(packLib.loadPack('example').memoryFile)
  await tools.get('persona_remember').execute({ text: '用户要求中文回答', importance: 3 })
  const after = memoryLib.countMemory(packLib.loadPack('example').memoryFile)
  assert.equal(after, before + 1)
})

await checkAsync('persona_lore 返回章节与检索结果', async () => {
  const chapters = await tools.get('persona_lore').execute({ action: 'chapters' })
  assert.ok(chapters.chapters.length >= 1)
  assert.ok(chapters.chapters[0].chapter && chapters.chapters[0].count >= 1)
  const hits = await tools.get('persona_lore').execute({ action: 'search', query: '情绪' })
  assert.ok(Array.isArray(hits.hits))
})

check('关闭注入后段文本为空串', () => {
  writeSettings({ injectPersona: false })
  const fresh = makeCtx()
  sections.length = 0
  plugin.apply(fresh, {})
  const main = sections.find((entry) => entry.name === 'persona:main')
  assert.equal(main.text({}), '')
  writeSettings({ injectPersona: true })
})

check('人格文件损坏时降级为空串而不是抛错', () => {
  const fresh = makeCtx()
  sections.length = 0
  plugin.apply(fresh, {})
  const main = sections.find((entry) => entry.name === 'persona:main')
  const file = packLib.packFilePath('example', 'persona')
  const backup = fs.readFileSync(file, 'utf8')
  fs.writeFileSync(file, '', 'utf8')
  assert.equal(main.text({}), '')
  fs.writeFileSync(file, backup, 'utf8')
})

/* ── 4. 设置页接口（真跑一个 http server） ───────────────────────────── */

section('4. 设置页接口')

let registration = null
const webCtx = makeCtx({
  webServer: {
    register(entry) {
      registration = entry
      return () => {
        registration = null
      }
    },
  },
})

writeActiveId('example')
plugin.apply(webCtx, {})

const server = http.createServer((req, res) => {
  if (registration && typeof registration.handler === 'function') {
    registration.handler(req, res)
    return
  }
  res.writeHead(500)
  res.end('no handler')
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

async function call(pathname, options = {}) {
  const init = { method: options.method || 'GET' }
  if (options.body) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(options.body)
  }
  const response = await fetch(base + pathname, init)
  const payload = await response.json().catch(() => ({}))
  return { status: response.status, payload }
}

check('路由以前缀 /persona 注册', () => {
  assert.ok(registration, '应当注册了 http 路由')
  assert.equal(registration.kind, 'prefix')
  assert.equal(registration.path, '/persona')
})

await checkAsync('GET /overview 返回激活包、设置与包列表', async () => {
  const { status, payload } = await call('/persona/api/overview')
  assert.equal(status, 200)
  assert.equal(payload.activeId, 'example')
  assert.ok(payload.settings && typeof payload.settings.enabled === 'boolean')
  assert.ok(Array.isArray(payload.packs) && payload.packs.length >= 1)
  assert.equal(payload.locked, false)
})

await checkAsync('GET /pack 返回正文、事实与档案行', async () => {
  const { status, payload } = await call('/persona/api/pack?id=example')
  assert.equal(status, 200)
  assert.ok(payload.persona.length > 0)
  assert.ok(payload.facts.length > 0)
  assert.ok(typeof payload.loreJsonl === 'string')
  assert.ok(payload.loreCount >= 1)
})

await checkAsync('PUT /pack 写入文件并立刻生效', async () => {
  const { status } = await call('/persona/api/pack', {
    method: 'PUT',
    body: { id: 'example', file: 'facts', content: '# 事实\n\n- 接口测试写进来的一条。\n' },
  })
  assert.equal(status, 200)
  const { payload } = await call('/persona/api/pack?id=example')
  assert.ok(payload.facts.includes('接口测试写进来的一条'))
})

await checkAsync('PUT /pack 保存包信息不会丢 version / tags', async () => {
  const before = packLib.loadPack('example')
  const { status } = await call('/persona/api/pack', {
    method: 'PUT',
    body: {
      id: 'example',
      file: 'pack.json',
      meta: {
        name: '示例人格（改）',
        address: before.address,
        description: before.description,
        version: before.version,
        signature: before.signature,
        tags: before.tags,
        createdAt: before.createdAt,
      },
    },
  })
  assert.equal(status, 200)
  const after = packLib.loadPack('example')
  assert.equal(after.name, '示例人格（改）')
  assert.deepEqual(after.tags, before.tags)
  assert.equal(after.version, before.version)
})

await checkAsync('PUT /active 切换激活包', async () => {
  const { status, payload } = await call('/persona/api/active', { method: 'PUT', body: { id: 'demo' } })
  assert.equal(status, 200)
  assert.equal(payload.activeId, 'demo')
  assert.equal(readActiveId(), 'demo')
})

await checkAsync('PUT /active 拒绝不存在的包', async () => {
  const { status } = await call('/persona/api/active', { method: 'PUT', body: { id: 'no-such-pack' } })
  assert.equal(status, 400)
})

await checkAsync('PUT /settings 合并写入并让段文本跟上', async () => {
  const { status, payload } = await call('/persona/api/settings', {
    method: 'PUT',
    body: { injectPersona: false },
  })
  assert.equal(status, 200)
  assert.equal(payload.settings.injectPersona, false)
  assert.equal(payload.settings.order.facts, DEFAULT_SETTINGS.order.facts, '未涉及的嵌套字段不应被覆盖')
  const main = sections.filter((entry) => entry.name === 'persona:main').pop()
  assert.equal(main.text({}), '')
  await call('/persona/api/settings', { method: 'PUT', body: { injectPersona: true } })
})

await checkAsync('POST /memory 写入后 GET 能读到', async () => {
  await call('/persona/api/active', { method: 'PUT', body: { id: 'example' } })
  const added = await call('/persona/api/memory', {
    method: 'POST',
    body: { action: 'add', text: '接口层写入的记忆', importance: 3 },
  })
  assert.equal(added.status, 200)
  assert.equal(added.payload.created, true)
  const { payload } = await call('/persona/api/memory')
  assert.ok(payload.rows.some((row) => row.text === '接口层写入的记忆'))
})

await checkAsync('POST /memory forget 按内容删除并返回条数', async () => {
  const { payload } = await call('/persona/api/memory', {
    method: 'POST',
    body: { action: 'forget', query: '接口层写入的记忆' },
  })
  assert.equal(payload.removed, 1)
  assert.ok(payload.entry && payload.entry.text.includes('接口层写入'))
})

await checkAsync('POST /lore 检索命中', async () => {
  const { status, payload } = await call('/persona/api/lore', {
    method: 'POST',
    body: { action: 'search', query: '情绪' },
  })
  assert.equal(status, 200)
  assert.ok(Array.isArray(payload.hits))
})

await checkAsync('未知路由返回 404 而不是崩', async () => {
  const { status, payload } = await call('/persona/api/nope')
  assert.equal(status, 404)
  assert.match(String(payload.error || ''), /没有这个接口/)
})

await checkAsync('没有激活包时 /memory 返回 409', async () => {
  await call('/persona/api/active', { method: 'PUT', body: { id: '' } })
  const { status } = await call('/persona/api/memory')
  assert.equal(status, 409)
  await call('/persona/api/active', { method: 'PUT', body: { id: 'example' } })
})

/* ── 4b. 结构化文档接口 ───────────────────────────────────────────────── */

section('4b. 结构化文档接口')

const originalPersona = (await call('/persona/api/pack?id=example')).payload.persona

await checkAsync('PUT /pack 收结构化 doc，落盘仍是 markdown', async () => {
  const doc = {
    preamble: '# 测试包\n\n一句话说明。',
    blocks: [
      { title: '身份', items: [{ text: '我是测试人格。', style: 'plain' }] },
      {
        title: '语气',
        items: [
          { text: '称呼「你」。', style: 'bullet' },
          { text: '语气词只作点缀。', style: 'bullet' },
        ],
      },
      { title: '台词', items: [{ text: '「唔，先这样。」', style: 'quote' }] },
    ],
  }
  const { status, payload } = await call('/persona/api/pack', {
    method: 'PUT',
    body: { id: 'example', file: 'persona', doc },
  })
  assert.equal(status, 200)
  assert.equal(payload.doc.blocks.length, 3)
  assert.equal(payload.doc.blocks[1].items.length, 2)
  assert.equal(payload.doc.blocks[2].items[0].style, 'quote')
  assert.match(payload.text, /^## 语气$/m)
  assert.match(payload.text, /^- 称呼「你」。$/m)
  assert.match(payload.text, /^> 「唔，先这样。」$/m)
})

await checkAsync('GET /pack 回来的 doc 与提交的一致', async () => {
  const { payload } = await call('/persona/api/pack?id=example')
  assert.equal(payload.personaDoc.blocks.length, 3)
  assert.equal(payload.personaDoc.blocks[0].title, '身份')
  assert.equal(payload.personaDoc.blocks[0].items[0].style, 'plain')
  assert.match(payload.persona, /一句话说明。/)
})

await checkAsync('GET /pack 带上预设模块名', async () => {
  const { payload } = await call('/persona/api/pack?id=example')
  assert.ok(Array.isArray(payload.sectionPresets))
  assert.ok(payload.sectionPresets.includes('身份'))
})

await checkAsync('空正文的模块留骨架，标题也空的才被丢掉', async () => {
  const { payload } = await call('/persona/api/pack', {
    method: 'PUT',
    body: {
      id: 'example',
      file: 'persona',
      doc: {
        preamble: '',
        blocks: [
          { title: '有内容', items: [{ text: '留着。', style: 'bullet' }] },
          { title: '只有标题', items: [{ text: '', style: 'bullet' }] },
          { title: '', items: [{ text: '', style: 'bullet' }] },
        ],
      },
    },
  })
  assert.equal(payload.doc.blocks.length, 2)
  assert.equal(payload.doc.blocks[1].title, '只有标题')
})

await checkAsync('facts 结构化保存保留说明区与条目', async () => {
  const { payload } = await call('/persona/api/pack', {
    method: 'PUT',
    body: {
      id: 'example',
      file: 'facts',
      doc: {
        preamble: '> 这段是说明，不算条目。',
        items: [
          { text: '称呼「你」。', style: 'bullet' },
          { text: '底线：不消失。', style: 'bullet' },
        ],
      },
    },
  })
  assert.equal(payload.doc.items.length, 2)
  assert.match(payload.text, /^> 这段是说明，不算条目。$/m)
  assert.match(payload.text, /^- 底线：不消失。$/m)
})

// 收尾还原，后面的测试还要用原始 example 包。
await call('/persona/api/pack', {
  method: 'PUT',
  body: { id: 'example', file: 'persona', content: originalPersona },
})

/* ── 4c. 快照 / 模块开关 / 导入 ─────────────────────────────────────── */

section('4c. 快照、模块开关与导入接口')

const API_A = '## 身份\n\n- 甲。\n\n## 语气\n\n- 简短。\n'

await call('/persona/api/pack', {
  method: 'POST',
  body: { action: 'create', id: 'snapapi', name: '快照接口测试', address: '你' },
})
await call('/persona/api/pack', {
  method: 'PUT',
  body: { id: 'snapapi', file: 'persona', content: API_A },
})

await checkAsync('POST /snapshot 手动备份后 GET /snapshots 能看到', async () => {
  const made = await call('/persona/api/snapshot', {
    method: 'POST',
    body: { id: 'snapapi', action: 'create', note: '测试备份' },
  })
  assert.equal(made.status, 200, JSON.stringify(made.payload))
  assert.ok(made.payload.snapshot && made.payload.snapshot.stamp, '应返回新快照')
  const listed = await call('/persona/api/snapshots?id=snapapi')
  assert.equal(listed.status, 200)
  assert.equal(listed.payload.limit, 20)
  assert.ok(listed.payload.list.length >= 1)
  assert.equal(listed.payload.list[0].note, '测试备份')
})

await checkAsync('POST /snapshot restore 把正文换回快照内容', async () => {
  const stamp = (await call('/persona/api/snapshots?id=snapapi')).payload.list[0].stamp
  await call('/persona/api/pack', {
    method: 'PUT',
    body: { id: 'snapapi', file: 'persona', content: '## 身份\n\n- 临时改坏。\n' },
  })
  const restored = await call('/persona/api/snapshot', {
    method: 'POST',
    body: { id: 'snapapi', action: 'restore', stamp },
  })
  assert.equal(restored.status, 200, JSON.stringify(restored.payload))
  assert.ok(restored.payload.written.includes('persona'))
  const pack = await call('/persona/api/pack?id=snapapi')
  assert.deepEqual(pack.payload.personaDoc.blocks.map((b) => b.title), ['身份', '语气'])
  assert.match(pack.payload.persona, /甲/)
  assert.ok(!pack.payload.persona.includes('临时改坏'), '恢复后不该残留改坏的内容')
})

await checkAsync('PUT /muted 停用模块后注入文本立刻变短，编辑器仍看得到', async () => {
  const before = (await call('/persona/api/pack?id=snapapi')).payload
  const muted = await call('/persona/api/muted', {
    method: 'PUT',
    body: { id: 'snapapi', title: '身份', mute: true },
  })
  assert.equal(muted.status, 200, JSON.stringify(muted.payload))
  assert.deepEqual(muted.payload.muted, ['身份'])
  const after = (await call('/persona/api/pack?id=snapapi')).payload
  assert.ok(!after.persona.includes('甲'), '停用的模块不该进注入文本')
  assert.match(after.persona, /简短/)
  assert.equal(after.personaDoc.blocks.length, before.personaDoc.blocks.length, '编辑器仍要看到全部模块')
  const back = await call('/persona/api/muted', {
    method: 'PUT',
    body: { id: 'snapapi', title: '身份', mute: false },
  })
  assert.deepEqual(back.payload.muted, [])
})

await checkAsync('POST /doc/parse 把粘贴的 Markdown 切成模块', async () => {
  const { status, payload } = await call('/persona/api/doc/parse', {
    method: 'POST',
    body: { kind: 'persona', text: '## 一\n- a\n\n## 二\n- b\n' },
  })
  assert.equal(status, 200)
  assert.equal(payload.count, 2)
  assert.equal(payload.doc.blocks[1].title, '二')
})

await call('/persona/api/pack', { method: 'POST', body: { action: 'remove', id: 'snapapi' } })


await new Promise((resolve) => server.close(resolve))

/* ── 5. 官方校验器 ───────────────────────────────────────────────────── */

section('5. 官方 schema 校验')

const appManifest = process.env.DSH_APP_MANIFEST || 'E:/DSH NEXT/resources/app/package.json'
let toolsValidator = null
try {
  toolsValidator = createRequire(appManifest)('@deepseek-ai/dsh-tools')
} catch {
  toolsValidator = null
}

if (toolsValidator) {
  // 宿主注册工具时会真的跑这个校验：schema 用了不支持的 keyword（比如 minimum），
  // 不是少个提示，而是整个插件加载失败。所以这里对着官方实现验一遍。
  for (const [toolName, definition] of tools) {
    check(`${toolName} 的 schema 通过 dsh-tools 校验`, () => {
      toolsValidator.assertSupportedJsonSchema(definition.parameters)
      toolsValidator.assertSupportedJsonSchema(definition.output.schema)
    })
  }
} else {
  console.log('  - 跳过：本机找不到 @deepseek-ai/dsh-tools（可用 DSH_APP_MANIFEST 指定）')
}

/* ── 6. 参数边界 ─────────────────────────────────────────────────────── */

section('6. 参数边界')

await checkAsync('persona_recall 的 limit 收敛到 1–20', async () => {
  writeActiveId('example')
  const recallTool = tools.get('persona_recall')
  const low = await recallTool.execute({ query: '记忆', limit: -5 })
  assert.ok(Array.isArray(low.hits), '负数 limit 不该抛错')
  const high = await recallTool.execute({ query: '记忆', limit: 999 })
  assert.ok(high.hits.length <= 20)
  const junk = await recallTool.execute({ query: '记忆', limit: 'abc' })
  assert.ok(Array.isArray(junk.hits))
})

await checkAsync('persona_remember 的 importance 收敛到 1–5', async () => {
  const rememberTool = tools.get('persona_remember')
  const out = await rememberTool.execute({ text: '边界测试记忆', importance: 99 })
  assert.ok(out && out.id, '应该写入成功')
  const list = (await import('../lib/memory.js')).listMemory(
    (await import('../lib/pack.js')).loadPack('example').memoryFile,
    { limit: 50 }
  )
  const row = list.find((entry) => entry.text === '边界测试记忆')
  assert.equal(row.importance, 5)
})

/* ── 7. 分块文档的解析与序列化 ───────────────────────────────────────── */

section('7. 分块文档')

const samplePersona = [
  '# 示例人格',
  '',
  '> 一句话说明。',
  '',
  '## 身份',
  '我是示例人格。',
  '',
  '## 语气',
  '- 称呼「你」',
  '- 语气词作点缀',
  '',
  '## 台词',
  '> 「唔，先这样。」',
].join('\n')

check('解析出 3 个模块，标题与条目样式都对', () => {
  const doc = personaLib.parsePersonaDoc(samplePersona)
  assert.equal(doc.blocks.length, 3)
  assert.equal(doc.blocks[0].title, '身份')
  assert.equal(doc.blocks[1].title, '语气')
  assert.equal(doc.blocks[1].items.length, 2)
  assert.equal(doc.blocks[1].items[0].style, 'bullet')
  assert.equal(doc.blocks[2].items[0].style, 'quote')
  assert.equal(doc.blocks[0].items[0].style, 'plain')
})

check('第一个模块之前的内容进文件头，不丢', () => {
  const doc = personaLib.parsePersonaDoc(samplePersona)
  assert.match(doc.preamble, /^# 示例人格/)
  assert.match(doc.preamble, /> 一句话说明。/)
})

check('序列化再解析得到同一结构（往返稳定）', () => {
  const once = personaLib.serializePersonaDoc(personaLib.parsePersonaDoc(samplePersona))
  const docA = personaLib.parsePersonaDoc(once)
  const docB = personaLib.parsePersonaDoc(personaLib.serializePersonaDoc(docA))
  assert.equal(JSON.stringify(docA), JSON.stringify(docB))
  assert.equal(docA.blocks.length, 3)
})

check('正文为空时序列化返回空串，不留空标题', () => {
  assert.equal(personaLib.serializePersonaDoc({ preamble: '', blocks: [] }), '')
  assert.equal(personaLib.serializePersonaDoc(null), '')
})

check('空正文的模块保留标题，标题也空的才丢弃', () => {
  const text = personaLib.serializePersonaDoc({
    preamble: '',
    blocks: [
      { title: '留着', items: [{ text: '有内容', style: 'bullet' }] },
      { title: '只有标题', items: [{ text: '  ', style: 'bullet' }] },
      { title: '', items: [{ text: '', style: 'bullet' }] },
    ],
  })
  assert.match(text, /^## 留着$/m)
  assert.match(text, /^## 只有标题$/m)
  assert.equal((text.match(/^## /gm) || []).length, 2)
})

check('删掉一块后，注入文本里就少一块且顺序不变', () => {
  const doc = personaLib.parsePersonaDoc(samplePersona)
  doc.blocks.splice(0, 1)
  doc.blocks.push({ title: '新增', items: [{ text: '新的一节。', style: 'plain' }] })
  const text = personaLib.serializePersonaDoc(doc)
  assert.ok(!text.includes('## 身份'))
  assert.ok(text.indexOf('## 语气') < text.indexOf('## 台词'))
  assert.ok(text.indexOf('## 台词') < text.indexOf('## 新增'))
})

check('常驻事实：列表项进条目，其余进说明区', () => {
  const doc = personaLib.parseFactsDoc([
    '# 示例人格',
    '> 常驻事实。',
    '- 称呼「你」',
    '- 20 岁',
  ].join('\n'))
  assert.equal(doc.items.length, 2)
  assert.equal(doc.items[1].text, '20 岁')
  assert.match(doc.preamble, /^# 示例人格/)
})

check('常驻事实往返稳定', () => {
  const once = personaLib.serializeFactsDoc(personaLib.parseFactsDoc('- 甲\n- 乙\n'))
  const docA = personaLib.parseFactsDoc(once)
  const docB = personaLib.parseFactsDoc(personaLib.serializeFactsDoc(docA))
  assert.equal(JSON.stringify(docA), JSON.stringify(docB))
  assert.equal(docA.items.length, 2)
})

check('suggestTitle 撞名时补序号', () => {
  assert.equal(personaLib.suggestTitle([], '语气'), '语气')
  assert.equal(personaLib.suggestTitle([{ title: '语气' }], '语气'), '语气 2')
  assert.equal(
    personaLib.suggestTitle([{ title: '语气' }, { title: '语气 2' }], '语气'),
    '语气 3'
  )
})

check('解析不会吞掉含特殊字符的正文', () => {
  const text = '## 边界\n- 不写「抱歉」这类词\n- 保留 `code` 与 **加粗**\n'
  const doc = personaLib.parsePersonaDoc(text)
  assert.equal(doc.blocks[0].items.length, 2)
  assert.match(doc.blocks[0].items[1].text, /\*\*加粗\*\*/)
  assert.match(personaLib.serializePersonaDoc(doc), /`code`/)
})

check('没写模块名的块不产生空标题', () => {
  const text = personaLib.serializePersonaDoc({
    preamble: '',
    blocks: [{ title: '', items: [{ text: '一段裸正文。', style: 'plain' }] }],
  })
  assert.equal(text, '一段裸正文。\n')
  assert.ok(!text.includes('##'))
})

/* ── 8. 快照 / 模块开关 / Markdown 导入 ─────────────────────────────── */

section('8. 快照、模块开关与导入')

packLib.createPack({ id: 'snap', name: '快照测试', address: '你' })
const SNAP_A = '## 身份\n\n- 甲。\n'
const SNAP_B = '## 身份\n\n- 乙。\n'

check('保存前就留下改动前的内容', () => {
  const before = packLib.loadPack('snap').persona
  packLib.savePackFile('snap', 'persona', SNAP_A)
  const list = snapshotLib.listSnapshots('snap')
  assert.equal(list.length, 1, '应有一份快照')
  const snap = snapshotLib.readSnapshot('snap', list[0].stamp)
  assert.equal(snap.content['persona.md'], before)
})

check('连续保存同样内容不会重复堆快照', () => {
  packLib.savePackFile('snap', 'persona', SNAP_A)
  const steady = snapshotLib.listSnapshots('snap').length
  packLib.savePackFile('snap', 'persona', SNAP_A)
  assert.equal(snapshotLib.listSnapshots('snap').length, steady)
})

check('改了内容会再存一份，新的在前', () => {
  packLib.savePackFile('snap', 'persona', SNAP_B)
  const list = snapshotLib.listSnapshots('snap')
  assert.ok(list.length >= 2)
  assert.ok(list[0].stamp > list[1].stamp, '列表应按时间倒序')
  assert.equal(snapshotLib.readSnapshot('snap', list[0].stamp).content['persona.md'], SNAP_A)
})

check('恢复快照能把正文退回去', () => {
  const target = snapshotLib
    .listSnapshots('snap')
    .find((row) => snapshotLib.readSnapshot('snap', row.stamp).content['persona.md'] === SNAP_A)
  assert.ok(target, '应能找到存着旧正文的那份快照')
  packLib.savePackFile('snap', 'persona', snapshotLib.readSnapshot('snap', target.stamp).content['persona.md'])
  assert.match(packLib.loadPack('snap').persona, /甲/)
})

check('force 备份即使内容没变也会存', () => {
  const before = snapshotLib.listSnapshots('snap').length
  const dir = packLib.loadPack('snap').dir
  snapshotLib.createSnapshot('snap', dir, { note: '手动备份', force: true })
  assert.equal(snapshotLib.listSnapshots('snap').length, before + 1)
})

check('快照超过上限时从最旧的删', () => {
  const dir = packLib.loadPack('snap').dir
  for (let i = 0; i < snapshotLib.SNAPSHOT_LIMIT + 3; i += 1) {
    snapshotLib.createSnapshot('snap', dir, { note: `第 ${i} 次`, force: true })
  }
  assert.equal(snapshotLib.listSnapshots('snap').length, snapshotLib.SNAPSHOT_LIMIT)
})

check('删包时连带清掉快照', () => {
  packLib.createPack({ id: 'snap2', name: '待删', address: '你' })
  const dir = packLib.loadPack('snap2').dir
  snapshotLib.createSnapshot('snap2', dir, { force: true })
  assert.ok(snapshotLib.listSnapshots('snap2').length > 0)
  packLib.removePack('snap2')
  assert.equal(snapshotLib.listSnapshots('snap2').length, 0)
})

check('停用的模块不进注入文本，但仍留在编辑器里', () => {
  packLib.createPack({ id: 'mute', name: '开关测试', address: '你' })
  packLib.savePackFile('mute', 'persona', '## 身份\n\n- 我是测试人格。\n\n## 语气\n\n- 说话简短。\n')
  const pack = packLib.loadPack('mute')
  assert.equal(pack.personaDoc.blocks.length, 2)
  assert.match(pack.persona, /说话简短/)

  packLib.savePackFile('mute', 'pack.json', { ...pack, muted: ['语气'] })
  const muted = packLib.loadPack('mute')
  assert.equal(muted.muted[0], '语气')
  assert.ok(!muted.persona.includes('说话简短'), '停用的模块不该进注入文本')
  assert.match(muted.persona, /我是测试人格/)
  assert.equal(muted.personaDoc.blocks.length, 2, '编辑器仍要看到全部模块')
})

check('全部模块都停用时注入文本为空', () => {
  const pack = packLib.loadPack('mute')
  packLib.savePackFile('mute', 'pack.json', { ...pack, muted: ['身份', '语气'] })
  assert.equal(packLib.loadPack('mute').persona.trim(), '')
})

check('改标题后旧开关自动失效，不会误伤新模块', () => {
  const pack = packLib.loadPack('mute')
  packLib.savePackFile('mute', 'persona', '## 自我介绍\n\n- 改了个名字。\n')
  const next = packLib.loadPack('mute')
  assert.match(next.persona, /改了个名字/, '标题变了，同名开关不再命中')
})

check('切开关不留快照，免得把 20 份上限点满', () => {
  const before = snapshotLib.listSnapshots('mute').length
  const pack = packLib.loadPack('mute')
  packLib.savePackFile('mute', 'pack.json', { ...pack, muted: [] }, { snapshot: false })
  assert.equal(snapshotLib.listSnapshots('mute').length, before, '纯开关类写入不该产生快照')
  assert.deepEqual(packLib.loadPack('mute').muted, [])
  // 但正文保存必须留
  packLib.savePackFile('mute', 'persona', '## 身份\n\n- 正文改动。\n')
  assert.ok(snapshotLib.listSnapshots('mute').length > before, '正文改动仍要有快照')
})

check('把现成 Markdown 粘进来能切成模块', () => {
  const text = '# 总标题\n\n开头一段。\n\n## 身份\n\n- 第一行\n- 第二行\n\n## 语气\n\n> 一句示例。\n'
  const doc = personaLib.parsePersonaDoc(text)
  assert.equal(doc.blocks.length, 2)
  assert.equal(doc.blocks[0].title, '身份')
  assert.equal(doc.blocks[0].items.length, 2)
  assert.equal(doc.blocks[1].items[0].style, 'quote')
  assert.match(doc.preamble, /开头一段/)
})

check('常驻事实也能整段导入，注释行不进注入', () => {
  const doc = personaLib.parseFactsDoc('- 事实一\n- 事实二\n\n// 这条是写给自己看的备注\n')
  assert.equal(doc.items.length, 2)
  assert.match(doc.preamble, /写给自己看/)
})



console.log(`\n${failed === 0 ? '全部通过' : '有失败项'}：${passed} 通过，${failed} 失败`)
console.log(`临时数据目录：${HOME}\n`)

try {
  fs.rmSync(HOME, { recursive: true, force: true })
} catch {
  /* Windows 上偶尔删不掉，无所谓 */
}

process.exit(failed === 0 ? 0 : 1)
