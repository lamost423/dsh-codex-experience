# @deepseek-ai/dsh-todo-freshness-guard

English | [中文](README.zh.md)

Enforces current task status while an agent has an unfinished `todo_write` list. The guard counts native tool attempts and Code Mode SDK sub-dispatches against the current list, injects one reminder at `reminderAfterCalls`, and denies calls after `blockAfterCalls` until `todo_write` replaces the complete list. It is a policy plugin over the existing tool and session events, not a model-facing tool or a second todo store. Decision record: [todo freshness enforcement](../../../.agents/notes/implemented/bug-fix/2026-08-14-enforce-todo-freshness.md).

## Config

```yaml
- id: todo-freshness-guard
  name: '@deepseek-ai/dsh-todo-freshness-guard'
  config:
    reminderAfterCalls: 5
    blockAfterCalls: 8
```

Both positive-integer thresholds are required deployment choices, and `blockAfterCalls` must be greater than `reminderAfterCalls`; invalid values fail at plugin load. The shipped base bundle uses `5` and `8`, matching the existing loop-hygiene escalation band while leaving three calls for the model to reconcile after the reminder.

## Freshness semantics

The latest `todo/write` in the current turn starts an epoch when any item is `pending` or `in_progress`. Each non-bookkeeping attempt increments that session's counter before downstream policy and execution, so parallel Code Mode sub-dispatches cannot over-admit past the limit; a denial from another policy still consumes an attempt. The call that reaches `reminderAfterCalls` runs and carries an attributed reminder into the next model request. Calls through `blockAfterCalls` run unless another policy denies them; every later call is denied by this guard before its body executes.

`todo_write` always delegates and every successful `todo/write` event replaces the epoch, including an identical heartbeat list. A list containing only `completed` items disables enforcement. `turn/start` clears the prior turn's epoch, matching the todo projection. Calls without an owning agent are outside per-session policy.

Code Mode's root `run_code` transport always delegates because blocking it would also block the route to `todo_write`. Its SDK sub-dispatches carry a `parent` token and count as the actual work. A program denied on another binding can call `todo_write` and continue; native mode applies the same counter directly to its tools.

The package hydrates a current unfinished list from the session log when it mounts or first observes an already-running session. Hydration begins a fresh counter; the durable list survives reload, but this enforcement counter is process-local policy state.

## Model Experience

### Advisory reminder

#### What the model sees

At `reminderAfterCalls`, the next request receives this plugin-sourced notice:

##### Reminder text

```markdown
Task status is stale: <calls> non-bookkeeping tool calls have run since the latest todo_write. Reconcile the complete task list now: mark finished items completed, mark every active item in_progress, and call todo_write before continuing.
```

#### Token effect

Zero tokens before the reminder threshold; one retained message is appended when the threshold is reached and remains in session history.

#### KV Cache effect

Append-only; the reminder follows the reusable prefix and does not replace earlier request content.

### Blocking result

#### What the model sees

After `blockAfterCalls` attempts, another non-bookkeeping tool returns the ordinary denied-tool error containing `task status is stale after <calls> tool calls since the latest todo_write; call todo_write with the complete reconciled list before using another tool`. In Code Mode the rejected SDK binding exposes the same message to the program and the outer result when uncaught.

#### Token effect

The denied result replaces the result that the blocked tool would have produced; the tool body contributes no output tokens or context.

#### KV Cache effect

Append-only at the next model request; the denied result follows the reusable prefix.

## Known Limitations and Deferred Work

- **Call count is a freshness proxy** — the guard cannot infer that a specific todo completed from arbitrary tool output, so it requires reconciliation at bounded intervals rather than synthesizing status transitions.
- **An identical list is a valid heartbeat** — this preserves long single-item work but lets a model acknowledge the guard without advancing an item; the next epoch remains bounded by the same thresholds.
- **Counters are process-local** — reload hydrates the current list with a zero counter because no durable event records tool-attempt ownership for this policy.
- **No plan means no enforcement** — work before the first unfinished `todo_write` remains unaffected; the tool description still decides when a multi-step task needs a list.
