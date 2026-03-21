import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://aitown:aitown_dev@localhost:5432/aitown',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export async function checkConnection(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT 1');
    return result.rowCount === 1;
  } catch {
    return false;
  }
}
