/**
 * 人格包（Persona Pack）：发现、加载、校验、增删改。
 *
 * 一个包就是一个目录：
 *   pack.json     元数据（可省略，缺省从目录名推导）
 *   persona.md    人格正文 → 注入为系统提示段 persona:main
 *   facts.md      常驻事实（核心记忆）→ 注入为系统提示段 persona:facts
 *   lore.jsonl    档案分块，一行一条 JSON {id, chapter, title, text, tags}
 *   lore/*.md     可选，按 `##` 标题自动切块
 *   memory.jsonl  长期记忆，运行期由 persona_remember 写入
 *
 * 内置包随包发布（<包根>/packs），用户包在 %DSH_HOME%/persona/packs。
 * 同名时用户包优先，因此可以整体接管内置包而不改安装目录。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  atomicWrite, ensureRoot, readJson, statOf, userPacksRoot, writeJson,
} from './state.js'
import { parseFactsDoc, parsePersonaDoc, serializePersonaDoc } from './persona.js'
import { createSnapshot, dropSnapshots } from './snapshot.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const BUILTIN_ROOT = path.join(HERE, '..', 'packs')

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
const TEXT_FILES = new Set(['persona', 'facts'])

/** 包 id 是否合法（同时用作目录名）。 */
export function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id)
}

export function assertValidId(id) {
  if (!isValidId(id)) {
    throw new Error(`人格包 id 不合法："${id}"，只允许小写字母、数字、下划线和连字符，且以字母或数字开头（1–64 个字符）`)
  }
  return id
}

function listDirs(root) {
  let entries = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => isValidId(name))
    .sort()
}

/** 已安装的全部包：id → { id, dir, builtin }，用户包覆盖内置包。 */
export function discoverPacks() {
  ensureRoot()
  const found = new Map()
  for (const id of listDirs(BUILTIN_ROOT)) {
    found.set(id, { id, dir: path.join(BUILTIN_ROOT, id), builtin: true })
  }
  for (const id of listDirs(userPacksRoot())) {
    found.set(id, { id, dir: path.join(userPacksRoot(), id), builtin: false })
  }
  return [...found.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function resolvePackDir(id, { preferBuiltin = false } = {}) {
  assertValidId(id)
  const builtin = path.join(BUILTIN_ROOT, id)
  const user = path.join(userPacksRoot(), id)
  const hasBuiltin = fs.existsSync(path.join(builtin, 'pack.json')) || fs.existsSync(path.join(builtin, 'persona.md'))
  const hasUser = fs.existsSync(path.join(user, 'pack.json')) || fs.existsSync(path.join(user, 'persona.md'))
  if (preferBuiltin) return hasBuiltin ? builtin : hasUser ? user : null
  if (hasUser) return user
  if (hasBuiltin) return builtin
  return null
}

export function defaultMeta(id) {
  return {
    id,
    name: id,
    signature: '',
    aliases: [],
    address: '',
    version: '1.0.0',
    description: '',
    order: null,
    tags: [],
    // 临时停用的模块标题：这些块仍留在 persona.md 里，但不进系统提示词。
    // 按标题匹配 —— 标题就是用户在编辑器里看到的那个名字，改名即视为新模块。
    muted: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function normalizeMeta(raw, id) {
  const base = defaultMeta(id)
  const meta = { ...base }
  if (raw && typeof raw === 'object') {
    for (const key of ['name', 'signature', 'address', 'version', 'description']) {
      if (typeof raw[key] === 'string' && raw[key].trim()) meta[key] = raw[key].trim()
    }
    if (Array.isArray(raw.aliases)) meta.aliases = raw.aliases.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
    if (Array.isArray(raw.tags)) meta.tags = raw.tags.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
    if (Array.isArray(raw.muted)) {
      meta.muted = [...new Set(raw.muted.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()))]
    }
    if (Number.isFinite(raw.order)) meta.order = raw.order
    if (typeof raw.createdAt === 'string') meta.createdAt = raw.createdAt
    if (typeof raw.updatedAt === 'string') meta.updatedAt = raw.updatedAt
  }
  meta.id = id
  return meta
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  } catch {
    return ''
  }
}

function normalizeLoreEntry(raw, index, fallbackChapter) {
  if (!raw || typeof raw !== 'object') return null
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (!text) return null
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `lore-${index + 1}`,
    chapter: typeof raw.chapter === 'string' && raw.chapter.trim() ? raw.chapter.trim() : fallbackChapter,
    title: typeof raw.title === 'string' ? raw.title.trim() : '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : [],
    text,
  }
}

/** 读 lore.jsonl；容忍空行、注释行（# 开头）与坏行。 */
function readLoreJsonl(file) {
  const text = readText(file)
  if (!text.trim()) return []
  const out = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    try {
      const entry = normalizeLoreEntry(JSON.parse(trimmed), out.length, '')
      if (entry) out.push(entry)
    } catch {
      /* 坏行跳过，不影响其它档案 */
    }
  }
  return out
}

/** 把 lore/*.md 按 `##` 标题切成档案块。 */
export function chunkMarkdown(text, { title = '' } = {}) {
  const source = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!source) return []
  const lines = source.split('\n')
  const chunks = []
  let current = { title, chapter: '', lines: [] }
  const flush = () => {
    const body = current.lines.join('\n').trim()
    if (body) chunks.push({ title: current.title, chapter: current.chapter, text: body })
    current = { title: current.chapter || current.title, chapter: '', lines: [] }
  }
  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+?)\s*$/.exec(line)
    if (heading && heading[1].length <= 2) {
      const level = heading[1].length
      const label = heading[2].trim()
      if (level === 1) {
        if (current.lines.join('\n').trim()) flush()
        current.title = label
        current.chapter = label
        continue
      }
      flush()
      current.title = label
      current.chapter = current.chapter || label
      continue
    }
    current.lines.push(line)
  }
  if (current.lines.join('\n').trim()) {
    const body = current.lines.join('\n').trim()
    chunks.push({ title: current.title, chapter: current.chapter, text: body })
  }
  return chunks
}

function readLoreMarkdown(dir) {
  const loreDir = path.join(dir, 'lore')
  let names = []
  try {
    names = fs.readdirSync(loreDir).filter((name) => name.toLowerCase().endsWith('.md')).sort()
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    const base = name.replace(/\.md$/i, '')
    for (const chunk of chunkMarkdown(readText(path.join(loreDir, name)), { title: base })) {
      out.push({
        id: `${base}-${out.length + 1}`,
        chapter: chunk.chapter || base,
        title: chunk.title || base,
        tags: [],
        text: chunk.text,
      })
    }
  }
  return out
}

const packCache = new Map()

/**
 * 加载一个包。每次调用校验文件 mtime，改文件即生效，无需重启。
 * @param {string} id 包 id
 * @returns {object|null} 包对象；不存在时 null
 */
export function loadPack(id) {
  let dir = null
  try {
    dir = resolvePackDir(id)
  } catch {
    return null
  }
  if (!dir) return null

  const metaFile = path.join(dir, 'pack.json')
  const personaFile = path.join(dir, 'persona.md')
  const factsFile = path.join(dir, 'facts.md')
  const loreFile = path.join(dir, 'lore.jsonl')
  const memoryFile = path.join(dir, 'memory.jsonl')
  const stamps = [metaFile, personaFile, factsFile, loreFile].map((file) => {
    const stat = statOf(file)
    return stat ? `${file}:${stat.mtimeMs}:${stat.size}` : `${file}:-`
  }).join('|')

  const cached = packCache.get(dir)
  if (cached && cached.stamps === stamps) return cached.pack

  const rawMeta = readJson(metaFile, null)
  const meta = normalizeMeta(rawMeta, id)
  const personaText = readText(personaFile)
  const factsText = readText(factsFile)
  // 完整文档给编辑器；注入用的 persona 剔除被停用的模块。
  const personaDoc = parsePersonaDoc(personaText)
  const muted = new Set(meta.muted)
  const kept = muted.size ? personaDoc.blocks.filter((block) => !muted.has(String(block.title || '').trim())) : personaDoc.blocks
  const personaInject = kept.length === personaDoc.blocks.length
    ? personaText
    : serializePersonaDoc({ preamble: personaDoc.preamble, blocks: kept })
  const pack = {
    ...meta,
    dir,
    builtin: dir.startsWith(BUILTIN_ROOT),
    persona: personaInject,
    facts: factsText,
    // 结构化视图：编辑器按块/条目读写，落盘仍是 markdown。
    personaDoc,
    factsDoc: parseFactsDoc(factsText),
    lore: [...readLoreJsonl(loreFile), ...readLoreMarkdown(dir)],
    memoryFile,
    files: {
      meta: fs.existsSync(metaFile),
      persona: fs.existsSync(personaFile),
      facts: fs.existsSync(factsFile),
      lore: fs.existsSync(loreFile) || fs.existsSync(path.join(dir, 'lore')),
    },
  }
  packCache.set(dir, { stamps, pack })
  return pack
}

export function invalidate(id) {
  const dir = resolvePackDir(id)
  if (dir) packCache.delete(dir)
  for (const key of packCache.keys()) {
    if (key.endsWith(path.sep + id)) packCache.delete(key)
  }
}

/** 所有包的摘要（不读正文，设置页列表用）。 */
export function listPacks() {
  return discoverPacks().map((entry) => {
    const pack = loadPack(entry.id)
    return {
      id: entry.id,
      builtin: entry.builtin,
      name: pack?.name || entry.id,
      signature: pack?.signature || '',
      description: pack?.description || '',
      version: pack?.version || '',
      address: pack?.address || '',
      tags: pack?.tags || [],
      hasPersona: Boolean(pack?.persona?.trim()),
      hasFacts: Boolean(pack?.facts?.trim()),
      loreCount: pack?.lore?.length || 0,
      dir: entry.dir,
    }
  })
}

/** 新建用户包骨架。 */
export function createPack({ id, name, description = '', address = '' }) {
  assertValidId(id)
  const existing = resolvePackDir(id)
  if (existing) throw new Error(`人格包 "${id}" 已存在（${existing}）`)
  const dir = path.join(userPacksRoot(), id)
  const meta = { ...defaultMeta(id), name: name || id, description, address }
  writeJson(path.join(dir, 'pack.json'), meta)
  atomicWrite(path.join(dir, 'persona.md'), personaTemplate(meta))
  atomicWrite(path.join(dir, 'facts.md'), factsTemplate(meta))
  atomicWrite(path.join(dir, 'lore.jsonl'), '')
  invalidate(id)
  return loadPack(id)
}

function personaTemplate(meta) {
  return `# ${meta.name}｜人格设定

> 这一段会作为系统提示注入（段名 persona:main）。写清楚「是谁、怎么说话、怎么相处、边界在哪」，
> 不需要复述工具用法——工具说明由 harness 自己给。

## 身份
- 名字：

## 语气
- 

## 相处方式
- 

## 不做的事
- 
`
}

function factsTemplate(meta) {
  return `# ${meta.name}｜常驻事实

> 这一段会作为系统提示注入（段名 persona:facts），每条都应短、稳定、可核对。
> 变化频繁的内容放进档案（lore.jsonl），由 persona_lore 按需检索。

- 
`
}

/** 写用户包文件。内置包不可改，会先复制成用户包。 */
const FILE_MAP = {
  'pack.json': (dir) => path.join(dir, 'pack.json'),
  persona: (dir) => path.join(dir, 'persona.md'),
  facts: (dir) => path.join(dir, 'facts.md'),
  lore: (dir) => path.join(dir, 'lore.jsonl'),
}

export function packFilePath(id, file) {
  const resolver = FILE_MAP[file]
  if (!resolver) throw new Error(`不支持的人格包文件：${file}`)
  let dir = resolvePackDir(id)
  if (!dir) throw new Error(`人格包 "${id}" 不存在`)
  if (dir.startsWith(BUILTIN_ROOT)) {
    dir = forkBuiltin(id)
  }
  return resolver(dir)
}

/** 把内置包复制到用户目录，返回新目录。已存在用户副本时直接返回。 */
export function forkBuiltin(id) {
  assertValidId(id)
  const builtinDir = path.join(BUILTIN_ROOT, id)
  const userDir = path.join(userPacksRoot(), id)
  if (!fs.existsSync(builtinDir)) throw new Error(`内置人格包 "${id}" 不存在`)
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true })
    for (const name of ['pack.json', 'persona.md', 'facts.md', 'lore.jsonl']) {
      const from = path.join(builtinDir, name)
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(userDir, name))
    }
    const loreDir = path.join(builtinDir, 'lore')
    if (fs.existsSync(loreDir)) copyDir(loreDir, path.join(userDir, 'lore'))
  }
  invalidate(id)
  return userDir
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dst = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(src, dst)
    else fs.copyFileSync(src, dst)
  }
}

export function savePackFile(id, file, content, options = {}) {
  const target = packFilePath(id, file)
  // 落盘前留一份：改坏了能退回去。lore 是只增的档案、纯开关类的写入（muted）也不值得占一份快照。
  if (file !== 'lore' && options.snapshot !== false) {
    try {
      createSnapshot(id, path.dirname(target))
    } catch {
      /* 快照失败不能挡住保存本身 */
    }
  }
  if (file === 'pack.json') {
    const meta = typeof content === 'string' ? JSON.parse(content) : content
    writeJson(target, normalizeMeta(meta, id))
  } else {
    if (file === 'lore' && typeof content !== 'string') content = content.map((row) => JSON.stringify(row)).join('\n') + '\n'
    atomicWrite(target, String(content ?? ''))
  }
  invalidate(id)
  return loadPack(id)
}

/** 删除用户包；内置包不允许删除。 */
export function removePack(id) {
  assertValidId(id)
  const dir = resolvePackDir(id)
  if (!dir) throw new Error(`人格包 "${id}" 不存在`)
  if (dir.startsWith(BUILTIN_ROOT)) throw new Error('内置人格包不能删除，可以先复制为用户包再修改')
  fs.rmSync(dir, { recursive: true, force: true })
  invalidate(id)
  dropSnapshots(id)
  return true
}

export function duplicatePack(id, newId, newName) {
  assertValidId(newId)
  if (resolvePackDir(newId)) throw new Error(`人格包 "${newId}" 已存在`)
  const from = resolvePackDir(id)
  if (!from) throw new Error(`人格包 "${id}" 不存在`)
  const to = path.join(userPacksRoot(), newId)
  fs.mkdirSync(to, { recursive: true })
  for (const name of ['persona.md', 'facts.md', 'lore.jsonl']) {
    const src = path.join(from, name)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(to, name))
  }
  const loreDir = path.join(from, 'lore')
  if (fs.existsSync(loreDir)) copyDir(loreDir, path.join(to, 'lore'))
  const meta = loadPack(id) || defaultMeta(id)
  writeJson(path.join(to, 'pack.json'), normalizeMeta({
    ...meta, id: newId, name: newName || meta.name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  }, newId))
  invalidate(newId)
  return loadPack(newId)
}

export { TEXT_FILES }
