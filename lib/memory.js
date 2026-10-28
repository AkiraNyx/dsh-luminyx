/**
 * 长期记忆：每条一行 JSON 追加到 <包目录>/memory.jsonl。
 *
 * 条目形状：
 *   { id, text, importance, tags, createdAt, updatedAt, source }
 *
 * 检索沿用 lib/rank.js 的 TF-IDF，再乘上 importance 与新近度：
 *   - importance 1–5 → 权重 0.85 + 0.06·imp（低权重不会被完全压死，高权重更靠前）
 *   - 新近度：半衰期 60 天，最低 0.9、最高 1.1，避免"越新越好"压过内容相关
 *
 * 写入策略：追加 + 删除时整体重写（条目数量级在千以内，重写最省心也最不容易坏）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicWrite } from './state.js'
import { rank, similarity } from './rank.js'

const HALF_LIFE_DAYS = 60
const MAX_TEXT = 2000

function readLines(file) {
  let text = ''
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const out = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    try {
      const entry = normalizeEntry(JSON.parse(trimmed))
      if (entry) out.push(entry)
    } catch {
      /* 坏行跳过 */
    }
  }
  return out
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (!text) return null
  const importance = Number.isFinite(raw.importance) ? Math.min(5, Math.max(1, Math.round(raw.importance))) : 2
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : randomUUID(),
    text: text.slice(0, MAX_TEXT),
    importance,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : [],
    source: typeof raw.source === 'string' ? raw.source : 'user',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  }
}

function writeAll(file, entries) {
  atomicWrite(file, entries.map((entry) => JSON.stringify(entry)).join('\n') + (entries.length ? '\n' : ''))
}

export function listMemory(memoryFile) {
  return readLines(memoryFile)
}

export function countMemory(memoryFile) {
  return readLines(memoryFile).length
}

/**
 * 新增一条记忆。
 * @param {string} memoryFile memory.jsonl 绝对路径
 * @param {{text:string, importance?:number, tags?:string[], source?:string}} input
 */
export function addMemory(memoryFile, input) {
  const text = String(input?.text ?? '').trim()
  if (!text) throw new Error('记忆内容不能为空')
  const entries = readLines(memoryFile)
  const candidate = normalizeEntry({
    text,
    importance: input?.importance,
    tags: input?.tags,
    source: input?.source || 'assistant',
  })
  // 完全重复就不写第二遍，只刷新时间与重要性
  const duplicate = entries.find((entry) => similarity(entry.text, candidate.text) >= 0.92)
  if (duplicate) {
    duplicate.updatedAt = new Date().toISOString()
    if (candidate.importance > duplicate.importance) duplicate.importance = candidate.importance
    if (candidate.tags.length) duplicate.tags = [...new Set([...duplicate.tags, ...candidate.tags])]
    writeAll(memoryFile, entries)
    return { entry: duplicate, created: false }
  }
  entries.push(candidate)
  writeAll(memoryFile, entries)
  return { entry: candidate, created: true }
}

/** 按 id 删除；没有 id 时按内容最相似的一条（≥0.62）删除。 */
export function forgetMemory(memoryFile, { id, query } = {}) {
  const entries = readLines(memoryFile)
  let index = -1
  if (id) index = entries.findIndex((entry) => entry.id === id)
  else if (query) {
    let best = { index: -1, score: 0 }
    entries.forEach((entry, i) => {
      const score = similarity(entry.text, query)
      if (score > best.score) best = { index: i, score }
    })
    if (best.score >= 0.62) index = best.index
    if (index < 0) {
      const hits = rank(query, entries, { limit: 1, minScore: 0.18 })
      if (hits.length) index = entries.indexOf(hits[0].doc)
    }
  }
  if (index < 0) return { removed: null }
  const [removed] = entries.splice(index, 1)
  writeAll(memoryFile, entries)
  return { removed }
}

/** 按条件批量清理：keep 保留最近 N 条（0 表示全清）。 */
export function pruneMemory(memoryFile, { keep = 0 } = {}) {
  const entries = readLines(memoryFile)
  if (!entries.length) return { removed: 0, remaining: 0 }
  const sorted = [...entries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const kept = keep > 0 ? sorted.slice(0, keep) : []
  writeAll(memoryFile, kept)
  return { removed: entries.length - kept.length, remaining: kept.length }
}

function recencyWeight(entry) {
  const created = Date.parse(entry.createdAt)
  if (!Number.isFinite(created)) return 1
  const ageDays = Math.max(0, (Date.now() - created) / 86400000)
  const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS)
  return 0.9 + 0.2 * decay
}

function importanceWeight(entry) {
  return 0.85 + 0.06 * (Number(entry.importance) || 2)
}

/** 检索记忆：TF-IDF × 重要性 × 新近度。 */
export function recall(memoryFile, query, { limit = 5, minScore = 0.12 } = {}) {
  const entries = readLines(memoryFile)
  if (!entries.length) return []
  const docs = entries.map((entry) => ({ ...entry, text: entry.text, title: entry.tags.join(' '), entry }))
  const hits = rank(query, docs, {
    limit,
    minScore,
    extra: (doc) => importanceWeight(doc) * recencyWeight(doc),
  })
  return hits.map((hit) => ({ entry: hit.doc.entry, score: hit.score }))
}
