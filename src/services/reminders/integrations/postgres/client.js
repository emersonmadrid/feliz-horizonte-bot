import { Pool } from "pg";

let pool;

export function getPostgresPool(config) {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required for postgres mode");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: { rejectUnauthorized: false },
    });
  }

  return pool;
}
