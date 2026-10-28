/**
 * 档案（Lore）：人格包里可按需检索的知识块。
 *
 * 来源两处，合并成一个数组：
 *   lore.jsonl   每行 { id?, chapter?, title?, tags?, text }（推荐，可带标签）
 *   lore/*.md    按 `##` 标题自动切块，便于直接写长文档
 *
 * 与记忆的区别：档案是"设定原文"，只读、由作者维护；记忆是"相处中累积的事实"，
 * 由 persona_remember / persona_forget 在运行期增删。
 */
import { rank, similarity } from './rank.js'
import { chunkMarkdown } from './pack.js'

export function listChapters(pack) {
  const map = new Map()
  for (const entry of pack?.lore || []) {
    const key = entry.chapter || '未分类'
    const row = map.get(key) || { chapter: key, count: 0, titles: [] }
    row.count += 1
    if (entry.title && !row.titles.includes(entry.title)) row.titles.push(entry.title)
    map.set(key, row)
  }
  return [...map.values()].sort((a, b) => (a.chapter < b.chapter ? -1 : 1))
}

export function searchLore(pack, query, { limit = 5, minScore = 0.12 } = {}) {
  const entries = pack?.lore || []
  if (!entries.length) return []
  const docs = entries.map((entry) => ({
    ...entry,
    title: [entry.chapter, entry.title, entry.tags.join(' ')].filter(Boolean).join(' '),
  }))
  const hits = rank(query, docs, { limit, minScore })
  return hits.map((hit) => ({ entry: entries[docs.indexOf(hit.doc)], score: hit.score }))
}

/**
 * 读取档案。
 *   { chapter }  整章（可再按 query 过滤）
 *   { id }       单条
 *   { query }    语义不到位的模糊匹配：先按章标题/标题相似度找，再退回全文检索
 */
export function readLore(pack, { chapter, id, query, limit = 6 } = {}) {
  const entries = pack?.lore || []
  if (id) {
    const hit = entries.find((entry) => entry.id === id)
    return hit ? { mode: 'id', entries: [hit] } : { mode: 'id', entries: [], missing: id }
  }
  if (chapter) {
    const matched = entries.filter((entry) => entry.chapter === chapter || entry.chapter.startsWith(chapter))
    if (query) {
      const hits = rank(query, matched.map((entry) => ({ ...entry, title: entry.title })), { limit, minScore: 0.1 })
      return { mode: 'chapter+query', chapter, entries: hits.map((hit) => matched.find((entry) => entry.id === hit.doc.id) ?? hit.doc) }
    }
    return { mode: 'chapter', chapter, entries: matched.slice(0, limit), total: matched.length }
  }
  if (query) {
    const chapters = listChapters(pack)
    let best = { chapter: '', score: 0 }
    for (const row of chapters) {
      const score = similarity(row.chapter + ' ' + row.titles.join(' '), query)
      if (score > best.score) best = { chapter: row.chapter, score }
    }
    if (best.score >= 0.5) return readLore(pack, { chapter: best.chapter, query, limit })
    const hits = searchLore(pack, query, { limit })
    return { mode: 'search', entries: hits.map((hit) => hit.entry) }
  }
  return { mode: 'list', chapters: listChapters(pack) }
}

export function loreStats(pack) {
  const entries = pack?.lore || []
  const chars = entries.reduce((sum, entry) => sum + entry.text.length, 0)
  return { count: entries.length, chars, chapters: listChapters(pack).length }
}

export { chunkMarkdown }
