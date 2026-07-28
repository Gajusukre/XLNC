import { Pool } from 'pg';

export class SyncRunRepository {
  constructor(private readonly pool: Pool) {}

  async start(jobName: string): Promise<number> {
    const { rows } = await this.pool.query<{ id: number }>(
      `INSERT INTO sync_runs (job_name, status) VALUES ($1, 'running') RETURNING id`,
      [jobName],
    );
    return rows[0].id;
  }

  async succeed(runId: number, recordsProcessed: number): Promise<void> {
    await this.pool.query(
      `UPDATE sync_runs SET status = 'succeeded', finished_at = now(), records_processed = $2 WHERE id = $1`,
      [runId, recordsProcessed],
    );
  }

  async fail(runId: number, errorMessage: string): Promise<void> {
    await this.pool.query(
      `UPDATE sync_runs SET status = 'failed', finished_at = now(), error_message = $2 WHERE id = $1`,
      [runId, errorMessage],
    );
  }

  async recent(jobName?: string, limit = 20): Promise<
    Array<{
      id: number;
      jobName: string;
      status: string;
      startedAt: string;
      finishedAt: string | null;
      recordsProcessed: number | null;
      errorMessage: string | null;
    }>
  > {
    const { rows } = await this.pool.query(
      jobName
        ? `SELECT * FROM sync_runs WHERE job_name = $1 ORDER BY started_at DESC LIMIT $2`
        : `SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT $1`,
      jobName ? [jobName, limit] : [limit],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      jobName: row.job_name,
      status: row.status,
      startedAt: (row.started_at as Date).toISOString(),
      finishedAt: row.finished_at ? (row.finished_at as Date).toISOString() : null,
      recordsProcessed: row.records_processed,
      errorMessage: row.error_message,
    }));
  }
}
