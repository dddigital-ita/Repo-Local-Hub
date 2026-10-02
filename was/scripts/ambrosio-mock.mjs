/**
 * Mock provider OpenAI-compatible per testare Ambrosio E2E su localhost.
 * Risponde in modo deterministico: estrae le righe di catalogo (pacchetti)
 * dal SYSTEM PROMPT ricevuto e le riporta nella risposta — così il test
 * dimostra che Ambrosio riceve davvero il listino dal DB. Log su /tmp.
 */
import http from "node:http";
import { appendFileSync } from "node:fs";

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try {
      const { messages } = JSON.parse(body);
      const system = messages?.find((m) => m.role === "system")?.content ?? "";
      const catLines = system
        .split("\n")
        .filter((l) => /^- (Sito|E-commerce|SEO|Consulenza|Restyling|Posizionamento|Fotografo|Video|Assistenza)/.test(l));
      const lastUser = [...(messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "";
      appendFileSync(
        "/tmp/ambrosio-mock.log",
        JSON.stringify({ at: new Date().toISOString(), catalogLines: catLines, lastUser: lastUser.slice(0, 200) }, null, 2) + "\n",
      );
      const asksPrice = /quanto\s+cost|prezzo|costa/i.test(lastUser);
      const clean = (s) => s.replace(/^- /, "").replace(/ \(include:[^)]*\)/, "");
      const content =
        asksPrice && catLines.length
          ? `Ti do subito le fasce vere, quelle che usiamo noi: ${catLines
              .slice(0, 4)
              .map(clean)
              .join("; ")}. Se ti tornano, lasciami nome e numero: Daniele ti richiama in mattinata.`
          : "Ciao! Sono Ambrosio (mock di test): dimmi che servizio ti serve e ti indico subito la fascia giusta.";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
  });
});

server.listen(3999, "127.0.0.1", () => console.log("mock pronto su :3999"));
