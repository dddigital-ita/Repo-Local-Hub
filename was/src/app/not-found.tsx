import SearchBar from "@/components/search-bar";
import { Container } from "@/components/ui";

export default function NotFound() {
  return (
    <main>
      <Container className="flex flex-col items-center py-24 text-center">
        <p className="text-6xl font-extrabold text-brand-200">404</p>
        <h1 className="mt-4 text-2xl font-bold text-slate-900">Pagina non trovata</h1>
        <p className="mt-2 max-w-md text-slate-600">
          Forse cercavi un servizio? Scrivilo qui sotto: si apre la chat col team.
        </p>
        <div className="mt-8 w-full max-w-xl">
          <SearchBar />
        </div>
      </Container>
    </main>
  );
}
