# Oddable phone + PIN sync: one-time setup (free)
1. Make a free project at supabase.com (name it oddable).
2. SQL Editor > New query > run:

create table oddable_sync (id text primary key, salt text not null, pinhash text not null, data jsonb not null default '{}', updated bigint not null default 0);
alter table oddable_sync enable row level security;

3. Project Settings > API: copy the Project URL and the `service_role` key.
4. Render > calcutta-odds > Environment: add SUPABASE_URL (the Project URL) and SUPABASE_KEY (the service_role key). Save (it redeploys).
5. Check https://calcutta-odds.onrender.com/sync/status shows {"configured":true}.

## Claude (Anthropic API)
Render > calcutta-odds > Environment: ANTHROPIC_API_KEY = key from console.anthropic.com. Optional AI_MODEL. Check: /ai/status returns {"ok":true}.
