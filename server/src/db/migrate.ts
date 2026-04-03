/**
 * Schema migration runner — applies `schema.sql` to the database at startup.
 *
 * Currently runs the full DDL on every boot (all statements use `IF NOT EXISTS`
 * or `CREATE OR REPLACE`). There is no incremental migration history yet.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(pool: Pool): Promise<void> {
  const schemaPath = join(__dirname, "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");

  try {
    await pool.query(schema);
    console.log("Database schema applied successfully");
  } catch (error) {
    console.error("Failed to apply database schema:", error);
    throw error;
  }
}
