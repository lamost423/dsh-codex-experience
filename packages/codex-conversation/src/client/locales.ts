/** Simplified Chinese dictionary and canonical key set. */
export const zh = {
  'action.open': '侧边对话',
  'selection.add': '添加到对话',
  'selection.open': '在侧边聊天中提问',
  'selection.placeholder': '添加可选评论…',
  'selection.annotation': '注释',
  'annotation.comment': '用户评论',
  'annotation.marker': '回复注释',
  'panel.title': '侧边对话',
  'panel.close': '关闭侧边对话',
  'panel.quote': '引用自主会话',
  'panel.question': '问题',
  'panel.creating': '正在创建临时侧边对话…',
  'panel.empty': '侧边对话是临时聊天，关闭后会消失。',
  'panel.error': '侧边对话暂时不可用',
  'composer.placeholder': '继续追问…',
  'composer.send': '发送',
} as const satisfies Record<string, string>

/** English dictionary, complete against the Chinese key set. */
export const en: Record<keyof typeof zh, string> = {
  'action.open': 'Side chat',
  'selection.add': 'Add to conversation',
  'selection.open': 'Ask in side chat',
  'selection.placeholder': 'Add an optional comment…',
  'selection.annotation': 'Annotation',
  'annotation.comment': 'User comment',
  'annotation.marker': 'Response annotation',
  'panel.title': 'Side chat',
  'panel.close': 'Close side chat',
  'panel.quote': 'Quoted from the main conversation',
  'panel.question': 'Question',
  'panel.creating': 'Creating temporary side chat…',
  'panel.empty': 'Side chat is temporary and disappears when closed.',
  'panel.error': 'Side chat is unavailable',
  'composer.placeholder': 'Ask a follow-up…',
  'composer.send': 'Send',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    sideChat: keyof typeof zh
  }
}

/** Side Chat locale key union. */
export type SideChatKey = keyof typeof zh
