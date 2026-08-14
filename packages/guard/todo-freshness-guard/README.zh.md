# @deepseek-ai/dsh-todo-freshness-guard

[English](README.md) | 中文

当 agent 存在未完成的 `todo_write` 清单时，强制保持任务状态最新。该 guard 将原生工具调用和 Code Mode SDK 子调用计入当前清单，在 `reminderAfterCalls` 注入一次提醒，并在超过 `blockAfterCalls` 后拒绝继续执行，直到 `todo_write` 替换完整清单。它是消费现有工具与会话事件的策略插件，不是面向模型的工具，也不维护第二份 todo 存储。决策记录见 [todo 状态新鲜度强制机制](../../../.agents/notes/implemented/bug-fix/2026-08-14-enforce-todo-freshness.md)。

## 配置

```yaml
- id: todo-freshness-guard
  name: '@deepseek-ai/dsh-todo-freshness-guard'
  config:
    reminderAfterCalls: 5
    blockAfterCalls: 8
```

两个正整数阈值都必须由部署显式指定，且 `blockAfterCalls` 必须大于 `reminderAfterCalls`；非法值会让插件加载失败。随附 base bundle 使用 `5` 和 `8`，与现有循环卫生升级区间一致，并在提醒后保留三次调用供模型核对清单。

## 新鲜度语义

当前 turn 中最新的 `todo/write` 只要包含 `pending` 或 `in_progress` 项，就会开启一个 epoch。每次非记账尝试都会在下游策略与执行前递增该 session 的计数，因此并行 Code Mode 子调用不能越过上限超额获准；被其他策略拒绝的尝试也会计数。达到 `reminderAfterCalls` 的调用会向下一次模型请求附带带来源标记的提醒。达到 `blockAfterCalls` 为止的调用除非被其他策略拒绝，否则仍会执行；之后的调用会被本 guard 在工具主体运行前拒绝。

`todo_write` 始终继续下游执行，每个成功的 `todo/write` 事件都会替换 epoch，即使它写入的是相同心跳清单。仅包含 `completed` 项的清单会停用强制机制。`turn/start` 会清除上一 turn 的 epoch，与 todo 投影保持一致。没有所属 agent 的调用不受按 session 执行的策略约束。

Code Mode 根级 `run_code` transport 始终继续执行，因为阻断它也会阻断到达 `todo_write` 的路径。带 `parent` token 的 SDK 子调用才作为实际工作计数。程序的其他 binding 被拒绝后，仍可调用 `todo_write` 并继续；原生模式直接对工具使用同一计数器。

当插件在相关事件已经写入后挂载，或首次观察到一个已经运行的 session 时，它会从会话日志恢复当前未完成清单。恢复会从零开始计数；持久清单跨重载保留，但强制计数器是进程内策略状态。

## 模型体验

### 建议性提醒

#### 模型看到什么

达到 `reminderAfterCalls` 时，下一次请求会收到以下插件来源 notice：

##### 提醒文本

```markdown
Task status is stale: <calls> non-bookkeeping tool calls have run since the latest todo_write. Reconcile the complete task list now: mark finished items completed, mark every active item in_progress, and call todo_write before continuing.
```

#### Token 影响

达到提醒阈值前为零；达到阈值后追加一条保留消息，并留在会话历史中。

#### KV Cache 影响

仅追加；提醒位于可复用前缀之后，不替换先前请求内容。

### 阻断结果

#### 模型看到什么

完成 `blockAfterCalls` 次尝试后，下一次非记账工具会返回普通拒绝错误，其中包含 `task status is stale after <calls> tool calls since the latest todo_write; call todo_write with the complete reconciled list before using another tool`。在 Code Mode 中，被拒绝的 SDK binding 会向程序暴露相同消息；未捕获时，该消息进入外层结果。

#### Token 影响

拒绝结果替代被阻断工具原本会生成的结果；工具主体不会产生输出 token 或上下文。

#### KV Cache 影响

在下一次模型请求中仅追加；拒绝结果位于可复用前缀之后。

## 已知限制与延期工作

- **调用次数只是新鲜度代理**——guard 无法从任意工具输出推断某个 todo 已完成，因此它要求按有界间隔核对清单，而不自动生成状态转换。
- **相同清单是合法心跳**——这允许较长的单项工作，但模型也可以在不推进条目的情况下响应 guard；下一 epoch 仍受相同阈值约束。
- **计数器只在进程内保存**——重载时从当前清单恢复并将计数置零，因为没有持久事件记录该策略的工具尝试归属。
- **没有清单就不强制**——首次写入未完成的 `todo_write` 之前不受影响；多步骤任务何时需要清单仍由工具描述决定。
