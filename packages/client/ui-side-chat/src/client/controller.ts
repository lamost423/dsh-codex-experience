import type {
  ConversationSnapshot, ISessions, ObservableSnapshot, SessionFace, SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'

const QUOTE_LIMIT = 4_000

/** Main-conversation material addressed by one side-chat gesture. */
export interface AssistantQuoteTarget {
  readonly seq: number
  readonly text: string
}

/** Immutable controller snapshot consumed by the panel hook. */
export interface SideChatView {
  readonly parentSessionId: SessionId
  readonly childSessionId: SessionId | null
  readonly origin: AssistantQuoteTarget | null
  readonly conversation: ConversationSnapshot | null
  readonly phase: 'idle' | 'forking' | 'ready' | 'error'
  readonly error: string | null
}

/** Result of sending one side-chat prompt. */
export type SideChatSendResult = { ok: true } | { ok: false; error: string }

function bounded(text: string): string {
  const normalized = text.trim()
  return normalized.length <= QUOTE_LIMIT ? normalized : `${normalized.slice(0, QUOTE_LIMIT)}…`
}

/**
 * Per-parent Side Chat controller. It creates at most one ephemeral child,
 * keeps the main Session selected, and mirrors the child conversation through
 * one stable observable source.
 */
export class SideChatController implements ObservableSnapshot<SideChatView> {
  #view: SideChatView
  #listeners = new Set<() => void>()
  #child: SessionFace | null = null
  #offChild: (() => void) | null = null
  #seedBoundarySeq: number | null = null
  #fork: Promise<SessionFace> | null = null
  #closing: Promise<void> | null = null
  #disposing: Promise<void> | null = null
  #sending = false
  #generation = 0
  #disposed = false

  constructor(private readonly sessions: ISessions, parentSessionId: SessionId) {
    this.#view = {
      parentSessionId,
      childSessionId: null,
      origin: null,
      conversation: null,
      phase: 'idle',
      error: null,
    }
  }

  getSnapshot = (): SideChatView => this.#view

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /**
   * Address a whole answer or selection and begin creating its child fork.
   * @param target - finalized source sequence and bounded quote candidate.
   */
  open(target: AssistantQuoteTarget): void {
    if (this.#disposed || this.#disposing !== null || this.#closing !== null) return
    this.#publish({ origin: { seq: target.seq, text: bounded(target.text) }, error: null })
    void this.#ensureChild(target.seq).catch(() => {})
  }

  /**
   * Send one user question to the child; the pending quote is consumed once.
   * @param text - user-authored follow-up.
   * @returns acceptance or the child/fork failure.
   */
  async send(text: string): Promise<SideChatSendResult> {
    const question = text.trim()
    if (question === '') return { ok: false, error: 'empty-message' }
    if (this.#disposing !== null || this.#closing !== null) return { ok: false, error: 'side-chat-closing' }
    if (this.#sending) return { ok: false, error: 'send-in-progress' }
    this.#sending = true
    const generation = this.#generation
    const origin = this.#view.origin
    if (origin !== null) this.#publish({ origin: null, error: null })
    try {
      const child = await this.#ensureChild(origin?.seq)
      const prompt = origin === null || origin.text === ''
        ? question
        : `请基于主会话中这段内容回答，不要修改主任务：\n\n> ${origin.text.replaceAll('\n', '\n> ')}\n\n${question}`
      const result = await child.prompt([{ type: 'text', text: prompt }], 'queue')
      if (!result.ok) {
        const error = `${result.error.code}: ${result.error.message}`
        this.#publish({
          ...(origin !== null && this.#view.origin === null ? { origin } : {}),
          error,
        })
        return { ok: false, error }
      }
      if (generation === this.#generation) this.#publish({ phase: 'ready', error: null })
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (generation === this.#generation) this.#publish({
        ...(origin !== null && this.#view.origin === null ? { origin } : {}),
        phase: 'error',
        error: message,
      })
      return { ok: false, error: message }
    } finally {
      this.#sending = false
    }
  }

  /** Close the temporary conversation and destroy its Host-owned child. */
  async close(): Promise<void> {
    if (this.#disposed) return
    if (this.#closing !== null) return this.#closing
    const closing = this.#closeCurrent()
    this.#closing = closing
    try {
      await closing
    } finally {
      /* v8 ignore next -- close() owns this promise until this exact finally clears it. */
      if (this.#closing === closing) this.#closing = null
    }
  }

  /** Await child destruction before retiring this controller's capability. */
  dispose(): Promise<void> {
    if (this.#disposed) return Promise.resolve()
    if (this.#disposing !== null) return this.#disposing
    const disposing = this.#disposeCurrent()
    this.#disposing = disposing
    return disposing
  }

  async #disposeCurrent(): Promise<void> {
    try {
      await this.close()
      this.#disposed = true
      this.#listeners.clear()
    } finally {
      this.#disposing = null
    }
  }

  async #ensureChild(atSeq: number | undefined): Promise<SessionFace> {
    if (this.#disposed) throw new Error('side chat controller disposed')
    if (this.#child !== null) return this.#child
    if (this.#fork !== null) return this.#fork
    const generation = this.#generation
    this.#publish({ phase: 'forking', error: null })
    const creating = this.sessions.fork({
      sessionId: this.#view.parentSessionId,
      ...(atSeq === undefined ? {} : { atSeq }),
      ephemeral: true,
    }).then(async (childSessionId) => {
      const child = this.sessions.binding(childSessionId)?.session
      if (child === undefined) {
        await this.sessions.discardEphemeral(childSessionId)
        throw new Error(`side chat child "${childSessionId}" is not addressable`)
      }
      try {
        await child.open()
      } catch (error) {
        await this.sessions.discardEphemeral(childSessionId)
        throw error
      }
      const opened = child.getSnapshot()
      if (opened.openState !== 'open') {
        await this.sessions.discardEphemeral(childSessionId)
        const detail = opened.openError === null
          ? opened.openState
          : `${opened.openError.code}: ${opened.openError.message}`
        throw new Error(`side chat child history failed to open: ${detail}`)
      }
      this.#seedBoundarySeq = opened.chat.order.reduce((latest, key) => {
        const anchor = opened.chat.nodes.get(key)?.anchorSeq
        return anchor === undefined ? latest : Math.max(latest, anchor)
      }, Number.NEGATIVE_INFINITY)
      this.#child = child
      this.#offChild = child.subscribe(() => {
        const next = child.getSnapshot()
        this.#publish({ conversation: this.#visibleConversation(next) })
      })
      this.#publish({
        childSessionId,
        conversation: this.#visibleConversation(opened),
        phase: 'ready',
        error: null,
      })
      return child
    }).catch((error: unknown) => {
      /* v8 ignore else -- awaited close/dispose cannot retire an active fork before it settles. */
      if (!this.#disposed && generation === this.#generation) {
        this.#publish({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
      }
      throw error
    }).finally(() => {
      /* v8 ignore else -- generation changes only after the awaited fork settles. */
      if (generation === this.#generation) this.#fork = null
    })
    this.#fork = creating
    return creating
  }

  /** Wait for creation, then discard before releasing the only retry handle. */
  async #closeCurrent(): Promise<void> {
    const pending = this.#fork
    if (pending !== null) {
      try {
        await pending
      } catch {
        /* v8 ignore else -- a rejected creation cannot also publish a child id. */
        if (this.#view.childSessionId === null) {
          this.#releaseChild()
          return
        }
      }
    }
    const childId = this.#view.childSessionId
    if (childId !== null) await this.sessions.discardEphemeral(childId)
    this.#releaseChild()
  }

  /** Reset the view and return the child capability target, if already created. */
  #releaseChild(): SessionId | null {
    this.#generation += 1
    this.#fork = null
    this.#offChild?.()
    this.#offChild = null
    this.#child = null
    this.#seedBoundarySeq = null
    const childId = this.#view.childSessionId
    this.#publish({
      childSessionId: null,
      origin: null,
      conversation: null,
      phase: 'idle',
      error: null,
    })
    return childId
  }

  /** Hide the fork seed while retaining the child's live side-chat rows. */
  #visibleConversation(snapshot: ConversationSnapshot): ConversationSnapshot {
    const boundary = this.#seedBoundarySeq
    if (boundary === null) return snapshot
    const order = snapshot.chat.order.filter((key) => {
      const anchor = snapshot.chat.nodes.get(key)?.anchorSeq
      return anchor !== undefined && anchor > boundary
    })
    return order.length === snapshot.chat.order.length
      ? snapshot
      : { ...snapshot, chat: { ...snapshot.chat, order } }
  }

  #publish(patch: Partial<SideChatView>): void {
    if (this.#disposed) return
    this.#view = { ...this.#view, ...patch }
    for (const listener of [...this.#listeners]) {
      try { listener() } catch (error) { console.error('[ui-side-chat] subscriber threw:', error) }
    }
  }
}
