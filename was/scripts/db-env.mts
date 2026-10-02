/** Pool PostgreSQL verso il DB indicato da DATABASE_URL (env), per gli script .mts.
 *  Uso: import { pool, end } from "./db-env.mts"; — niente DSN hardcoded:
 *  il DSN arriva dall'ambiente (come db-migrate-all.mjs). */
import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});

export async function end(): Promise<void> {
  await pool.end();
}
