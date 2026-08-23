// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { AnnotationBody } from '../src/client/AnnotationBody.tsx'
import { parseAnnotations, serializeAnnotations } from '../src/client/annotation-format.ts'
import type { AnnotationBodyProps } from '../src/client/slots.ts'

afterEach(cleanup)

const t = ((key: string) => key) as AnnotationBodyProps['t']

function body(matched: AnnotationBodyProps['matched']) {
  return render(<AnnotationBody {...{ matched, t } as AnnotationBodyProps} />)
}

describe('answer-annotation bubble body', () => {
  it('numbers every card, links it to its source answer, and shows the request below', () => {
    const view = body({
      items: [
        { seq: 12, text: '第一段选中', annotation: '为什么？' },
        { seq: 13, text: '第二段选中', annotation: null },
      ],
      request: '另外再看一眼',
    })

    const links = view.container.querySelectorAll('a[data-answer-annotation]')
    expect([...links].map(link => link.getAttribute('href'))).toEqual(['#dsh-message-12', '#dsh-message-13'])
    expect([...links].map(link => link.textContent)).toEqual(['1第一段选中', '2第二段选中'])
    // A blank comment prints no label at all; only the annotated card carries one.
    expect(view.container.querySelectorAll('[class*="commentLabel"]')).toHaveLength(1)
    expect(view.getByText('为什么？')).toBeTruthy()
    expect(view.container.querySelector('[data-annotation-request]')?.textContent).toBe('另外再看一眼')
  })

  it('omits the request block when the user sent annotations alone', () => {
    const view = body({ items: [{ seq: 4, text: '只有引用', annotation: null }], request: '' })

    expect(view.container.querySelector('[data-annotation-request]')).toBeNull()
  })

  it('jumps to the quoted answer without letting the anchor navigate', () => {
    window.location.hash = ''
    const view = body({ items: [{ seq: 9, text: '引用', annotation: null }], request: '' })
    const link = view.container.querySelector('a[data-answer-annotation]')
    if (link === null) throw new Error('annotation card has no source link')

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    fireEvent(link, event)

    expect(event.defaultPrevented).toBe(true)
    expect(window.location.hash).toBe('#dsh-message-9')
  })

  it('renders exactly what the composer sent, through one serialize/parse round trip', () => {
    const sent = `${serializeAnnotations([{ seq: 3, text: '往返', annotation: '对得上吗？' }])}\n补充`
    const matched = parseAnnotations(sent)
    if (matched === null) throw new Error('round trip lost the attachment')
    const view = body(matched)

    expect(view.container.querySelector('a[data-answer-annotation]')?.textContent).toBe('1往返')
    expect(view.getByText('对得上吗？')).toBeTruthy()
    expect(view.container.querySelector('[data-annotation-request]')?.textContent).toBe('补充')
  })
})
