import type { NextApiRequest, NextApiResponse } from 'next';
import { clearSessionCookies, readSessionCookies } from '../../../lib/session';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { refreshToken } = readSessionCookies(req);
  const apiUrl = process.env.API_URL || 'http://localhost:4000';

  if (refreshToken) {
    // Best-effort: revoke server-side, but clear cookies regardless of
    // whether this call succeeds — the user's browser session ends either way.
    try {
      await fetch(`${apiUrl}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Backend unreachable — cookies still get cleared below.
    }
  }

  clearSessionCookies(res);
  res.status(204).end();
}
