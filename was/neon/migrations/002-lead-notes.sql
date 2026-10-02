-- Note operative sul lead (pipeline admin)
alter table leads add column if not exists notes text;
