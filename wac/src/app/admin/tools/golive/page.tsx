import type { Metadata } from "next";
import Link from "next/link";
import { Rocket, FileText, ScanEye } from "lucide-react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { requireAdmin } from "@/lib/admin";
import { parseMarkdownDoc, parseInlineTokens } from "@/lib/markdown-lite";
import { GlassCard as Card } from "@/components/glass";
import { SubPageHeader } from "@/components/sub-page-header";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Runbook go-live", robots: { index: false } };

/** Legge il documento operativo dal disco: fonte unica, niente copie da tenere in sync. */
function loadRunbookDoc(): string {
  return readFileSync(path.join(process.cwd(), "GO-LIVE.md"), "utf8");
}

/** Markup inline del documento: inline code e link (esterni in nuova scheda). */
function InlineText({ text }: { text: string }) {
  const tokens = parseInlineTokens(text);
  return (
    <>
      {tokens.map((t, i) => {
        if (t.kind === "strong") {
          return (
            <strong key={i} className="font-semibold text-slate-800">
              {t.text}
            </strong>
          );
        }
        if (t.kind === "code") {
          return (
            <code key={i} className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em] text-slate-700">
              {t.text}
            </code>
          );
        }
        if (t.kind === "link") {
          return t.external ? (
            <a key={i} href={t.href} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">
              {t.text}
            </a>
          ) : (
            <Link key={i} href={t.href} className="text-brand-700 hover:underline">
              {t.text}
            </Link>
          );
        }
        return <span key={i}>{t.text}</span>;
      })}
    </>
  );
}

/**
 * RUNBOOK GO-LIVE — lettura in sola lettura del documento operativo del repo
 * (GO-LIVE.md), la checklist temporizzata (T–3:00 → T+1:00) che il team segue
 * per mettere online un sito. Il file resta la FONTE UNICA: la pagina lo
 * legge dal disco a ogni richiesta, mai una copia — aggiornare il runbook
 * significa modificare il markdown, la pagina segue da sola.
 *
 * Stesso pattern della checklist captcha: utile su altro sito (Web Agency
 * Salento) perché il runbook resta a portata di click nel momento in cui
 * serve, senza cercare il file nel repo.
 */
export default async function GoLiveRunbookPage() {
  await requireAdmin();
  const doc = parseMarkdownDoc(loadRunbookDoc());

  return (
    <div className="space-y-4">
      <SubPageHeader
        backHref="/admin/tools"
        backLabel="Tools"
        Icon={Rocket}
        tone="text-brand-600"
        title="Runbook go-live"
        subtitle={
          <span className="inline-flex items-center gap-1 text-xs">
            <ScanEye className="h-3.5 w-3.5 text-slate-400" aria-hidden />
            GO-LIVE.md — letta dal repo, sempre aggiornata
          </span>
        }
      />

      <Card>
        {doc.title && (
          <h1 className="mb-4 text-xl font-bold text-slate-900">{doc.title}</h1>
        )}
        <div className="space-y-3">
          {doc.nodes.map((node, i) => {
            switch (node.type) {
              case "heading": {
                if (node.level === 2) {
                  return (
                    <h2 key={i} className="mt-5 text-lg font-semibold text-slate-900 first:mt-0">
                      {node.text}
                    </h2>
                  );
                }
                if (node.level === 3) {
                  return (
                    <h3 key={i} className="mt-4 font-semibold text-slate-800">
                      {node.text}
                    </h3>
                  );
                }
                return (
                  <p key={i} className="mt-5 text-base font-semibold text-slate-900">
                    {node.text}
                  </p>
                );
              }
              case "paragraph":
                return (
                  <p key={i} className="text-sm leading-relaxed text-slate-600">
                    <InlineText text={node.text} />
                  </p>
                );
              case "quote":
                return (
                  <blockquote
                    key={i}
                    className="rounded-xl bg-amber-50/80 px-4 py-3 text-sm leading-relaxed text-amber-900 ring-1 ring-amber-100"
                  >
                    <InlineText text={node.text} />
                  </blockquote>
                );
              case "list": {
                const ListTag = node.ordered ? "ol" : "ul";
                return (
                  <ListTag
                    key={i}
                    className={`space-y-1 pl-5 text-sm leading-relaxed text-slate-600 ${node.ordered ? "list-decimal" : "list-disc"}`}
                  >
                    {node.items.map((it, j) => (
                      <li key={j} className={it.depth === 1 ? "ml-4" : ""}>
                        <InlineText text={it.text} />
                      </li>
                    ))}
                  </ListTag>
                );
              }
              case "fence":
                return (
                  <pre
                    key={i}
                    className="mt-3 overflow-x-auto rounded-xl bg-slate-900 px-4 py-3 text-xs leading-relaxed text-slate-100"
                  >
                    <code>{node.lines.join("\n")}</code>
                  </pre>
                );
              case "table":
                return (
                  <div key={i} className="mt-2 overflow-x-auto rounded-xl ring-1 ring-white/60">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-white/60 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          {node.headers.map((h, j) => (
                            <th key={j} className="px-3 py-2 font-semibold">
                              <InlineText text={h} />
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {node.rows.map((row, j) => (
                          <tr key={j} className="border-t border-white/60 bg-white/40">
                            {row.map((cell, k) => (
                              <td key={k} className="px-3 py-2 align-top text-slate-700">
                                <InlineText text={cell} />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              case "hr":
                return <hr key={i} className="border-white/70" />;
              default:
                return null;
            }
          })}
        </div>
      </Card>

      <p className="flex items-center gap-1.5 px-1 text-xs text-slate-400">
        <FileText className="h-3.5 w-3.5" aria-hidden />
        Fonte: GO-LIVE.md nella root del repo — per modificarlo basta modificare lì.
      </p>
    </div>
  );
}
