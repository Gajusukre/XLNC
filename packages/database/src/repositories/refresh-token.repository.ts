import { Pool } from 'pg';
import { createHash } from 'crypto';

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  expiresAt: string;
  revokedAt: string | null;
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export class RefreshTokenRepository {
  constructor(private readonly pool: Pool) {}

  async store(userId: string, rawToken: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [userId, hashToken(rawToken), expiresAt.toISOString()],
    );
  }

  /** Returns the token record only if it exists, is unrevoked, and unexpired. */
  async findValid(rawToken: string): Promise<RefreshTokenRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM refresh_tokens
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [hashToken(rawToken)],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async revoke(rawToken: string): Promise<void> {
    await this.pool.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashToken(rawToken)],
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
  }
}

function mapRow(row: Record<string, unknown>): RefreshTokenRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    expiresAt: (row.expires_at as Date).toISOString(),
    revokedAt: row.revoked_at ? (row.revoked_at as Date).toISOString() : null,
  };
}
