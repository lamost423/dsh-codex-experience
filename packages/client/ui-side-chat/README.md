# @deepseek-ai/dsh-client-ui-side-chat

English | [中文](README.zh.md)

Optional Web Client Plugin that opens a fork-backed conversation in the right details column without switching or mutating the main Session. It contributes a whole-answer action to `conversation.chat.assistant-actions`, a selection control to `conversation.chat.assistant-body-overlay`, and the `side-chat` renderer to keyed `conversation.details.view`.

The first gesture for a parent Session lazily calls `ctx.sessions.fork({ sessionId, atSeq, increaseTitle: true })`. The child remains an ordinary durable Session in the Session list. Closing the panel only calls `ctx.layout.closeDetails()`; it never deletes the child. A later gesture in the same parent reuses that child and replaces the quote awaiting the next prompt.

The selected or complete closing-answer text is bounded to 4,000 characters and atomically claimed before asynchronous fork work. It is restored if delivery fails and is prepended to exactly one accepted child prompt; concurrent sends are rejected. That prompt is an ordinary logged user message, so model-visible input is reconstructable from the child Session log. The panel deliberately renders only user and assistant text; Tool cards, attachments, merge-back, enforced read-only capabilities, ephemeral children, and multiple simultaneous side panels are outside this package.

The `/client` export exposes the plugin body and its public controller and props contracts. The Host root is intentionally empty.

## Model Experience

### Child user message

#### What the model sees

The first follow-up after an annotation contains the bounded quote and the user's question as one ordinary user message. Later follow-ups contain only the user's text. The parent model receives nothing.

##### First annotated follow-up

```markdown
请基于主会话中这段内容回答，不要修改主任务：

> <selected assistant text>

<user follow-up>
```

#### Token effect

The child inherits the parent prefix through `ctx.sessions.fork()`. The first side-chat request adds at most 4,000 quote characters plus the fixed instruction and user follow-up; later requests add ordinary conversation turns.

#### KV Cache effect

The child is a normal fork through a completed-turn boundary, so it reuses the inherited request prefix. The quote enters after that prefix as user content.

## Known Limitations and Deferred Work

- **The child is durable and visible** — closing the panel preserves an ordinary fork in the Session list; hidden or ephemeral child semantics require a Host contract.
- **Read-only behavior is advisory** — the first prompt asks the child not to modify the main task, but no Tool deny gate restricts the child's capabilities.
- **The panel is text-only** — it omits Tool cards, attachments, merge-back, and multiple simultaneous side panels.
