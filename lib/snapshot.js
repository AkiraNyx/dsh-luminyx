/**
 * 人格包快照：改坏了能退回去。
 *
 * 布局（%DSH_HOME%/persona/.snapshots/<包 id>/<stamp>/）：
 *   persona.md facts.md pack.json   保存当时的三个文件
 *   meta.json                       时间、备注、字数
 *
 * 放 .snapshots 而不是包目录里，是为了包被误删时人格内容还能捞回来；
 * 目录名以点开头，也不会被包发现逻辑当成一个人格包。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { atomicWrite, personaRoot, readJson } from './state.js'

/** 参与快照的文件。lore / memory 不存 —— 它们只增不改，体积也大。 */
const TRACKED = ['persona.md', 'facts.md', 'pack.json']

/** 每个包最多留几份，超了从最旧的删。 */
export const SNAPSHOT_LIMIT = 20

function root() {
  return path.join(personaRoot(), '.snapshots')
}

function dirOf(id) {
  return path.join(root(), String(id))
}

/** 20261028-124500-123，按字典序就是时间序。 */
function stampNow() {
  const now = new Date()
  const pad = (value, width = 2) => String(value).padStart(width, '0')
  return [
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
    pad(now.getMilliseconds(), 3),
  ].join('-')
}

function digest(text) {
  return crypto.createHash('sha1').update(String(text ?? '')).digest('hex')
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function listStamps(id) {
  try {
    return fs
      .readdirSync(dirOf(id), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse()
  } catch {
    return []
  }
}

function readMeta(id, stamp) {
  const meta = readJson(path.join(dirOf(id), stamp, 'meta.json'), null)
  return meta && typeof meta === 'object' ? meta : null
}

/**
 * 给一个包目录打快照。
 *
 * @param {string} id 包 id
 * @param {string} dir 包目录（内置包请先 fork，别对安装目录写东西）
 * @param {{ note?: string, force?: boolean }} options force=true 时即使内容没变也存
 * @returns {object|null} 新快照的 meta；内容未变且非 force 时返回 null
 */
export function createSnapshot(id, dir, options = {}) {
  const files = {}
  for (const name of TRACKED) {
    const text = readIfExists(path.join(dir, name))
    if (text !== null) files[name] = text
  }
  if (!Object.keys(files).length) return null

  // 内容指纹：没变就不必再存一份，否则每次点保存都会堆垃圾。
  const signature = digest(TRACKED.map((name) => `${name}:${digest(files[name] ?? '')}`).join('|'))
  const latest = latestSignature(id)
  if (!options.force && signature === latest) return null

  const stamp = stampNow()
  const target = path.join(dirOf(id), stamp)
  fs.mkdirSync(target, { recursive: true })

  let bytes = 0
  for (const [name, text] of Object.entries(files)) {
    atomicWrite(path.join(target, name), text)
    bytes += text.length
  }

  const meta = {
    stamp,
    time: new Date().toISOString(),
    note: String(options.note || '').slice(0, 200),
    bytes,
    signature,
    files: Object.keys(files),
    chars: {
      persona: (files['persona.md'] || '').length,
      facts: (files['facts.md'] || '').length,
    },
  }
  atomicWrite(path.join(target, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`)
  prune(id)
  return meta
}

function latestSignature(id) {
  const stamps = listStamps(id)
  if (!stamps.length) return ''
  const meta = readMeta(id, stamps[0])
  return meta && typeof meta.signature === 'string' ? meta.signature : ''
}

/** 只保留最近 SNAPSHOT_LIMIT 份。 */
export function prune(id, limit = SNAPSHOT_LIMIT) {
  const stamps = listStamps(id)
  for (const stamp of stamps.slice(limit)) {
    try {
      fs.rmSync(path.join(dirOf(id), stamp), { recursive: true, force: true })
    } catch {
      /* 删不掉就留着，不影响读取 */
    }
  }
  return Math.max(0, stamps.length - limit)
}

/** 快照列表，新的在前。 */
export function listSnapshots(id) {
  return listStamps(id)
    .map((stamp) => {
      const meta = readMeta(id, stamp)
      return {
        stamp,
        time: meta?.time || '',
        note: meta?.note || '',
        bytes: Number(meta?.bytes || 0),
        chars: meta?.chars || { persona: 0, facts: 0 },
      }
    })
    .filter(Boolean)
}

/** 读一份快照的内容，用来预览或恢复。 */
export function readSnapshot(id, stamp) {
  const dir = path.join(dirOf(id), String(stamp))
  if (!fs.existsSync(dir)) throw new Error(`快照不存在：${stamp}`)
  const meta = readMeta(id, stamp) || { stamp }
  return {
    ...meta,
    content: {
      'persona.md': readIfExists(path.join(dir, 'persona.md')),
      'facts.md': readIfExists(path.join(dir, 'facts.md')),
      'pack.json': readIfExists(path.join(dir, 'pack.json')),
    },
  }
}

/** 删一份快照。 */
export function removeSnapshot(id, stamp) {
  const dir = path.join(dirOf(id), String(stamp))
  if (!fs.existsSync(dir)) return false
  fs.rmSync(dir, { recursive: true, force: true })
  return true
}

/** 包被删除时一起清掉它的快照。 */
export function dropSnapshots(id) {
  const dir = dirOf(id)
  if (!fs.existsSync(dir)) return false
  fs.rmSync(dir, { recursive: true, force: true })
  return true
}
