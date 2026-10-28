import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres, { type Sql } from 'postgres';

export type Db = Sql;
/** Anything that can run a query: the pool or a transaction handle. */
export type Q = postgres.ISql<Record<never, never>>;

export function createDb(url: string, max = 10): Db {
  // int8 comes back as a string (driver default); money columns are converted with BigInt() at the edge.
  return postgres(url, { max, onnotice: () => undefined });
}

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

/** Applies pending .sql files in name order, each in its own transaction, serialized by an advisory lock. */
export async function migrate(db: Db): Promise<string[]> {
  const applied: string[] = [];
  await db.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(727272)`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const done = new Set((await tx<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      await tx.unsafe(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      applied.push(file);
    }
  });
  return applied;
}
