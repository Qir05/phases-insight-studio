-- Phases Insight Studio: Supabase Schema

create extension if not exists "pgcrypto";

create table if not exists tools (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  slug         text not null unique,
  description  text,
  system_prompt text not null default '',
  email_capture_enabled  boolean not null default true,
  phone_capture_enabled  boolean not null default false,
  ghl_enabled            boolean not null default false,
  ghl_webhook_url        text,
  ghl_tag                text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists questions (
  id            uuid primary key default gen_random_uuid(),
  tool_id       uuid not null references tools(id) on delete cascade,
  label         text not null,
  variable_name text not null default '',
  field_type    text not null check (field_type in ('text','textarea','radio','checkbox','dropdown','number')),
  options       jsonb,   -- array of strings for radio/checkbox/dropdown
  required      boolean not null default true,
  order_index   integer not null default 0,
  created_at    timestamptz not null default now()
);

create table if not exists submissions (
  id               uuid primary key default gen_random_uuid(),
  tool_id          uuid not null references tools(id) on delete cascade,
  first_name       text,
  last_name        text,
  email            text not null,
  phone            text,
  answers          jsonb not null default '{}',
  ai_result        text,
  result_token     text unique not null default encode(gen_random_bytes(24), 'hex'),
  ghl_sync_status  text check (ghl_sync_status in ('pending','success','failed','skipped')) default 'skipped',
  ghl_response     jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists idx_questions_tool_id on questions(tool_id);
create index if not exists idx_submissions_tool_id on submissions(tool_id);
create index if not exists idx_submissions_result_token on submissions(result_token);

-- Row Level Security
alter table tools enable row level security;
alter table questions enable row level security;
alter table submissions enable row level security;

-- Allow service role full access (used by Next.js API routes)
create policy "service role all tools"       on tools       for all using (true);
create policy "service role all questions"   on questions   for all using (true);
create policy "service role all submissions" on submissions for all using (true);
