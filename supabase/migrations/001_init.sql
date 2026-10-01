-- Breeder's Desk: initial schema.
-- Column names follow the data engine's contract (services/data-engine/docs/CONTRACTS.md):
-- snake_case, colours upper case. Engine fields are stored verbatim; our own fields are added next to them.

-- ---------------------------------------------------------------- chats
create table chats (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- messages
create table messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  kind text not null check (kind in ('text', 'analysis', 'answer')),
  status text not null default 'ok' check (status in ('ok', 'error')),
  text text,
  analysis jsonb,
  versions jsonb,
  usage jsonb,
  error jsonb,
  tool_calls jsonb,
  created_at timestamptz not null default now()
);

create index messages_chat_idx on messages (chat_id, created_at);

-- ---------------------------------------------------------------- files
create table files (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats (id) on delete cascade,
  message_id uuid not null references messages (id) on delete cascade,
  name text not null,
  mime_type text,
  size_bytes bigint,
  storage_path text,
  ingestion jsonb,
  created_at timestamptz not null default now()
);

create index files_message_idx on files (message_id);

-- ---------------------------------------------------------------- candidates
-- One row per engine candidate per analysis message.
-- colour / overridden / override are the engine's effective values, refreshed from the engine
-- when a candidate is read or after an override; the backend never computes them.
create table candidates (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats (id) on delete cascade,
  message_id uuid not null references messages (id) on delete cascade,

  candidate_id text not null,
  colour text not null check (colour in ('GREEN', 'AMBER', 'RED')),
  engine_colour text not null check (engine_colour in ('GREEN', 'AMBER', 'RED')),
  overridden boolean not null default false,
  override jsonb,
  verdict text check (verdict in ('PASS', 'HOLD', 'FAIL')),
  reason text,
  n_trials integer,
  n_fail integer,
  ambiguous_trials jsonb,
  atypical boolean,
  rule_version text,
  evidence jsonb,
  data_gaps jsonb,
  evidence_hash text,

  justification text,
  justification_source text check (justification_source in ('claude', 'engine')),
  verified boolean,
  confidence text check (confidence in ('high', 'medium', 'low')),
  created_at timestamptz not null default now()
);

create index candidates_reuse_idx on candidates (candidate_id, rule_version, evidence_hash);
create index candidates_chat_idx on candidates (chat_id);

-- ---------------------------------------------------------------- candidate_reviews
-- Append-only audit of the breeder's edits and decisions. The latest row is the effective review.
-- No cascade: deleting reviewed candidates must fail rather than erase the audit trail.
create table candidate_reviews (
  id uuid primary key default gen_random_uuid(),
  candidate_row_id uuid not null references candidates (id),
  colour text check (colour in ('GREEN', 'AMBER', 'RED')),
  justification text,
  decision text not null default 'pending' check (decision in ('pending', 'pass', 'no_pass')),
  reason_code text,
  comment text,
  user_name text not null,
  engine_override_id text,
  created_at timestamptz not null default now()
);

create index candidate_reviews_latest_idx on candidate_reviews (candidate_row_id, created_at desc);

create function reject_review_changes() returns trigger
language plpgsql as $$
begin
  raise exception 'candidate_reviews is append-only';
end;
$$;

create trigger candidate_reviews_no_update_delete
  before update or delete on candidate_reviews
  for each row execute function reject_review_changes();

create trigger candidate_reviews_no_truncate
  before truncate on candidate_reviews
  for each statement execute function reject_review_changes();

-- ---------------------------------------------------------------- candidates + latest review
-- latest_colour is only for filtering the dashboard; the engine stays the source of the effective colour.
create view candidates_with_latest_review
with (security_invoker = true) as
select
  c.*,
  r.colour as review_colour,
  r.justification as review_justification,
  coalesce(r.decision, 'pending') as decision,
  (r.justification is not null) as edited,
  r.created_at as reviewed_at,
  coalesce(r.colour, c.colour) as latest_colour
from candidates c
left join lateral (
  select cr.colour, cr.justification, cr.decision, cr.created_at
  from candidate_reviews cr
  where cr.candidate_row_id = c.id
  order by cr.created_at desc
  limit 1
) r on true;

-- ---------------------------------------------------------------- security
-- No policies: only the server (service role) reads and writes.
alter table chats enable row level security;
alter table messages enable row level security;
alter table files enable row level security;
alter table candidates enable row level security;
alter table candidate_reviews enable row level security;

-- ---------------------------------------------------------------- storage
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do nothing;
