// Demo: crea due ticket di prova (uno con lead, uno solo-bot). Cancellare dopo i test.
import { readFileSync } from "node:fs";
import pg from "pg";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/^DATABASE_URL=["']?([^"'\n]+)["']?\s*$/m)[1];
const p = new pg.Pool({ connectionString: url, ssl: url.includes("localhost") ? false : { rejectUnauthorized: false } });

const c1 = await p.query(
  "insert into conversations (initial_query, source_page, status, priority, assigned_to) values ('sito ristorante Gallipoli', '/siti-web-gallipoli', 'lead_captured', 'alta', 'A') returning id, number",
);
await p.query(
  "insert into messages (conversation_id, sender, body) values ($1,'visitor','Cerco un sito per il mio ristorante'),($1,'bot','Di che servizio hai bisogno?')",
  [c1.rows[0].id],
);
const l1 = await p.query(
  "insert into leads (name, phone, service, urgency, budget, consent) values ('Marco Rossi','+393331234567','sito web','entro 1 mese','2-5k €',true) returning id",
);
await p.query("update conversations set lead_id = $1 where id = $2", [l1.rows[0].id, c1.rows[0].id]);

const c2 = await p.query(
  "insert into conversations (initial_query, source_page, status, priority) values ('seo per dentista', '/seo-salento', 'bot', 'normale') returning id, number",
);
await p.query(
  "insert into messages (conversation_id, sender, body) values ($1,'visitor','quanto costa la seo?'),($1,'bot','Hai già un sito?')",
  [c2.rows[0].id],
);

console.log("TICKET DEMO:", c1.rows[0].number, c2.rows[0].number);
await p.end();
