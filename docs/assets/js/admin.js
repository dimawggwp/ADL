import { CATEGORIES } from './config.js';
import { sb, esc, catName, toast, compressImage, waLink } from './core.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- вход ---------- */
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { $('#loginBox').hidden = false; $('#panel').hidden = true; $('#logout').hidden = true; return; }
  const { data: isAdmin, error } = await sb.rpc('is_admin');
  if (error || !isAdmin) {
    $('#loginBox').innerHTML = `<h2>Нет доступа</h2><p class="muted">Вы вошли как <b>${esc(session.user.email)}</b>, но этот email не добавлен в администраторы.<br><br>Выполните в Supabase → SQL Editor:<br><code>insert into public.admins (email) values ('${esc(session.user.email)}');</code></p><button class="b b--dark b--full" id="lo2" style="margin-top:18px">Выйти</button>`;
    $('#lo2').onclick = async () => { await sb.auth.signOut(); location.reload(); };
    return;
  }
  $('#loginBox').hidden = true; $('#panel').hidden = false; $('#logout').hidden = false;
  loadItems(); loadLeads();
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#loginForm button'); btn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email: $('#lEmail').value.trim(), password: $('#lPass').value });
  btn.disabled = false;
  if (error) { toast('Неверный email или пароль', 'err'); return; }
  boot();
});
$('#logout').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

$$('.a-tabs button').forEach((b) => b.addEventListener('click', () => {
  $$('.a-tabs button').forEach((x) => x.classList.toggle('is-on', x === b));
  $$('[data-p]').forEach((p) => { p.hidden = p.dataset.p !== b.dataset.t; });
}));

/* ---------- галерея: форма ---------- */
$('#iCat').innerHTML = CATEGORIES.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
let photos = [];   // { file?, url, path? }  — новые (file) и уже загруженные (url+path)
let editing = null;

const drop = $('#drop');
['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('is-over')));
drop.addEventListener('drop', (e) => { e.preventDefault(); addFiles(e.dataTransfer.files); });
$('#files').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
function addFiles(list) {
  [...list].filter((f) => f.type.startsWith('image/')).forEach((f) => photos.push({ file: f, url: URL.createObjectURL(f) }));
  renderThumbs();
}
function renderThumbs() {
  $('#thumbs').innerHTML = photos.map((p, i) => `<div draggable="true" data-i="${i}"><img src="${esc(p.url)}" alt="">${i === 0 ? '<span class="cover">обложка</span>' : `<span class="mk" data-first="${i}">сделать обложкой</span>`}<button type="button" data-rm="${i}" aria-label="Убрать">×</button></div>`).join('');
  $$('[data-rm]').forEach((b) => b.onclick = () => { photos.splice(+b.dataset.rm, 1); renderThumbs(); });
  $$('[data-first]').forEach((b) => b.onclick = () => { const [p] = photos.splice(+b.dataset.first, 1); photos.unshift(p); renderThumbs(); });
}

function resetForm() {
  editing = null; photos = []; renderThumbs(); $('#itemForm').reset(); $('#iPub').checked = true;
  $('#formTitle').textContent = 'Новая работа'; $('#saveBtn').textContent = 'Опубликовать'; $('#cancelEdit').hidden = true;
}
$('#cancelEdit').addEventListener('click', resetForm);

$('#itemForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!photos.length) { toast('Добавьте хотя бы одно фото', 'err'); return; }
  const btn = $('#saveBtn'); btn.disabled = true;
  try {
    const images = [], paths = [];
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      if (p.file) {
        btn.textContent = `Загружаем фото ${i + 1} из ${photos.length}…`;
        const blob = await compressImage(p.file, 2000, 0.85);
        const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const { error } = await sb.storage.from('gallery').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' });
        if (error) throw error;
        images.push(sb.storage.from('gallery').getPublicUrl(path).data.publicUrl); paths.push(path);
      } else { images.push(p.url); paths.push(p.path); }
    }
    const row = {
      title: $('#iTitle').value.trim(), category: $('#iCat').value, images, image_paths: paths,
      price: $('#iPrice').value.trim() || null, materials: $('#iMat').value.trim() || null, mechanisms: $('#iMech').value.trim() || null,
      dimensions: $('#iDim').value.trim() || null, lead_time: $('#iTime').value.trim() || null, description: $('#iDesc').value.trim() || null,
      is_published: $('#iPub').checked,
    };
    btn.textContent = 'Сохраняем…';
    if (editing) {
      const removed = (editing.image_paths || []).filter((p) => p && !paths.includes(p));
      const { error } = await sb.from('gallery_items').update(row).eq('id', editing.id);
      if (error) throw error;
      if (removed.length) await sb.storage.from('gallery').remove(removed);
      toast('Работа обновлена');
    } else {
      row.sort = Math.floor(Date.now() / 1000);
      const { error } = await sb.from('gallery_items').insert(row);
      if (error) throw error;
      toast('Работа опубликована — она уже в галерее на сайте');
    }
    resetForm(); loadItems();
  } catch (err) { console.error(err); toast('Ошибка: ' + err.message, 'err'); }
  btn.disabled = false; if (!editing) btn.textContent = 'Опубликовать';
});

/* ---------- галерея: список ---------- */
let ITEMS = [];
async function loadItems() {
  const { data, error } = await sb.from('gallery_items').select('*').order('sort', { ascending: false }).order('created_at', { ascending: false });
  if (error) { $('#items').innerHTML = `<p class="muted">Ошибка загрузки: ${esc(error.message)}. Выполнили ли вы supabase/schema.sql?</p>`; return; }
  ITEMS = data;
  $('#items').innerHTML = data.length ? data.map((it) => `<div class="item${it.is_published ? '' : ' is-hidden'}">
      <img src="${esc(it.images?.[0] || '')}" alt="" loading="lazy">
      <div class="item-b"><small>${esc(catName(it.category))}${it.is_published ? '' : ' · скрыто'}</small><b>${esc(it.title)}</b><span>${esc(it.price || 'цена не указана')} · фото: ${it.images?.length || 0}</span></div>
      <div class="item-act">
        <button data-edit="${it.id}">Изменить</button>
        <button data-top="${it.id}">↑ В начало</button>
        <button data-vis="${it.id}">${it.is_published ? 'Скрыть' : 'Показать'}</button>
        <button class="del" data-del="${it.id}">Удалить</button>
      </div></div>`).join('') : '<p class="muted">Пока нет работ. Загрузите первую — она сразу появится в галерее на сайте.</p>';
  $$('[data-edit]').forEach((b) => b.onclick = () => edit(ITEMS.find((x) => x.id === b.dataset.edit)));
  $$('[data-top]').forEach((b) => b.onclick = async () => { await sb.from('gallery_items').update({ sort: Math.floor(Date.now() / 1000) }).eq('id', b.dataset.top); loadItems(); });
  $$('[data-vis]').forEach((b) => b.onclick = async () => { const it = ITEMS.find((x) => x.id === b.dataset.vis); await sb.from('gallery_items').update({ is_published: !it.is_published }).eq('id', it.id); loadItems(); });
  $$('[data-del]').forEach((b) => b.onclick = async () => {
    const it = ITEMS.find((x) => x.id === b.dataset.del);
    if (!confirm(`Удалить «${it.title}» навсегда?`)) return;
    const { error } = await sb.from('gallery_items').delete().eq('id', it.id);
    if (error) { toast(error.message, 'err'); return; }
    const paths = (it.image_paths || []).filter(Boolean); if (paths.length) await sb.storage.from('gallery').remove(paths);
    toast('Удалено'); loadItems();
  });
}
function edit(it) {
  editing = it;
  photos = (it.images || []).map((url, i) => ({ url, path: it.image_paths?.[i] }));
  renderThumbs();
  $('#iTitle').value = it.title; $('#iCat').value = it.category; $('#iPrice').value = it.price || '';
  $('#iMat').value = it.materials || ''; $('#iMech').value = it.mechanisms || ''; $('#iDim').value = it.dimensions || '';
  $('#iTime').value = it.lead_time || ''; $('#iDesc').value = it.description || ''; $('#iPub').checked = it.is_published;
  $('#formTitle').textContent = 'Редактирование'; $('#saveBtn').textContent = 'Сохранить изменения'; $('#cancelEdit').hidden = false;
  scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- заявки ---------- */
const STATUS = { new: 'Новая', in_work: 'В работе', done: 'Завершена', rejected: 'Отказ' };
const SRC = { form: 'форма', calculator: 'калькулятор', constructor: '3D-конструктор', gallery: 'галерея' };
async function loadLeads() {
  const { data, error } = await sb.from('leads').select('*').order('created_at', { ascending: false }).limit(300);
  if (error) { $('#leads').innerHTML = `<p class="muted">Ошибка: ${esc(error.message)}</p>`; return; }
  const nNew = data.filter((l) => l.status === 'new').length;
  $('#newCount').hidden = !nNew; $('#newCount').textContent = nNew;
  $('#leads').innerHTML = data.length ? data.map((l) => {
    const digits = l.phone.replace(/\D/g, '');
    return `<div class="lead${l.status === 'new' ? ' new' : ''}">
      <div><h3>${esc(l.name)} · <a href="tel:+${digits}">${esc(l.phone)}</a></h3>
        <div class="meta">${new Date(l.created_at).toLocaleString('ru-RU')} · ${esc(l.furniture || '—')} · источник: ${esc(SRC[l.source] || l.source || '—')}</div></div>
      <div class="row">
        <a class="b b--wa" href="https://wa.me/${digits}" target="_blank" rel="noopener">WhatsApp</a>
        <select data-st="${l.id}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === l.status ? ' selected' : ''}>${v}</option>`).join('')}</select>
      </div>
      ${l.message ? `<pre>${esc(l.message)}</pre>` : ''}
      ${l.project_url ? `<div class="proj"><a href="${esc(l.project_url)}" target="_blank" rel="noopener"><img src="${esc(l.project_url)}" alt="Проект клиента" loading="lazy"></a></div>` : ''}
    </div>`;
  }).join('') : '<p class="muted">Заявок пока нет.</p>';
  $$('[data-st]').forEach((s) => s.onchange = async () => {
    const { error } = await sb.from('leads').update({ status: s.value }).eq('id', s.dataset.st);
    if (error) toast(error.message, 'err'); else { toast('Статус обновлён'); loadLeads(); }
  });
}
setInterval(() => { if (!$('#panel').hidden) loadLeads(); }, 60000);

boot();
