# Agent Note: Message annotations open a fork-backed side chat

Status: implemented

English | [中文](2026-08-14-message-annotations-and-side-chat.zh.md)

## Problem

The Web client can attach fixed actions to a completed assistant message, but it cannot address a selected passage inside the message or open an independent conversation without replacing the main conversation view. The existing right details column is also coupled to Tool output: `ui-conversation` occupies the whole column and exposes only one Tool-specific child seat. A Side Chat implemented inside that package would therefore turn an optional product feature into core conversation policy and leave no reusable route for another details view.

The Host already has the correct conversation primitive. `ctx.sessions.fork()` creates an ordinary child Session from a completed-turn boundary, preserves the inherited log, and leaves the source untouched. The missing work is client composition and a small annotation currency, not another Agent Loop or transport.

## Decision

`@deepseek-ai/dsh-client-ui-side-chat` is an optional Web Client Plugin. It contributes two entry points to assistant output: a `conversation.chat.assistant-actions` button for the complete closing answer and a `conversation.chat.assistant-body-overlay` entry that detects a DOM selection inside one settled assistant body. Both send an `AssistantQuoteTarget` containing the source event sequence and bounded plain text to one per-parent-Session controller.

The controller opens the right details column under the `side-chat` route and lazily forks the parent through the addressed assistant sequence. It never changes the current Session selection. The child is an ordinary durable Session and remains in the Session list after the panel closes, so closing a panel never performs an irreversible delete. The panel subscribes directly to the child Session face, sends prompts to that child, and renders its user and assistant text. The selected quote is atomically claimed before any asynchronous fork work, restored on delivery failure, and prepended to exactly one accepted user prompt; a concurrent send is rejected. The prompt is therefore model-visible through the child log rather than hidden browser state. The controller is disposed with its parent Session scope.

This delivery is the recoverable first UI binding of the broader [interactive side-session proposal](../../proposed/feature/2026-07-08-interactive-side-sessions.md). It does not implement merge-back or a read-only Tool deny gate.

## Extension contracts

`conversation.chat.assistant-body-overlay` is a session-scoped list slot declared by the built-in Assistant renderer. Its owner share carries only durable message identity, source sequence, and settled plain text. Entries render inside a stable positioned boundary around the assistant body; selection interpretation and controls belong to the contributing feature. Only the closing message of a closed Turn dispatches this slot. Side Chat uses one document-level selection broker regardless of transcript length and routes the active range to the matching body entry.

The existing `conversation.chat.assistant-actions` owner currency gains the same sequence and plain-text fields. Existing feedback entries continue to use only `messageId`; the richer currency lets another independent action address the exact completed-turn fork boundary without reading conversation internals.

The layout service changes from `openDetails()` to `openDetails(view)`. Its transient root store owns both panel width and the active route. `AppFrame` passes the route as the `details` owner share. `ui-conversation` remains the single occupant of that column but becomes a router: it declares keyed `conversation.details.view`, registers its current Tool panel under `tool`, and dispatches the requested key. Feature packages can inject another view without importing or replacing the shell. Closing clears the route and width together; switching Sessions retains the existing close-before-paint behavior. If a keyed contribution disappears during plugin unload, the router closes the now-invalid route instead of leaving a blank column.

The route key and quote are browser viewing state. The child Session log is the durable authority for the actual side conversation. No side-chat event, hidden prompt channel, or second persistence database is introduced.

## Verification

Package tests pin selection containment, atomic quote delivery and failure recovery, concurrent-send rejection, closed-Turn eligibility, fork reuse, child-only prompting, Session-scoped controller disposal, invalid-route recovery, and slot cleanup. The Web bundle composition test pins the optional plugin row. The browser replay covers opening the panel, two child prompts, post-quote panel geometry, one-shot quote persistence, parent-log isolation, and closing without deleting the child.

## Alternatives considered

**Implement Side Chat inside `ui-conversation`.** Rejected because conversation would own optional product policy, controller state, and child-session rendering, while plugins could not remove or replace the feature independently.

**Create a new Host side-chat protocol.** Rejected because an ordinary fork already supplies lineage, persistence, replay, concurrency, and isolation. A dedicated protocol is justified only when ephemeral visibility, merge-back, or enforced capabilities require Host semantics that a normal Session lacks.

**Use a modal or switch the main Session.** Rejected because both break the simultaneous-reference workflow: the source answer must remain visible while the user explores the branch.

**Delete the fork when the panel closes.** Rejected because panel close is a viewing action and must not silently destroy a conversation. Ephemeral discard needs an explicit Host contract and confirmation UX.

## Consequences

Side Chat composes out as one plugin row and the reusable seams remain useful without it. The main Session is never selected away from or mutated, and every model-visible side-chat message is reconstructable from the child log. The costs are one durable child in the ordinary Session list, a compact side-panel transcript rather than the full main conversation renderer, and advisory rather than enforced read-only behavior. Merge-back, hidden or ephemeral child visibility, attachments, Tool cards, and multiple simultaneous side panels remain outside this implementation.
