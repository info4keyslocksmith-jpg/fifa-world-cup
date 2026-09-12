// YouTube Studio upload flow, the same screens you click by hand:
// Create → Upload videos → details → next ×3 → visibility (schedule or public) → done.
import { typeInto, clickIfVisible, MINUTE } from '../browser.mjs';

export const name = 'youtube';
export const urls = { home: 'https://studio.youtube.com/' };

export async function isLoggedIn(page, u = urls) {
  await page.goto(u.home, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  if (/accounts\.google\.com/.test(page.url())) return false;
  return (await page.locator('#create-icon').count()) > 0;
}

/** Format helpers for YouTube's schedule picker (channel timezone must match this computer). */
export function scheduleParts(date) {
  const d = new Date(date);
  const rounded = new Date(Math.round(d.getTime() / (15 * MINUTE)) * 15 * MINUTE);
  const day = rounded.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  let h = rounded.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const time = `${h}:${String(rounded.getMinutes()).padStart(2, '0')} ${ampm}`;
  return { day, time };
}

/**
 * job: { videoPath, thumbnailPath?, title, caption, tags[], visibility, mode: 'schedule'|'now', scheduleAt }
 */
export async function post(page, job, log = () => {}, u = urls) {
  await page.goto(u.home, { waitUntil: 'domcontentloaded' });
  if (/accounts\.google\.com/.test(page.url())) throw new Error('YouTube: not logged in. Run: node social-agent/cli.mjs login');

  await page.locator('#create-icon').click({ timeout: MINUTE });
  await page.locator('#text-item-0, tp-yt-paper-item:has-text("Upload videos")').first().click();

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: MINUTE }),
    page.locator('#select-files-button').click(),
  ]);
  await chooser.setFiles(job.videoPath);
  log('video selected, waiting for the details form');

  const title = page.locator('#title-textarea #textbox');
  await title.waitFor({ state: 'visible', timeout: 2 * MINUTE });
  await page.waitForTimeout(1000);
  await typeInto(title, job.title);
  await typeInto(page.locator('#description-textarea #textbox'), job.caption);

  if (job.thumbnailPath) {
    const thumbInput = page.locator('ytcp-thumbnail-uploader input[type="file"], #file-loader').first();
    if (await thumbInput.count()) await thumbInput.setInputFiles(job.thumbnailPath);
  }

  await page.locator('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]').click();

  if (job.tags?.length) {
    await clickIfVisible(page.locator('#toggle-button'), 3000);
    const tagInput = page.locator('#tags-container input, ytcp-free-text-chip-bar input').first();
    await tagInput.click();
    await tagInput.pressSequentially(job.tags.join(',') + ',', { delay: 10 });
  }

  for (let i = 0; i < 3; i++) {
    await page.locator('#next-button').click();
    await page.waitForTimeout(700);
  }

  if (job.mode === 'schedule') {
    const { day, time } = scheduleParts(job.scheduleAt);
    await page.locator('#schedule-radio-button').click();
    await page.locator('#datepicker-trigger').click();
    const dateInput = page.locator('ytcp-date-picker input, ytcp-date-picker tp-yt-paper-input input').first();
    await dateInput.click();
    await page.keyboard.press('ControlOrMeta+a');
    await dateInput.fill(day);
    await page.keyboard.press('Enter');
    await page.locator('#time-of-day-trigger').click();
    await page.locator(`tp-yt-paper-item:has-text("${time}")`).first().click();
    log(`scheduled for ${day} ${time} (channel timezone)`);
  } else {
    const vis = { public: 'PUBLIC', unlisted: 'UNLISTED', private: 'PRIVATE' }[job.visibility || 'public'];
    await page.locator(`tp-yt-paper-radio-button[name="${vis}"]`).click();
  }

  log('waiting for the upload to finish');
  await page.locator('#done-button').click({ timeout: 30 * MINUTE }); // enabled once upload + checks complete
  await clickIfVisible(page.locator('#close-button'), 15000);
  return { ok: true };
}
