# Agent Note: Ephemeral side chat and answer annotations

Status: implemented

English | [中文](2026-08-14-ephemeral-side-chat-and-answer-annotations.zh.md)

## Problem

Assistant output supports fixed message actions but cannot turn a selected passage into context for the current composer. A side question also needs to preserve the source answer on screen without creating an ordinary task that remains in Workspace navigation and persistence after the panel closes.

The right details column originally routes only Tool output. Putting selection ownership, temporary Session lifetime, and a second transcript directly into `ui-conversation` would make optional product behavior part of the core conversation policy and prevent another plugin from replacing it.

## Decision

`@deepseek-ai/dsh-client-ui-side-chat` is an optional Web Client Plugin. It contributes a whole-answer action and a two-action selection toolbar to assistant messages. `Add to conversation` appends an answer-annotation reference chip labeled with the source event sequence to the parent Session's current composer. The input machine serializes the chip into a bounded blockquote, which becomes model-visible only when the user submits that ordinary main-conversation prompt.

`Ask in side chat` opens the keyed `side-chat` details view and calls `ctx.sessions.fork({ sessionId, atSeq, ephemeral: true })` on first use. The Host gives the child an `ephemeral: true` Session header, retains its `AgentHandle`, skips Workspace attachment, and exposes the live child through the ordinary event stream. The client keeps the child addressable for the panel but filters it from task navigation. Closing the panel calls `session.cancel({ discardEphemeral: true })`; the Host accepts that operation only for a retained ephemeral handle and disposes the Agent and Session.

Session persistence ignores ephemeral Session creation, events, flushes, disposal, and HMR seeding. The persisted projection cache independently excludes every ephemeral event, timer, turn boundary, and disposal write, and rejects direct checkpoints. Telemetry likewise refuses ephemeral adoption, live events, flush hints, operational records, shutdown markers, and explicit on-demand capture. The runtime-only header value therefore enters neither a stored log, a durable projection record, nor a telemetry backend. An ordinary fork keeps its existing Workspace, list, title, durability, and telemetry behavior.

The selected or complete closing-answer text is bounded to 4,000 characters and stored directly in the composer reference chip instead of a plugin-global map. The controller claims a pending quote before asynchronous fork work, restores it after failed delivery, prepends it to exactly one accepted child prompt, and rejects concurrent sends. Closing and parent/plugin disposal await an in-flight fork, discard the child, and only then release the retry capability; a discard failure leaves the child addressable for another teardown attempt. Panel unmount performs the same discard without closing whichever details route replaced it. The Host also owns every retained ephemeral handle through the API proxy scope, so client or plugin teardown cannot strand a child.

## Extension contracts

`conversation.chat.assistant-body-overlay` is a Session-level list slot rendered inside a stable assistant-body positioning boundary. The owner currency carries the finalized answer sequence and text; the contributing plugin owns DOM selection interpretation and its floating controls. `conversation.chat.assistant-actions` carries the same answer currency for whole-answer entry points.

The layout service routes the details column by key. `ui-conversation` declares keyed `conversation.details.view`, registers the Tool view under `tool`, and dispatches the active key. Side Chat registers `side-chat` without importing or replacing the application shell. Controller lifetime follows the parent Session scope, while every child lifetime follows the retained ephemeral Agent handle.

## Verification

Host tests pin the ephemeral header, missing Workspace attachment, concurrent disposal coalescing, post-detach failure convergence, owner-scope teardown, and final removal. Persistence tests prove a temporary child materializes neither a JSONL artifact nor a projection-cache record. Telemetry tests prove that both live and explicit on-demand capture emit nothing for it. Runtime and Workspace tests pin protocol forwarding, local removal, and exclusion from grouped, flat, search, and subagent-reference navigation. UI tests pin both selection actions, anchored composer insertion, single-quote delivery, in-flight close, discard retry, route-unmount teardown, awaited controller teardown, and plugin registration cleanup.

## Alternatives considered

**Use an ordinary durable fork.** Rejected because a side question is temporary panel state, not a new task. Keeping it in Workspace navigation changes information architecture and requires the user to clean up exploratory conversations.

**Keep a hidden durable Session.** Rejected because UI filtering does not remove stored logs or establish an owner that can destroy the child at panel close.

**Copy selected text without a message anchor.** Rejected because the current composer would lose which finalized answer produced the quote. The event sequence is stable across rendering and replay without storing DOM offsets.

**Put Side Chat inside `ui-conversation`.** Rejected because selection policy, temporary lifecycle, and transcript presentation must remain removable through plugin composition.

**Open a modal or navigate to the child.** Rejected because both break simultaneous visual reference to the source answer.

## Consequences

Side Chat behaves as temporary exploration: it stays inside the current chat layout, never appears as an ordinary task, never reaches persistence, and disappears when closed. Answer annotations enter the existing main composer instead of creating another conversation.

The Host contract gains one runtime-only Session classification and a restricted discard branch on the existing cancel RPC. The panel remains text-only, read-only behavior remains advisory rather than enforced by Tool policy, annotations anchor to a message sequence rather than DOM offsets, and one parent Session owns at most one open side conversation.
