-- Supabase の SQL Editor に貼って実行する(1回だけ)。
-- 方針: ログイン済みの人は全員「読める」。書き込み・削除は持ち主だけ。

create table if not exists public.clothes (
  id            uuid primary key,
  owner_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category      text not null,
  sub           text not null default '',
  brand         text not null default '',
  shop          text not null default '',
  size          text not null default '',
  purchased_on  text not null default '',
  memo          text not null default '',
  photo_main    text,
  thumb         text,
  photo_tag     text,
  created_at    bigint not null,
  updated_at    bigint not null
);

alter table public.clothes enable row level security;

drop policy if exists "clothes_select" on public.clothes;
drop policy if exists "clothes_insert" on public.clothes;
drop policy if exists "clothes_update" on public.clothes;
drop policy if exists "clothes_delete" on public.clothes;

create policy "clothes_select" on public.clothes for select to authenticated using (true);
create policy "clothes_insert" on public.clothes for insert to authenticated with check (owner_id = auth.uid());
create policy "clothes_update" on public.clothes for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "clothes_delete" on public.clothes for delete to authenticated using (owner_id = auth.uid());

-- 写真置き場(非公開)。パスは「持ち主のID/服のID/ファイル名」。
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "photos_select" on storage.objects;
drop policy if exists "photos_insert" on storage.objects;
drop policy if exists "photos_update" on storage.objects;
drop policy if exists "photos_delete" on storage.objects;

create policy "photos_select" on storage.objects for select to authenticated
  using (bucket_id = 'photos');
create policy "photos_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos_update" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
