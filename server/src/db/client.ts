/**
 * PostgreSQL connection pool singleton.
 *
 * Uses `DATABASE_URL` from the environment, defaulting to the Docker
 * Compose dev credentials. The pool is created lazily on first call to
 * {@link getPool} and shared for the lifetime of the process.
 */
import pg from "pg";

const { Pool } = pg;

let sharedPool: pg.Pool | undefined;

function createPool(): pg.Pool {
  return new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      "postgres://aitown:aitown_dev@localhost:5432/aitown",
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

export function getPool(): pg.Pool {
  if (!sharedPool) {
    sharedPool = createPool();
  }
  return sharedPool;
}

export async function checkConnection(pool?: pg.Pool): Promise<boolean> {
  try {
    const result = await (pool ?? getPool()).query("SELECT 1");
    return result.rowCount === 1;
  } catch {
    return false;
  }
}
