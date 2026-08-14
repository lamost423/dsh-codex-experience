import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { AssistantQuoteTarget } from './controller.ts'

const SOURCE = 'answer-annotation'
const QUOTE_LIMIT = 4_000

interface AnnotationOccurrence {
  readonly source: string
  readonly ref: string
  readonly offset: number
  readonly label: string
  readonly clipboardText: string
}

interface AnnotationInputState {
  readonly draft: string
  readonly draftRev: number
  readonly occurrences: readonly AnnotationOccurrence[]
}

/** Narrow structural face used by the annotation plugin over SessionInput. */
export interface AnnotationInput {
  readonly state: HostObservable<AnnotationInputState>
  setDraft(text: string): void
  insertReference(reference: ReferenceInsert, span: { start: number; end: number; draftRev: number }): boolean
}

/** One answer selection staged in the current, unsent main-composer draft. */
export interface StagedAnnotation {
  readonly id: number
  readonly order: number
  readonly target: AssistantQuoteTarget
  readonly comment: string
}

/** Session-local annotation draft projected to selection overlays. */
export interface AnnotationView {
  readonly annotations: readonly StagedAnnotation[]
  readonly activeId: number | null
}

function bounded(text: string): string {
  const normalized = text.trim()
  return normalized.length <= QUOTE_LIMIT ? normalized : `${normalized.slice(0, QUOTE_LIMIT)}…`
}

function annotationBlock(annotation: StagedAnnotation): string {
  const quote = annotation.target.text
  const link = `[查看原回复](#dsh-message-${String(annotation.target.seq)})`
  const comment = annotation.comment.trim() || '（未填写）'
  return [
    `### 注释 ${String(annotation.order)}`,
    '',
    `引用位置：${link}`,
    '',
    '引用内容：',
    '',
    `> ${quote.replaceAll('\n', '\n> ')}`,
    '',
    '用户问题：',
    '',
    comment,
  ].join('\n')
}

/**
 * Owns the Codex-style annotation attachment for one parent Session.
 * Many selected passages serialize through one aggregate composer chip; the
 * chip is the draft's send boundary, so adding or editing never calls prompt.
 */
export class AnnotationController implements HostObservable<AnnotationView> {
  #view: AnnotationView = { annotations: [], activeId: null }
  #listeners = new Set<() => void>()
  #nextId = 0
  #syncing = false
  #disposed = false
  #offInput: () => void

  constructor(
    private readonly input: AnnotationInput,
    readonly bundleRef: string,
  ) {
    this.#offInput = input.state.subscribe(() => { this.#observeInput() })
  }

  getSnapshot = (): AnnotationView => this.#view

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /** Stage one selected passage and make its optional-comment editor active. */
  stage(target: AssistantQuoteTarget): StagedAnnotation | null {
    if (this.#disposed) return null
    const text = bounded(target.text)
    if (text === '') return null
    const previous = this.#view
    const annotation: StagedAnnotation = {
      id: this.#nextId + 1,
      order: previous.annotations.length + 1,
      target: { seq: target.seq, text },
      comment: '',
    }
    this.#view = { annotations: [...previous.annotations, annotation], activeId: annotation.id }
    if (!this.#syncReference()) {
      const attached = this.input.state.getSnapshot().occurrences.some(
        occurrence => occurrence.source === SOURCE && occurrence.ref === this.bundleRef,
      )
      this.#view = attached ? previous : { annotations: [], activeId: null }
      if (!attached && previous.annotations.length > 0) this.#emit()
      return null
    }
    this.#nextId = annotation.id
    this.#emit()
    return annotation
  }

  /** Update optional prose only; the aggregate reference serializer reads it live. */
  update(id: number, comment: string): void {
    if (this.#disposed) return
    const index = this.#view.annotations.findIndex(annotation => annotation.id === id)
    const current = this.#view.annotations[index]
    if (current === undefined || current.comment === comment) return
    const annotations = [...this.#view.annotations]
    annotations[index] = { ...current, comment }
    this.#view = { ...this.#view, annotations }
    this.#emit()
  }

  /** Focus one numbered anchor's editor, or collapse all inline editors. */
  activate(id: number | null): void {
    if (this.#disposed || this.#view.activeId === id) return
    if (id !== null && !this.#view.annotations.some(annotation => annotation.id === id)) return
    this.#view = { ...this.#view, activeId: id }
    this.#emit()
  }

  /** Serialize staged passages as labelled model context with stable source links. */
  serialize(): string {
    if (this.#view.annotations.length === 0) throw new Error('annotation bundle is empty')
    return [
      '请逐条回答以下回复注释。“引用内容”来自你此前的回复；“用户问题”才是用户针对该引用填写的问题。',
      '',
      this.#view.annotations.map(annotationBlock).join('\n\n'),
      '',
      '主输入框补充问题（如有）：',
    ].join('\n')
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#offInput()
    this.#listeners.clear()
  }

  #reference(): ReferenceInsert {
    const count = this.#view.annotations.length
    return {
      source: SOURCE,
      ref: this.bundleRef,
      label: `${String(count)} 条注释`,
      clipboardText: `${String(count)} 条注释`,
    }
  }

  /** Keep exactly one aggregate chip at the first line of the main draft. */
  #syncReference(): boolean {
    const reference = this.#reference()
    const before = this.input.state.getSnapshot()
    const existing = before.occurrences.find(
      occurrence => occurrence.source === SOURCE && occurrence.ref === this.bundleRef,
    )
    this.#syncing = true
    try {
      if (existing === undefined) {
        this.input.setDraft(`\n${before.draft}`)
        const ready = this.input.state.getSnapshot()
        const accepted = this.input.insertReference(reference, {
          start: 0,
          end: 0,
          draftRev: ready.draftRev,
        })
        if (!accepted) this.input.setDraft(before.draft)
        return accepted
      }
      if (existing.label === reference.label) return true

      const without = before.draft.slice(0, existing.offset) + before.draft.slice(existing.offset + 1)
      this.input.setDraft(without)
      const ready = this.input.state.getSnapshot()
      if (this.input.insertReference(reference, {
        start: existing.offset,
        end: existing.offset,
        draftRev: ready.draftRev,
      })) return true

      const rollback = this.input.state.getSnapshot()
      this.input.insertReference({
        source: existing.source,
        ref: existing.ref,
        label: existing.label,
        clipboardText: existing.clipboardText,
      }, {
        start: existing.offset,
        end: existing.offset,
        draftRev: rollback.draftRev,
      })
      return false
    } finally {
      this.#syncing = false
    }
  }

  /** Sending or deleting the aggregate chip clears every staged anchor. */
  #observeInput(): void {
    if (this.#disposed || this.#syncing || this.#view.annotations.length === 0) return
    const attached = this.input.state.getSnapshot().occurrences.some(
      occurrence => occurrence.source === SOURCE && occurrence.ref === this.bundleRef,
    )
    if (attached) return
    this.#view = { annotations: [], activeId: null }
    this.#emit()
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) {
      try { listener() } catch (error) { console.error('[ui-side-chat] annotation subscriber threw:', error) }
    }
  }
}

export const ANNOTATION_SOURCE = SOURCE
