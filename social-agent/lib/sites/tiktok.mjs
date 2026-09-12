// TikTok Studio upload page. Posts immediately (the runner calls this at the
// scheduled time), so nothing depends on TikTok's own scheduler UI.
import { typeInto, clickIfVisible, MINUTE } from '../browser.mjs';

export const name = 'tiktok';
export const urls = { home: 'https://www.tiktok.com/tiktokstudio/upload?from=upload' };

export async function isLoggedIn(page, u = urls) {
  await page.goto(u.home, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  if (/\/login/.test(page.url())) return false;
  return (await page.locator('input[type="file"]').count()) > 0;
}

/** job: { videoPath, caption } */
export async function post(page, job, log = () => {}, u = urls) {
  await page.goto(u.home, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if (/\/login/.test(page.url())) throw new Error('TikTok: not logged in. Run: node social-agent/cli.mjs login');

  const input = page.locator('input[type="file"]').first();
  await input.waitFor({ state: 'attached', timeout: MINUTE });
  await input.setInputFiles(job.videoPath);
  log('video selected, waiting for the editor');

  const editor = page.locator('div.public-DraftEditor-content[contenteditable="true"], [data-e2e="caption-editor"] [contenteditable="true"]').first();
  await editor.waitFor({ state: 'visible', timeout: 3 * MINUTE });
  // TikTok pre-fills the caption with the file name; wait for the upload to settle before replacing it.
  await page.getByText(/uploaded/i).first().waitFor({ timeout: 10 * MINUTE }).catch(() => {});
  await page.waitForTimeout(1000);
  await typeInto(editor, job.caption);
  await page.keyboard.press('Escape'); // close any hashtag suggestion popup

  const postButton = page.getByRole('button', { name: /^Post$/ }).first();
  await postButton.click({ timeout: 10 * MINUTE }); // enabled once processing is done
  await clickIfVisible(page.getByRole('button', { name: /^Post now$/i }), 5000);

  await page.getByText(/(Manage your posts|being uploaded|Upload another|Your video is now|has been posted)/i).first()
    .waitFor({ timeout: 5 * MINUTE });
  return { ok: true };
}
