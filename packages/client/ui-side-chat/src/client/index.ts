/** Side Chat browser plugin: assistant annotations plus a fork-backed details view. */
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { SideChatController, type AssistantQuoteTarget } from './controller.ts'
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

/** Required services for forking, slot composition, panel routing, and copy. */
export const inject = ['slots', 'sessions', 'layout', 'locale']

/** Mount the three optional UI entries and their per-parent controllers. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-side-chat: dictionaries')

  const controllers = new Map<SessionId, SideChatController>()
  const controllerFor = (sessionId: SessionId): SideChatController => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`ui-side-chat: parent Session "${sessionId}" is not bound`)
      controller = new SideChatController(ctx.sessions, sessionId)
      controllers.set(sessionId, controller)
      const owned = controller
      binding.ctx.effect(() => () => {
        if (controllers.get(sessionId) !== owned) return
        owned.dispose()
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
    return {
      hooks: { sideChat: controller },
      open,
      send: text => controller.send(text),
      close: () => { ctx.layout.closeDetails() },
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
    return () => {
      offPanel()
      offSelection()
      offAction()
      for (const controller of controllers.values()) controller.dispose()
      controllers.clear()
    }
  }, 'ui-side-chat: annotation and panel entries')
}
