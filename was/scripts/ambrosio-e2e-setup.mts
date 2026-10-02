/**
 * Configura il provider AI mock (custom → http://127.0.0.1:3888/v1) e abilita
 * Ambrosio sul DB locale, cifrando la chiave con il vero ADMIN_SESSION_SECRET
 * del server — lo stesso percorso che fa l'admin UI, così niente bypass.
 *
 * Uso: npx tsx --env-file=.env.local scripts/ambrosio-e2e-setup.mts
 */
import { saveProviderKey, saveAiSettings, getAiSettings } from "../src/lib/ai.ts";

await saveProviderKey({
  provider: "custom",
  apiKey: "sk-test-mock-e2e",
  model: "mock-model",
  baseUrl: "http://127.0.0.1:3999/v1",
  enabled: true,
});

await saveAiSettings({ enabled: true, provider: "custom", temperature: 0.4 });

const s = await getAiSettings();
console.log("AI settings:", { enabled: s?.enabled, provider: s?.provider, hasKey: s?.hasKey });
process.exit(0);
