/**
 * The attachment parser reads durable message text, so it treats every
 * malformed or hand-edited body as "not an attachment" and lets the bubble
 * fall back to its plain projection.
 */
import { describe, expect, it } from 'vitest'
import { parseAnnotations, serializeAnnotations } from '../src/client/annotation-format.ts'

const one = serializeAnnotations([{ seq: 5, text: '引用', annotation: '问题' }])

/** Replace the block's JSON payload, keeping every surrounding marker intact. */
function withPayload(payload: string): string {
  return `${one.replace(/\[\{.*\}\]/u, payload)}\n请求`
}

describe('answer-annotation attachment parsing', () => {
  it('accepts its own output and keeps an empty request when nothing follows', () => {
    expect(parseAnnotations(one)).toEqual({
      items: [{ seq: 5, text: '引用', annotation: '问题' }],
      request: '',
    })
  })

  it.each([
    ['no attachment heading', 'just a question'],
    ['heading without an opening tag', '# 回复注释：\n说明\n请求'],
    ['opening tag without a closing tag', `${one.replace('</response-annotations>', '')}\n请求`],
    ['no request heading', one.replace('## 我的请求：', '')],
  ])('declines text with %s', (_case, text) => {
    expect(parseAnnotations(text)).toBeNull()
  })

  it.each([
    ['malformed JSON', '[{'],
    ['a non-array payload', '{"seq":1}'],
    ['an empty array', '[]'],
    ['a non-object item', '["quote"]'],
    ['a null item', '[null]'],
    ['a non-integer seq', '[{"seq":1.5,"text":"引用","annotation":null}]'],
    ['a missing seq', '[{"text":"引用","annotation":null}]'],
    ['an empty text', '[{"seq":1,"text":"","annotation":null}]'],
    ['a non-string text', '[{"seq":1,"text":7,"annotation":null}]'],
    ['a non-string comment', '[{"seq":1,"text":"引用","annotation":7}]'],
  ])('declines a block carrying %s', (_case, payload) => {
    expect(parseAnnotations(withPayload(payload))).toBeNull()
  })
})
