-- Native Web Push subscriptions — one row per device per user.
-- The endpoint URL doubles as the primary key because it is globally unique
-- and avoids a separate id that would need to round-trip to the client.

create table if not exists zane_push_subscriptions (
  id        text        primary key,   -- endpoint URL
  user_id   uuid        not null references auth.users(id) on delete cascade,
  endpoint  text        not null,
  p256dh    text        not null,      -- client EC public key (base64url)
  auth      text        not null,      -- auth secret (base64url)
  created_at timestamptz not null default now()
);

alter table zane_push_subscriptions enable row level security;

create policy "users manage own push subscriptions"
  on zane_push_subscriptions for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
