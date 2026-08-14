// Keyless browser journey for assistant annotations and the fork-backed
// details view. A borrowed settled transcript supplies the final answer; the
// scenario opens Side Chat without sending a model request, proves the main
// Session stays selected, and pins the assembled panel accessibility tree.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/side-chat', import.meta.url))
const EXPECTED = join(SNAPSHOT_DIR, 'panel.expected.md')
const SEED = fileURLToPath(new URL('./snapshots/seeded-history/seed.jsonl', import.meta.url))
const BASE_REPLAY = fileURLToPath(new URL('./snapshots/live-interactions/session.jsonl', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'side-chat-web-e2e'
const FIRST_FOLLOW_UP = 'Explain the quoted answer in one sentence.'
const SECOND_FOLLOW_UP = 'Give one concise follow-up.'

function userTexts(events: readonly SessionEvent[]): string[] {
  return events.flatMap(event => event.type === 'user/message'
    ? [event.data.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')]
    : [])
}

async function selectAssistantText(page: Page): Promise<void> {
  const body = page.locator('[data-assistant-message-body]').last()
  await body.waitFor()
  await body.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node !== null && (node.textContent?.trim() ?? '') === '') node = walker.nextNode()
    if (node === null || node.textContent === null) throw new Error('assistant answer has no selectable text')
    const range = document.createRange()
    range.setStart(node, 0)
    range.setEnd(node, Math.min(node.textContent.length, 24))
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }))
  })
}

async function borderStyle(locator: Locator): Promise<{
  width: string
  style: string
  color: string
}> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      width: style.borderTopWidth,
      style: style.borderTopStyle,
      color: style.borderTopColor,
    }
  })
}

function twoTurnReplay(source: string): string {
  const [header, ...eventLines] = source.trimEnd().split('\n')
  if (header === undefined) throw new Error('side-chat replay fixture has no header')
  const continued = eventLines.map(line => line
    .replace(/"seq":(\d+)/g, (_match, seq: string) => `"seq":${String(Number(seq) + 100)}`)
    .replace(/"seq0":(\d+)/g, (_match, seq: string) => `"seq0":${String(Number(seq) + 100)}`)
    .replaceAll('"turn":1', '"turn":2'))
  return [header, ...eventLines, ...continued, ''].join('\n')
}

describe('web e2e: assistant Side Chat', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let fixtureRoot: string | undefined

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), 'dsh-web-side-chat-'))
    const replayFixture = join(fixtureRoot, 'session.jsonl')
    await writeFile(replayFixture, twoTurnReplay(await readFile(BASE_REPLAY, 'utf8')))
    scaffold = await launchWebScaffold({ replayFixture })
    await seedSession(scaffold, await readFile(SEED, 'utf8'), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
    if (fixtureRoot !== undefined) await rm(fixtureRoot, { recursive: true, force: true })
  })

  it.skipIf(MODE === 'record')('opens beside the source, hides the temporary fork, and discards it on close', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-side-chat'))
    const group = page.locator('[role="treeitem"]').first()
    await group.waitFor({ timeout: 15_000 })
    if (await group.getAttribute('aria-expanded') !== 'true') await group.click()
    const source = page.locator('[role="treeitem"]').nth(1)
    await source.click()
    const selected = page.locator('[role="treeitem"][aria-selected="true"]')
    await expect.poll(() => selected.textContent(), { timeout: 15_000 }).toContain('Use the read tool twice')
    const sourceLabel = await selected.textContent()
    await expect.poll(
      () => scaffold.ctx.agents.list().find(agent => agent.session.id === SessionId(SEED_ID)),
      { timeout: 15_000 },
    ).toBeDefined()
    const sourceAgent = scaffold.ctx.agents.list().find(agent => agent.session.id === SessionId(SEED_ID))
    if (sourceAgent === undefined) throw new Error('seeded source Agent is unavailable')
    const sourceUsersBefore = userTexts(sourceAgent.session.events).length
    await page.getByText('DONE', { exact: true }).waitFor({ timeout: 30_000 })

    await selectAssistantText(page)
    const addToConversation = page.getByRole('button', { name: 'Add to conversation' })
    const askInSideChat = page.getByRole('button', { name: 'Ask in side chat' })
    await addToConversation.waitFor()
    expect(await borderStyle(addToConversation)).toMatchObject({ width: '1px', style: 'solid' })
    expect(await borderStyle(askInSideChat)).toMatchObject({ width: '1px', style: 'solid' })
    expect((await borderStyle(addToConversation)).color).not.toBe('rgba(0, 0, 0, 0)')
    const toolbar = addToConversation.locator('..')
    expect(await borderStyle(toolbar)).toMatchObject({ width: '1px', style: 'solid' })
    await page.evaluate(() => { window.getSelection()?.removeAllRanges() })
    await expect.poll(() => addToConversation.count()).toBe(0)

    await page.getByRole('button', { name: 'Side chat' }).last().click()
    const panel = page.locator('[data-side-chat-panel]')
    await panel.waitFor({ timeout: 15_000 })
    await expect.poll(() => scaffold.ctx.agents.list()
      .filter(agent => agent.session.header.parentSession === SessionId(SEED_ID)).length).toBe(1)
    await expect.poll(() => selected.count()).toBe(1)
    expect(await selected.textContent()).toBe(sourceLabel)
    await panel.getByText('DONE', { exact: true }).waitFor()

    const snapshot = await captureStableAria(page, '[data-side-chat-panel]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(EXPECTED, snapshot, MODE)

    const childAgent = scaffold.ctx.agents.list()
      .find(agent => agent.session.header.parentSession === SessionId(SEED_ID))
    if (childAgent === undefined) throw new Error('Side Chat child Agent is unavailable')
    expect(childAgent.session.header.ephemeral).toBe(true)
    const childUsersBefore = userTexts(childAgent.session.events).length
    const childTurnsBefore = childAgent.session.events.filter(event => event.type === 'turn/end').length
    const composer = panel.getByRole('textbox', { name: 'Ask a follow-up…' })
    const transcript = panel.locator('[aria-live="polite"]')
    const userRows = transcript.locator('article[data-role="user"]')
    const assistantRows = transcript.locator('article[data-role="assistant"]')
    await expect.poll(() => userRows.count()).toBe(0)
    await expect.poll(() => assistantRows.count()).toBe(0)
    await composer.fill(FIRST_FOLLOW_UP)
    await composer.press('Enter')
    await expect.poll(
      () => childAgent.session.events.filter(event => event.type === 'turn/end').length,
      { timeout: 30_000 },
    ).toBe(childTurnsBefore + 1)
    await expect.poll(() => userRows.count()).toBe(1)
    await expect.poll(() => userRows.first().textContent()).toContain(FIRST_FOLLOW_UP)
    await expect.poll(() => assistantRows.count()).toBeGreaterThan(0)
    await expect.poll(() => assistantRows.last().textContent()).not.toBe('')
    const firstAssistantRows = await assistantRows.count()
    const transcriptBox = await transcript.boundingBox()
    const composerBox = await panel.locator('form').boundingBox()
    if (transcriptBox === null || composerBox === null) throw new Error('Side Chat panel layout is unavailable')
    expect(transcriptBox.height).toBeGreaterThan(composerBox.height)
    await composer.fill(SECOND_FOLLOW_UP)
    await composer.press('Enter')
    await expect.poll(
      () => childAgent.session.events.filter(event => event.type === 'turn/end').length,
      { timeout: 30_000 },
    ).toBe(childTurnsBefore + 2)
    await expect.poll(() => userRows.count()).toBe(2)
    await expect.poll(() => userRows.last().textContent()).toContain(SECOND_FOLLOW_UP)
    await expect.poll(() => assistantRows.count()).toBeGreaterThan(firstAssistantRows)

    const appended = userTexts(childAgent.session.events).slice(childUsersBefore)
    const followUps = appended.filter(text => text.includes(FIRST_FOLLOW_UP) || text === SECOND_FOLLOW_UP)
    expect(followUps).toEqual([
      expect.stringContaining(`> DONE\n\n${FIRST_FOLLOW_UP}`),
      SECOND_FOLLOW_UP,
    ])
    expect(appended.join('\n').split('请基于主会话中这段内容回答').length - 1).toBe(1)
    expect(userTexts(sourceAgent.session.events)).toHaveLength(sourceUsersBefore)
    expect(await selected.textContent()).toBe(sourceLabel)

    await panel.getByRole('button', { name: 'Close side chat' }).click()
    await expect.poll(() => panel.count()).toBe(0)
    await expect.poll(() => scaffold.ctx.agents.list()
      .filter(agent => agent.session.header.parentSession === SessionId(SEED_ID)).length).toBe(0)
  }, 60_000)

  it.skipIf(MODE === 'record')('kept the console clean and inventory closed', async () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['panel.expected.md'])
  })
})
