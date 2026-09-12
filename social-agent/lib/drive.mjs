// Finds the Google Drive folder that Google Drive for desktop syncs to this
// computer, so a spec can point at a video with "drive:4_ready/clip.mp4"
// instead of copying it. Same folder name Videito's editor uses.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const DRIVE_FOLDER_NAME = process.env.DRIVE_FOLDER_NAME || 'Videos 4keys Claude';

export function driveRoots(home = homedir()) {
  const roots = [];
  const cloud = join(home, 'Library', 'CloudStorage'); // macOS Drive for desktop
  if (existsSync(cloud)) {
    for (const d of readdirSync(cloud)) {
      if (d.startsWith('GoogleDrive-')) roots.push(join(cloud, d, 'My Drive'), join(cloud, d));
    }
  }
  roots.push(join(home, 'Google Drive', 'My Drive'), join(home, 'Google Drive'));
  if (process.platform === 'win32') roots.push('G:\\My Drive', 'G:\\');
  roots.push(home);
  return roots;
}

export function findDriveFolder(name = DRIVE_FOLDER_NAME, home = homedir()) {
  if (process.env.DRIVE_FOLDER) return existsSync(process.env.DRIVE_FOLDER) ? process.env.DRIVE_FOLDER : null;
  for (const root of driveRoots(home)) {
    const candidate = join(root, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function isDrivePath(p) {
  return typeof p === 'string' && /^drive:/i.test(p);
}

/** "drive:4_ready/clip.mp4" → absolute path inside the synced folder, or null when the folder isn't on this computer. */
export function resolveDrivePath(p, home = homedir()) {
  const rel = p.replace(/^drive:\/*/i, '');
  const root = findDriveFolder(DRIVE_FOLDER_NAME, home);
  return root ? join(root, rel) : null;
}

export const DRIVE_HELP = `Google Drive folder "${DRIVE_FOLDER_NAME}" was not found on this computer. Install Google Drive for desktop and make sure that folder is synced, or set DRIVE_FOLDER=/full/path in social-agent/.env`;
