/**
 * 轻量文本检索：中文二元组 + 拉丁词，TF-IDF 打分。
 *
 * 设计目标不是"语义搜索"，而是够用、可解释、零依赖：
 *   - 中文没有空格，按连续汉字串切二元组（「长期记忆」→ 长期/期记/记忆）
 *   - 拉丁字母、数字按词切，兼容 persona_remember、kv-net 这类写法
 *   - 打分 = Σ idf(t) · sat(tf) / 长度归一，另加字段权重
 * 全库 IDF 在每次检索时按候选集现算，条目量在几百到几千时开销可忽略。
 */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g
const LATIN = /[a-z0-9][a-z0-9_+.#-]{0,31}/g

export function hasCjk(text) {
  return CJK.test(String(text || ''))
}

/** 归一化：小写、全角转半角空白、去零宽字符。 */
export function normalize(text) {
  return String(text ?? '')
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
    .replace(/[\u3000\u00a0]/g, ' ')
    .toLowerCase()
}

/** 切词：返回 token 数组（含重复，便于计 tf）。 */
export function tokenize(text) {
  const source = normalize(text)
  const tokens = []
  for (const match of source.matchAll(LATIN)) {
    const token = match[0]
    if (token.length >= 2 || /[a-z]/.test(token)) tokens.push(token)
  }
  for (const run of source.matchAll(CJK_RUN)) {
    const seg = run[0]
    if (seg.length === 1) {
      tokens.push(seg)
      continue
    }
    for (let i = 0; i < seg.length - 1; i += 1) tokens.push(seg.slice(i, i + 2))
    // 整段也作为弱信号保留，长词命中更精确
    if (seg.length <= 6) tokens.push(`=${seg}`)
  }
  return tokens
}

export function termFrequency(text) {
  const tf = new Map()
  for (const token of tokenize(text)) tf.set(token, (tf.get(token) || 0) + 1)
  return tf
}

function saturate(count) {
  return count / (count + 1.2)
}

/**
 * 对候选条目打分。
 * @param {string} query 查询串
 * @param {Array<{id?:string, text:string, weight?:number, title?:string}>} docs
 * @param {{limit?:number, minScore?:number, extra?:Function}} options
 *   extra(doc) 可以返回额外加权（例如记忆的 importance / 新近度）
 */
export function rank(query, docs, { limit = 5, minScore = 0.1, extra = null } = {}) {
  const qTokens = [...new Set(tokenize(query))]
  if (!docs.length) return []
  const docTokens = docs.map((doc) => termFrequency(`${doc.title || ''} ${doc.text || ''}`))
  const N = docs.length

  const idf = new Map()
  for (const token of qTokens) {
    let df = 0
    for (const tf of docTokens) if (tf.has(token)) df += 1
    idf.set(token, Math.log(1 + N / (1 + df)))
  }

  const scores = []
  for (let i = 0; i < docs.length; i += 1) {
    const doc = docs[i]
    const tf = docTokens[i]
    let sum = 0
    let matched = 0
    let total = 0
    for (const token of qTokens) {
      const count = tf.get(token) || 0
      if (!count) continue
      matched += 1
      total += idf.get(token) * saturate(count)
    }
    if (!matched) continue
    const coverage = matched / qTokens.length
    const lengthNorm = 1 + Math.log(1 + tf.size / 60)
    sum = (total / lengthNorm) * (0.55 + 0.45 * coverage)
    if (typeof doc.weight === 'number') sum *= doc.weight
    if (typeof extra === 'function') sum *= extra(doc)
    if (sum <= 0) continue
    scores.push({ doc, score: Number(sum.toFixed(4)) })
  }

  scores.sort((a, b) => b.score - a.score)
  const floor = scores.length && scores[0].score < minScore ? scores[0].score * 0.25 : minScore
  return scores.filter((item) => item.score >= Math.max(floor, 0)).slice(0, limit)
}

/** 文本相似度 0..1，用于"按内容删记忆"这类场景。 */
export function similarity(a, b) {
  const left = termFrequency(a)
  const right = termFrequency(b)
  if (!left.size || !right.size) return 0
  let overlap = 0
  for (const [token, count] of left) {
    const other = right.get(token) || 0
    if (other) overlap += Math.min(count, other)
  }
  return (2 * overlap) / (left.size + right.size)
}

/** 截断到 maxChars，尽量落在句读处。 */
export function clampText(text, maxChars) {
  const source = String(text ?? '')
  if (!Number.isFinite(maxChars) || maxChars <= 0 || source.length <= maxChars) return source
  const head = source.slice(0, maxChars)
  const cut = Math.max(
    head.lastIndexOf('\n\n'),
    head.lastIndexOf('。'),
    head.lastIndexOf('\n'),
    head.lastIndexOf('，'),
  )
  const trimmed = cut > maxChars * 0.6 ? head.slice(0, cut + 1) : head
  return `${trimmed.trimEnd()}\n\n（以上内容因长度上限被截断）`
}
