import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

/**
 * Config ESLint flat (ESLint 9) — `npm run lint` con la CLI diretta (Next 16
 * ha rimosso `next lint`). Da Next 16 `eslint-config-next` esporta FLAT
 * CONFIG native (niente più FlatCompat): si importano direttamente
 * core-web-vitals e typescript.
 */
const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // Convenzione: nome che inizia con _ = parametri/variabili volutamente
      // inutilizzati (signature stabili, destrutturazioni parziali).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
      // react-hooks v6 (React Compiler): set-state-in-effect, refs e purity
      // sono ATTIVI a livello di errore (default del preset). I 10 pattern
      // storici sono stati rifattorizzati (2026-09-27, CHANGELOG), non
      // silenziati: ogni nuovo setState sincrono in effect rompe la lint.
    },
  },
  {
    // I .cjs sono CommonJS PER DEFINIZIONE: require() è la loro sintassi,
    // non un oversight (scripts/e2e-port.cjs deve restare CJS nativo perché
    // il config di Playwright traspira i .mjs della sua catena d'import —
    // stessa soluzione adottata dal repo gemello WebAgencyCrema).
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    ignores: [
      "node_modules/**",
      // Ogni output di build (WAC_DIST_DIR variabile): .next, .next-prod,
      // .next-bench-*, .next-prod-ci, ... — i chunk minificati non si lintano.
      ".next*/**",
      "out/**",
      "next-env.d.ts",
      // Fixture JSX di prova del guard overlay: escluse dal typecheck per
      // la stessa ragione (tsconfig.json) — non devono inquinare la lint.
      "tests/fixtures/**",
      // File generato dall'app a runtime (dashboard di seed): non è codice
      // del progetto e non deve passare dalla lint.
      ".buffy-seed-dash.cjs",
    ],
  },
];

export default eslintConfig;
