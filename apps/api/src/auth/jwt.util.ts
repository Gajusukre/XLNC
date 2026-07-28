import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { UserRole } from '@xlnc/database';

const ACCESS_TOKEN_TTL = '15m';

let resolvedSecret: string | null = null;

/**
 * Resolves JWT_SECRET from the environment. If unset, generates an
 * ephemeral random secret for local/dev convenience — loudly, so it's
 * never mistaken for a real production configuration. Every token signed
 * with an ephemeral secret is invalidated on the next process restart,
 * which is a deliberate fail-safe (better than a fixed default secret
 * baked into source).
 */
export function resolveJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  if (resolvedSecret) return resolvedSecret;

  if (env.JWT_SECRET) {
    resolvedSecret = env.JWT_SECRET;
    return resolvedSecret;
  }

  resolvedSecret = randomBytes(32).toString('hex');
  // eslint-disable-next-line no-console
  console.warn(
    '[auth] JWT_SECRET not set — generated an EPHEMERAL secret for this process only. ' +
      'All existing sessions will be invalidated on restart, and this MUST NOT be used in production. ' +
      'Set JWT_SECRET in .env before deploying.',
  );
  return resolvedSecret;
}

export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
  role: UserRole;
}

export function signAccessToken(payload: AccessTokenPayload, env?: NodeJS.ProcessEnv): string {
  return jwt.sign(payload, resolveJwtSecret(env), { expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyAccessToken(token: string, env?: NodeJS.ProcessEnv): AccessTokenPayload {
  return jwt.verify(token, resolveJwtSecret(env)) as AccessTokenPayload;
}

/** Only for tests: forces a fresh secret to be generated on next resolve. */
export function _resetSecretForTests(): void {
  resolvedSecret = null;
}
