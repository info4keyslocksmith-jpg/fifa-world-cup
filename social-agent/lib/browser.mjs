// Drives a real Chrome window with a dedicated, persistent profile so you log
// in to each site once and stay logged in. No service in the middle.
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { AGENT_ROOT } from './env.mjs';

export const PROFILE_DIR = process.env.CHROME_PROFILE_DIR || join(AGENT_ROOT, '.chrome-profile');
export const LOG_DIR = join(AGENT_ROOT, 'logs');

export async function launchContext({ headless = process.env.HEADLESS === '1' } = {}) {
  const { chromium } = await import('playwright');
  mkdirSync(PROFILE_DIR, { recursive: true });
  const base = {
    headless,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check'],
    ignoreDefaultArgs: ['--enable-automation'],
    acceptDownloads: false,
  };
  // Prefer the Chrome already installed on this computer; fall back to
  // Playwright's own Chromium; BROWSER_EXECUTABLE forces a specific binary.
  const attempts = [];
  if (process.env.BROWSER_EXECUTABLE) attempts.push({ executablePath: process.env.BROWSER_EXECUTABLE });
  else attempts.push({ channel: 'chrome' }, {});
  let lastErr;
  for (const extra of attempts) {
    try {
      return await chromium.launchPersistentContext(PROFILE_DIR, { ...base, ...extra });
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Could not start Chrome: ${String(lastErr?.message || lastErr).split('\n')[0]}`);
}

/** Open the browser, run fn(page, context), always close. */
export async function withBrowser(fn, opts) {
  const ctx = await launchContext(opts);
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    return await fn(page, ctx);
  } finally {
    await ctx.close().catch(() => {});
  }
}

/** Replace the text of an input or rich-text editor (works for plain, DraftJS and Lexical editors). */
export async function typeInto(locator, text) {
  await locator.click();
  const page = locator.page();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(text);
}

/** Click the first match if it shows up within `timeout` ms. Returns whether it did. */
export async function clickIfVisible(locator, timeout = 2500) {
  try {
    const first = locator.first();
    await first.waitFor({ state: 'visible', timeout });
    await first.click();
    return true;
  } catch {
    return false;
  }
}

export async function saveErrorShot(page, name) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `${name}-${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: false });
    return file;
  } catch {
    return null;
  }
}

export const MINUTE = 60_000;
