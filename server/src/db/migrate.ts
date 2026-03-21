import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runMigrations(): Promise<void> {
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  try {
    await pool.query(schema);
    console.log('Database schema applied successfully');
  } catch (error) {
    console.error('Failed to apply database schema:', error);
    throw error;
  }
}
