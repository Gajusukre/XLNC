import { randomBytes } from 'crypto';

const REFRESH_TOKEN_TTL_DAYS = 30;

export function generateRefreshToken(): { raw: string; expiresAt: Date } {
  const raw = randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { raw, expiresAt };
}
