/**
 * The answer-annotation wire format: the one text encoding shared by the
 * composer (which writes it) and the transcript projector (which reads it
 * back). The sent text is the only durable record of an annotation batch, so
 * every field the bubble needs to rebuild its cards travels inside the block.
 *
 * Serializer and parser live together because they are one contract: the
 * parser accepts exactly what the serializer emits and nothing looser.
 */

/** One selected passage and its optional user comment, as carried to the model. */
export interface AnnotationItem {
  /** Source assistant message sequence, used to link a card back to its answer. */
  readonly seq: number
  /** The passage the user selected in that answer. */
  readonly text: string
  /** The user's comment on the passage, or null when they left it blank. */
  readonly annotation: string | null
}

/** One parsed annotation attachment plus the user's own request text. */
export interface AnnotationAttachment {
  /** Annotations in the order the user staged them; never empty. */
  readonly items: readonly AnnotationItem[]
  /** What the user typed in the main composer; empty when they sent only annotations. */
  readonly request: string
}

/** The directive name the model writes back to cite one annotation. */
export const DIRECTIVE_NAME = 'dsh-annotation'

const HEADING = '# 回复注释：'
const OPEN = '<response-annotations>'
const CLOSE = '</response-annotations>'
const REQUEST_HEADING = '## 我的请求：'

const INSTRUCTION = [
  '每一项是从此前回复中选中的文本，可能附带用户评论。按数组顺序视为注释 1、注释 2，依此类推。',
  '把每段选中文本都当作上下文，并回应每一条评论。回应某条注释时，在正文里内联写出它的指令',
  ` \`:${DIRECTIVE_NAME}{index="N"}\`，N 是它在数组里的一基序号（例如 \`:${DIRECTIVE_NAME}{index="1"}\`）。`,
  '不要使用其他形式的注释标签。',
].join('')

/**
 * Encode one staged annotation batch as the model-facing attachment prefix.
 * The result ends at the request heading; the composer's own newline plus the
 * user's draft complete the message.
 * @param items - Staged annotations in display order; must not be empty.
 * @returns The attachment text, ending with the request heading.
 */
export function serializeAnnotations(items: readonly AnnotationItem[]): string {
  return [
    HEADING,
    INSTRUCTION,
    OPEN,
    JSON.stringify(items.map(({ seq, text, annotation }) => ({ seq, text, annotation }))),
    CLOSE,
    '',
    REQUEST_HEADING,
  ].join('\n')
}

function readItems(json: string): AnnotationItem[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    // Hand-edited or truncated durable text reaches this parser like any other
    // message body; a malformed block projects as literal text instead.
    return null
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null
  const items: AnnotationItem[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) return null
    const { seq, text, annotation } = entry as Record<string, unknown>
    if (typeof seq !== 'number' || !Number.isInteger(seq)) return null
    if (typeof text !== 'string' || text === '') return null
    if (annotation !== null && typeof annotation !== 'string') return null
    items.push({ seq, text, annotation })
  }
  return items
}

/**
 * Recover the annotation batch and the user's request from one sent message.
 * @param text - The complete user-message text.
 * @returns The attachment, or null when this message carries no annotations.
 */
export function parseAnnotations(text: string): AnnotationAttachment | null {
  const head = `${HEADING}\n`
  if (!text.startsWith(head)) return null
  const open = `\n${OPEN}\n`
  const openAt = text.indexOf(open, head.length)
  if (openAt === -1) return null
  const close = `\n${CLOSE}\n`
  const closeAt = text.indexOf(close, openAt + open.length)
  if (closeAt === -1) return null
  const items = readItems(text.slice(openAt + open.length, closeAt))
  if (items === null) return null
  const request = `\n${REQUEST_HEADING}`
  const requestAt = text.indexOf(request, closeAt + close.length)
  if (requestAt === -1) return null
  return { items, request: text.slice(requestAt + request.length).replace(/^\n/u, '') }
}
