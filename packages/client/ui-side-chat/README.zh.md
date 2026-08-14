# @deepseek-ai/dsh-client-ui-side-chat

[English](README.md) | 中文

可选 Web Client Plugin：在右侧详情栏打开基于 fork 的对话，同时不切换或修改主 Session。它向 `conversation.chat.assistant-actions` 贡献整段回答动作，向 `conversation.chat.assistant-body-overlay` 贡献选区控件，并向 keyed `conversation.details.view` 贡献 `side-chat` renderer。

父 Session 的首次操作会延迟调用 `ctx.sessions.fork({ sessionId, atSeq, increaseTitle: true })`。子会话是 Session 列表中的普通持久 Session。关闭面板只调用 `ctx.layout.closeDetails()`，不会删除子会话。同一父 Session 的后续操作复用该子会话，并替换等待下一条 prompt 使用的引用。

选中内容或完整收尾回答最多保留 4,000 个字符，并在异步 fork 工作前被原子领取。投递失败时会恢复引用；它只会追加到一条被接受的子会话 prompt 前；并发发送会被拒绝。该 prompt 是普通的已记录用户消息，因此模型可见输入可从子 Session 日志重建。面板只渲染用户和 assistant 文本；Tool 卡片、附件、merge-back、强制只读能力、临时子会话和多个并行侧栏均不属于本包。

`/client` 导出 plugin body 及公开 controller 和 props 合同。Host root 刻意保持为空。

## Model Experience

### 子会话用户消息

#### What the model sees

批注后的第一次追问会把有长度上限的引用和用户问题合成一条普通用户消息。后续追问只包含用户文本。父模型不会接收任何 Side Chat 内容。

##### First annotated follow-up

```markdown
请基于主会话中这段内容回答，不要修改主任务：

> <selected assistant text>

<user follow-up>
```

#### Token effect

子会话通过 `ctx.sessions.fork()` 继承父会话前缀。第一次侧聊请求最多增加 4,000 个引用字符、固定指令和用户追问；后续请求按普通对话轮次增加。

#### KV Cache effect

子会话通过已完成轮次边界执行普通 fork，因此复用继承的请求前缀。引用作为该前缀之后的用户内容进入。

## Known Limitations and Deferred Work

- **子会话持久且可见**：关闭面板会在 Session 列表中保留普通 fork；隐藏或临时子会话语义需要 Host 合同。
- **只读行为是建议性的**：第一次 prompt 会要求子会话不要修改主任务，但没有 Tool deny gate 限制子会话能力。
- **面板仅显示文本**：它不显示 Tool 卡片和附件，也不支持 merge-back 或多个并行侧栏。
