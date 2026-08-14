/** Side Chat browser plugin: answer annotations plus an ephemeral details view. */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { ANNOTATION_SOURCE, AnnotationController } from './annotations.ts'
import { SideChatController, type AssistantQuoteTarget } from './controller.ts'
import { SideChatAction } from './SideChatAction.tsx'
import { SideChatSelection } from './SideChatSelection.tsx'
import { SideChatPanel } from './SideChatPanel.tsx'
import type { SideChatInjected } from './slots.ts'
import { en, zh } from './locales.ts'

export type {
  AssistantQuoteTarget, SideChatSendResult, SideChatView,
} from './controller.ts'
export type { AnnotationView, StagedAnnotation } from './annotations.ts'
export type {
  SideChatActionProps, SideChatInjected, SideChatPanelProps, SideChatSelectionProps,
} from './slots.ts'
export type { SideChatKey } from './locales.ts'

const NS = 'sideChat'
/** Required services for forking, slot composition, panel routing, and copy. */
export const inject = ['slots', 'sessions', 'layout', 'locale', 'conversation', 'inputTriggers']

/** Mount the three optional UI entries and their per-parent controllers. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-side-chat: dictionaries')

  const annotationBundles = new Map<string, AnnotationController>()
  const annotationText = (ref: string): string => {
    const bundle = annotationBundles.get(ref)
    if (bundle === undefined) throw new Error(`annotation bundle "${ref}" is unavailable`)
    return bundle.serialize()
  }
  const source: InputTriggerSource = {
    trigger: '@',
    name: ANNOTATION_SOURCE,
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

  interface SessionControllers {
    readonly sideChat: SideChatController
    readonly annotations: AnnotationController
  }
  const controllers = new Map<SessionId, SessionControllers>()
  const controllerFor = (sessionId: SessionId): SessionControllers => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`ui-side-chat: parent Session "${sessionId}" is not bound`)
      const bundleRef = `${ANNOTATION_SOURCE}:${String(sessionId)}`
      const annotations = new AnnotationController(
        ctx.conversation.input.for(binding.ctx),
        bundleRef,
      )
      controller = { sideChat: new SideChatController(ctx.sessions, sessionId), annotations }
      controllers.set(sessionId, controller)
      annotationBundles.set(bundleRef, annotations)
      const owned = controller
      binding.ctx.effect(() => async () => {
        /* v8 ignore next -- this scope owns the only controller installed for its parent id. */
        if (controllers.get(sessionId) !== owned) return
        owned.annotations.dispose()
        annotationBundles.delete(owned.annotations.bundleRef)
        await owned.sideChat.dispose()
        controllers.delete(sessionId)
      }, 'ui-side-chat: parent controller')
    }
    return controller
  }
  const faceFor = (sessionId: SessionId): SideChatInjected => {
    const controller = controllerFor(sessionId)
    const open = (target: AssistantQuoteTarget): void => {
      controller.sideChat.open(target)
      ctx.layout.openDetails('side-chat')
    }
    return {
      hooks: { sideChat: controller.sideChat, annotations: controller.annotations },
      open,
      addToConversation: (target) => {
        if (ctx.sessions.binding(sessionId) === undefined) {
          throw new Error(`ui-side-chat: parent Session "${sessionId}" is not bound`)
        }
        return controller.annotations.stage(target)
      },
      updateAnnotation: (id, comment) => { controller.annotations.update(id, comment) },
      activateAnnotation: (id) => { controller.annotations.activate(id) },
      send: text => controller.sideChat.send(text),
      release: () => controller.sideChat.close(),
      close: () => {
        ctx.layout.closeDetails()
        void controller.sideChat.close().catch((error: unknown) => {
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
        for (const controller of controllers.values()) controller.annotations.dispose()
        await Promise.all([...controllers.values()].map(controller => controller.sideChat.dispose()))
      } finally {
        annotationBundles.clear()
        controllers.clear()
      }
    }
  }, 'ui-side-chat: annotation and panel entries')
}
