import { IncomingMessage, ServerResponse } from 'http';

export const ACCESS_COOKIE = 'xlnc_access';
export const REFRESH_COOKIE = 'xlnc_refresh';

const ACCESS_MAX_AGE = 15 * 60; // seconds, matches API's access token TTL
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60; // seconds, matches API's refresh token TTL

interface CookieSerializeOptions {
  httpOnly?: boolean;
  path?: string;
  sameSite?: 'lax' | 'strict' | 'none';
  secure?: boolean;
  maxAge?: number;
}

/**
 * Minimal, dependency-free Set-Cookie serializer — deliberately not using
 * the external `cookie` package here: its most recent major version
 * rewrote its entire API (renamed parse/serialize to parseCookie/
 * stringifySetCookie), which broke this file on first build. Cookie
 * serialization for our fixed, known set of attributes is a handful of
 * lines; writing it directly avoids depending on a package whose API
 * shape isn't stable across majors for something this small.
 */
function serializeCookie(name: string, value: string, options: CookieSerializeOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.sameSite) parts.push(`SameSite=${options.sameSite[0].toUpperCase()}${options.sameSite.slice(1)}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function parseCookieHeader(header: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key) {
      try {
        result[key] = decodeURIComponent(value);
      } catch {
        result[key] = value;
      }
    }
  }
  return result;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'lax' as const,
    // Secure cookies require HTTPS. Default to secure in production; allow
    // an explicit opt-out via COOKIE_SECURE=false for a VPS not yet behind
    // TLS, but this should be enabled once you've set up HTTPS.
    secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false',
    maxAge,
  };
}

export function setSessionCookies(res: ServerResponse, accessToken: string, refreshToken: string): void {
  const existing = res.getHeader('Set-Cookie');
  const existingArr = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
  res.setHeader('Set-Cookie', [
    ...existingArr,
    serializeCookie(ACCESS_COOKIE, accessToken, cookieOptions(ACCESS_MAX_AGE)),
    serializeCookie(REFRESH_COOKIE, refreshToken, cookieOptions(REFRESH_MAX_AGE)),
  ]);
}

export function clearSessionCookies(res: ServerResponse): void {
  res.setHeader('Set-Cookie', [
    serializeCookie(ACCESS_COOKIE, '', { ...cookieOptions(0), maxAge: 0 }),
    serializeCookie(REFRESH_COOKIE, '', { ...cookieOptions(0), maxAge: 0 }),
  ]);
}

export function readSessionCookies(req: IncomingMessage): { accessToken?: string; refreshToken?: string } {
  const parsed = parseCookieHeader(req.headers.cookie || '');
  return { accessToken: parsed[ACCESS_COOKIE], refreshToken: parsed[REFRESH_COOKIE] };
}

/**
 * Decodes a JWT payload WITHOUT verifying its signature — display purposes
 * only (e.g. showing "logged in as X"). Every actual authorization decision
 * happens on the API side, which does verify the signature. Never use this
 * function's output to make an access-control decision.
 */
export function decodeJwtPayloadForDisplay(token: string): { email?: string; role?: string } | null {
  try {
    const [, payloadB64] = token.split('.');
    const json = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export class UnauthorizedError extends Error {}

/**
 * Fetches a backend API URL using the access token; if the API responds
 * 401 (expired token), attempts exactly one refresh-and-retry using the
 * refresh token, updating the response cookies on success. Throws
 * UnauthorizedError if there's no usable session or the refresh itself
 * fails — callers should catch that and redirect to /login.
 */
export async function fetchWithAuth(
  apiUrl: string,
  path: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Response> {
  const { accessToken, refreshToken } = readSessionCookies(req);
  if (!accessToken) {
    throw new UnauthorizedError('No access token cookie present');
  }

  const doFetch = (token: string) =>
    fetch(`${apiUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });

  let response = await doFetch(accessToken);
  if (response.status !== 401) {
    return response;
  }

  if (!refreshToken) {
    throw new UnauthorizedError('Access token expired and no refresh token available');
  }

  const refreshRes = await fetch(`${apiUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!refreshRes.ok) {
    throw new UnauthorizedError('Refresh token invalid or expired');
  }
  const refreshed = (await refreshRes.json()) as { accessToken: string; refreshToken: string };
  setSessionCookies(res, refreshed.accessToken, refreshed.refreshToken);

  response = await doFetch(refreshed.accessToken);
  if (response.status === 401) {
    throw new UnauthorizedError('Still unauthorized after token refresh');
  }
  return response;
}
