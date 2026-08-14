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
 * Per-parent Side Chat controller. It creates at most one child fork, keeps
 * the main Session selected, and mirrors the child conversation through one
 * stable observable source.
 */
export class SideChatController implements ObservableSnapshot<SideChatView> {
  #view: SideChatView
  #listeners = new Set<() => void>()
  #child: SessionFace | null = null
  #offChild: (() => void) | null = null
  #fork: Promise<SessionFace> | null = null
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
    if (this.#disposed) return
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
    if (this.#sending) return { ok: false, error: 'send-in-progress' }
    this.#sending = true
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
      this.#publish({ phase: 'ready', error: null })
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.#publish({
        ...(origin !== null && this.#view.origin === null ? { origin } : {}),
        phase: 'error',
        error: message,
      })
      return { ok: false, error: message }
    } finally {
      this.#sending = false
    }
  }

  /** Release the child subscription and invalidate in-flight fork completion. */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#generation += 1
    this.#offChild?.()
    this.#offChild = null
    this.#listeners.clear()
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
      increaseTitle: true,
    }).then((childSessionId) => {
      if (this.#disposed || generation !== this.#generation) throw new Error('side chat fork abandoned')
      const child = this.sessions.binding(childSessionId)?.session
      if (child === undefined) throw new Error(`side chat child "${childSessionId}" is not addressable`)
      this.#child = child
      this.#offChild = child.subscribe(() => {
        this.#publish({ conversation: child.getSnapshot() })
      })
      this.#publish({
        childSessionId,
        conversation: child.getSnapshot(),
        phase: 'ready',
        error: null,
      })
      return child
    }).catch((error: unknown) => {
      if (!this.#disposed && generation === this.#generation) {
        this.#publish({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
      }
      throw error
    }).finally(() => {
      if (generation === this.#generation) this.#fork = null
    })
    this.#fork = creating
    return creating
  }

  #publish(patch: Partial<SideChatView>): void {
    if (this.#disposed) return
    this.#view = { ...this.#view, ...patch }
    for (const listener of [...this.#listeners]) {
      try { listener() } catch (error) { console.error('[ui-side-chat] subscriber threw:', error) }
    }
  }
}
