/** Simplified Chinese dictionary and canonical key set. */
export const zh = {
  'action.open': '侧边对话',
  'selection.open': '针对选中内容侧聊',
  'panel.title': '侧边对话',
  'panel.close': '关闭侧边对话',
  'panel.quote': '引用自主会话',
  'panel.creating': '正在创建分支会话…',
  'panel.empty': '输入问题，在不改变主会话的情况下继续探索。',
  'panel.error': '侧边对话暂时不可用',
  'composer.placeholder': '继续追问…',
  'composer.send': '发送',
} as const satisfies Record<string, string>

/** English dictionary, complete against the Chinese key set. */
export const en: Record<keyof typeof zh, string> = {
  'action.open': 'Side chat',
  'selection.open': 'Chat about selection',
  'panel.title': 'Side chat',
  'panel.close': 'Close side chat',
  'panel.quote': 'Quoted from the main conversation',
  'panel.creating': 'Creating branch conversation…',
  'panel.empty': 'Ask a question without changing the main conversation.',
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
