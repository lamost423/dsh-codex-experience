# Agent Note: 临时侧边对话与回答注释

Status: implemented

[English](2026-08-14-ephemeral-side-chat-and-answer-annotations.md) | 中文

## Problem

Assistant 输出支持固定消息动作，但不能把选中段落变成当前输入区的上下文。侧边问题还需要让源回答留在屏幕上，同时不能创建普通任务并在面板关闭后继续留在 Workspace 导航和持久化中。

右侧详情栏最初只路由 Tool 输出。若把选区所有权、临时 Session 生命周期和第二份 transcript（文本记录）直接放进 `ui-conversation`，可选产品行为就会成为核心对话策略，其他插件也无法替换它。

## Decision

`@deepseek-ai/dsh-client-ui-side-chat` 是可选 Web Client 插件。它向 assistant 消息贡献整段回答动作和双动作选区工具条。“添加到对话”会把带源事件序号标签的回答注释引用 chip 追加到父 Session 的当前输入区。输入机把 chip 序列化成有长度上限的引用块；只有用户提交这条普通主对话提示词后，引用才对模型可见。

“在侧边聊天中提问”会打开 keyed `side-chat` 详情视图，并在首次使用时调用 `ctx.sessions.fork({ sessionId, atSeq, ephemeral: true })`。Host 给子会话写入 `ephemeral: true` Session header，保留其 `AgentHandle`，跳过 Workspace 挂载，并通过普通事件流暴露实时子会话。客户端让面板可以寻址子会话，但把它从任务导航中过滤。关闭面板会调用 `session.cancel({ discardEphemeral: true })`；Host 只会对自己保留的临时句柄接受该操作，并 dispose（资源释放）Agent 和 Session。

Session 持久化会忽略临时 Session 的创建、事件、flush、dispose 和 HMR（热模块替换）播种。持久投影缓存还会独立排除临时 Session 的所有事件、定时器、轮次边界和释放写入，并拒绝直接检查点。遥测同样拒绝临时 Session 的收养、实时事件、flush 提示、运维记录、shutdown 标记和显式按需捕获。因此，仅存在于运行时的 header 值既不会进入存储日志和持久投影记录，也不会到达遥测后端。普通 fork 继续保持既有 Workspace、列表、标题、持久性和遥测行为。

选中内容或完整收尾回答最多保留 4,000 个字符，并直接存放在输入区引用 chip 中，不另建插件全局 Map。控制器在异步 fork 前领取待处理引用，投递失败后恢复引用，只把引用追加到一条被接受的子提示词前，并拒绝并发发送。关闭、父控制器释放和插件卸载都会等待正在进行的 fork，丢弃子会话后才释放重试能力；丢弃失败时子会话仍可寻址，能由下一次清理重试。面板卸载执行同样的丢弃，但不会关闭替代它的新详情路由。Host 还通过 API proxy scope 持有每个临时句柄，因此客户端或插件清理不会遗留子会话。

## Extension contracts

`conversation.chat.assistant-body-overlay` 是渲染在稳定 assistant 正文定位边界内的 Session 级 list slot。owner currency 携带已定稿回答的序号和文本；贡献插件拥有 DOM 选区解释和浮动控件。`conversation.chat.assistant-actions` 为整段回答入口携带相同回答 currency。

Layout 服务按 key 路由详情栏。`ui-conversation` 声明 keyed `conversation.details.view`，在 `tool` 下注册 Tool 视图，并分发活动 key。Side Chat 注册 `side-chat`，无需导入或替换应用 shell。控制器生命周期跟随父 Session scope，每个子会话生命周期跟随 Host 保留的临时 Agent 句柄。

## Verification

Host 测试固定临时 header、不挂 Workspace、并发释放合并、脱离注册表后的失败收敛、owner scope 清理和最终移除。持久化测试证明临时子会话既不会生成 JSONL 产物，也不会留下投影缓存记录。遥测测试证明实时捕获和显式按需捕获都不会为它发出内容。运行时与 Workspace 测试固定协议转发、本地移除，以及在分组、平铺、搜索和 subagent 引用导航中的排除行为。UI 测试固定两个选区动作、锚定输入区插入、引用单次投递、进行中关闭、丢弃重试、路由卸载清理、可等待的控制器释放和插件注册清理。

## Alternatives considered

**使用普通持久 fork。** 拒绝，因为侧边问题是临时面板状态，不是新任务。把它保留在 Workspace 导航中会改变信息架构，并要求用户清理探索性对话。

**保留隐藏的持久 Session。** 拒绝，因为 UI 过滤不会删除存储日志，也不会建立能在面板关闭时销毁子会话的所有者。

**复制选中文字但不记录消息锚点。** 拒绝，因为当前输入区会丢失引用来自哪条已定稿回答。事件序号可跨渲染和回放保持稳定，无需存储 DOM 偏移。

**把 Side Chat 写进 `ui-conversation`。** 拒绝，因为选区策略、临时生命周期和 transcript 展示必须能通过插件组合移除。

**打开 modal 或导航到子会话。** 拒绝，因为两者都会破坏对源回答的同步视觉参照。

## Consequences

Side Chat 成为临时探索：它留在当前聊天布局内，不显示为普通任务，不进入持久化，并在关闭时消失。回答注释进入现有主输入区，不会创建另一段对话。

Host 约定增加一项仅存在于运行时的 Session 分类，并在既有 cancel RPC 上增加受限丢弃分支。面板仍然只显示文本；只读行为仍由提示词建议，而非 Tool 策略强制；注释锚定消息序号，而非 DOM 偏移；一个父 Session 最多拥有一个打开的侧边对话。
