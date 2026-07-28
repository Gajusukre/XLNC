import type { NextApiRequest, NextApiResponse } from 'next';
import { setSessionCookies } from '../../../lib/session';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: '"email" and "password" are required' });
    return;
  }

  const apiUrl = process.env.API_URL || 'http://localhost:4000';
  const apiRes = await fetch(`${apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!apiRes.ok) {
    const body = await apiRes.json().catch(() => ({ error: 'Login failed' }));
    res.status(apiRes.status).json(body);
    return;
  }

  const { accessToken, refreshToken, user } = await apiRes.json();
  setSessionCookies(res, accessToken, refreshToken);
  res.status(200).json({ user });
}
