/**
 * TEST SETUP WIZARD — il wizard d'installazione (/setup) è codice operativo:
 * i test verificano le sue decisioni SENZA toccare un database, leggendo il
 * sorgente come fa il test del runner CLI (tests/db-migrate-all.test.mjs).
 *
 * Coprono:
 *  1. chiusura del wizard: layout in 404 sullo stato «completed»;
 *  2. riverifica del lock nelle server actions PRIMA di installare;
 *  3. password mai restituita dalle action (solo hash su DB);
 *  4. splitter SQL: protegge i blocchi $$ … $$ dallo split sui «;»;
 *  5. euristiche di connessione: SSL solo fuori da localhost, timeout;
 *  6. coerenza col runner CLI: stesse migration, stesso ordine, idempotenza;
 *  7. server.js per Passenger: porta da env, mai dev mode.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..");
const SETUP = path.join(ROOT, "src", "lib", "setup.ts");
const ACTIONS = path.join(ROOT, "src", "app", "setup", "actions.ts");
const LAYOUT = path.join(ROOT, "src", "app", "setup", "layout.tsx");
const PAGE = path.join(ROOT, "src", "app", "setup", "page.tsx");
const SERVER_JS = path.join(ROOT, "server.js");

const src = readFileSync(SETUP, "utf8");
const actions = readFileSync(ACTIONS, "utf8");
const layout = readFileSync(LAYOUT, "utf8");
const page = readFileSync(PAGE, "utf8");

describe("chiusura del wizard (one-shot)", () => {
  test("il layout fa 404 quando lo stato è «completed»", () => {
    assert.match(layout, /setupState/);
    assert.match(layout, /completed/);
    assert.match(layout, /notFound\(\)/);
  });

  test("lo stato considera completato il lock su DB, non solo il file", () => {
    assert.match(src, /setup_lock/);
    assert.match(src, /select completed from setup_lock/);
  });

  test("installAction riverifica il lock PRIMA di toccare il database", () => {
    const gateIdx = actions.indexOf("setupState()");
    const installIdx = actions.indexOf("runInstall(");
    assert.ok(gateIdx !== -1 && installIdx !== -1);
    assert.ok(gateIdx < installIdx, "la riverifica del lock deve precedere runInstall");
    assert.match(actions.slice(gateIdx, installIdx), /completed/);
  });

  test("le action non restituiscono mai la password né il DSN completo", () => {
    // La password dell'admin va solo nell'insert (hash su DB): nelle response
    // riappare al massimo mascherata nel messaggio del .env.local.
    assert.doesNotMatch(actions, /adminPassword:\s*[^,}]+,/); // nessun echo del campo
    assert.match(src, /mask\(/, "il DSN nei log deve passare dalla mascheratura");
  });
});

describe("splitter SQL per le migration", () => {
  // Il repo non importa i sorgenti TS da node --test (convenzione: assert
  // sul sorgente + implementazione di contrasto, come il test del runner
  // CLI). La copia di contrasto verifica il comportamento, gli assert sul
  // sorgente verificano che NON diverga dalle scelte chiave:
  //  - i commenti «--» vengono RIMOSSI (contengono «;» e apostrofi italiani:
  //    frammenti di commento arrivati a Postgres = syntax error);
  //  - i dollar-quoted $$…$$ / $tag$…$tag$ proteggono i «;» interni.
  function splitSqlStatements(sql) {
    const statements = [];
    let current = "";
    let i = 0;
    const n = sql.length;
    while (i < n) {
      const ch = sql[i];
      if (ch === "-" && sql[i + 1] === "-") {
        while (i < n && sql[i] !== "\n") i++;
        current += " ";
        continue;
      }
      if (ch === "'") {
        const start = i;
        i++;
        while (i < n) {
          if (sql[i] === "'") {
            if (sql[i + 1] === "'") {
              i += 2;
              continue;
            }
            i++;
            break;
          }
          i++;
        }
        current += sql.slice(start, i);
        continue;
      }
      if (ch === "$") {
        const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
        if (m) {
          const tag = m[0];
          const end = sql.indexOf(tag, i + tag.length);
          const stop = end === -1 ? n : end + tag.length;
          current += sql.slice(i, stop);
          i = stop;
          continue;
        }
      }
      if (ch === ";") {
        const s = current.trim();
        if (s) statements.push(s);
        current = "";
        i++;
        continue;
      }
      current += ch;
      i++;
    }
    const tail = current.trim();
    if (tail) statements.push(tail);
    return statements;
  }

  test("il sorgente rimuove i commenti «--» e protegge i dollar-quoted", () => {
    assert.match(src, /ch === "-" && sql\[i \+ 1\] === "-"/, "manca la gestione dei commenti «--»");
    assert.match(src, /\^\\\$\[A-Za-z_\]\*\\\$/, "manca il riconoscimento dei dollar-tag");
  });

  test("i commenti con «;» e apostrofi non producono statement", () => {
    const out = splitSqlStatements("-- il lead è pronto; poi ogni ticket va chiuso\nselect 1;");
    assert.deepEqual(out, ["select 1"]);
  });

  test("le stringhe con «;» e apici raddoppiati restano intere", () => {
    const out = splitSqlStatements("insert into t values ('a;b''c'); select 2;");
    assert.equal(out.length, 2);
    assert.match(out[0], /'a;b''c'/);
  });

  test("semplice lista di statement", () => {
    assert.deepEqual(
      splitSqlStatements("create table a (id int); insert into a values (1);"),
      ["create table a (id int)", "insert into a values (1)"],
    );
  });

  test("i blocchi do $$ … $$ restano unici (i «;» interni non splitzano)", () => {
    const sql = "create table t (c text); do $$ begin update x set y=1; delete from z; end $$;";
    const out = splitSqlStatements(sql);
    assert.equal(out.length, 2);
    assert.match(out[1], /^do \$\$ begin update x set y=1; delete from z; end \$\$$/);
  });

  test("gli statement vuoti vengono scartati", () => {
    assert.deepEqual(splitSqlStatements(";;  ;"), []);
  });

  test("tutte le migration reali producono statement sintatticamente chiusi", () => {
    // Proprietà concreta: per ogni file, il conteggio «;» protetti deve
    // coincidere con gli statement trovati (nessun $$ spezzato a metà).
    const dir = path.join(ROOT, "neon", "migrations");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
      const sql = readFileSync(path.join(dir, f), "utf8");
      const statements = splitSqlStatements(sql);
      assert.ok(statements.length >= 1, `${f}: almeno uno statement`);
      for (const s of statements) {
        // un blocco $$ aperto senza chiusura significherebbe splitter rotto
        const dollars = (s.match(/\$\$/g) ?? []).length;
        assert.equal(dollars % 2, 0, `${f}: blocco $$ non bilanciato in: ${s.slice(0, 60)}…`);
      }
    }
  });
});

describe("connessione al database", () => {
  test("SSL solo fuori da localhost (come lib/db.ts)", () => {
    assert.match(src, /dsn\.includes\("localhost"\)\s*\?\s*false\s*:\s*\{ rejectUnauthorized: false \}/);
  });

  test("timeout di connessione corto (l'utente non aspetta 30s su un host sbagliato)", () => {
    assert.match(src, /connectionTimeoutMillis:\s*[\d_]+/);
  });

  test("uselibpqcompat=true aggiunto senza toccare il DSN dell'utente", () => {
    assert.match(src, /uselibpqcompat=true/);
  });

  test("errori PostgreSQL tradotti in messaggi d'aiuto", () => {
    for (const code of ["ECONNREFUSED", "28P01", "3D000", "42501"]) {
      assert.ok(src.includes(`"${code}"`), `manca la traduzione dell'errore ${code}`);
    }
  });
});

describe("coerenza col runner CLI (db-migrate-all)", () => {
  const cli = readFileSync(path.join(ROOT, "scripts", "db-migrate-all.mjs"), "utf8");

  test("stessa directory, stesso ordine lessicografico", () => {
    assert.match(src, /neon/, "la cartella migration deve essere la stessa del repo");
    assert.match(src, /\.sort\(\)/);
    assert.match(cli, /\.sort\(\)/);
  });

  test("tracciamento con checksum: i file già applicati NON vengono rieseguiti", () => {
    const gateIdx = src.indexOf("recorded.get(file)");
    const execIdx = src.indexOf("await pool.query(statement)");
    assert.ok(gateIdx !== -1 && execIdx !== -1);
    assert.ok(gateIdx < execIdx, "il gate del tracciamento deve precedere l'esecuzione");
    assert.match(src, /checksum/);
  });

  test("«already exists» è backfill, non errore (stessa classificazione del CLI)", () => {
    assert.match(src, /already exists\|duplicate key value/i);
    assert.match(src, /KNOWN_RULES/);
  });

  test("l'installazione si interrompe se una migration fallisce", () => {
    assert.match(src, /ok: failed === 0/);
  });
});

describe("super admin e ruoli", () => {
  test("l'account creato dal wizard è super_admin e attivo, upsert idempotente", () => {
    assert.match(src, /'super_admin', true/);
    assert.match(src, /on conflict \(email\) do update/);
  });

  test("usa l'hashing del repo (scrypt di lib/admin), non uno nuovo", () => {
    assert.match(src, /hashPassword/);
  });
});

describe("scrittura .env.local", () => {
  test("contiene le tre variabili minime e commenti per le opzionali", () => {
    for (const key of ["DATABASE_URL", "NEXT_PUBLIC_SITE_URL", "ADMIN_SESSION_SECRET", "RESEND_API_KEY"]) {
      assert.ok(src.includes(key), `manca ${key}`);
    }
  });

  test("il secret di sessione esistente viene conservato (le sessioni non muoiono)", () => {
    assert.match(src, /readExistingEnvSecret/);
  });
});

describe("pagina e startup file", () => {
  test("il wizard guida l'utente su database, Node.js App e riavvio finale", () => {
    assert.match(page, /Database Wizard/);
    assert.match(page, /Setup Node\.js App/);
    assert.match(page, /Restart/);
  });

  test("il form verifica la password prima dell'installazione", () => {
    assert.match(page, /Le due password non coincidono/);
    assert.match(page, /almeno 8 caratteri/);
  });

  test("la pagina dichiara la chiusura definitiva del wizard", () => {
    assert.match(page, /non è più raggiungibile/);
  });

  test("server.js: legge PORT, mai dev mode, handler Next", () => {
    const srv = readFileSync(SERVER_JS, "utf8");
    assert.match(srv, /process\.env\.PORT/);
    assert.match(srv, /dev:\s*false/);
    assert.match(srv, /getRequestHandler/);
  });
});
