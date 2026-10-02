import { redirect } from "next/navigation";

/**
 * La inbox è diventata il ticketing system: redirect per i vecchi link.
 * I parametri (filtro f, ticket t, ricerca q) vengono preservati: un
 * bookmark tipo /admin/inbox?f=da_rispondere&t=… deve atterrare sulla
 * stessa vista, non sul filtro di default.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") qs.set(key, value);
    else if (Array.isArray(value) && value[0] !== undefined) qs.set(key, value[0]);
  }
  const query = qs.toString();
  redirect(`/admin/tickets${query ? `?${query}` : ""}`);
}
