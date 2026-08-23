/**
 * Type declarations for the two transcript extension points this plugin
 * renders through. The annotated Harness fork (rc.8 line) declares both with
 * these exact structures; this file restates them so the mirror's source
 * tree names its dependency explicitly instead of through the fork's types.
 *
 * On a harness that declares neither seam, both surfaces degrade to display
 * only: the `conversation.chat.user-body` slot is never declared by a parent
 * entry, so the registration under `slots.inject` never runs and a sent
 * annotation batch shows as its literal attachment text, and nothing reads
 * `chatInlineDirectives`, so the model's `:dsh-annotation{...}` citations
 * stay literal prose. The message format is identical either way, and a
 * transcript written under the degraded rendering upgrades in place when
 * opened on a harness that declares the seams.
 */
import type { ReactNode } from 'react'

/** Structural twin of the fork's `UserBodyChainProps`. */
export interface UserBodyChainProps {
  /** The message's joined text blocks. */
  text: string
}

/** Structural twin of the fork's `MarkdownInlineDirectives`. */
export interface MarkdownInlineDirectives {
  /**
   * Resolve one `:name{key="value"}` occurrence.
   * @param name - The directive name, without its leading colon.
   * @param attributes - Quoted `key="value"` pairs, in author order.
   * @returns The node to render in its place, or undefined to keep the
   * literal text.
   */
  resolve(name: string, attributes: Readonly<Record<string, string>>): ReactNode | undefined
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** The user bubble's body chain; declared by harnesses that render it. */
    'conversation.chat.user-body': { kind: 'chain'; scope: 'session'; owner: UserBodyChainProps }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Prose directive vocabulary consumed by harnesses that render it; reach via ctx.get. */
    chatInlineDirectives: MarkdownInlineDirectives
  }
}
