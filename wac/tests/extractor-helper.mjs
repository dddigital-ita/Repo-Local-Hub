/**
 * Helper condiviso dalla sentinella route-get-purity.test.mjs: estrae il
 * corpo bilanciato di un export GET da un sorgente route handler. Vive in
 * un file separato così il controtest manuale può importarlo senza eseguire
 * l'intera suite.
 */
export function extractGetHandler(source) {
  const patterns = [
    /export\s+async\s+function\s+GET\s*\([^)]*\)\s*(:[^)]*)?\{/,
    /export\s+function\s+GET\s*\([^)]*\)\s*(:[^)]*)?\{/,
    /GET\s*:\s*async\s+function\s*\([^)]*\)\s*\{/,
    /GET\s*:\s*\(\s*[^)]*\)\s*=>\s*\{/,
  ];
  for (const re of patterns) {
    const m = source.match(re);
    if (m) {
      let depth = 0;
      const start = m.index + m[0].length - 1;
      for (let i = start; i < source.length; i++) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") {
          depth--;
          if (depth === 0) return source.slice(start, i + 1);
        }
      }
    }
  }
  return null;
}
