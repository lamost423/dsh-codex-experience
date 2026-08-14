// Keyless browser journey for assistant annotations and the fork-backed
// details view. A borrowed settled transcript supplies the final answer; the
// scenario opens Side Chat without sending a model request, proves the main
// Session stays selected, and pins the assembled panel accessibility tree.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
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
const CHILD_REPLAY = fileURLToPath(new URL('./snapshots/goal-multi-turn-actions/session.jsonl', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'side-chat-web-e2e'
const FIRST_FOLLOW_UP = 'Explain the quoted answer in one sentence.'
const SECOND_FOLLOW_UP = 'Give one concise follow-up.'

function userTexts(events: readonly SessionEvent[]): string[] {
  return events.flatMap(event => event.type === 'user/message'
    ? [event.data.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')]
    : [])
}

describe('web e2e: assistant Side Chat', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayChildFixtures: [CHILD_REPLAY] })
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
  })

  it.skipIf(MODE === 'record')('opens beside the source, keeps the fork after close, and matches its golden', async () => {
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
    const childUsersBefore = userTexts(childAgent.session.events).length
    const childTurnsBefore = childAgent.session.events.filter(event => event.type === 'turn/end').length
    const composer = panel.getByRole('textbox', { name: 'Ask a follow-up…' })
    await composer.fill(FIRST_FOLLOW_UP)
    await composer.press('Enter')
    await expect.poll(
      () => childAgent.session.events.filter(event => event.type === 'turn/end').length,
      { timeout: 30_000 },
    ).toBe(childTurnsBefore + 1)
    const transcriptBox = await panel.locator('[aria-live="polite"]').boundingBox()
    const composerBox = await panel.locator('form').boundingBox()
    if (transcriptBox === null || composerBox === null) throw new Error('Side Chat panel layout is unavailable')
    expect(transcriptBox.height).toBeGreaterThan(composerBox.height)
    await composer.fill(SECOND_FOLLOW_UP)
    await composer.press('Enter')
    await expect.poll(
      () => childAgent.session.events.filter(event => event.type === 'turn/end').length,
      { timeout: 30_000 },
    ).toBe(childTurnsBefore + 2)

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
    expect(scaffold.ctx.agents.list()
      .filter(agent => agent.session.header.parentSession === SessionId(SEED_ID))).toHaveLength(1)
  }, 60_000)

  it.skipIf(MODE === 'record')('kept the console clean and inventory closed', async () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
    await assertFixtureInventory(SNAPSHOT_DIR, ['panel.expected.md'])
  })
})
