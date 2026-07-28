import { Pool } from 'pg';

export type UserRole = 'admin' | 'manager' | 'viewer';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export class UserRepository {
  constructor(private readonly pool: Pool) {}

  async create(email: string, passwordHash: string, role: UserRole): Promise<User> {
    const { rows } = await this.pool.query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING *`,
      [email.toLowerCase(), passwordHash, role],
    );
    return mapRow(rows[0]);
  }

  async findByEmail(email: string): Promise<User | null> {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE email = $1', [
      email.toLowerCase(),
    ]);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async existsWithRole(role: UserRole): Promise<boolean> {
    const { rows } = await this.pool.query('SELECT 1 FROM users WHERE role = $1 LIMIT 1', [role]);
    return rows.length > 0;
  }

  async setActive(id: string, isActive: boolean): Promise<void> {
    await this.pool.query('UPDATE users SET is_active = $2 WHERE id = $1', [id, isActive]);
  }
}

function mapRow(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    email: row.email as string,
    passwordHash: row.password_hash as string,
    role: row.role as UserRole,
    isActive: row.is_active as boolean,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}
