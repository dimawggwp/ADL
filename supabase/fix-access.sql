-- =====================================================================
--  ADL · права доступа к таблицам (выполнить ОДИН раз в SQL Editor → Run)
--  Новые проекты Supabase не выдают права сайту автоматически —
--  без этого галерея пустая, а заявки и работы не сохраняются в базу.
--  Защита остаётся: правила RLS по-прежнему решают, кто что видит.
-- =====================================================================
grant usage on schema public to anon, authenticated;

-- галерея: смотреть могут все, менять — только админ (проверяет RLS)
grant select on public.gallery_items to anon, authenticated;
grant insert, update, delete on public.gallery_items to authenticated;

-- заявки: отправить может любой посетитель, читать — только админ
grant insert on public.leads to anon, authenticated;
grant select, update, delete on public.leads to authenticated;

-- список админов и настройки наружу не открываем (is_admin работает и без этого)
revoke all on public.admins from anon, authenticated;
revoke all on public.app_settings from anon, authenticated;
