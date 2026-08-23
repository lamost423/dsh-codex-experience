import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AnnotationAttachment } from './annotation-format.ts'
import type { AnnotationView, StagedAnnotation } from './annotations.ts'
import type { AssistantQuoteTarget, SideChatSendResult, SideChatView } from './controller.ts'
import type {} from './locales.ts'

/** Business face shared by the Side Chat entry points and panel. */
export interface SideChatInjected {
  hooks: {
    /** One parent Session's Side Chat controller snapshot. */
    sideChat: HostObservable<SideChatView>
    /** Current main-composer annotation attachment for this Session. */
    annotations: HostObservable<AnnotationView>
  }
  /** Open the panel for a whole answer or a selected passage. */
  open: (target: AssistantQuoteTarget) => void
  /** Stage one answer-anchored annotation; never sends by itself. */
  addToConversation: (target: AssistantQuoteTarget) => StagedAnnotation | null
  /** Update the optional comment attached to one staged annotation. */
  updateAnnotation: (id: number, comment: string) => void
  /** Open one anchor's inline editor, or collapse all editors with null. */
  activateAnnotation: (id: number | null) => void
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

/** Elected user-bubble body component props: the parsed attachment plus copy. */
export type AnnotationBodyProps = PropsRuntime<'conversation.chat.user-body'>
  & { matched: AnnotationAttachment } & PropsLocale<'sideChat'>

/** Ephemeral details panel component props. */
export type SideChatPanelProps = PropsRuntime<'conversation.details.view'>
  & InjectFace<SideChatInjected> & PropsLocale<'sideChat'>
