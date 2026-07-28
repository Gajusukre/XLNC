import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IncomingMessage, ServerResponse } from 'http';
import {
  readSessionCookies,
  setSessionCookies,
  clearSessionCookies,
  decodeJwtPayloadForDisplay,
  fetchWithAuth,
  UnauthorizedError,
} from '../lib/session';

function fakeReq(cookieHeader?: string): IncomingMessage {
  return { headers: { cookie: cookieHeader } } as IncomingMessage;
}

function fakeRes(): ServerResponse & { _headers: Record<string, unknown> } {
  const headers: Record<string, unknown> = {};
  return {
    _headers: headers,
    setHeader: (name: string, value: unknown) => {
      headers[name] = value;
    },
    getHeader: (name: string) => headers[name],
  } as unknown as ServerResponse & { _headers: Record<string, unknown> };
}

describe('readSessionCookies', () => {
  it('parses both cookies from a cookie header', () => {
    const req = fakeReq('xlnc_access=abc123; xlnc_refresh=def456');
    const { accessToken, refreshToken } = readSessionCookies(req);
    expect(accessToken).toBe('abc123');
    expect(refreshToken).toBe('def456');
  });

  it('returns undefined values when no cookie header is present', () => {
    const req = fakeReq(undefined);
    const { accessToken, refreshToken } = readSessionCookies(req);
    expect(accessToken).toBeUndefined();
    expect(refreshToken).toBeUndefined();
  });
});

describe('setSessionCookies / clearSessionCookies', () => {
  it('sets both cookies as httpOnly with the expected names', () => {
    const res = fakeRes();
    setSessionCookies(res, 'access-val', 'refresh-val');
    const cookies = res._headers['Set-Cookie'] as string[];
    expect(cookies.some((c) => c.startsWith('xlnc_access=access-val') && c.includes('HttpOnly'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('xlnc_refresh=refresh-val') && c.includes('HttpOnly'))).toBe(true);
  });

  it('clearSessionCookies sets Max-Age=0 for both cookies', () => {
    const res = fakeRes();
    clearSessionCookies(res);
    const cookies = res._headers['Set-Cookie'] as string[];
    expect(cookies.every((c) => c.includes('Max-Age=0'))).toBe(true);
  });
});

describe('decodeJwtPayloadForDisplay', () => {
  it('decodes a well-formed JWT payload without verifying signature', () => {
    const payload = { email: 'user@test.com', role: 'viewer' };
    const fakeJwt = `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
    const decoded = decodeJwtPayloadForDisplay(fakeJwt);
    expect(decoded?.email).toBe('user@test.com');
    expect(decoded?.role).toBe('viewer');
  });

  it('returns null for a malformed token rather than throwing', () => {
    expect(decodeJwtPayloadForDisplay('not-a-jwt')).toBeNull();
  });
});

describe('fetchWithAuth', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('throws UnauthorizedError immediately when no access token cookie exists', async () => {
    const req = fakeReq(undefined);
    const res = fakeRes();
    await expect(fetchWithAuth('http://api', '/properties', req, res)).rejects.toThrow(UnauthorizedError);
  });

  it('returns the response directly on a non-401 result (no refresh attempted)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    const req = fakeReq('xlnc_access=valid-token');
    const res = fakeRes();
    const result = await fetchWithAuth('http://api', '/properties', req, res);
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no refresh call made
  });

  it('on a 401, refreshes the token and retries once, updating cookies', async () => {
    const fetchMock = vi
      .fn()
      // 1st call: original request with expired access token -> 401
      .mockResolvedValueOnce({ status: 401, ok: false })
      // 2nd call: refresh endpoint -> success
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ accessToken: 'new-access', refreshToken: 'new-refresh' }),
      })
      // 3rd call: retried original request with new access token -> 200
      .mockResolvedValueOnce({ status: 200, ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    const req = fakeReq('xlnc_access=expired-token; xlnc_refresh=valid-refresh');
    const res = fakeRes();
    const result = await fetchWithAuth('http://api', '/properties', req, res);

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const cookies = res._headers['Set-Cookie'] as string[];
    expect(cookies.some((c) => c.includes('new-access'))).toBe(true);
    expect(cookies.some((c) => c.includes('new-refresh'))).toBe(true);
  });

  it('throws UnauthorizedError if refresh token is missing after a 401', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ status: 401, ok: false });
    global.fetch = fetchMock as unknown as typeof fetch;

    const req = fakeReq('xlnc_access=expired-token'); // no refresh cookie
    const res = fakeRes();
    await expect(fetchWithAuth('http://api', '/properties', req, res)).rejects.toThrow(UnauthorizedError);
  });

  it('throws UnauthorizedError if the refresh call itself fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 401, ok: false })
      .mockResolvedValueOnce({ ok: false, status: 401 });
    global.fetch = fetchMock as unknown as typeof fetch;

    const req = fakeReq('xlnc_access=expired-token; xlnc_refresh=also-expired');
    const res = fakeRes();
    await expect(fetchWithAuth('http://api', '/properties', req, res)).rejects.toThrow(UnauthorizedError);
  });
});
