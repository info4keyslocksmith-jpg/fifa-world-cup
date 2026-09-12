// Instagram web (desktop): New post → pick file → crop → next → caption → share.
// Videos publish as Reels. Posts immediately; the runner calls this at the
// scheduled time.
import { typeInto, clickIfVisible, MINUTE } from '../browser.mjs';

export const name = 'instagram';
export const urls = { home: 'https://www.instagram.com/' };

export async function isLoggedIn(page, u = urls) {
  await page.goto(u.home, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  if (/accounts\/login/.test(page.url())) return false;
  return (await page.locator('svg[aria-label="New post"], svg[aria-label="Home"]').count()) > 0;
}

/** job: { videoPath, caption } */
export async function post(page, job, log = () => {}, u = urls) {
  await page.goto(u.home, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if (/accounts\/login/.test(page.url())) throw new Error('Instagram: not logged in. Run: node social-agent/cli.mjs login');
  await clickIfVisible(page.getByRole('button', { name: /^not now$/i }), 2000);

  await page.locator('svg[aria-label="New post"]').first().click({ timeout: MINUTE });
  await clickIfVisible(page.locator('svg[aria-label="Post"]'), 2500); // sub-menu on newer layouts

  const dialog = page.getByRole('dialog').last();
  const input = dialog.locator('input[type="file"]').first();
  await input.waitFor({ state: 'attached', timeout: MINUTE });
  await input.setInputFiles(job.videoPath);
  log('video selected');
  await clickIfVisible(page.getByRole('button', { name: /^ok$/i }), 4000); // "video posts are shared as reels" notice

  // Keep the original 9:16 frame instead of Instagram's default square crop.
  if (await clickIfVisible(dialog.locator('svg[aria-label="Select crop"]'), 4000)) {
    await clickIfVisible(dialog.getByText('Original', { exact: true }), 3000);
  }

  await dialog.getByRole('button', { name: /^next$/i }).first().click({ timeout: 2 * MINUTE });
  await page.waitForTimeout(800);
  await dialog.getByRole('button', { name: /^next$/i }).first().click({ timeout: 2 * MINUTE });

  const caption = dialog.locator('[aria-label="Write a caption..."][contenteditable="true"], [aria-label="Write a caption…"][contenteditable="true"]').first();
  await caption.waitFor({ state: 'visible', timeout: MINUTE });
  await typeInto(caption, job.caption);

  await dialog.getByRole('button', { name: /^share$/i }).first().click({ timeout: MINUTE });
  log('sharing, waiting for Instagram to finish processing');
  await page.getByText(/(has been shared|post shared|reel shared)/i).first().waitFor({ timeout: 15 * MINUTE });
  return { ok: true };
}
