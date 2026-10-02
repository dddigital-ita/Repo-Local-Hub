-- ── 008: QUALIFICAZIONE COMMERCIALE LEAD ────────────────────────
-- temperature: valutazione commerciale (caldo = da chiamare subito).
-- ricontatta_il: promemoria interno "riprova tra X giorni".

alter table leads add column if not exists temperature text
  not null default 'tiepido'
  check (temperature in ('caldo', 'tiepido', 'freddo'));

alter table leads add column if not exists ricontatta_il timestamptz;

create index if not exists leads_temperature_idx on leads (temperature) where temperature <> 'tiepido';
