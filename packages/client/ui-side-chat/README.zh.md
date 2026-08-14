# @deepseek-ai/dsh-client-ui-side-chat

[English](README.md) | 中文

可选 Web Client 插件：为 assistant 消息添加回答锚定注释和临时侧边对话，同时不切换主 Session。它向 `conversation.chat.assistant-actions` 贡献整段回答动作，向 `conversation.chat.assistant-body-overlay` 贡献双动作选区工具条，并向 keyed `conversation.details.view` 贡献 `side-chat` renderer。

“添加到对话”会把带源消息序号标签的回答注释引用 chip 追加到当前主输入区。chip 自己持有有长度上限的引用块，因此插件全局不会另建注释存储来保留选中的回答正文。输入机只在用户提交时才序列化该 chip；主提示词被接受后，引用才记录进父 Session 日志。“在侧边聊天中提问”会延迟调用 `ctx.sessions.fork({ sessionId, atSeq, ephemeral: true })`，不把子会话挂入 Workspace 和普通任务导航，并在现有详情栏打开其 transcript（文本记录）。关闭面板、切换到其他详情路由或离开父 Session 都会丢弃子 agent（智能体）句柄，并移除仅存在于运行时的 Session。丢弃失败时会保留句柄，以便再次关闭时重试。

选中内容或完整收尾回答最多保留 4,000 个字符，并在异步 fork 工作前被原子领取。投递失败时会恢复引用；它只会追加到一条被接受的子会话提示词前；并发发送会被拒绝。关闭操作会等待正在创建的 fork 完成，再将其丢弃。子会话不进入持久化、投影缓存和遥测，其实时事件流是面板打开期间的权威。面板只渲染用户和 assistant 文本。

`/client` 导出插件主体及公开控制器和 props 约定。Host root 刻意保持为空。

## Model Experience

### 主对话注释

#### What the model sees

用户提交主输入区后，选中的回答会作为回答注释块进入普通用户消息。提交前，父模型看不到该内容。

##### 已提交的注释

```markdown
> 回答注释（消息 #<event-seq>）
> <selected assistant text>

<user text>
```

#### Token effect

注释会在父会话的下一次请求中增加有长度上限的选中文本、消息序号标签和用户提示词。它仍是未提交的输入区 chip 时，不消耗模型 token。

#### KV Cache effect

提交注释会在父会话已有缓存前缀之后继续扩展，不会创建或重放子会话。

### 侧边对话用户消息

#### What the model sees

第一次追问会把有长度上限的引用和用户问题合成一条普通用户消息。后续追问只包含用户文本。父模型不会接收任何侧边对话内容。

##### 第一次带注释的追问

```markdown
请基于主会话中这段内容回答，不要修改主任务：

> <selected assistant text>

<user follow-up>
```

#### Token effect

临时子会话通过 `ctx.sessions.fork()` 继承父会话前缀。第一次侧聊请求最多增加 4,000 个引用字符、固定指令和用户追问；后续请求按普通对话轮次增加。

#### KV Cache effect

子会话通过已完成轮次边界执行 fork，因此复用继承的请求前缀。引用作为该前缀之后的用户内容进入。

## Known Limitations and Deferred Work

- **只读行为是建议性的**：第一次提示词会要求子会话不要修改主任务，但没有 Tool deny 策略限制子会话能力。
- **面板仅显示文本**：它不显示 Tool 卡片和附件，也不支持 merge-back 或多个并行侧栏。
- **注释使用稳定消息锚点，而非 DOM 偏移**：插入块记录源事件序号和选中文字；页面导航后不会恢复浏览器选区。
