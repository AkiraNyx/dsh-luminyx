/**
 * 设置页接口：/persona/api/*
 *
 * 只做薄薄一层：解析请求 → 调 lib/* 的纯函数 → 返回 JSON。
 * 所有业务校验都在 lib 里，这里不做第二套规则。
 */
import path from 'node:path'
import { listPacks as defaultListPacks, packFilePath as resolvePackFile } from './pack.js'
import {
  SECTION_PRESETS, parseFactsDoc, parsePersonaDoc, serializeFactsDoc, serializePersonaDoc, suggestTitle,
} from './persona.js'
import {
  SNAPSHOT_LIMIT, createSnapshot, listSnapshots, readSnapshot, removeSnapshot,
} from './snapshot.js'

const MAX_BODY = 4 * 1024 * 1024

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('请求体过大（上限 4 MB）'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function readJson(req) {
  const text = await readBody(req)
  if (!text.trim()) return {}
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? value : {}
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

export function installHttp(ctx, deps) {
  const {
    version, pluginId, getConfig, setConfig, activeId, setActiveId, isLocked,
    packs, memory, lore,
  } = deps

  let disposeRegistration = null

  function overview() {
    const cfg = getConfig()
    const id = activeId()
    const list = packs.listPacks()
    const active = id ? safe(() => packs.loadPack(id)) : null
    return {
      plugin: pluginId,
      version,
      locked: isLocked(),
      activeId: id || null,
      active: active
        ? {
          id: active.id,
          name: active.name,
          signature: active.signature,
          description: active.description,
          builtin: active.builtin,
          dir: active.dir,
          chars: { persona: active.persona.length, facts: active.facts.length },
          lore: lore.loreStats(active),
          memory: { count: memory.countMemory(active.memoryFile) },
        }
        : null,
      settings: cfg,
      packs: list,
    }
  }

  const routes = {
    'GET api/overview': () => overview(),

    // 注入预览：把当前设置真正会送进提示词的那两段原样交出来，
    // 方便在界面上核字数、看有没有被截断，而不用猜。
    'GET api/preview': (query) => {
      const id = String(query.get('id') || activeId() || '')
      const pack = id ? packs.loadPack(id) : null
      const clip = (text, limit) => {
        const value = String(text || '')
        if (!limit || value.length <= limit) return { text: value, truncated: false, chars: value.length }
        return { text: value.slice(0, limit), truncated: true, chars: value.length }
      }
      const persona = clip(pack?.persona, cfg.maxChars.persona)
      const facts = clip(pack?.facts, cfg.maxChars.facts)
      const personaOn = Boolean(cfg.enabled && cfg.injectPersona && pack)
      const factsOn = Boolean(cfg.enabled && cfg.injectFacts && pack)
      return {
        id: pack ? pack.id : null,
        name: pack ? pack.name : '',
        enabled: Boolean(cfg.enabled),
        total: (personaOn ? persona.text.length : 0) + (factsOn ? facts.text.length : 0),
        tools: Boolean(cfg.enabled && cfg.exposeTools),
        recall: cfg.recall,
        sections: [
          {
            name: 'persona:main',
            label: '人格正文',
            on: personaOn,
            order: cfg.order.persona,
            limit: cfg.maxChars.persona,
            ...persona,
          },
          {
            name: 'persona:facts',
            label: '常驻事实',
            on: factsOn,
            order: cfg.order.facts,
            limit: cfg.maxChars.facts,
            ...facts,
          },
        ],
      }
    },

    // 快照列表：每个包改了哪些版本，改坏了能退回去。
    'GET api/snapshots': (query) => {
      const id = String(query.get('id') || activeId() || '').trim()
      if (!id) return { id: '', limit: SNAPSHOT_LIMIT, list: [] }
      return { id, limit: SNAPSHOT_LIMIT, list: listSnapshots(id) }
    },

    'POST api/snapshot': (query, body) => {
      const id = String(body.id || query.get('id') || activeId() || '').trim()
      if (!id) throw new Error('缺少 id')
      const pack = packs.loadPack(id)
      if (!pack) throw new Error(`人格包 "${id}" 不存在`)
      // 内置包先 fork 成用户包再操作，别把快照写进安装目录。
      const dir = path.dirname(resolvePackFile(id, 'persona'))
      const action = String(body.action || 'create')
      if (action === 'create') {
        const snapshot = createSnapshot(id, dir, { note: String(body.note || '手动备份'), force: true })
        return { ok: true, snapshot, list: listSnapshots(id) }
      }
      if (action === 'restore') {
        const stamp = String(body.stamp || '')
        if (!stamp) throw new Error('缺少 stamp')
        const snap = readSnapshot(id, stamp)
        // 恢复动作本身会经由 savePackFile 自动留一份「恢复前」的快照，所以这里不再重复备份。
        const written = []
        if (snap.content['persona.md'] !== null) {
          packs.savePackFile(id, 'persona', snap.content['persona.md'])
          written.push('persona')
        }
        if (snap.content['facts.md'] !== null) {
          packs.savePackFile(id, 'facts', snap.content['facts.md'])
          written.push('facts')
        }
        if (snap.content['pack.json'] !== null) {
          packs.savePackFile(id, 'pack.json', snap.content['pack.json'])
          written.push('meta')
        }
        return { ok: true, restored: stamp, written, list: listSnapshots(id) }
      }
      if (action === 'remove') {
        const stamp = String(body.stamp || '')
        if (!stamp) throw new Error('缺少 stamp')
        return { ok: removeSnapshot(id, stamp), list: listSnapshots(id) }
      }
      throw new Error(`不支持的操作：${action}`)
    },

    // Markdown 反解析：把现成的一份设定粘进来，切成模块再进编辑器。
    'POST api/doc/parse': (query, body) => {
      const text = String(body.text ?? '')
      const kind = String(body.kind || 'persona')
      if (kind === 'facts') {
        const doc = parseFactsDoc(text)
        return { ok: true, kind, doc, count: doc.items.length }
      }
      const doc = parsePersonaDoc(text)
      return { ok: true, kind, doc, count: doc.blocks.length }
    },

    'GET api/pack': (query) => {
      const id = String(query.get('id') || activeId() || '')
      const pack = packs.loadPack(id)
      if (!pack) throw Object.assign(new Error(`人格包不存在：${id}`), { status: 404 })
      return {
        id: pack.id,
        name: pack.name,
        signature: pack.signature,
        address: pack.address,
        description: pack.description,
        version: pack.version,
        tags: pack.tags,
        muted: pack.muted,
        builtin: pack.builtin,
        dir: pack.dir,
        files: pack.files,
        persona: pack.persona,
        personaDoc: pack.personaDoc,
        facts: pack.facts,
        factsDoc: pack.factsDoc,
        sectionPresets: SECTION_PRESETS,
        loreJsonl: pack.lore.map((entry) => JSON.stringify(entry)).join('\n'),
        loreCount: pack.lore.length,
        chapters: lore.listChapters(pack),
        memoryCount: memory.countMemory(pack.memoryFile),
      }
    },

    'PUT api/pack': async (query, body) => {
      const id = String(body.id || query.get('id') || '').trim()
      if (!id) throw new Error('缺少 id')
      if (body.file === 'pack.json' || body.meta) {
        const meta = body.meta || body.content
        const pack = packs.savePackFile(id, 'pack.json', typeof meta === 'string' ? meta : meta)
        return { ok: true, meta: pack }
      }
      const file = String(body.file || 'persona')
      if (!['persona', 'facts', 'lore'].includes(file)) throw new Error(`不支持的文件：${file}`)
      // 结构化保存：编辑器传块/条目，宿主序列化成 markdown 再落盘。
      if (body.doc && (file === 'persona' || file === 'facts')) {
        const text = file === 'persona' ? serializePersonaDoc(body.doc) : serializeFactsDoc(body.doc)
        const pack = packs.savePackFile(id, file, text)
        return {
          ok: true,
          saved: file,
          bytes: text.length,
          doc: file === 'persona' ? pack.personaDoc : pack.factsDoc,
          text,
          pack: { id: pack.id, name: pack.name },
        }
      }
      const content = String(body.content ?? '')
      const pack = packs.savePackFile(id, file, content)
      return { ok: true, saved: file, bytes: content.length, pack: { id: pack.id, name: pack.name } }
    },

    // 模块级开关：停用的块留在 persona.md 里，只是不进系统提示词。
    'PUT api/muted': (query, body) => {
      const id = String(body.id || query.get('id') || '').trim()
      if (!id) throw new Error('缺少 id')
      const title = String(body.title || '').trim()
      if (!title) throw new Error('缺少模块名')
      const pack = packs.loadPack(id)
      if (!pack) throw new Error(`人格包 "${id}" 不存在`)
      const muted = new Set(pack.muted)
      if (body.mute) muted.add(title)
      else muted.delete(title)
      // normalizeMeta 只取白名单字段，剩下的运行时字段会被丢掉。
      const saved = packs.savePackFile(id, 'pack.json', { ...pack, muted: [...muted] }, { snapshot: false })
      return { ok: true, muted: saved.muted }
    },

    'POST api/pack': async (query, body) => {
      const action = String(body.action || '')
      if (action === 'create') {
        const created = packs.createPack({
          id: String(body.id || '').trim(),
          name: String(body.name || '').trim(),
          description: String(body.description || ''),
          address: String(body.address || ''),
        })
        return { ok: true, id: created.id, dir: created.dir }
      }
      if (action === 'duplicate') {
        const created = packs.duplicatePack(String(body.id || '').trim(), String(body.newId || '').trim(), body.name)
        return { ok: true, id: created.id, dir: created.dir }
      }
      if (action === 'delete') {
        packs.removePack(String(body.id || '').trim())
        if (activeId() === body.id) setActiveId('')
        return { ok: true, removed: body.id }
      }
      throw new Error(`未知的 action：${action}`)
    },

    'PUT api/active': async (query, body) => {
      const id = String(body.id || '').trim()
      const next = setActiveId(id)
      return { ok: true, activeId: next || null }
    },

    'PUT api/settings': async (query, body) => {
      const next = setConfig(body || {})
      return { ok: true, settings: next }
    },

    'GET api/memory': (query) => {
      const pack = requireActive()
      const rows = memory.listMemory(pack.memoryFile)
      return {
        pack: pack.id,
        total: rows.length,
        rows: rows
          .slice()
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .map((entry) => ({ ...entry })),
      }
    },

    'POST api/memory': async (query, body) => {
      const pack = requireActive()
      const action = String(body.action || '')
      if (action === 'add') {
        const result = memory.addMemory(pack.memoryFile, { text: body.text, importance: body.importance, tags: body.tags, source: 'ui' })
        return { ok: true, created: result.created, id: result.entry.id, total: memory.countMemory(pack.memoryFile) }
      }
      if (action === 'forget') {
        const result = memory.forgetMemory(pack.memoryFile, { id: body.id, query: body.query })
        return {
          ok: Boolean(result.removed),
          removed: result.removed ? 1 : 0,
          entry: result.removed ? { id: result.removed.id, text: result.removed.text } : null,
          total: memory.countMemory(pack.memoryFile),
        }
      }
      if (action === 'prune') {
        const result = memory.pruneMemory(pack.memoryFile, { keep: Number(body.keep) || 0 })
        return { ok: true, ...result }
      }
      throw new Error(`未知的 action：${action}`)
    },

    'POST api/lore': async (query, body) => {
      const pack = requireActive()
      const action = String(body.action || 'search')
      if (action === 'chapters') return { pack: pack.id, stats: lore.loreStats(pack), chapters: lore.listChapters(pack) }
      if (action === 'search') {
        return {
          pack: pack.id,
          hits: lore.searchLore(pack, String(body.query || ''), { limit: Number(body.limit) || 8 })
            .map((hit) => ({ ...hit.entry, score: hit.score })),
        }
      }
      if (action === 'read') {
        return { pack: pack.id, ...lore.readLore(pack, { chapter: body.chapter, id: body.id, query: body.query, limit: Number(body.limit) || 6 }) }
      }
      throw new Error(`未知的 action：${action}`)
    },
  }

  function requireActive() {
    const id = activeId()
    const pack = id ? packs.loadPack(id) : null
    if (!pack) throw Object.assign(new Error('当前没有激活的人格包'), { status: 409 })
    return pack
  }

  function send(res, code, payload) {
    const body = JSON.stringify(payload)
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(body),
    })
    res.end(body)
  }

  async function handler(req, res) {
    const url = new URL(String(req.url || '/persona'), 'http://local')
    const parts = url.pathname.split('/').filter(Boolean)
    const rest = parts[0] === 'persona' ? parts.slice(1) : parts
    const routeKey = `${req.method} ${rest.join('/')}`
    try {
      const route = routes[routeKey]
      if (!route) {
        send(res, 404, { error: `没有这个接口：${routeKey}` })
        return
      }
      const body = req.method === 'GET' ? {} : await readJson(req)
      const result = await route(url.searchParams, body)
      send(res, 200, result)
    } catch (error) {
      const status = error?.status || 400
      send(res, status, { error: error?.message || String(error) })
    }
  }

  ctx.inject(['webServer'], (subCtx) => {
    let ws = null
    try {
      ws = subCtx.webServer ?? (typeof subCtx.get === 'function' ? subCtx.get('webServer') : undefined)
    } catch {
      ws = undefined
    }
    if (!ws || typeof ws.register !== 'function') {
      ctx.logger?.warn?.(`[${pluginId}] webServer 不可用：设置页接口未挂载`)
      return
    }
    const registration = ws.register({ kind: 'prefix', path: '/persona', handler })
    disposeRegistration = typeof registration === 'function'
      ? registration
      : typeof registration?.dispose === 'function' ? () => registration.dispose() : null
  })

  return () => {
    try {
      disposeRegistration?.()
    } catch {
      /* ignore */
    }
    disposeRegistration = null
  }
}

function safe(fn) {
  try {
    return fn()
  } catch {
    return null
  }
}

export { defaultListPacks }
