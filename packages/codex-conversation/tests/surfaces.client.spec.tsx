// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { SideChatAction } from '../src/client/SideChatAction.tsx'
import { SideChatPanel } from '../src/client/SideChatPanel.tsx'
import { SideChatSelection } from '../src/client/SideChatSelection.tsx'
import type { SideChatActionProps, SideChatPanelProps, SideChatSelectionProps } from '../src/client/slots.ts'

afterEach(() => {
  cleanup()
  window.getSelection()?.removeAllRanges()
})

const t = (key: string): string => key
Element.prototype.scrollIntoView = vi.fn()

function annotationFace() {
  type Annotation = { id: number; order: number; target: { seq: number; text: string }; comment: string }
  let view: { annotations: Annotation[]; activeId: number | null } = { annotations: [], activeId: null }
  const listeners = new Set<() => void>()
  const publish = (next: typeof view): void => {
    view = next
    for (const listener of listeners) listener()
  }
  const useAnnotations = <T,>(select: (value: typeof view) => T): T => useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    () => select(view),
  )
  const addToConversation = vi.fn((target: Annotation['target']) => {
    const annotation = { id: view.annotations.length + 1, order: view.annotations.length + 1, target, comment: '' }
    publish({ annotations: [...view.annotations, annotation], activeId: annotation.id })
    return annotation
  })
  const updateAnnotation = vi.fn((id: number, comment: string) => {
    publish({ ...view, annotations: view.annotations.map(item => item.id === id ? { ...item, comment } : item) })
  })
  const activateAnnotation = vi.fn((id: number | null) => { publish({ ...view, activeId: id }) })
  return { useAnnotations, addToConversation, updateAnnotation, activateAnnotation, publish }
}

function panelProps(overrides: Record<string, unknown> = {}): SideChatPanelProps {
  const view = {
    parentSessionId: 'parent', childSessionId: null, origin: null,
    conversation: null, phase: 'idle', error: null,
  }
  return {
    useSideChat: (select: (value: unknown) => unknown) => select(view),
    send: vi.fn().mockResolvedValue({ ok: true }),
    close: vi.fn(),
    release: vi.fn().mockResolvedValue(undefined),
    t,
    ...overrides,
  } as unknown as SideChatPanelProps
}

describe('Side Chat assistant entry points', () => {
  it('opens the whole answer at its finalized sequence', () => {
    const open = vi.fn()
    render(<SideChatAction {...({ seq: 12, text: 'whole answer', open, t } as unknown as SideChatActionProps)} />)
    fireEvent.click(screen.getByRole('button', { name: 'action.open' }))
    expect(open).toHaveBeenCalledWith({ seq: 12, text: 'whole answer' })
  })

  it('offers a control only for text selected inside its assistant boundary', () => {
    const open = vi.fn()
    const addToConversation = vi.fn()
    const rect = { left: 20, top: 40, width: 80, height: 20, right: 100, bottom: 60, x: 20, y: 40, toJSON: () => ({}) }
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
    const rendered = render(
      <div data-assistant-message-body>
        <span>select this passage</span>
        <SideChatSelection
          {...({ seq: 9, ...annotationFace(), open, addToConversation, t } as unknown as SideChatSelectionProps)}
        />
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

  it('stages a numbered annotation with an optional inline comment without sending', () => {
    const open = vi.fn()
    const annotations = annotationFace()
    const rect = { left: 20, top: 40, width: 80, height: 20, right: 100, bottom: 60, x: 20, y: 40, toJSON: () => ({}) }
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
    const rendered = render(
      <div data-assistant-message-body>
        <span>annotate this passage</span>
        <SideChatSelection
          {...({ seq: 11, open, ...annotations, t } as unknown as SideChatSelectionProps)}
        />
      </div>,
    )
    vi.spyOn(rendered.container.firstElementChild!, 'getBoundingClientRect').mockReturnValue({ ...rect, left: 0, top: 0, width: 300, right: 300 })
    const range = document.createRange()
    range.selectNodeContents(screen.getByText('annotate this passage'))
    window.getSelection()?.addRange(range)
    fireEvent.pointerUp(document)

    fireEvent.click(screen.getByRole('button', { name: 'selection.add' }))
    expect(screen.getByTestId('annotation-highlight-1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'selection.annotation 1' })).toBeTruthy()
    const comment = screen.getByPlaceholderText('selection.placeholder')
    fireEvent.change(comment, { target: { value: 'explain this' } })
    expect(annotations.updateAnnotation).toHaveBeenCalledWith(1, 'explain this')
    expect(annotations.addToConversation).toHaveBeenCalledWith({ seq: 11, text: 'annotate this passage' })
    expect(open).not.toHaveBeenCalled()
  })

  it('keeps the first anchor while a second selection becomes annotation 2', () => {
    const annotations = annotationFace()
    const rect = { left: 20, top: 40, width: 80, height: 20, right: 100, bottom: 60, x: 20, y: 40, toJSON: () => ({}) }
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
    const rendered = render(
      <div data-assistant-message-body>
        <span>use lower composer</span>
        <SideChatSelection {...({
          seq: 13,
          open: vi.fn(),
          ...annotations,
          t,
        } as unknown as SideChatSelectionProps)} />
      </div>,
    )
    vi.spyOn(rendered.container.firstElementChild!, 'getBoundingClientRect')
      .mockReturnValue({ ...rect, left: 0, top: 0, width: 300, right: 300 })
    const range = document.createRange()
    range.selectNodeContents(screen.getByText('use lower composer'))
    window.getSelection()?.addRange(range)
    fireEvent.pointerUp(document)

    fireEvent.click(screen.getByRole('button', { name: 'selection.add' }))
    window.getSelection()?.removeAllRanges()
    const second = document.createRange()
    second.selectNodeContents(screen.getByText('use lower composer'))
    window.getSelection()?.addRange(second)
    fireEvent.pointerUp(document)
    fireEvent.click(screen.getByRole('button', { name: 'selection.add' }))

    expect(screen.getByRole('button', { name: 'selection.annotation 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'selection.annotation 2' })).toBeTruthy()
    expect(screen.getAllByPlaceholderText('selection.placeholder')).toHaveLength(1)
  })

  it('does not register when rendered outside an assistant boundary', () => {
    render(<SideChatSelection {...({
      seq: 1, ...annotationFace(), open: vi.fn(), addToConversation: vi.fn(), t,
    } as unknown as SideChatSelectionProps)} />)
    fireEvent.pointerUp(document)
    expect(screen.queryByRole('button', { name: 'selection.open' })).toBeNull()
  })

  it('clears the active toolbar when the selection collapses or leaves its boundary', () => {
    const rect = { left: 20, top: 40, width: 80, height: 20, right: 100, bottom: 60, x: 20, y: 40, toJSON: () => ({}) }
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
    const rendered = render(
      <>
        <div data-assistant-message-body>
          <span>inside</span>
          <SideChatSelection
            {...({
              seq: 1, ...annotationFace(), open: vi.fn(), addToConversation: vi.fn(), t,
            } as unknown as SideChatSelectionProps)}
          />
        </div>
        <span>outside</span>
      </>,
    )
    vi.spyOn(rendered.container.querySelector<HTMLElement>('[data-assistant-message-body]')!, 'getBoundingClientRect')
      .mockReturnValue({ ...rect, left: 0, top: 0, width: 300, right: 300 })
    const range = document.createRange()
    range.selectNodeContents(screen.getByText('inside'))
    window.getSelection()?.addRange(range)
    fireEvent.keyUp(document)
    expect(screen.getByRole('button', { name: 'selection.open' })).toBeTruthy()

    window.getSelection()?.removeAllRanges()
    fireEvent(document, new Event('selectionchange', { bubbles: true }))
    expect(screen.queryByRole('button', { name: 'selection.open' })).toBeNull()

    const outside = document.createRange()
    outside.selectNodeContents(screen.getByText('outside'))
    window.getSelection()?.addRange(outside)
    fireEvent.pointerUp(document)
    expect(screen.queryByRole('button', { name: 'selection.open' })).toBeNull()
  })

  it('moves one active toolbar between assistant boundaries and prevents pointer selection loss', () => {
    const rect = { left: -100, top: 10, width: 1_000, height: 20, right: 900, bottom: 30, x: -100, y: 10, toJSON: () => ({}) }
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => rect })
    const rendered = render(<>
      <div data-assistant-message-body>
        <span>first</span>
        <SideChatSelection
          {...({
            seq: 1, ...annotationFace(), open: vi.fn(), addToConversation: vi.fn(), t,
          } as unknown as SideChatSelectionProps)}
        />
      </div>
      <div data-assistant-message-body>
        <span>second</span>
        <SideChatSelection
          {...({
            seq: 2, ...annotationFace(), open: vi.fn(), addToConversation: vi.fn(), t,
          } as unknown as SideChatSelectionProps)}
        />
      </div>
    </>)
    for (const boundary of rendered.container.querySelectorAll<HTMLElement>('[data-assistant-message-body]')) {
      vi.spyOn(boundary, 'getBoundingClientRect').mockReturnValue({ ...rect, left: 0, top: 0, width: 100, right: 100 })
    }
    const select = (label: string): void => {
      window.getSelection()?.removeAllRanges()
      const range = document.createRange()
      range.selectNodeContents(screen.getByText(label))
      window.getSelection()?.addRange(range)
      fireEvent.pointerUp(document)
    }
    select('first')
    expect(screen.getAllByRole('button', { name: 'selection.open' })).toHaveLength(1)
    select('second')
    const button = screen.getByRole('button', { name: 'selection.open' })
    expect(button.closest('[data-assistant-message-body]')?.textContent).toContain('second')
    const pointer = new Event('pointerdown', { bubbles: true, cancelable: true })
    button.dispatchEvent(pointer)
    expect(pointer.defaultPrevented).toBe(true)
  })

  it('handles an element selection and overlapping registrations on one boundary', () => {
    const open = vi.fn()
    const boundaryRef = { current: null as HTMLDivElement | null }
    const rendered = render(
      <div ref={(node) => { boundaryRef.current = node }} data-assistant-message-body>
        <SideChatSelection {...({
          seq: 1, ...annotationFace(), open, addToConversation: vi.fn(), t,
        } as unknown as SideChatSelectionProps)} />
        <SideChatSelection {...({
          seq: 2, ...annotationFace(), open, addToConversation: vi.fn(), t,
        } as unknown as SideChatSelectionProps)} />
      </div>,
    )
    const boundary = boundaryRef.current!
    const selection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => ({ commonAncestorContainer: boundary, getBoundingClientRect: () => ({ left: 0, top: 0, width: 10 }) }),
      toString: () => 'element selection',
      removeAllRanges: vi.fn(),
    } as unknown as Selection
    vi.spyOn(window, 'getSelection').mockReturnValue(selection)
    vi.spyOn(boundary, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100 } as DOMRect)
    fireEvent.pointerUp(document)

    const add = screen.getByRole('button', { name: 'selection.add' })
    const pointer = new Event('pointerdown', { bubbles: true, cancelable: true })
    add.dispatchEvent(pointer)
    expect(pointer.defaultPrevented).toBe(true)

    const text = document.createTextNode('text selection')
    boundary.append(text)
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => ({ commonAncestorContainer: text, getBoundingClientRect: () => ({ left: 0, top: 0, width: 10 }) }),
      toString: () => 'text selection',
      removeAllRanges: vi.fn(),
    } as unknown as Selection)
    fireEvent.pointerUp(document)
    expect(screen.getByRole('button', { name: 'selection.open' })).toBeTruthy()
    rendered.unmount()
  })

  it('uses client rect fragments, keeps zero-width lines, and handles annotation editor keys', () => {
    const annotations = annotationFace()
    const boundaryRect = { left: 10, top: 20, width: 300, height: 200 } as DOMRect
    const fragments = [
      { left: 20, top: 40, width: 0, height: 10 },
      { left: 30, top: 55, width: 40, height: 0 },
    ] as DOMRect[]
    const rendered = render(
      <div data-assistant-message-body>
        <span>fragmented selection</span>
        <SideChatSelection {...({
          seq: 14, open: vi.fn(), ...annotations, t,
        } as unknown as SideChatSelectionProps)} />
      </div>,
    )
    const boundary = rendered.container.querySelector<HTMLElement>('[data-assistant-message-body]')!
    vi.spyOn(boundary, 'getBoundingClientRect').mockReturnValue(boundaryRect)
    const text = screen.getByText('fragmented selection').firstChild!
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => ({ commonAncestorContainer: text, getClientRects: () => fragments }),
      toString: () => 'fragmented selection',
      removeAllRanges: vi.fn(),
    } as unknown as Selection)

    fireEvent.pointerUp(document)
    fireEvent.click(screen.getByRole('button', { name: 'selection.add' }))
    expect(screen.getByTestId('annotation-highlight-1')).toBeTruthy()
    expect(rendered.container.querySelectorAll('[class*="highlight"]')).toHaveLength(2)

    const editor = screen.getByPlaceholderText('selection.placeholder')
    fireEvent.keyDown(editor, { key: 'a' })
    fireEvent.keyDown(editor, { key: 'Enter', isComposing: true })
    expect(annotations.activateAnnotation).toHaveBeenLastCalledWith(null)
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(annotations.activateAnnotation).toHaveBeenLastCalledWith(null)

    fireEvent.click(screen.getByRole('button', { name: 'selection.annotation 1' }))
    expect(annotations.activateAnnotation).toHaveBeenLastCalledWith(1)
  })

  it('keeps the selection toolbar open when annotation staging is rejected', () => {
    const annotations = annotationFace()
    annotations.addToConversation.mockReturnValueOnce(null as never)
    const rect = { left: 0, top: 0, width: 10, height: 10 } as DOMRect
    const rendered = render(
      <div data-assistant-message-body>
        <span>rejected selection</span>
        <SideChatSelection {...({
          seq: 15, open: vi.fn(), ...annotations, t,
        } as unknown as SideChatSelectionProps)} />
      </div>,
    )
    const boundary = rendered.container.querySelector<HTMLElement>('[data-assistant-message-body]')!
    vi.spyOn(boundary, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 100, height: 10,
    } as DOMRect)
    const text = screen.getByText('rejected selection').firstChild!
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => ({ commonAncestorContainer: text, getClientRects: () => [rect] }),
      toString: () => 'rejected selection',
      removeAllRanges: vi.fn(),
    } as unknown as Selection)

    fireEvent.pointerUp(document)
    fireEvent.click(screen.getByRole('button', { name: 'selection.add' }))
    expect(screen.getByRole('button', { name: 'selection.add' })).toBeTruthy()
  })

  it('dismisses selections with no visible rectangles', () => {
    const rendered = render(
      <div data-assistant-message-body>
        <span>zero rectangle</span>
        <SideChatSelection {...({
          seq: 16, open: vi.fn(), ...annotationFace(), t,
        } as unknown as SideChatSelectionProps)} />
      </div>,
    )
    const boundary = rendered.container.querySelector<HTMLElement>('[data-assistant-message-body]')!
    vi.spyOn(boundary, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100 } as DOMRect)
    const text = screen.getByText('zero rectangle').firstChild!
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => ({
        commonAncestorContainer: text,
        getClientRects: () => [{ left: 0, top: 0, width: 0, height: 0 }],
      }),
      toString: () => 'zero rectangle',
      removeAllRanges: vi.fn(),
    } as unknown as Selection)

    fireEvent.pointerUp(document)
    expect(screen.queryByRole('button', { name: 'selection.add' })).toBeNull()
  })

  it('drops anchors whose annotation projection disappears between filtering and lookup', async () => {
    const annotations = annotationFace()
    const rect = { left: 0, top: 0, width: 10, height: 10 } as DOMRect
    const rendered = render(
      <div data-assistant-message-body>
        <span>transient annotation</span>
        <SideChatSelection {...({
          seq: 17, open: vi.fn(), ...annotations, t,
        } as unknown as SideChatSelectionProps)} />
      </div>,
    )
    const boundary = rendered.container.querySelector<HTMLElement>('[data-assistant-message-body]')!
    vi.spyOn(boundary, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100 } as DOMRect)
    const text = screen.getByText('transient annotation').firstChild!
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => ({ commonAncestorContainer: text, getClientRects: () => [rect] }),
      toString: () => 'transient annotation',
      removeAllRanges: vi.fn(),
    } as unknown as Selection)
    fireEvent.pointerUp(document)
    fireEvent.click(screen.getByRole('button', { name: 'selection.add' }))

    const projected = [{ id: 1, order: 1, target: { seq: 17, text: 'transient annotation' }, comment: '' }]
    const unstable = [...projected]
    Object.defineProperty(unstable, 'find', { value: () => undefined })
    annotations.publish({ annotations: unstable, activeId: null })
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: 'selection.annotation 1' })).toBeNull()
    })
  })

  it('defensively clears geometries whose first or final rectangle disappears', () => {
    const originalMap = Array.prototype.map
    const map = vi.spyOn(Array.prototype, 'map').mockImplementation(function (this: unknown[], callback, thisArg) {
      const source = this as Array<{ coverageMarker?: string }>
      const marker = source[0]?.coverageMarker
      if (marker === 'missing-first') {
        return { 0: undefined, length: 1, at: () => undefined } as unknown as never[]
      }
      if (marker === 'missing-last') {
        const mapped = originalMap.call(this, callback, thisArg)
        let calls = 0
        return {
          0: mapped[0],
          length: 1,
          map: () => [],
          at: () => { calls += 1; return calls === 1 ? mapped[0] : undefined },
        } as unknown as never[]
      }
      return originalMap.call(this, callback, thisArg)
    })
    const annotations = annotationFace()
    const rendered = render(
      <div data-assistant-message-body>
        <span>vanishing rectangle</span>
        <SideChatSelection {...({
          seq: 18, open: vi.fn(), ...annotations, t,
        } as unknown as SideChatSelectionProps)} />
      </div>,
    )
    const boundary = rendered.container.querySelector<HTMLElement>('[data-assistant-message-body]')!
    vi.spyOn(boundary, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 100 } as DOMRect)
    const text = screen.getByText('vanishing rectangle').firstChild!
    let marker = 'missing-first'
    vi.spyOn(window, 'getSelection').mockImplementation(() => ({
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => ({
        commonAncestorContainer: text,
        getClientRects: () => [{ coverageMarker: marker, left: 0, top: 0, width: 10, height: 10 }],
      }),
      toString: () => 'vanishing rectangle',
      removeAllRanges: vi.fn(),
    } as unknown as Selection))

    fireEvent.pointerUp(document)
    expect(screen.queryByRole('button', { name: 'selection.add' })).toBeNull()
    marker = 'missing-last'
    fireEvent.pointerUp(document)
    fireEvent.click(screen.getByRole('button', { name: 'selection.add' }))
    expect(screen.queryByRole('button', { name: 'selection.annotation 1' })).toBeNull()
    map.mockRestore()
  })
})

describe('Side Chat panel lifecycle', () => {
  it('releases its ephemeral child when another details route unmounts it', () => {
    const release = vi.fn().mockResolvedValue(undefined)
    const rendered = render(<SideChatPanel {...panelProps({ release })} />)

    rendered.unmount()
    expect(release).toHaveBeenCalledOnce()
  })

  it('routes the close button through the explicit close action', () => {
    const close = vi.fn()
    render(<SideChatPanel {...panelProps({ close })} />)

    fireEvent.click(screen.getByRole('button', { name: 'panel.close' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('renders the pending quote, states, errors, and text-only child transcript', () => {
    const conversation = {
      chat: {
        order: ['user', 'assistant', 'tool-only', 'unknown'],
        nodes: new Map([
          ['user', { kind: 'user', data: { content: [
            { type: 'text', text: 'child question' }, { type: 'image', image: 'ignored' },
          ] } }],
          ['assistant', { kind: 'assistant-step', data: { blocks: [
            { kind: 'text', text: 'child answer' }, { kind: 'tool', name: 'ignored' },
          ] } }],
          ['tool-only', { kind: 'assistant-step', data: { blocks: [{ kind: 'tool', name: 'ignored' }] } }],
          ['unknown', { kind: 'tool' }],
        ]),
      },
    } as unknown as ConversationSnapshot
    const view = {
      parentSessionId: 'parent', childSessionId: 'child',
      origin: { seq: 3, text: 'quoted answer' }, conversation, phase: 'error', error: 'failed',
    }
    render(<SideChatPanel {...panelProps({
      useSideChat: (select: (value: unknown) => unknown) => select(view),
    })} />)

    expect(screen.getByText('quoted answer')).toBeTruthy()
    expect(screen.getByText('child question')).toBeTruthy()
    expect(screen.getByText('child answer')).toBeTruthy()
    expect(screen.getByText('panel.error: failed')).toBeTruthy()
    expect(screen.queryByText('panel.empty')).toBeNull()
  })

  it('renders a sent side-chat seed as a small quote followed by the user question', () => {
    const seed = '请基于主会话中这段内容回答，不要修改主任务：\n\n> quoted first line\n> quoted second line\n\nwhy?'
    const conversation = {
      chat: {
        order: ['user'],
        nodes: new Map([['user', { kind: 'user', data: { content: [{ type: 'text', text: seed }] } }]]),
      },
    } as unknown as ConversationSnapshot
    const view = {
      parentSessionId: 'parent', childSessionId: 'child', origin: null,
      conversation, phase: 'ready', error: null,
    }

    render(<SideChatPanel {...panelProps({
      useSideChat: (select: (value: unknown) => unknown) => select(view),
    })} />)

    expect(screen.getByTestId('side-chat-inline-quote').textContent).toContain('quoted first line')
    expect(screen.getByTestId('side-chat-question').textContent).toBe('why?')
    expect(screen.queryByText('请基于主会话中这段内容回答，不要修改主任务：')).toBeNull()
  })

  it('leaves malformed or empty side-chat seeds as ordinary user text', () => {
    const prefix = '请基于主会话中这段内容回答，不要修改主任务：'
    const texts = [
      `${prefix}\n\nquestion without quote`,
      `${prefix}\n\n> quote without separator\nquestion`,
      `${prefix}\n\n> quote\n\n   `,
    ]
    const conversation = {
      chat: {
        order: ['no-quote', 'no-separator', 'no-question'],
        nodes: new Map(texts.map((text, index) => [
          ['no-quote', 'no-separator', 'no-question'][index],
          { kind: 'user', data: { content: [{ type: 'text', text }] } },
        ])),
      },
    } as unknown as ConversationSnapshot
    const view = {
      parentSessionId: 'parent', childSessionId: 'child', origin: null,
      conversation, phase: 'ready', error: null,
    }

    render(<SideChatPanel {...panelProps({
      useSideChat: (select: (value: unknown) => unknown) => select(view),
    })} />)

    expect(screen.queryByTestId('side-chat-inline-quote')).toBeNull()
    expect(screen.getByText(/question without quote/)).toBeTruthy()
    expect(screen.getByText(/quote without separator/)).toBeTruthy()
  })

  it('shows the creating state instead of the empty state', () => {
    const view = {
      parentSessionId: 'parent', childSessionId: null, origin: { seq: 1, text: '' },
      conversation: null, phase: 'forking', error: null,
    }
    render(<SideChatPanel {...panelProps({
      useSideChat: (select: (value: unknown) => unknown) => select(view),
    })} />)
    expect(screen.getByText('panel.creating')).toBeTruthy()
    expect(screen.queryByText('panel.empty')).toBeNull()
  })

  it('submits a trimmed prompt by form and clears it only after acceptance', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true })
    render(<SideChatPanel {...panelProps({ send })} />)
    const composer = screen.getByPlaceholderText('composer.placeholder')
    fireEvent.change(composer, { target: { value: '  why?  ' } })
    fireEvent.submit(composer.closest('form')!)

    await vi.waitFor(() => { expect(send).toHaveBeenCalledWith('why?') })
    await vi.waitFor(() => { expect((composer as HTMLTextAreaElement).value).toBe('') })
  })

  it('keeps a rejected prompt and blocks duplicate submits while pending', async () => {
    let resolveSend: ((value: { ok: false; error: string }) => void) | undefined
    const send = vi.fn(() => new Promise<{ ok: false; error: string }>((resolve) => { resolveSend = resolve }))
    render(<SideChatPanel {...panelProps({ send })} />)
    const composer = screen.getByPlaceholderText('composer.placeholder')
    fireEvent.change(composer, { target: { value: 'retry me' } })
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false, isComposing: false })
    fireEvent.submit(composer.closest('form')!)
    expect(send).toHaveBeenCalledOnce()
    expect((composer as HTMLTextAreaElement).disabled).toBe(true)

    resolveSend?.({ ok: false, error: 'no' })
    await vi.waitFor(() => { expect((composer as HTMLTextAreaElement).disabled).toBe(false) })
    expect((composer as HTMLTextAreaElement).value).toBe('retry me')
  })

  it('leaves newline and composition keyboard gestures to the textarea', () => {
    const send = vi.fn()
    render(<SideChatPanel {...panelProps({ send })} />)
    const composer = screen.getByPlaceholderText('composer.placeholder')
    fireEvent.change(composer, { target: { value: 'draft' } })
    fireEvent.keyDown(composer, { key: 'a' })
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(composer, { key: 'Enter', isComposing: true })
    expect(send).not.toHaveBeenCalled()
  })

  it('reports a route-release failure and uses the latest release callback', async () => {
    const first = vi.fn().mockResolvedValue(undefined)
    const failure = new Error('release failed')
    const second = vi.fn().mockRejectedValue(failure)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rendered = render(<SideChatPanel {...panelProps({ release: first })} />)
    rendered.rerender(<SideChatPanel {...panelProps({ release: second })} />)
    rendered.unmount()

    await vi.waitFor(() => { expect(error).toHaveBeenCalledWith('[ui-side-chat] route release failed:', failure) })
    expect(first).not.toHaveBeenCalled()
    error.mockRestore()
  })
})
