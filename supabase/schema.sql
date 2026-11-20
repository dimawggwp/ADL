-- =====================================================================
--  ADL · Корпусная мебель Алматы — схема базы данных Supabase
--  Как применить: Supabase → SQL Editor → New query → вставить ВЕСЬ файл → Run
--  Скрипт можно запускать повторно — он ничего не сломает.
-- =====================================================================

create extension if not exists pg_net;

-- ---------- 1. Администраторы (кто может загружать фото в галерею) ----------
create table if not exists public.admins (
  email text primary key,
  created_at timestamptz default now()
);
alter table public.admins enable row level security;
-- никто снаружи не читает и не меняет этот список

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.admins
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------- 2. Галерея работ ----------
create table if not exists public.gallery_items (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  title        text not null,
  category     text not null default 'other',
  images       text[] not null default '{}',   -- публичные ссылки, первая = обложка
  image_paths  text[] not null default '{}',   -- пути в Storage (для удаления)
  price        text,                           -- например «от 450 000 ₸»
  materials    text,                           -- корпус, фасады, столешница
  mechanisms   text,                           -- фурнитура, механизмы
  dimensions   text,                           -- размеры
  lead_time    text,                           -- срок изготовления
  description  text,
  sort         int  not null default 0,
  is_published boolean not null default true
);
alter table public.gallery_items enable row level security;

drop policy if exists "gallery public read"  on public.gallery_items;
drop policy if exists "gallery admin insert" on public.gallery_items;
drop policy if exists "gallery admin update" on public.gallery_items;
drop policy if exists "gallery admin delete" on public.gallery_items;
create policy "gallery public read"  on public.gallery_items for select using (is_published or public.is_admin());
create policy "gallery admin insert" on public.gallery_items for insert to authenticated with check (public.is_admin());
create policy "gallery admin update" on public.gallery_items for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "gallery admin delete" on public.gallery_items for delete to authenticated using (public.is_admin());

-- ---------- 3. Заявки с сайта ----------
create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(name) between 1 and 120),
  phone       text not null check (char_length(phone) between 6 and 30),
  furniture   text check (char_length(furniture) <= 120),
  message     text check (char_length(message) <= 3000),
  source      text check (char_length(source) <= 60),   -- form / calculator / constructor / gallery
  details     jsonb,                                    -- расчёт калькулятора или проект 3D
  project_url text check (char_length(project_url) <= 500),
  status      text not null default 'new'               -- new / in_work / done
);
alter table public.leads enable row level security;

drop policy if exists "leads anyone insert" on public.leads;
drop policy if exists "leads admin read"    on public.leads;
drop policy if exists "leads admin update"  on public.leads;
drop policy if exists "leads admin delete"  on public.leads;
-- посетитель может только ОТПРАВИТЬ заявку, читать чужие заявки нельзя
create policy "leads anyone insert" on public.leads for insert to anon, authenticated with check (status = 'new');
create policy "leads admin read"    on public.leads for select to authenticated using (public.is_admin());
create policy "leads admin update"  on public.leads for update to authenticated using (public.is_admin());
create policy "leads admin delete"  on public.leads for delete to authenticated using (public.is_admin());

-- ---------- 4. Хранилище фото ----------
insert into storage.buckets (id, name, public) values ('gallery','gallery',true)  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('projects','projects',true) on conflict (id) do nothing;

drop policy if exists "gallery files admin insert"  on storage.objects;
drop policy if exists "gallery files admin update"  on storage.objects;
drop policy if exists "gallery files admin delete"  on storage.objects;
drop policy if exists "projects files anyone insert" on storage.objects;
create policy "gallery files admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'gallery' and public.is_admin());
create policy "gallery files admin update" on storage.objects for update to authenticated
  using (bucket_id = 'gallery' and public.is_admin());
create policy "gallery files admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'gallery' and public.is_admin());
-- снимки проектов из 3D-конструктора (клиент прикладывает к заявке)
create policy "projects files anyone insert" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'projects');

-- ---------- 5. Автоматическая отправка заявки в WhatsApp ----------
-- Работает через бесплатный сервис CallMeBot (инструкция в README.md).
-- Ключ хранится только в базе, на сайте его не видно.
create table if not exists public.app_settings (
  key   text primary key,
  value text
);
alter table public.app_settings enable row level security;  -- без политик = недоступно снаружи

create or replace function public.urlencode(input text) returns text
language plpgsql immutable as $$
declare
  result text := '';
  b bytea := convert_to(input, 'UTF8');
  i int; c int;
begin
  for i in 0 .. length(b) - 1 loop
    c := get_byte(b, i);
    if (c between 48 and 57) or (c between 65 and 90) or (c between 97 and 122) or c in (45, 46, 95, 126) then
      result := result || chr(c);
    else
      result := result || '%' || upper(lpad(to_hex(c), 2, '0'));
    end if;
  end loop;
  return result;
end $$;

create or replace function public.notify_lead_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_phone  text;
  v_apikey text;
  v_text   text;
begin
  select value into v_phone  from public.app_settings where key = 'callmebot_phone';
  select value into v_apikey from public.app_settings where key = 'callmebot_apikey';
  if v_phone is null or v_apikey is null or v_apikey = '' then
    return new;  -- уведомления ещё не настроены
  end if;

  v_text := '*Новая заявка ADL*' || chr(10)
         || 'Имя: '    || new.name  || chr(10)
         || 'Телефон: '|| new.phone || chr(10)
         || coalesce('Мебель: '  || new.furniture || chr(10), '')
         || coalesce('Источник: '|| new.source    || chr(10), '')
         || coalesce('Комментарий: ' || left(new.message, 1200) || chr(10), '')
         || coalesce('Проект: '  || new.project_url || chr(10), '')
         || 'Позвонить: https://wa.me/' || regexp_replace(new.phone, '\D', '', 'g');

  perform net.http_get(
    url := 'https://api.callmebot.com/whatsapp.php?phone=' || v_phone
           || '&text=' || public.urlencode(v_text)
           || '&apikey=' || v_apikey
  );
  return new;
exception when others then
  return new;  -- заявка сохраняется в любом случае
end $$;

drop trigger if exists trg_lead_whatsapp on public.leads;
create trigger trg_lead_whatsapp after insert on public.leads
  for each row execute function public.notify_lead_whatsapp();

-- =====================================================================
--  ЗАПОЛНИТЕ ПОД СЕБЯ (замените значения и запустите эти строки)
-- =====================================================================
-- 1) Email администратора (тот же, что в Authentication → Users):
-- insert into public.admins (email) values ('ВАШ_EMAIL@gmail.com') on conflict do nothing;

-- 2) WhatsApp-уведомления (после получения ключа от CallMeBot):
-- insert into public.app_settings (key, value) values
--   ('callmebot_phone',  '77076041986'),
--   ('callmebot_apikey', 'ВАШ_КЛЮЧ')
-- on conflict (key) do update set value = excluded.value;
