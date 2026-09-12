// Minimal client for the Postiz public API (same endpoints the official
// `postiz` CLI uses). Node 18+ only: uses global fetch, FormData and Blob.
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

const MIME = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export class PostizClient {
  constructor({ apiKey, apiUrl = 'https://api.postiz.com' } = {}) {
    if (!apiKey) throw new Error('PostizClient needs an apiKey');
    this.apiKey = apiKey;
    this.apiUrl = apiUrl.replace(/\/+$/, '');
  }

  async request(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${this.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: this.apiKey,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Postiz ${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`);
    }
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return text;
    }
  }

  /** All connected channels: [{ id, name, identifier, picture, disabled, profile, customer }] */
  listIntegrations() {
    return this.request('/public/v1/integrations');
  }

  /** Settings schema + rules for one channel (honor `output.rules`). */
  integrationSettings(integrationId) {
    return this.request(`/public/v1/integration-settings/${integrationId}`);
  }

  /**
   * Upload a local file. Every media file MUST go through here before it is
   * referenced in a post: Instagram, TikTok and YouTube reject anything that
   * is not a Postiz-hosted URL. Returns { path, size, type, id? }.
   */
  async upload(filePath) {
    const buffer = readFileSync(filePath);
    const name = basename(filePath);
    const type = MIME[extname(name).toLowerCase()] || 'application/octet-stream';
    const form = new FormData();
    form.append('file', new Blob([buffer], { type }), name);
    const res = await fetch(`${this.apiUrl}/public/v1/upload`, {
      method: 'POST',
      headers: { Authorization: this.apiKey },
      body: form,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Postiz upload of ${name} failed (${res.status}): ${text.slice(0, 500)}`);
    return JSON.parse(text);
  }

  createPost(body) {
    return this.request('/public/v1/posts', { method: 'POST', body });
  }

  listPosts({ startDate, endDate, customer } = {}) {
    const q = new URLSearchParams();
    if (startDate) q.set('startDate', startDate);
    if (endDate) q.set('endDate', endDate);
    if (customer) q.set('customer', customer);
    const qs = q.toString();
    return this.request(`/public/v1/posts${qs ? `?${qs}` : ''}`);
  }

  deletePost(postId) {
    return this.request(`/public/v1/posts/${postId}`, { method: 'DELETE' });
  }

  setPostStatus(postId, status) {
    return this.request(`/public/v1/posts/${postId}/status`, { method: 'PUT', body: { status } });
  }
}

export function clientFromEnv() {
  return new PostizClient({
    apiKey: process.env.POSTIZ_API_KEY,
    apiUrl: process.env.POSTIZ_API_URL || 'https://api.postiz.com',
  });
}
