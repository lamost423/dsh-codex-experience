import { useRef } from 'react'
import type { MarkdownInlineDirectives } from './harness-compat.ts'
import { DIRECTIVE_NAME } from './annotation-format.ts'
import css from './AnnotationMarker.module.css'

/**
 * Scroll to the card this marker cites: the numbered annotation in the
 * nearest annotated user bubble above it. Position is resolved from the
 * marker's own place in the document, so several annotated exchanges in one
 * conversation each cite their own batch.
 */
function jumpToCard(marker: HTMLElement, index: number): void {
  const bodies = [...document.querySelectorAll('[data-annotation-body]')]
  const preceding = bodies.filter(body =>
    (body.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  ).at(-1)
  preceding?.querySelectorAll('[data-annotation-index]')[index - 1]
    ?.scrollIntoView({ block: 'center' })
}

/** The inline citation the model writes back into its own answer. */
function AnnotationMarker({ index, label }: { index: number; label: string }) {
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <button
      ref={ref}
      type="button"
      className={css.marker}
      aria-label={`${label} ${String(index)}`}
      data-annotation-marker={index}
      /* v8 ignore next -- the click target is this very button, so its ref is mounted. */
      onClick={() => { if (ref.current !== null) jumpToCard(ref.current, index) }}
    >
      {index}
    </button>
  )
}

/**
 * Build the answer-side directive vocabulary. Only this plugin's own
 * directive resolves; every other name stays the literal text the model wrote.
 * @param label - Localized accessible prefix, completed with the marker number.
 * @returns The vocabulary the conversation hands to settled answers.
 */
export function annotationDirectives(label: string): MarkdownInlineDirectives {
  return {
    resolve(name, attributes) {
      if (name !== DIRECTIVE_NAME) return undefined
      const index = Number(attributes.index)
      if (!Number.isInteger(index) || index < 1) return undefined
      return <AnnotationMarker index={index} label={label} />
    },
  }
}
