/**
 * Side Chat stylesheet contract.
 *
 * CSS custom properties fail silently when a token is misspelled: the whole
 * declaration becomes invalid, which previously removed every intended border
 * from the selection toolbar. Keep this package tied to the platform token
 * sheets so that failure is caught before a browser build is deployed.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const clientDir = fileURLToPath(new URL('../src/client/', import.meta.url))
const styles = readdirSync(clientDir)
  .filter(name => name.endsWith('.css'))
  .map(name => ({ name, text: readFileSync(new URL(`../src/client/${name}`, import.meta.url), 'utf8') }))
const tokens = readdirSync(fileURLToPath(new URL('../../ui-theme/src/styles/', import.meta.url)))
  .filter(name => name.endsWith('.css'))
  .map(name => readFileSync(new URL(`../../ui-theme/src/styles/${name}`, import.meta.url), 'utf8'))
  .join('\n')

function block(css: string, selector: string): string {
  const match = new RegExp(`^\\${selector} \\{([^}]*)\\}`, 'm').exec(css)
  if (match === null) throw new Error(`stylesheet has no \`${selector}\` rule`)
  return match[1] ?? ''
}

describe('Side Chat theme styles', () => {
  it('names only custom properties declared by the theme', () => {
    const named = styles.flatMap(({ text }) =>
      [...text.matchAll(/var\((--(?:dsw|dsh|ds)-[a-z0-9-]+)/g)].map(match => match[1]),
    )
    const undeclared = [...new Set(named)].filter(name => !tokens.includes(`  ${String(name)}:`))
    expect(undeclared).toEqual([])
  })

  it('keeps the selection toolbar and both actions visibly outlined', () => {
    const css = styles.find(style => style.name === 'SideChatSelection.module.css')?.text
    if (css === undefined) throw new Error('SideChatSelection.module.css is missing')
    expect(block(css, '.toolbar')).toContain('border: 1px solid var(--dsw-alias-border-l3)')
    expect(block(css, '.action')).toContain('border: 1px solid var(--dsw-alias-border-l4)')
    expect(block(css, '.annotationEditor')).toContain('border: 1px solid var(--dsw-alias-border-l3)')
  })

  it('renders sent side-chat context as an unmistakable small quote', () => {
    const css = styles.find(style => style.name === 'SideChatPanel.module.css')?.text
    if (css === undefined) throw new Error('SideChatPanel.module.css is missing')
    expect(block(css, '.inlineQuote')).toContain('border-left: 3px solid var(--dsw-alias-state-business-primary)')
    expect(block(css, '.inlineQuote p')).toContain('font-size: 12px')
  })
})
