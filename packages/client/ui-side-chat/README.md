# @deepseek-ai/dsh-client-ui-side-chat

English | [中文](README.zh.md)

Optional Web Client Plugin that adds answer-anchored annotations and an ephemeral side conversation to assistant messages without switching the main Session. It contributes a whole-answer action to `conversation.chat.assistant-actions`, a two-action selection toolbar to `conversation.chat.assistant-body-overlay`, and the `side-chat` renderer to keyed `conversation.details.view`.

`Add to conversation` appends an answer-annotation reference chip labeled with the source message sequence to the current main composer. The chip owns its bounded blockquote payload, so no plugin-global annotation store retains selected answer bodies. The input machine serializes that chip only when the user submits it; the accepted main prompt then records the quote in the parent Session log. `Ask in side chat` lazily calls `ctx.sessions.fork({ sessionId, atSeq, ephemeral: true })`, keeps the child out of Workspace attachment and ordinary task navigation, and opens its transcript in the existing details column. Closing the panel, replacing it with another details route, or leaving the parent Session discards the child Agent handle and removes the runtime-only Session. A failed discard preserves the handle so closing can retry.

The selected or complete closing-answer text is bounded to 4,000 characters and atomically claimed before asynchronous fork work. It is restored if delivery fails and is prepended to exactly one accepted child prompt; concurrent sends are rejected. Closing waits for an in-flight fork before discarding it. The child is excluded from session persistence, projection caches, and telemetry, while its live event stream remains the authority for the open panel. The panel renders only user and assistant text.

The `/client` export exposes the plugin body and its public controller and props contracts. The Host root is intentionally empty.

## Model Experience

### Main-conversation annotation

#### What the model sees

After the user submits the main composer, the selected answer appears inside the ordinary user message as an answer annotation block. Before submission, the parent model sees nothing.

##### Submitted annotation

```markdown
> 回答注释（消息 #<event-seq>）
> <selected assistant text>

<user text>
```

#### Token effect

The annotation adds the bounded selected text, its message-sequence label, and the user's prompt to the next parent request. It consumes no model tokens while it remains an unsubmitted composer chip.

#### KV Cache effect

Submitting the annotation extends the existing parent conversation after its cached prefix. It does not create or replay a child conversation.

### Side-chat user message

#### What the model sees

The first follow-up contains the bounded quote and the user's question as one ordinary user message. Later follow-ups contain only the user's text. The parent model receives nothing.

##### First annotated follow-up

```markdown
请基于主会话中这段内容回答，不要修改主任务：

> <selected assistant text>

<user follow-up>
```

#### Token effect

The ephemeral child inherits the parent prefix through `ctx.sessions.fork()`. The first side-chat request adds at most 4,000 quote characters plus the fixed instruction and user follow-up; later requests add ordinary conversation turns.

#### KV Cache effect

The child forks through a completed-turn boundary, so it reuses the inherited request prefix. The quote enters after that prefix as user content.

## Known Limitations and Deferred Work

- **Read-only behavior is advisory** — the first prompt asks the child not to modify the main task, but no Tool deny policy restricts the child's capabilities.
- **The panel is text-only** — it omits Tool cards, attachments, merge-back, and multiple simultaneous side panels.
- **Annotations use a stable message anchor, not DOM offsets** — the inserted block records the source event sequence and selected text; it does not restore the browser range after navigation.
