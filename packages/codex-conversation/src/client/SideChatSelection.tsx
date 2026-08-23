import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { SideChatSelectionProps } from './slots.ts'
import css from './SideChatSelection.module.css'

interface RelativeRect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

interface SelectionState {
  readonly text: string
  readonly rects: readonly RelativeRect[]
  readonly left: number
  readonly top: number
}

interface AnnotationAnchor {
  readonly id: number
  readonly order: number
  readonly rects: readonly RelativeRect[]
  readonly left: number
  readonly top: number
}

type SelectionSink = (selection: SelectionState | null) => void

const sinks = new WeakMap<HTMLElement, SelectionSink>()
let activeSink: SelectionSink | null = null
let registrations = 0

function clearActive(): void {
  activeSink?.(null)
  activeSink = null
}

function relativeRects(range: Range, boundary: HTMLElement): RelativeRect[] {
  const host = boundary.getBoundingClientRect()
  const clientRects = typeof range.getClientRects === 'function' ? [...range.getClientRects()] : []
  const source = clientRects.length > 0 ? clientRects : [range.getBoundingClientRect()]
  return source
    .filter(rect => rect.width > 0 || rect.height > 0)
    .map(rect => ({
      left: rect.left - host.left,
      top: rect.top - host.top,
      width: rect.width,
      height: rect.height,
    }))
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
  const rects = relativeRects(range, boundary)
  if (rects.length === 0) {
    clearActive()
    return
  }
  const first = rects[0]
  const last = rects.at(-1)
  if (first === undefined || last === undefined) {
    clearActive()
    return
  }
  const host = boundary.getBoundingClientRect()
  sink({
    text,
    rects,
    left: Math.max(8, Math.min(host.width - 36, last.left + last.width / 2)),
    top: Math.max(0, first.top - 36),
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

/** Selection toolbar plus persistent Codex-style numbered annotation anchors. */
export function SideChatSelection({
  seq,
  open,
  addToConversation,
  updateAnnotation,
  activateAnnotation,
  useAnnotations,
  t,
}: SideChatSelectionProps) {
  const seatRef = useRef<HTMLDivElement | null>(null)
  const [selection, setSelection] = useState<SelectionState | null>(null)
  const [anchors, setAnchors] = useState<readonly AnnotationAnchor[]>([])
  const annotationView = useAnnotations(value => value)
  const liveIds = new Set(annotationView.annotations.map(annotation => annotation.id))
  const visibleAnchors = anchors.filter(anchor => liveIds.has(anchor.id))

  const dismissSelection = (): void => {
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }

  useEffect(() => {
    const boundary = seatRef.current?.closest<HTMLElement>('[data-assistant-message-body]')
    if (boundary === null || boundary === undefined) return undefined
    return listen(boundary, (next) => {
      if (next !== null) activateAnnotation(null)
      setSelection(next)
    })
  }, [activateAnnotation])

  const addSelection = (): void => {
    if (selection === null) return
    const annotation = addToConversation({ seq, text: selection.text })
    if (annotation === null) return
    setAnchors(current => [...current, {
      id: annotation.id,
      order: annotation.order,
      rects: selection.rects,
      left: selection.left,
      top: selection.top,
    }])
    dismissSelection()
  }

  const onCommentKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if ((event.key === 'Enter' && !event.nativeEvent.isComposing) || event.key === 'Escape') {
      event.preventDefault()
      activateAnnotation(null)
      event.currentTarget.blur()
    }
  }

  return (
    <div ref={seatRef} className={css.seat}>
      {visibleAnchors.flatMap(anchor => anchor.rects.map((rect, index) => (
        <span
          key={`${String(anchor.id)}-${String(index)}`}
          className={css.highlight}
          data-testid={index === 0 ? `annotation-highlight-${String(anchor.order)}` : undefined}
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        />
      )))}
      {visibleAnchors.map((anchor) => {
        const annotation = annotationView.annotations.find(item => item.id === anchor.id)
        if (annotation === undefined) return null
        const last = anchor.rects.at(-1)
        if (last === undefined) return null
        const active = annotationView.activeId === annotation.id
        return (
          <div key={anchor.id}>
            <button
              type="button"
              className={css.badge}
              style={{ left: last.left + last.width, top: last.top - 10 }}
              aria-label={`${t('selection.annotation')} ${String(annotation.order)}`}
              onClick={() => { activateAnnotation(annotation.id) }}
            >
              {annotation.order}
            </button>
            {active && (
              <div className={css.annotationEditor} style={{ left: anchor.left, top: anchor.top }}>
                <input
                  autoFocus
                  value={annotation.comment}
                  placeholder={t('selection.placeholder')}
                  aria-label={t('selection.placeholder')}
                  onChange={(event) => { updateAnnotation(annotation.id, event.currentTarget.value) }}
                  onKeyDown={onCommentKeyDown}
                />
              </div>
            )}
          </div>
        )
      })}
      {selection !== null && (
        <div className={css.toolbar} style={{ left: selection.left, top: selection.top }}>
          <button
            type="button"
            className={css.action}
            onPointerDown={(event) => { event.preventDefault() }}
            onClick={addSelection}
          >
            {t('selection.add')}
          </button>
          <button
            type="button"
            className={css.action}
            onPointerDown={(event) => { event.preventDefault() }}
            onClick={() => {
              open({ seq, text: selection.text })
              dismissSelection()
            }}
          >
            {t('selection.open')}
          </button>
        </div>
      )}
    </div>
  )
}
