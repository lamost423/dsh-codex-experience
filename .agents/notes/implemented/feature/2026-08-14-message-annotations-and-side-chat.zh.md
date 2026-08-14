# Agent Note: 消息批注打开基于 fork 的侧边对话

Status: implemented

[English](2026-08-14-message-annotations-and-side-chat.md) | 中文

## Problem

Web 客户端可以在已完成的 assistant 消息后添加固定动作，但不能定位消息正文中的选中文字，也不能在保留主会话视图的同时打开独立对话。现有右侧详情栏还与 Tool 输出耦合：`ui-conversation` 占据整栏，只暴露一个 Tool 专用子席位。若把 Side Chat 直接写进该包，可选产品功能就会变成核心会话策略，其他详情视图也得不到可复用路由。

Host 已经具备正确的会话原语。`ctx.sessions.fork()` 能从已完成轮次边界创建普通子 Session，保留继承日志且不触碰源会话。缺少的是客户端组合和一小段批注载荷，而不是另一套 Agent Loop 或传输协议。

## Decision

`@deepseek-ai/dsh-client-ui-side-chat` 是可选 Web Client Plugin。它为 assistant 输出贡献两个入口：针对完整收尾回答的 `conversation.chat.assistant-actions` 按钮，以及在一条已定稿 assistant 正文内识别 DOM 选区的 `conversation.chat.assistant-body-overlay` entry。两者都向每个父 Session 唯一的 controller 传递 `AssistantQuoteTarget`，其中包含源事件序号和有长度上限的纯文本。

controller 在右侧详情栏打开 `side-chat` 路由，并在首次需要时从目标 assistant 序号 fork 父会话。它不改变当前 Session 选择。子会话是普通持久 Session，面板关闭后仍留在 Session 列表，因此关闭面板不会执行不可恢复删除。面板直接订阅子 Session face，将 prompt 发送给子会话，并渲染其中的用户和 assistant 文本。选中引用会在任何异步 fork 工作前被原子领取，投递失败时恢复，只在一条被接受的用户 prompt 前追加；并发发送会被拒绝。因此引用通过子日志对模型可见，而不是藏在浏览器状态中。controller 随父 Session scope 一起释放。

本次交付是更广泛的[交互式侧边 Session 提案](../../proposed/feature/2026-07-08-interactive-side-sessions.md)的首个可恢复 UI 绑定，不实现 merge-back，也不实现只读 Tool deny gate。

## Extension contracts

`conversation.chat.assistant-body-overlay` 是由内置 Assistant renderer 声明的 Session 级 list slot。owner share 只携带持久消息标识、源序号和已定稿纯文本。entry 渲染在 assistant 正文外的稳定定位边界中；选区解释和控件归贡献该 entry 的功能所有。只有已关闭 Turn 的收尾消息才分发该 slot。Side Chat 无论 transcript 多长都只使用一组 document 级选区监听器，并把活动 range 路由给命中的正文 entry。

现有 `conversation.chat.assistant-actions` owner currency 同样增加序号和纯文本字段。已有 feedback entry 继续只使用 `messageId`；更丰富的 currency 让另一个独立动作无需读取 conversation 内部实现，即可精确定位已完成轮次的 fork 边界。

layout service 从 `openDetails()` 改为 `openDetails(view)`。其瞬态 root store 同时持有面板宽度和当前路由。`AppFrame` 把路由作为 `details` owner share 传入。`ui-conversation` 仍是整栏唯一 occupant，但改为 router：声明 keyed `conversation.details.view`，把现有 Tool 面板注册到 `tool` key，并分发请求的 key。功能包无需导入或替换 shell 就能注入另一种 view。关闭动作同时清空路由和宽度；切换 Session 继续沿用现有的绘制前关闭语义。若 keyed contribution 在插件卸载时消失，router 会关闭失效路由，不留下空白栏。

路由 key 和引用属于浏览器查看状态。子 Session 日志才是实际侧边对话的持久权威。不引入 side-chat event、隐藏 prompt 通道或第二套持久化数据库。

## Verification

包级测试固定选区边界、引用原子投递与失败恢复、并发发送拒绝、关闭 Turn 资格、fork 复用、仅向子会话发 prompt、Session 级 controller 释放、失效路由恢复和 slot 清理。Web bundle 组合测试固定可选插件行。浏览器回放覆盖打开面板、两轮子会话 prompt、引用消失后的面板几何、引用单次持久化、父日志隔离，以及关闭但不删除子会话。

## Alternatives considered

**把 Side Chat 写入 `ui-conversation`。** 拒绝，因为 conversation 会持有可选产品策略、controller 状态和子会话渲染，而插件无法独立移除或替换该功能。

**新建 Host side-chat 协议。** 拒绝，因为普通 fork 已提供谱系、持久化、回放、并发和隔离。只有临时可见性、merge-back 或能力强制需要普通 Session 不具备的 Host 语义时，专用协议才成立。

**使用 modal 或切换主 Session。** 拒绝，因为两者都会破坏同步参照：用户探索分支时，源回答必须保持可见。

**面板关闭时删除 fork。** 拒绝，因为关闭面板是查看动作，不应静默销毁会话。临时丢弃需要明确 Host 合同和确认 UX。

## Consequences

Side Chat 能作为一行插件配置被组合掉，其可复用扩展口在没有该插件时仍然成立。主 Session 不会被切走或修改，每条模型可见的侧聊消息都能从子日志重建。代价是普通 Session 列表中会新增一个持久子会话；侧栏使用紧凑 transcript，而不是完整主会话 renderer；只读行为仍是建议性约束。merge-back、隐藏或临时子会话、附件、Tool 卡片及多个并行侧栏不属于本次实现。
