# dsh-codex-conversation

Codex-style answer annotations and ephemeral side chat for the DeepSeek Harness Web UI.

The plugin contributes three Web surfaces:

- an assistant action that opens a side conversation;
- a selection toolbar that stages annotations or opens side chat;
- a details-column renderer for the ephemeral child transcript.

`Add to conversation` stages multiple selections behind one composer chip without sending. On submission, every annotation is serialized with a stable source-message link, quoted answer, optional annotation question, and main-composer supplement.

`Ask in side chat` forks the parent through `ctx.sessions.fork({ sessionId, atSeq, ephemeral: true })`. The child stays outside ordinary task navigation and is discarded when the panel closes.

Install this package alone from the repository root:

```sh
dsh plugin --profile web add ./packages/codex-conversation
```

See the [root documentation](../../README.md) for compatibility, development, and removal instructions.
