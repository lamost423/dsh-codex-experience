import { describe, expect, it, vi } from 'vitest'
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { AnnotationController } from '../src/client/annotations.ts'

interface Occurrence {
  source: string
  ref: string
  offset: number
  length: number
  label: string
  clipboardText: string
}

/** The real input machine renders a reference as this run inside the draft. */
function displayText(label: string): string {
  return `@${label}`
}

function bench() {
  let snapshot = {
    draft: 'question',
    draftRev: 1,
    occurrences: [] as Occurrence[],
  }
  const listeners = new Set<() => void>()
  const insertResults: boolean[] = []
  const emit = (): void => { for (const listener of listeners) listener() }
  const setDraft = vi.fn((draft: string) => {
    const current = snapshot.occurrences[0]
    const offset = current === undefined ? -1 : draft.indexOf(displayText(current.label))
    snapshot = {
      ...snapshot,
      draft,
      draftRev: snapshot.draftRev + 1,
      occurrences: current === undefined || offset < 0 ? [] : [{ ...current, offset }],
    }
    emit()
  })
  const insertReference = vi.fn((reference: ReferenceInsert, span: { start: number; end: number }) => {
    const accepted = insertResults.shift() ?? true
    if (!accepted) return false
    const text = displayText(reference.label)
    const tail = snapshot.draft.slice(span.end)
    const gap = tail.length === 0 || tail[0] !== ' ' ? ' ' : ''
    snapshot = {
      draft: `${snapshot.draft.slice(0, span.start)}${text}${gap}${tail}`,
      draftRev: snapshot.draftRev + 1,
      occurrences: [{ ...reference, offset: span.start, length: text.length }],
    }
    emit()
    return true
  })
  const offInput = vi.fn()
  const input = {
    state: {
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener); offInput() }
      },
    },
    setDraft,
    insertReference,
  }
  const controller = new AnnotationController(input, 'bundle')
  return {
    controller,
    setDraft,
    insertReference,
    offInput,
    rejectNext: (...results: boolean[]) => { insertResults.push(...results) },
    replaceSnapshot: (next: Partial<typeof snapshot>) => { snapshot = { ...snapshot, ...next }; emit() },
    getSnapshot: () => snapshot,
  }
}

describe('AnnotationController', () => {
  it('bounds quotes and supports subscribe, update, activate, and unsubscribe', () => {
    const b = bench()
    const notified = vi.fn()
    const off = b.controller.subscribe(notified)
    const annotation = b.controller.stage({ seq: 4, text: `  ${'x'.repeat(4_010)}  ` })

    expect(annotation?.target.text).toHaveLength(4_001)
    expect(annotation?.target.text.endsWith('…')).toBe(true)
    b.controller.update(annotation!.id, 'why')
    b.controller.update(annotation!.id, 'why')
    b.controller.update(999, 'ignored')
    b.controller.activate(null)
    b.controller.activate(null)
    b.controller.activate(999)
    b.controller.activate(annotation!.id)
    expect(b.controller.getSnapshot()).toMatchObject({ activeId: annotation!.id })

    off()
    const calls = notified.mock.calls.length
    b.controller.update(annotation!.id, 'after unsubscribe')
    expect(notified).toHaveBeenCalledTimes(calls)
  })

  it('rejects empty staging and every mutation after disposal', () => {
    const b = bench()
    expect(b.controller.stage({ seq: 1, text: '   ' })).toBeNull()
    expect(() => b.controller.serialize()).toThrow('annotation bundle is empty')

    b.controller.dispose()
    b.controller.dispose()
    expect(b.offInput).toHaveBeenCalledOnce()
    expect(b.controller.stage({ seq: 2, text: 'answer' })).toBeNull()
    b.controller.update(1, 'ignored')
    b.controller.activate(1)
    expect(b.controller.getSnapshot()).toEqual({ annotations: [], activeId: null })
  })

  it('contains annotation subscriber failures while notifying healthy listeners', () => {
    const b = bench()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const healthy = vi.fn()
    b.controller.subscribe(() => { throw new Error('subscriber failed') })
    b.controller.subscribe(healthy)

    expect(b.controller.stage({ seq: 1, text: 'answer' })).not.toBeNull()
    expect(error).toHaveBeenCalledWith(
      '[ui-side-chat] annotation subscriber threw:',
      expect.objectContaining({ message: 'subscriber failed' }),
    )
    expect(healthy).toHaveBeenCalled()
    error.mockRestore()
  })

  it('keeps staged state when a chip already attached but its relabel is rejected', () => {
    const b = bench()
    const first = b.controller.stage({ seq: 1, text: 'first' })
    expect(first).not.toBeNull()
    b.rejectNext(false, true)

    expect(b.controller.stage({ seq: 2, text: 'second' })).toBeNull()
    expect(b.controller.getSnapshot().annotations).toEqual([first])
    expect(b.insertReference).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: '1 条注释' }),
      expect.objectContaining({ start: 0, end: 0 }),
    )
  })

  it('clears prior annotations when relabel and rollback both lose the chip', () => {
    const b = bench()
    expect(b.controller.stage({ seq: 1, text: 'first' })).not.toBeNull()
    const notified = vi.fn()
    b.controller.subscribe(notified)
    b.rejectNext(false, false)

    expect(b.controller.stage({ seq: 2, text: 'second' })).toBeNull()
    expect(b.controller.getSnapshot()).toEqual({ annotations: [], activeId: null })
    expect(notified).toHaveBeenCalled()
  })

  it('accepts an already current aggregate label without reinserting it', () => {
    const b = bench()
    b.replaceSnapshot({
      draft: '@1 条注释 question',
      occurrences: [{
        source: 'answer-annotation', ref: 'bundle', offset: 0, length: 6,
        label: '1 条注释', clipboardText: '1 条注释',
      }],
    })

    expect(b.controller.stage({ seq: 1, text: 'answer' })).not.toBeNull()
    expect(b.insertReference).not.toHaveBeenCalled()
  })

  it('ignores unrelated input changes but clears state after its aggregate chip leaves', () => {
    const b = bench()
    b.controller.stage({ seq: 1, text: 'answer' })
    b.replaceSnapshot({
      occurrences: [
        { source: 'other', ref: 'bundle', offset: 0, length: 2, label: 'x', clipboardText: 'x' },
        { source: 'answer-annotation', ref: 'other', offset: 0, length: 2, label: 'x', clipboardText: 'x' },
        { source: 'answer-annotation', ref: 'bundle', offset: 0, length: 6, label: '1 条注释', clipboardText: '1 条注释' },
      ],
    })
    expect(b.controller.getSnapshot().annotations).toHaveLength(1)

    b.replaceSnapshot({ occurrences: [] })
    expect(b.controller.getSnapshot()).toEqual({ annotations: [], activeId: null })
  })
})
