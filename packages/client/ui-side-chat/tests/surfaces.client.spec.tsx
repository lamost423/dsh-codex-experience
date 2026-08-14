// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SideChatAction } from '../src/client/SideChatAction.tsx'
import { SideChatSelection } from '../src/client/SideChatSelection.tsx'
import type { SideChatActionProps, SideChatSelectionProps } from '../src/client/slots.ts'

afterEach(() => {
  cleanup()
  window.getSelection()?.removeAllRanges()
})

const t = (key: string): string => key

describe('Side Chat assistant entry points', () => {
  it('opens the whole answer at its finalized sequence', () => {
    const open = vi.fn()
    render(<SideChatAction {...({ seq: 12, text: 'whole answer', open, t } as unknown as SideChatActionProps)} />)
    fireEvent.click(screen.getByRole('button', { name: 'action.open' }))
    expect(open).toHaveBeenCalledWith({ seq: 12, text: 'whole answer' })
  })

  it('offers a control only for text selected inside its assistant boundary', () => {
    const open = vi.fn()
    const rect = { left: 20, top: 40, width: 80, height: 20, right: 100, bottom: 60, x: 20, y: 40, toJSON: () => ({}) }
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
    const rendered = render(
      <div data-assistant-message-body>
        <span>select this passage</span>
        <SideChatSelection {...({ seq: 9, open, t } as unknown as SideChatSelectionProps)} />
      </div>,
    )
    vi.spyOn(rendered.container.firstElementChild!, 'getBoundingClientRect').mockReturnValue({ ...rect, left: 0, top: 0, width: 300, right: 300 })
    const range = document.createRange()
    range.selectNodeContents(screen.getByText('select this passage'))
    window.getSelection()?.addRange(range)
    fireEvent.pointerUp(document)

    fireEvent.click(screen.getByRole('button', { name: 'selection.open' }))
    expect(open).toHaveBeenCalledWith({ seq: 9, text: 'select this passage' })
  })
})
