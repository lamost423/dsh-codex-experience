// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { AnnotationBody } from '../src/client/AnnotationBody.tsx'
import { annotationDirectives } from '../src/client/AnnotationMarker.tsx'
import type { AnnotationBodyProps } from '../src/client/slots.ts'

afterEach(cleanup)

const directives = annotationDirectives('回复注释')
const t = ((key: string) => key) as AnnotationBodyProps['t']

/** One annotated exchange: the user's cards above, the answer's markers below. */
function exchange(items: AnnotationBodyProps['matched']['items']) {
  return render(
    <div>
      <AnnotationBody {...{ matched: { items, request: '' }, t } as AnnotationBodyProps} />
      <p>{directives.resolve('dsh-annotation', { index: '2' })}</p>
    </div>,
  )
}

describe('answer-side annotation markers', () => {
  it('resolves only its own directive name', () => {
    expect(directives.resolve('other-plugin', { index: '1' })).toBeUndefined()
  })

  it.each([['0'], ['-1'], ['1.5'], [''], ['one'], [undefined]])(
    'declines index %s rather than rendering a marker for it',
    (index) => {
      expect(directives.resolve('dsh-annotation', index === undefined ? {} : { index }))
        .toBeUndefined()
    },
  )

  it('scrolls to the cited card in the annotated bubble above it', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const view = exchange([
      { seq: 1, text: '第一段', annotation: null },
      { seq: 2, text: '第二段', annotation: null },
    ])
    const marker = view.container.querySelector('[data-annotation-marker]')
    if (marker === null) throw new Error('answer carries no marker')

    fireEvent.click(marker)

    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(scrollIntoView.mock.instances[0]).toBe(
      view.container.querySelectorAll('[data-annotation-index]')[1],
    )
  })

  it('cites nothing when no annotated bubble precedes the marker', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const view = render(<p>{directives.resolve('dsh-annotation', { index: '1' })}</p>)
    const marker = view.container.querySelector('[data-annotation-marker]')
    if (marker === null) throw new Error('answer carries no marker')

    fireEvent.click(marker)

    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('labels each marker for assistive technology', () => {
    const view = exchange([{ seq: 1, text: '第一段', annotation: null }])

    expect(view.container.querySelector('[data-annotation-marker]')?.getAttribute('aria-label'))
      .toBe('回复注释 2')
  })
})
