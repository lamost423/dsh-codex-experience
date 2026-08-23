# dsh-todo-freshness-guard

Tool-pipeline Guard that keeps an unfinished `todo_write` list current during long DeepSeek Harness turns.

The Guard counts non-bookkeeping tool attempts after each active todo list. It injects one model-visible reminder at `reminderAfterCalls`, then denies ordinary tools after `blockAfterCalls` until another complete `todo_write` replaces the list. Native calls and Code Mode sub-dispatches share the same counter. `todo_write` and the outer `run_code` transport remain reachable.

The default bundle configuration is:

```yaml
reminderAfterCalls: 5
blockAfterCalls: 8
```

Install this package alone from the repository root:

```sh
dsh plugin --profile web add ./packages/todo-freshness-guard
```

This plugin addresses stale `todo_write` state. It does not replace or patch the filesystem Write tool.

See the [root documentation](../../README.md) for compatibility, development, and removal instructions.
