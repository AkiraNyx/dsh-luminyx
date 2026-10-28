/**
 * 人格正文 / 常驻事实的结构化读写。
 *
 * 落盘格式仍是纯 markdown —— 可读、可 diff、可手改、可整份粘贴。
 * 结构化只存在于编辑器视图里：解析成块，改完再序列化回去。
 *
 * persona.md
 *   ## 身份
 *   - 我是「示例人格」，长期协作的搭档。
 *   > 「先给结论，再给依据。」
 *
 * facts.md
 *   - 称呼用户「你」
 */

const HEAD_RE = /^##\s+(.*)$/
const LIST_RE = /^[-*+]\s+(.*)$/
const QUOTE_RE = /^>\s?(.*)$/

/** @typedef {{ text: string, style: 'bullet'|'quote'|'plain' }} PersonaItem */
/** @typedef {{ id: string, title: string, items: PersonaItem[] }} PersonaBlock */

function toLines(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
}

function trimBlank(lines) {
  let start = 0
  let end = lines.length
  while (start < end && !lines[start].trim()) start += 1
  while (end > start && !lines[end - 1].trim()) end -= 1
  return lines.slice(start, end)
}

function readItem(line) {
  const list = LIST_RE.exec(line)
  if (list) return { text: list[1].trim(), style: 'bullet' }
  const quote = QUOTE_RE.exec(line)
  if (quote) return { text: quote[1].trim(), style: 'quote' }
  return { text: line.trim(), style: 'plain' }
}

function writeItem(item) {
  const text = String(item?.text ?? '').trim()
  if (!text) return ''
  const style = item?.style === 'quote' || item?.style === 'plain' ? item.style : 'bullet'
  if (style === 'quote') return `> ${text}`
  if (style === 'plain') return text
  return `- ${text}`
}

/**
 * 解析人格正文。
 * `## ` 起一个新块；第一个 `## ` 之前的内容算文件头（会一起注入）。
 * @returns {{ preamble: string, blocks: PersonaBlock[] }}
 */
export function parsePersonaDoc(text) {
  const preamble = []
  const blocks = []
  let current = null

  for (const line of toLines(text)) {
    const trimmed = line.trimEnd()
    const head = HEAD_RE.exec(trimmed)
    if (head) {
      current = { id: `b${blocks.length + 1}`, title: head[1].trim(), items: [] }
      blocks.push(current)
      continue
    }
    if (!trimmed.trim()) continue
    if (!current) {
      preamble.push(trimmed)
      continue
    }
    current.items.push(readItem(trimmed))
  }

  return { preamble: trimBlank(preamble).join('\n').trim(), blocks }
}

/**
 * 序列化人格正文。空块整块丢弃，条目按 style 还原成 `- ` / `> ` / 原样。
 * @param {{ preamble?: string, blocks?: PersonaBlock[] }} doc
 */
export function serializePersonaDoc(doc) {
  const chunks = []
  const preamble = String(doc?.preamble ?? '').trim()
  if (preamble) chunks.push(preamble)

  for (const block of doc?.blocks || []) {
    const title = String(block?.title ?? '').trim()
    const body = trimBlank((block?.items || []).map(writeItem))
      .filter(Boolean)
      .join('\n')
    if (!title && !body) continue
    // 没写模块名的块不生成 `## `，否则会留下一个空标题、下次解析又变成新块。
    if (!title) {
      chunks.push(body)
      continue
    }
    if (!body) {
      chunks.push(`## ${title}`)
      continue
    }
    chunks.push(`## ${title}\n\n${body}`)
  }

  return chunks.length ? `${chunks.join('\n\n')}\n` : ''
}

/**
 * 解析常驻事实。列表项进条目，其余（标题、说明）进文件头。
 * @returns {{ preamble: string, items: PersonaItem[] }}
 */
export function parseFactsDoc(text) {
  const preamble = []
  const items = []
  for (const line of toLines(text)) {
    const trimmed = line.trimEnd()
    if (!trimmed.trim()) continue
    // `//` 开头的行是写给自己的备注，不进注入。不用 `*`：那在 markdown 里是列表符号。
    if (/^\/\/\s?/.test(trimmed.trim())) {
      preamble.push(trimmed.trim())
      continue
    }
    if (LIST_RE.test(trimmed)) {
      items.push(readItem(trimmed))
      continue
    }
    if (QUOTE_RE.test(trimmed) || HEAD_RE.test(trimmed) || /^#\s/.test(trimmed)) {
      preamble.push(trimmed.trim())
      continue
    }
    items.push(readItem(trimmed))
  }
  return { preamble: trimBlank(preamble).join('\n').trim(), items }
}

/**
 * 序列化常驻事实。
 * @param {{ preamble?: string, items?: PersonaItem[] }} doc
 */
export function serializeFactsDoc(doc) {
  const chunks = []
  const preamble = String(doc?.preamble ?? '').trim()
  if (preamble) chunks.push(preamble)

  const body = trimBlank((doc?.items || []).map(writeItem))
    .filter(Boolean)
    .join('\n')
  if (body) chunks.push(body)

  return chunks.length ? `${chunks.join('\n\n')}\n` : ''
}

/** 标题去重后的建议名：新建块时给个不撞车的默认标题。 */
export function suggestTitle(blocks, preset) {
  const base = String(preset || '新模块').trim() || '新模块'
  const taken = new Set((blocks || []).map((block) => String(block?.title ?? '').trim()))
  if (!taken.has(base)) return base
  let index = 2
  while (taken.has(`${base} ${index}`)) index += 1
  return `${base} ${index}`
}

/** 编辑器里展示用的预设模块（只是候选，不限制自由命名）。 */
export const SECTION_PRESETS = [
  '身份',
  '语气',
  '相处方式',
  '不做的事',
  '连续性',
  '工作方式',
  '客观事实',
  '边界',
]
