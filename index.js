/**
 * 人格设定 · 宿主半
 *
 * 三件事：
 *   1) 注入  —— 把当前人格包的正文与常驻事实注册成系统提示段（官方 API，不 patch 任何包）。
 *               段文本用函数形式，每次组装重新求值，所以改文件 / 切包都立即生效。
 *   2) 工具  —— persona_status / persona_packs / persona_recall / persona_remember /
 *               persona_forget / persona_lore，给模型按需读写档案与记忆。
 *   3) 接口  —— /persona/*，给设置页读写包、切换激活包、增删记忆。
 *
 * 失败策略：注入路径上的任何异常都必须被吞掉并返回空串。系统提示组装失败会让整轮请求
 * 直接失败，人格包写错一个字不该有这个后果。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_SETTINGS, readActiveId, readSettings, writeActiveId, writeSettings,
} from './lib/state.js'
import {
  createPack, discoverPacks, duplicatePack, listPacks, loadPack, removePack, resolvePackDir, savePackFile,
} from './lib/pack.js'
import { addMemory, countMemory, forgetMemory, listMemory, pruneMemory, recall } from './lib/memory.js'
import { listChapters, loreStats, readLore, searchLore } from './lib/lore.js'
import { clampText } from './lib/rank.js'
import { installHttp } from './lib/http.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const name = 'dsh-luminyx'
export const inject = ['systemPrompt', 'tools']

const PLUGIN_ID = 'dsh-luminyx'
const VERSION = '0.1.0'

const jsonRender = (_args, value) => [{
  type: 'text',
  text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
}]

function resolveConfig(raw) {
  const base = readSettings()
  const cfg = {
    ...base,
    order: { ...base.order },
    recall: { ...base.recall },
    maxChars: { ...base.maxChars },
    packId: '',
    strict: false,
  }
  if (raw && typeof raw === 'object') {
    if (typeof raw.enabled === 'boolean') cfg.enabled = raw.enabled
    if (typeof raw.injectPersona === 'boolean') cfg.injectPersona = raw.injectPersona
    if (typeof raw.injectFacts === 'boolean') cfg.injectFacts = raw.injectFacts
    if (typeof raw.exposeTools === 'boolean') cfg.exposeTools = raw.exposeTools
    if (typeof raw.packId === 'string') cfg.packId = raw.packId.trim()
    if (typeof raw.strict === 'boolean') cfg.strict = raw.strict
    if (Number.isFinite(raw.order?.persona)) cfg.order.persona = raw.order.persona
    if (Number.isFinite(raw.order?.facts)) cfg.order.facts = raw.order.facts
    if (Number.isFinite(raw.recall?.limit)) cfg.recall.limit = raw.recall.limit
    if (Number.isFinite(raw.recall?.minScore)) cfg.recall.minScore = raw.recall.minScore
    if (Number.isFinite(raw.maxChars?.persona)) cfg.maxChars.persona = raw.maxChars.persona
    if (Number.isFinite(raw.maxChars?.facts)) cfg.maxChars.facts = raw.maxChars.facts
  }
  return cfg
}

// 工具参数的 schema 只能表达类型（宿主只接受 JSON Schema 的一个子集，没有 minimum/maximum），
// 所以数值范围在这里收口：取整、夹到 1–20，非法值落回默认。
function limitOf(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(20, Math.max(1, Math.round(n)))
}

export function apply(ctx, config = {}) {
  let cfg = resolveConfig(config)
  ctx.logger?.info?.(`[${PLUGIN_ID}] v${VERSION} 已加载，数据目录：${path.dirname(HERE)}`)

  /** 当前激活的包；顺序：config.packId（部署固定） → active.json。 */
  function activeId() {
    if (cfg.packId) return cfg.packId
    return readActiveId()
  }

  function activePack() {
    const id = activeId()
    if (!id) return null
    try {
      return loadPack(id)
    } catch {
      return null
    }
  }

  function requirePack() {
    const pack = activePack()
    if (!pack) {
      const available = listPacks().map((entry) => entry.id)
      throw new Error(available.length
        ? `当前没有激活的人格包。可用的包：${available.join('、')}；先用 persona_packs({action:'use', id}) 选择`
        : `当前没有激活的人格包，也没有安装任何包；先用 persona_packs({action:"create", id, name}) 建一个`)
    }
    return pack
  }

  // ── 1. 系统提示注入 ─────────────────────────────────────────────────────
  const sectionDisposers = []

  function disposeSections() {
    while (sectionDisposers.length) {
      const dispose = sectionDisposers.pop()
      try {
        dispose()
      } catch {
        /* 已经释放过就算了 */
      }
    }
  }

  function installSections() {
    disposeSections()
    const withGuard = (label, produce) => () => {
      try {
        return produce()
      } catch (error) {
        // 组装期异常一律降级成空段：宁可没有人格，不能让整轮请求起不来。
        if (cfg.strict) throw error
        ctx.logger?.warn?.(`[${PLUGIN_ID}] ${label} 求值失败，已跳过：${error?.message || error}`)
        return ''
      }
    }

    sectionDisposers.push(ctx.systemPrompt.section({
      name: 'persona:main',
      order: cfg.order.persona,
      interpolate: false,
      text: withGuard('persona:main', () => {
        if (!cfg.enabled || !cfg.injectPersona) return ''
        const pack = activePack()
        if (!pack || !pack.persona.trim()) return ''
        return clampText(pack.persona, cfg.maxChars.persona)
      }),
    }))

    sectionDisposers.push(ctx.systemPrompt.section({
      name: 'persona:facts',
      order: cfg.order.facts,
      interpolate: false,
      text: withGuard('persona:facts', () => {
        if (!cfg.enabled || !cfg.injectFacts) return ''
        const pack = activePack()
        if (!pack || !pack.facts.trim()) return ''
        return clampText(pack.facts, cfg.maxChars.facts)
      }),
    }))
  }

  installSections()

  // ── 2. 模型侧工具 ───────────────────────────────────────────────────────
  const toolDisposers = []

  function registerTool(definition) {
    const dispose = ctx.tools.register(definition)
    toolDisposers.push(dispose)
    return dispose
  }

  function installTools() {
    while (toolDisposers.length) {
      const dispose = toolDisposers.pop()
      try {
        dispose()
      } catch {
        /* ignore */
      }
    }
    if (!cfg.exposeTools) return

    registerTool({
      name: 'persona_status',
      description: '查看当前生效的人格包：名称、注入段、常驻事实与档案规模、长期记忆条数。用于确认"我现在是谁、手上有什么设定"，也用于排查"人格没生效"。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: { schema: { type: 'object', additionalProperties: true }, render: jsonRender },
      async execute() {
        const pack = activePack()
        const packs = listPacks()
        if (!pack) {
          return {
            active: null,
            enabled: cfg.enabled,
            available: packs.map((entry) => ({ id: entry.id, name: entry.name, builtin: entry.builtin })),
            hint: packs.length ? '用 persona_packs({action:"use", id}) 选择人格包' : '用 persona_packs({action:"create", id, name}) 新建人格包',
          }
        }
        return {
          active: {
            id: pack.id,
            name: pack.name,
            signature: pack.signature,
            version: pack.version,
            builtin: pack.builtin,
            address: pack.address,
            tags: pack.tags,
            dir: pack.dir,
          },
          enabled: cfg.enabled,
          injecting: {
            persona: cfg.injectPersona && Boolean(pack.persona.trim()),
            facts: cfg.injectFacts && Boolean(pack.facts.trim()),
            orders: cfg.order,
            chars: { persona: pack.persona.length, facts: pack.facts.length },
          },
          lore: loreStats(pack),
          memory: { count: countMemory(pack.memoryFile) },
          installed: packs.length,
        }
      },
    })

    registerTool({
      name: 'persona_packs',
      description: '人格包管理。action=list 列出全部包；use 切换当前激活包（立即生效，无需重启）；show 读一个包的正文与常驻事实；create 新建空白包；duplicate 复制包；delete 删除用户包。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'use', 'show', 'create', 'duplicate', 'delete'] },
          id: { type: 'string', description: '目标包 id（use/show/create/duplicate/delete 必填）' },
          name: { type: 'string', description: 'create/duplicate 时的显示名' },
          description: { type: 'string', description: 'create 时的简介' },
          address: { type: 'string', description: 'create 时的默认称呼' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: jsonRender },
      async execute(args = {}) {
        const action = String(args.action || 'list')
        if (action === 'list') {
          return {
            activeId: activeId() || null,
            packs: listPacks().map((entry) => ({
              id: entry.id,
              name: entry.name,
              builtin: entry.builtin,
              active: entry.id === activeId(),
              personaChars: entry.hasPersona ? undefined : 0,
              loreCount: entry.loreCount,
              description: entry.description,
            })),
          }
        }
        if (action === 'use') {
          const id = String(args.id || '').trim()
          const dir = resolvePackDir(id)
          if (!dir) throw new Error(`人格包 "${id}" 不存在`)
          writeActiveId(id)
          return { activeId: id, name: loadPack(id)?.name || id, applied: '下一轮请求生效' }
        }
        if (action === 'show') {
          const pack = loadPack(String(args.id || activeId()))
          if (!pack) throw new Error(`人格包不存在：${args.id || activeId()}`)
          return {
            id: pack.id,
            name: pack.name,
            builtin: pack.builtin,
            persona: clampText(pack.persona, 8000),
            facts: clampText(pack.facts, 3000),
            lore: loreStats(pack),
          }
        }
        if (action === 'create') {
          const created = createPack({
            id: String(args.id || '').trim(),
            name: String(args.name || '').trim(),
            description: String(args.description || ''),
            address: String(args.address || ''),
          })
          writeActiveId(created.id)
          return { created: created.id, dir: created.dir, active: true }
        }
        if (action === 'duplicate') {
          const created = duplicatePack(String(args.id || '').trim(), String(args.name || '').trim() || `${args.id}-copy`, args.name)
          return { created: created.id, dir: created.dir }
        }
        if (action === 'delete') {
          removePack(String(args.id || '').trim())
          if (activeId() === args.id) writeActiveId('')
          return { removed: args.id }
        }
        throw new Error(`未知的 action：${action}`)
      },
    })

    registerTool({
      name: 'persona_recall',
      description: '在当前人格包的长期记忆里检索相关条目。当用户提到"你记得""上次说过的""之前那个"时使用；结果按相关度 × 重要性 × 新近度排序。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要检索的话题或关键词' },
          limit: { type: 'integer', description: '最多返回几条（1–20），默认取插件设置' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: jsonRender },
      async execute(args = {}) {
        const pack = requirePack()
        const limit = limitOf(args.limit, cfg.recall.limit)
        const hits = recall(pack.memoryFile, String(args.query || ''), {
          limit,
          minScore: cfg.recall.minScore,
        })
        return {
          pack: pack.id,
          query: args.query,
          total: countMemory(pack.memoryFile),
          hits: hits.map((hit) => ({
            id: hit.entry.id,
            text: hit.entry.text,
            importance: hit.entry.importance,
            tags: hit.entry.tags,
            createdAt: hit.entry.createdAt,
            score: hit.score,
          })),
        }
      },
    })

    registerTool({
      name: 'persona_remember',
      description: '写入一条长期记忆。只写用户明确说出的、以后还用得上的事实：偏好、约定、称呼、重要经历、底线。一次一条，短句陈述，不要写过程。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '一句话的记忆内容' },
          importance: { type: 'integer', enum: [1, 2, 3, 4, 5], description: '重要性：日常偏好 2，明确约定 3，重要经历 4，底线与禁忌 5' },
          tags: { type: 'array', items: { type: 'string' }, description: '可选标签，便于检索' },
        },
        required: ['text'],
        additionalProperties: false,
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: jsonRender },
      async execute(args = {}) {
        const pack = requirePack()
        const result = addMemory(pack.memoryFile, {
          text: args.text,
          importance: args.importance,
          tags: args.tags,
          source: 'model',
        })
        return {
          pack: pack.id,
          created: result.created,
          id: result.entry.id,
          total: countMemory(pack.memoryFile),
        }
      },
    })

    registerTool({
      name: 'persona_forget',
      description: '删除一条长期记忆：用户要求忘记、或确认某条已过时时使用。给 id 精确删；给 query 则删最匹配的一条。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '要删除的记忆 id' },
          query: { type: 'string', description: '按内容匹配要删除的记忆' },
        },
        additionalProperties: false,
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: jsonRender },
      async execute(args = {}) {
        const pack = requirePack()
        if (!args.id && !args.query) throw new Error('需要 id 或 query 之一')
        const result = forgetMemory(pack.memoryFile, { id: args.id, query: args.query })
        return {
          pack: pack.id,
          removed: result.removed ? { id: result.removed.id, text: result.removed.text } : null,
          total: countMemory(pack.memoryFile),
        }
      },
    })

    registerTool({
      name: 'persona_lore',
      description: '查阅当前人格包的设定档案（只读）：列章节、按章节读、按 id 读、或按关键词检索。涉及精确设定、数字、结构、衣装细节时先查原文，不要凭印象编造。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['chapters', 'read', 'search'] },
          chapter: { type: 'string', description: 'read 时的章节名（可前缀匹配）' },
          id: { type: 'string', description: 'read 时的条目 id' },
          query: { type: 'string', description: 'search 或 read 时的关键词' },
          limit: { type: 'integer', description: '最多返回几条（1–20）' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: jsonRender },
      async execute(args = {}) {
        const pack = requirePack()
        const action = String(args.action || 'chapters')
        if (action === 'chapters') {
          return { pack: pack.id, stats: loreStats(pack), chapters: listChapters(pack) }
        }
        if (action === 'search') {
          const hits = searchLore(pack, String(args.query || ''), { limit: limitOf(args.limit, 5) })
          return {
            pack: pack.id,
            query: args.query,
            hits: hits.map((hit) => ({
              id: hit.entry.id,
              chapter: hit.entry.chapter,
              title: hit.entry.title,
              text: hit.entry.text,
              score: hit.score,
            })),
          }
        }
        if (action === 'read') {
          const result = readLore(pack, {
            chapter: args.chapter,
            id: args.id,
            query: args.query,
            limit: limitOf(args.limit, 6),
          })
          return { pack: pack.id, ...result }
        }
        throw new Error(`未知的 action：${action}`)
      },
    })
  }

  installTools()

  // ── 3. 设置页接口 ───────────────────────────────────────────────────────
  const disposeHttp = installHttp(ctx, {
    root: HERE,
    version: VERSION,
    pluginId: PLUGIN_ID,
    getConfig: () => cfg,
    setConfig: (patch) => {
      const next = resolveConfig({ ...cfg, ...patch })
      cfg = next
      persistConfig(next)
      installSections()
      installTools()
      return cfg
    },
    activeId,
    setActiveId: (id) => {
      const dir = id ? resolvePackDir(id) : null
      if (id && !dir) throw new Error(`人格包 "${id}" 不存在`)
      writeActiveId(id)
      return activeId()
    },
    isLocked: () => Boolean(cfg.packId),
    packs: { listPacks, loadPack, createPack, duplicatePack, removePack, savePackFile, discoverPacks },
    memory: { listMemory, addMemory, forgetMemory, pruneMemory, countMemory },
    lore: { listChapters, readLore, searchLore, loreStats },
  })

  ctx.effect(() => () => {
    disposeSections()
    while (toolDisposers.length) {
      const dispose = toolDisposers.pop()
      try {
        dispose()
      } catch {
        /* ignore */
      }
    }
    disposeHttp?.()
  }, `${PLUGIN_ID}: lifecycle`)
}

/** 只持久化 UI 可改的字段，config 里的部署级覆盖不写进 settings.json。 */
function persistConfig(cfg) {
  writeSettings({
    enabled: cfg.enabled,
    injectPersona: cfg.injectPersona,
    injectFacts: cfg.injectFacts,
    exposeTools: cfg.exposeTools,
    order: cfg.order,
    recall: cfg.recall,
    maxChars: cfg.maxChars,
  })
}

export { DEFAULT_SETTINGS }
