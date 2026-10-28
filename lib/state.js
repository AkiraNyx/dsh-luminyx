/**
 * 状态与路径：所有落盘位置集中在这里。
 *
 * 布局（%DSH_HOME% 默认 ~/.dsh）：
 *   persona/active.json        当前激活的人格包 id
 *   persona/settings.json      插件设置（注入开关、order、召回参数）
 *   persona/packs/<id>/        用户人格包（可增删改）
 *
 * 只依赖 node: 内置模块，不引入任何第三方依赖。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** DSH 数据根目录。宿主进程会注入 DSH_HOME；没有时退回 ~/.dsh。 */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim())
  return path.join(os.homedir(), '.dsh')
}

export function personaRoot() {
  return path.join(dshHome(), 'persona')
}

/** 用户人格包目录（可写）。 */
export function userPacksRoot() {
  return path.join(personaRoot(), 'packs')
}

export function activeFile() {
  return path.join(personaRoot(), 'active.json')
}

export function settingsFile() {
  return path.join(personaRoot(), 'settings.json')
}

export function cacheDir() {
  return path.join(personaRoot(), 'cache')
}

export function ensureRoot() {
  fs.mkdirSync(userPacksRoot(), { recursive: true })
  return personaRoot()
}

/** 读 JSON；文件缺失或损坏时返回 fallback（损坏不抛，避免把整个宿主拖垮）。 */
export function readJson(file, fallback) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    const value = JSON.parse(text)
    return value
  } catch {
    return fallback
  }
}

/** 原子写 JSON：先写 .tmp，再 rename，避免半截文件。 */
export function writeJson(file, value) {
  const text = JSON.stringify(value, null, 2) + '\n'
  atomicWrite(file, text)
  return value
}

export function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, file)
  return file
}

/** 当前激活的人格包 id；没有选择时返回空串。 */
export function readActiveId() {
  const data = readJson(activeFile(), {})
  const id = typeof data?.id === 'string' ? data.id.trim() : ''
  return id
}

export function writeActiveId(id) {
  const value = { id: String(id || ''), updatedAt: new Date().toISOString() }
  writeJson(activeFile(), value)
  return value
}

/** 插件设置：缺省值在这里集中定义，config 与 UI 都可以覆盖。 */
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  order: { persona: 9100, facts: 9120 },
  injectPersona: true,
  injectFacts: true,
  exposeTools: true,
  recall: { limit: 5, minScore: 0.12 },
  maxChars: { persona: 24000, facts: 6000 },
})

export function readSettings() {
  const stored = readJson(settingsFile(), {})
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(stored && typeof stored === 'object' ? stored : {}),
    order: { ...DEFAULT_SETTINGS.order, ...(stored?.order || {}) },
    recall: { ...DEFAULT_SETTINGS.recall, ...(stored?.recall || {}) },
    maxChars: { ...DEFAULT_SETTINGS.maxChars, ...(stored?.maxChars || {}) },
  }
  return merged
}

export function writeSettings(patch) {
  const next = { ...readSettings(), ...(patch || {}) }
  if (patch?.order) next.order = { ...readSettings().order, ...patch.order }
  if (patch?.recall) next.recall = { ...readSettings().recall, ...patch.recall }
  if (patch?.maxChars) next.maxChars = { ...readSettings().maxChars, ...patch.maxChars }
  writeJson(settingsFile(), next)
  return next
}

export function isFresh(file, cached, ttlMs = 1500) {
  if (!cached || typeof cached.mtimeMs !== 'number') return false
  try {
    const stat = fs.statSync(file)
    return stat.mtimeMs === cached.mtimeMs && Date.now() - cached.readAt < ttlMs
  } catch {
    return false
  }
}

export function statOf(file) {
  try {
    const stat = fs.statSync(file)
    return { mtimeMs: stat.mtimeMs, size: stat.size }
  } catch {
    return null
  }
}
