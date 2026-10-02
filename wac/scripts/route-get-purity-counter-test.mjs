// Controtest della sentinella (a mano, non in CI): il detector deve beccare
// il VECCHIO codice difettoso e lasciare passare i GET innocui.
import { extractGetHandler } from "../tests/extractor-helper.mjs";

const OLD_BUGGY = `import { NextResponse } from 'next/server';
import { logout } from '@/lib/admin';
export async function GET(req: Request) {
  await logout();
  return NextResponse.redirect(new URL('/admin/login', req.url));
}`;

const NEW_OK = `export async function GET(req: Request) {
  return NextResponse.redirect(new URL('/admin', req.url), 303);
}`;

const COOKIE_DELETE = `export async function GET() {
  const s = await cookies();
  s.delete("wac_admin");
  return NextResponse.json({ ok: true });
}`;

const SET_COOKIE_HEADER = `export async function GET() {
  return NextResponse.json({ ok: true }, { headers: { "Set-Cookie": "x=1" } });
}`;

const PATTERNS = [
  /await\s+cookies\(\)/,
  /\.set\(\s*["'`]/,
  /\.delete\(\s*["'`]/,
  /["'`]Set-Cookie["'`]\s*:\s*/i,
  /\blogout\s*\(/,
  /issueSessionFor\s*\(/,
];

const detect = (src) => {
  const body = extractGetHandler(src);
  return body ? PATTERNS.some((re) => re.test(body)) : false;
};

let ok = true;
const check = (label, src, expected) => {
  const got = detect(src);
  const pass = got === expected;
  if (!pass) ok = false;
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}: beccato=${got} (atteso=${expected})`);
};

check("vecchio bug: logout() dentro GET", OLD_BUGGY, true);
check("nuovo GET innocuo (solo redirect)", NEW_OK, false);
check("cookies().delete in GET", COOKIE_DELETE, true);
check("header Set-Cookie esplicito in GET", SET_COOKIE_HEADER, true);
process.exit(ok ? 0 : 1);
