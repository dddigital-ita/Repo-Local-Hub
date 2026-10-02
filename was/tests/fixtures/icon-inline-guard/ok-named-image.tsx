/**
 * FIXTURE legale: un svg con NOME ACCESSIBILE (role="img" + aria-label)
 * è un'immagine dichiarata (grafico, illustrazione), non un'icona di
 * accoppiata: il guard non la giudica come icona accanto al testo.
 * Riproduce il grafico GSC in seo-landing-editor (falso positivo reale
 * trovato al primo giro del guard).
 */
export function PositionChartOk() {
  return (
    <svg
      viewBox="0 0 640 180"
      className="w-full cursor-crosshair rounded-xl"
      role="img"
      aria-label="Grafico della posizione media su Google negli ultimi 90 giorni."
      tabIndex={0}
    >
      <line x1={34} x2={628} y1={14} y2={14} stroke="#e2e8f0" strokeWidth={1} />
      <text x={28} y={17} fontSize={9} fill="#94a3b8">
        10
      </text>
      <polyline points="34,100 200,80 400,60 628,40" fill="none" stroke="#4f46e5" strokeWidth={2} />
    </svg>
  );
}

export function ChartWithLegendOk() {
  return (
    <div className="mt-3 rounded-2xl">
      <PositionChartOk />
      <div className="mt-1 flex flex-wrap items-center gap-x-4 text-[11px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-[#4f46e5]" aria-hidden />
          Posizione media
        </span>
        <span className="text-slate-400">aree normalizzate</span>
      </div>
    </div>
  );
}
