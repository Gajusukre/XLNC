import { Pool } from 'pg';

export interface AuditLogEntry {
  userId?: string | null;
  action: string;
  resource?: string;
  success: boolean;
  ipAddress?: string;
  detail?: string;
}

export class AuditLogRepository {
  constructor(private readonly pool: Pool) {}

  async record(entry: AuditLogEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_log (user_id, action, resource, success, ip_address, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.userId ?? null,
        entry.action,
        entry.resource ?? null,
        entry.success,
        entry.ipAddress ?? null,
        entry.detail ?? null,
      ],
    );
  }

  async recentForUser(userId: string, limit = 50) {
    const { rows } = await this.pool.query(
      'SELECT * FROM audit_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit],
    );
    return rows;
  }

  async recentByAction(action: string, limit = 50) {
    const { rows } = await this.pool.query(
      'SELECT * FROM audit_log WHERE action = $1 ORDER BY created_at DESC LIMIT $2',
      [action, limit],
    );
    return rows;
  }
}
