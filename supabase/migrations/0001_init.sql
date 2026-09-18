-- Axxiom Safety Assistant: initial schema.
-- All tables have RLS enabled with no policies: anon/authenticated roles are denied everything.
-- The API and ingestion use the service role or the pooler connection.

create extension if not exists pgcrypto;

-- Source documents (the manual today; appendices and handbooks later).
create table documents (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  doc_kind text not null check (doc_kind in ('manual', 'appendix', 'handbook')),
  precedence int not null default 100,
  created_at timestamptz not null default now()
);

create table manual_versions (
  id text primary key,
  document_id uuid not null references documents(id),
  effective_date date not null,
  status text not null check (status in ('draft', 'review', 'active', 'retired')),
  page_count int not null,
  body_start_page int not null,
  pdf_storage_path text not null,
  md_storage_path text not null,
  manifest_storage_path text not null,
  pdf_sha256 text not null,
  pages_sha256 text not null,
  size_bytes bigint not null,
  token_count int,
  tooling jsonb not null,
  manifest jsonb not null,
  approval jsonb,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  retired_at timestamptz
);
create unique index manual_versions_one_active on manual_versions(document_id) where status = 'active';

create table manual_pages (
  manual_version_id text not null references manual_versions(id) on delete cascade,
  page_index int not null,
  is_toc boolean not null default false,
  raw_text text not null,
  model_text text not null,
  block_text text not null,
  char_count int not null,
  sha256 text not null,
  primary key (manual_version_id, page_index)
);

create table manual_sections (
  id uuid primary key default gen_random_uuid(),
  manual_version_id text not null references manual_versions(id) on delete cascade,
  number text,
  level smallint not null check (level between 1 and 3),
  title text not null,
  program_number smallint not null,
  policy_ref text,
  start_page int not null,
  start_line int not null,
  end_page int not null,
  end_line int not null,
  match_method text not null,
  match_score numeric(4,3) not null,
  toc_page_hint int
);
create unique index manual_sections_number on manual_sections(manual_version_id, number) where number is not null;
create index manual_sections_pages on manual_sections(manual_version_id, start_page, end_page);

-- Pseudonymous users keyed by identity-provider issuer and subject; no email stored.
create table app_users (
  id uuid primary key default gen_random_uuid(),
  issuer text not null,
  subject text not null,
  role text not null default 'technician' check (role in ('technician', 'safety_manager', 'admin')),
  created_at timestamptz not null default now(),
  disabled_at timestamptz,
  unique (issuer, subject)
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id),
  manual_version_id text not null references manual_versions(id),
  title text,
  turn_count int not null default 0,
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_reason text,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index conversations_user on conversations(user_id, last_message_at desc);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  turn_index int not null,
  role text not null check (role in ('user', 'assistant')),
  display_text text not null,
  content jsonb not null,
  response_kind text check (response_kind in ('answer', 'not_covered', 'out_of_scope', 'emergency', 'refusal', 'validation_failed', 'error')),
  emergency_trigger text check (emergency_trigger in ('keyword', 'model')),
  model text,
  prompt_version text,
  manual_version_id text references manual_versions(id),
  input_tokens int,
  output_tokens int,
  cache_read_input_tokens int,
  cache_creation_input_tokens int,
  latency_ms int,
  ttfb_ms int,
  stop_reason text,
  stop_details jsonb,
  fallback_ran boolean,
  validation jsonb,
  anthropic_message_id text,
  anthropic_request_id text,
  client_message_id text,
  device_id text,
  client_version text,
  created_at timestamptz not null default now(),
  unique (conversation_id, turn_index)
);
create unique index messages_client_message on messages(conversation_id, client_message_id) where client_message_id is not null;
create index messages_created on messages(created_at desc);
create index messages_kind on messages(response_kind, created_at desc);

create table message_citations (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  ordinal int not null,
  text_block_index int not null,
  manual_version_id text not null,
  page_index int not null,
  start_block_index int not null,
  end_block_index int not null,
  section_id uuid references manual_sections(id),
  program_number smallint,
  section_number text,
  cited_text_sha256 text not null,
  quote text,
  quote_verified boolean,
  foreign key (manual_version_id, page_index) references manual_pages(manual_version_id, page_index)
);
create index message_citations_page on message_citations(manual_version_id, page_index);

create table feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  user_id uuid references app_users(id),
  source text not null default 'user' check (source in ('user', 'auto_flag')),
  rating text check (rating in ('up', 'down')),
  flag text check (flag in ('wrong', 'unsafe', 'wrongly_not_covered', 'other')),
  comment text,
  status text not null default 'new' check (status in ('new', 'reviewed', 'dismissed', 'fixed')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
create index feedback_queue on feedback(status, created_at) where status = 'new';

create table rate_limit_buckets (
  user_id uuid not null,
  window_kind text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (user_id, window_kind, window_start)
);

create or replace function consume_rate_limit(p_user uuid, p_kind text, p_start timestamptz, p_limit int)
returns boolean language plpgsql as $$
declare c int;
begin
  insert into rate_limit_buckets(user_id, window_kind, window_start, count)
  values (p_user, p_kind, p_start, 1)
  on conflict (user_id, window_kind, window_start) do update set count = rate_limit_buckets.count + 1
  returning count into c;
  return c <= p_limit;
end $$;

create table keepalive_runs (
  id bigserial primary key,
  ran_at timestamptz not null default now(),
  skipped boolean not null,
  reason text,
  stop_reason text,
  cache_read_input_tokens int,
  cache_creation_input_tokens int,
  input_tokens int,
  latency_ms int,
  error text
);

-- Eval harness history.
create table eval_runs (
  id text primary key,
  git_sha text,
  profile text not null,
  prompt_version text,
  manual_version_id text,
  model text,
  totals jsonb not null,
  cost_usd numeric(10,4),
  passed boolean,
  created_at timestamptz not null default now()
);

create table eval_results (
  run_id text not null references eval_runs(id) on delete cascade,
  case_id text not null,
  rep int not null default 1,
  pass boolean not null,
  fail_reasons jsonb,
  judge jsonb,
  usage jsonb,
  latency jsonb,
  primary key (run_id, case_id, rep)
);

-- List prices per million tokens, for cost views.
create table model_prices (
  model text primary key,
  input_per_mtok numeric(10,4) not null,
  output_per_mtok numeric(10,4) not null,
  cache_read_per_mtok numeric(10,4) not null,
  cache_write_1h_per_mtok numeric(10,4) not null,
  updated_at timestamptz not null default now()
);
insert into model_prices values
  ('claude-opus-5', 5, 25, 0.5, 10, now()),
  ('claude-sonnet-5', 2, 10, 0.2, 4, now()),
  ('claude-haiku-4-5', 1, 5, 0.1, 2, now());

-- Private bucket for manual PDFs, Markdown and manifests; the API mints signed URLs.
insert into storage.buckets (id, name, public) values ('manuals', 'manuals', false) on conflict (id) do nothing;

alter table documents enable row level security;
alter table manual_versions enable row level security;
alter table manual_pages enable row level security;
alter table manual_sections enable row level security;
alter table app_users enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table message_citations enable row level security;
alter table feedback enable row level security;
alter table rate_limit_buckets enable row level security;
alter table keepalive_runs enable row level security;
alter table eval_runs enable row level security;
alter table eval_results enable row level security;
alter table model_prices enable row level security;
