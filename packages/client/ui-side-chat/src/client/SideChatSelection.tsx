import { useEffect, useRef, useState } from 'react'
import type { SideChatSelectionProps } from './slots.ts'
import css from './SideChatSelection.module.css'

interface SelectionState {
  text: string
  left: number
  top: number
}

type SelectionSink = (selection: SelectionState | null) => void

const sinks = new WeakMap<HTMLElement, SelectionSink>()
let activeSink: SelectionSink | null = null
let registrations = 0

function clearActive(): void {
  activeSink?.(null)
  activeSink = null
}

function inspectSelection(): void {
  const active = window.getSelection()
  if (active === null || active.rangeCount === 0 || active.isCollapsed) {
    clearActive()
    return
  }
  const range = active.getRangeAt(0)
  const common = range.commonAncestorContainer
  const element = common.nodeType === Node.ELEMENT_NODE ? common as Element : common.parentElement
  const boundary = element?.closest<HTMLElement>('[data-assistant-message-body]')
  const sink = boundary === null || boundary === undefined ? undefined : sinks.get(boundary)
  const text = active.toString().trim()
  if (boundary === null || boundary === undefined || sink === undefined || text === '') {
    clearActive()
    return
  }
  if (activeSink !== null && activeSink !== sink) activeSink(null)
  activeSink = sink
  const rect = range.getBoundingClientRect()
  const host = boundary.getBoundingClientRect()
  sink({
    text,
    left: Math.max(8, Math.min(host.width - 36, rect.left - host.left + rect.width / 2)),
    top: Math.max(0, rect.top - host.top - 36),
  })
}

function listen(boundary: HTMLElement, sink: SelectionSink): () => void {
  sinks.set(boundary, sink)
  registrations += 1
  if (registrations === 1) {
    document.addEventListener('pointerup', inspectSelection)
    document.addEventListener('keyup', inspectSelection)
    document.addEventListener('selectionchange', inspectSelection)
  }
  return () => {
    if (sinks.get(boundary) === sink) sinks.delete(boundary)
    if (activeSink === sink) clearActive()
    registrations -= 1
    if (registrations === 0) {
      document.removeEventListener('pointerup', inspectSelection)
      document.removeEventListener('keyup', inspectSelection)
      document.removeEventListener('selectionchange', inspectSelection)
    }
  }
}

/** Floating action shown only for a DOM selection inside its assistant body. */
export function SideChatSelection({ seq, open, addToConversation, t }: SideChatSelectionProps) {
  const seatRef = useRef<HTMLDivElement | null>(null)
  const [selection, setSelection] = useState<SelectionState | null>(null)

  useEffect(() => {
    const boundary = seatRef.current?.closest<HTMLElement>('[data-assistant-message-body]')
    if (boundary === null || boundary === undefined) return undefined
    return listen(boundary, setSelection)
  }, [])

  return (
    <div ref={seatRef} className={css.seat}>
      {selection !== null && (
        <div
          className={css.toolbar}
          style={{ left: selection.left, top: selection.top }}
        >
          <button
            type="button"
            className={css.action}
            onPointerDown={(event) => { event.preventDefault() }}
            onClick={() => {
              addToConversation({ seq, text: selection.text })
              setSelection(null)
              window.getSelection()?.removeAllRanges()
            }}
          >
            {t('selection.add')}
          </button>
          <button
            type="button"
            className={css.action}
            onPointerDown={(event) => { event.preventDefault() }}
            onClick={() => {
              open({ seq, text: selection.text })
              setSelection(null)
              window.getSelection()?.removeAllRanges()
            }}
          >
            {t('selection.open')}
          </button>
        </div>
      )}
    </div>
  )
}
