import * as youtube from './youtube.mjs';
import * as tiktok from './tiktok.mjs';
import * as instagram from './instagram.mjs';

export const SITES = { instagram, tiktok, youtube };
export const PLATFORMS = Object.keys(SITES);
