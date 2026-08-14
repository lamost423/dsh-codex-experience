import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AssistantQuoteTarget, SideChatSendResult, SideChatView } from './controller.ts'
import type {} from './locales.ts'

/** Business face shared by the Side Chat entry points and panel. */
export interface SideChatInjected {
  hooks: {
    /** One parent Session's Side Chat controller snapshot. */
    sideChat: HostObservable<SideChatView>
  }
  /** Open the panel for a whole answer or a selected passage. */
  open: (target: AssistantQuoteTarget) => void
  /** Add one answer-anchored quote to the current main composer. */
  addToConversation: (target: AssistantQuoteTarget) => void
  /** Send one answer-anchored inline annotation to the main conversation. */
  submitAnnotation: (target: AssistantQuoteTarget, text: string) => Promise<SideChatSendResult>
  /** Send a prompt to the forked child Session. */
  send: (text: string) => Promise<SideChatSendResult>
  /** Close the details column and destroy its ephemeral child. */
  close: () => void
  /** Destroy the ephemeral child when another details route replaces this panel. */
  release: () => Promise<void>
}

/** Whole-answer action-strip component props. */
export type SideChatActionProps = PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<SideChatInjected> & PropsLocale<'sideChat'>

/** Assistant-body selection decorator component props. */
export type SideChatSelectionProps = PropsRuntime<'conversation.chat.assistant-body-overlay'>
  & InjectFace<SideChatInjected> & PropsLocale<'sideChat'>

/** Ephemeral details panel component props. */
export type SideChatPanelProps = PropsRuntime<'conversation.details.view'>
  & InjectFace<SideChatInjected> & PropsLocale<'sideChat'>
