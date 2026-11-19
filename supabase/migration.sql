-- Weight tracker schema (lives in the wishlist Supabase project; all objects prefixed wt_)
-- Every table is owner-only via RLS. The Garmin sync uses the service-role key, which bypasses RLS.

create table if not exists public.wt_profile (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  goal_weight_kg numeric(5,2),
  daily_kcal_target integer,
  height_cm numeric(5,1),
  updated_at timestamptz not null default now()
);

create table if not exists public.wt_weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  weight_kg numeric(5,2) not null check (weight_kg between 20 and 400),
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

create table if not exists public.wt_meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  eaten_at timestamptz not null default now(),
  meal_type text not null default 'snack' check (meal_type in ('breakfast','lunch','dinner','snack')),
  name text not null,
  items jsonb not null default '[]'::jsonb,
  calories integer not null check (calories between 0 and 10000),
  protein_g numeric(6,1),
  carbs_g numeric(6,1),
  fat_g numeric(6,1),
  confidence text check (confidence in ('low','medium','high')),
  photo_path text,
  ai_estimate jsonb,           -- untouched AI output, to compare against your edits
  created_at timestamptz not null default now()
);
create index if not exists wt_meals_user_eaten_idx on public.wt_meals (user_id, eaten_at desc);

create table if not exists public.wt_garmin_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  total_kcal integer,
  active_kcal integer,
  bmr_kcal integer,
  steps integer,
  resting_hr integer,
  sleep_seconds integer,
  sleep_score integer,
  hrv_last_night integer,
  body_battery_high integer,
  body_battery_low integer,
  stress_avg integer,
  synced_at timestamptz not null default now(),
  primary key (user_id, date)
);

alter table public.wt_profile      enable row level security;
alter table public.wt_weights      enable row level security;
alter table public.wt_meals        enable row level security;
alter table public.wt_garmin_daily enable row level security;

create policy wt_profile_owner on public.wt_profile for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy wt_weights_owner on public.wt_weights for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy wt_meals_owner on public.wt_meals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- Garmin rows are written only by the sync job (service role); the app just reads them.
create policy wt_garmin_owner_read on public.wt_garmin_daily for select to authenticated
  using (user_id = (select auth.uid()));

-- Private photo bucket; files live under <user_id>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wt-meal-photos', 'wt-meal-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy wt_photos_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'wt-meal-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy wt_photos_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'wt-meal-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy wt_photos_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'wt-meal-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
