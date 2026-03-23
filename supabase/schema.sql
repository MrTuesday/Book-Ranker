create extension if not exists pgcrypto;

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  books jsonb not null default '[]'::jsonb,
  catalog_books jsonb not null default '[]'::jsonb,
  genre_interests jsonb not null default '{}'::jsonb,
  author_experiences jsonb not null default '{}'::jsonb,
  series_experiences jsonb not null default '{}'::jsonb,
  constraint user_profiles_name_not_blank check (char_length(trim(name)) > 0)
);

create unique index if not exists user_profiles_user_id_name_key
  on public.user_profiles (user_id, lower(name));

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  active_profile_id uuid references public.user_profiles (id) on delete set null,
  migrated_local_state boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.user_profiles enable row level security;
alter table public.user_settings enable row level security;

create policy "Users can read their profiles"
  on public.user_profiles
  for select
  using ((select auth.uid()) = user_id);

create policy "Users can insert their profiles"
  on public.user_profiles
  for insert
  with check ((select auth.uid()) = user_id);

create policy "Users can update their profiles"
  on public.user_profiles
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their profiles"
  on public.user_profiles
  for delete
  using ((select auth.uid()) = user_id);

create policy "Users can read their settings"
  on public.user_settings
  for select
  using ((select auth.uid()) = user_id);

create policy "Users can insert their settings"
  on public.user_settings
  for insert
  with check ((select auth.uid()) = user_id);

create policy "Users can update their settings"
  on public.user_settings
  for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.touch_user_profile_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists touch_user_profiles_updated_at on public.user_profiles;
create trigger touch_user_profiles_updated_at
before update on public.user_profiles
for each row
execute function public.touch_user_profile_updated_at();

create or replace function public.touch_user_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists touch_user_settings_updated_at on public.user_settings;
create trigger touch_user_settings_updated_at
before update on public.user_settings
for each row
execute function public.touch_user_settings_updated_at();
