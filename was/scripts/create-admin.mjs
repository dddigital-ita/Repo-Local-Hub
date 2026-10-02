/**
 * Crea un utente admin: npm run admin:create admin@email.com PasswordLunga
 * Richiede DATABASE_URL in .env.local (o nell'ambiente).
 */
import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('Uso: npm run admin:create admin@email.com "PasswordLunga"');
  process.exit(1);
}

// Carica .env.local manualmente (niente dipendenze extra)
import { readFileSync } from "node:fs";
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
} catch {}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL mancante: configura .env.local prima.");
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 64).toString("hex");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // Postgres locale (server finale): niente SSL; gestito (Neon): SSL
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});
await pool.query(
  `insert into admin_users (email, password_hash) values ($1, $2)
   on conflict (email) do update set password_hash = excluded.password_hash`,
  [email.toLowerCase().trim(), `${salt}:${hash}`],
);
await pool.end();
console.log(`✅ Admin pronto: ${email} — ora può entrare su /admin`);
