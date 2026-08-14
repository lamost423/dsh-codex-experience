/** Side Chat browser plugin: answer annotations plus an ephemeral details view. */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource, ReferenceInsert } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import {
  SideChatController, type AssistantQuoteTarget, type SideChatSendResult,
} from './controller.ts'
import { SideChatAction } from './SideChatAction.tsx'
import { SideChatSelection } from './SideChatSelection.tsx'
import { SideChatPanel } from './SideChatPanel.tsx'
import type { SideChatInjected } from './slots.ts'
import { en, zh } from './locales.ts'

export type {
  AssistantQuoteTarget, SideChatSendResult, SideChatView,
} from './controller.ts'
export type {
  SideChatActionProps, SideChatInjected, SideChatPanelProps, SideChatSelectionProps,
} from './slots.ts'
export type { SideChatKey } from './locales.ts'

const NS = 'sideChat'
const ANNOTATION_LIMIT = 4_000
const ANNOTATION_LABEL_LIMIT = 80

function annotationReference(target: AssistantQuoteTarget): ReferenceInsert | null {
  const normalized = target.text.trim()
  if (normalized === '') return null
  const quote = normalized.length <= ANNOTATION_LIMIT
    ? normalized
    : `${normalized.slice(0, ANNOTATION_LIMIT)}…`
  const singleLine = quote.replaceAll(/\s+/g, ' ').replaceAll(/[\[\]]/g, '')
  const snippet = singleLine.length <= ANNOTATION_LABEL_LIMIT
    ? singleLine
    : `${singleLine.slice(0, ANNOTATION_LABEL_LIMIT)}…`
  const label = `注释：${snippet}`
  const block = `[${label}](#dsh-message-${String(target.seq)})\n\n> ${quote.replaceAll('\n', '\n> ')}`
  return {
    source: 'answer-annotation',
    ref: block,
    label,
    clipboardText: block,
  }
}

/** Required services for forking, slot composition, panel routing, and copy. */
export const inject = ['slots', 'sessions', 'layout', 'locale', 'conversation', 'inputTriggers']

/** Mount the three optional UI entries and their per-parent controllers. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-side-chat: dictionaries')

  const annotationText = (ref: string): string => ref
  const source: InputTriggerSource = {
    trigger: '@',
    name: 'answer-annotation',
    candidates: () => Promise.resolve([]),
    onPick: () => undefined,
    codec: {
      clipboardText: annotationText,
      serialize: (ref, signal) => {
        signal.throwIfAborted()
        return Promise.resolve(annotationText(ref))
      },
    },
  }
  ctx.effect(() => {
    const off = ctx.inputTriggers.registerSource(source)
    return off
  }, 'ui-side-chat: answer annotation reference source')

  const controllers = new Map<SessionId, SideChatController>()
  const controllerFor = (sessionId: SessionId): SideChatController => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`ui-side-chat: parent Session "${sessionId}" is not bound`)
      controller = new SideChatController(ctx.sessions, sessionId)
      controllers.set(sessionId, controller)
      const owned = controller
      binding.ctx.effect(() => async () => {
        /* v8 ignore next -- this scope owns the only controller installed for its parent id. */
        if (controllers.get(sessionId) !== owned) return
        await owned.dispose()
        controllers.delete(sessionId)
      }, 'ui-side-chat: parent controller')
    }
    return controller
  }
  const faceFor = (sessionId: SessionId): SideChatInjected => {
    const controller = controllerFor(sessionId)
    const open = (target: AssistantQuoteTarget): void => {
      controller.open(target)
      ctx.layout.openDetails('side-chat')
    }
    const addToConversation = (target: AssistantQuoteTarget): void => {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`ui-side-chat: parent Session "${sessionId}" is not bound`)
      const reference = annotationReference(target)
      if (reference === null) return
      const input = ctx.conversation.input.for(binding.ctx)
      const original = input.state.getSnapshot().draft
      const prefix = original.trimEnd()
      input.setDraft(prefix === '' ? '' : `${prefix}\n\n`)
      const beforeInsert = input.state.getSnapshot()
      const accepted = input.insertReference(reference, {
        start: beforeInsert.draft.length,
        end: beforeInsert.draft.length,
        draftRev: beforeInsert.draftRev,
      })
      if (!accepted) {
        input.setDraft(original)
        return
      }
      input.setDraft(`${input.state.getSnapshot().draft}\n\n`)
    }
    const submitAnnotation = async (
      target: AssistantQuoteTarget,
      text: string,
    ): Promise<SideChatSendResult> => {
      const comment = text.trim()
      const reference = annotationReference(target)
      if (comment === '' || reference === null) return { ok: false, error: 'empty-message' }
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) return { ok: false, error: `parent Session "${sessionId}" is not bound` }
      try {
        const result = await binding.session.prompt(
          [{ type: 'text', text: `${reference.ref}\n\n${comment}` }],
          'queue',
        )
        if (result.ok) return { ok: true }
        return { ok: false, error: `${result.error.code}: ${result.error.message}` }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
    return {
      hooks: { sideChat: controller },
      open,
      addToConversation,
      submitAnnotation,
      send: text => controller.send(text),
      release: () => controller.close(),
      close: () => {
        ctx.layout.closeDetails()
        void controller.close().catch((error: unknown) => {
          console.error('[ui-side-chat] close failed:', error)
        })
      },
    }
  }

  ctx.effect(() => {
    const offAction = ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
      name: 'conversation.chat.assistant-actions',
      id: 'side-chat',
      order: 5,
      locale: NS,
      inject: (sessionId): SideChatInjected => faceFor(sessionId),
    }, SideChatAction))
    const offSelection = ctx.slots.inject('conversation.chat.assistant-body-overlay', () => ctx.slots.register({
      name: 'conversation.chat.assistant-body-overlay',
      id: 'side-chat-selection',
      order: 0,
      locale: NS,
      inject: (sessionId): SideChatInjected => faceFor(sessionId),
    }, SideChatSelection))
    const offPanel = ctx.slots.inject('conversation.details.view', () => ctx.slots.register({
      name: 'conversation.details.view',
      key: 'side-chat',
      locale: NS,
      inject: (sessionId): SideChatInjected => faceFor(sessionId),
    }, SideChatPanel))
    return async () => {
      offPanel()
      offSelection()
      offAction()
      try {
        await Promise.all([...controllers.values()].map(controller => controller.dispose()))
      } finally {
        controllers.clear()
      }
    }
  }, 'ui-side-chat: annotation and panel entries')
}
