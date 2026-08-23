# dsh-codex-pack

Combined DeepSeek Harness bundle for `dsh-codex-conversation` and `dsh-todo-freshness-guard`.

Install from the repository root:

```sh
dsh plugin --profile web add ./packages/codex-pack
```

The bundle mounts the conversation plugin and the Guard with reminder and blocking thresholds of 5 and 8 tool calls. Install the standalone packages instead when only one capability is required.
