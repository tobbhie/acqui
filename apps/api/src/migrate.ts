import { ConfigError, loadApiConfig } from '@acqui/shared';
import { createDb, migrate } from './db';

/** Applies pending SQL migrations once and exits. The API and worker also do this at start (under a database lock). */
async function main(): Promise<void> {
  let url: string;
  try {
    url = loadApiConfig(process.env).DATABASE_URL;
  } catch (error) {
    // Only DATABASE_URL matters here, so fall back to it when other API settings are not present.
    if (!(error instanceof ConfigError) || !process.env.DATABASE_URL) throw error;
    url = process.env.DATABASE_URL;
  }
  const db = createDb(url, 2);
  try {
    const applied = await migrate(db);
    console.log(applied.length > 0 ? `applied: ${applied.join(', ')}` : 'database is up to date');
  } finally {
    await db.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
