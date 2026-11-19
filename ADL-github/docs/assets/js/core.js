// Общие функции: Supabase, заявки, WhatsApp, форматирование, уведомления
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SITE, SUPABASE, CATEGORIES } from './config.js';

export const sb = createClient(SUPABASE.url, SUPABASE.anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const fmt = (n) => Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ') + ' ₸';
export const round1000 = (n) => Math.round(n / 1000) * 1000;
export const catName = (id) => (CATEGORIES.find((c) => c.id === id) || {}).name || 'Мебель';
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const waLink = (text) => `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(text)}`;

// ---------- маска телефона +7 (7XX) XXX-XX-XX ----------
export function phoneMask(input) {
  const format = () => {
    let d = input.value.replace(/\D/g, '');
    if (d.startsWith('8')) d = '7' + d.slice(1);
    if (!d.startsWith('7')) d = '7' + d;
    d = d.slice(0, 11);
    let out = '+7';
    if (d.length > 1) out += ' (' + d.slice(1, 4);
    if (d.length >= 4) out += ')';
    if (d.length > 4) out += ' ' + d.slice(4, 7);
    if (d.length > 7) out += '-' + d.slice(7, 9);
    if (d.length > 9) out += '-' + d.slice(9, 11);
    input.value = out;
  };
  input.addEventListener('focus', () => { if (!input.value) input.value = '+7 ('; });
  input.addEventListener('blur', () => { if (input.value.replace(/\D/g, '').length <= 1) input.value = ''; });
  input.addEventListener('input', format);
}
export const phoneValid = (v) => v.replace(/\D/g, '').length === 11;

// ---------- уведомления ----------
export function toast(msg, type = 'ok') {
  let box = document.querySelector('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.append(box); }
  const t = document.createElement('div');
  t.className = 'toast toast--' + type;
  t.textContent = msg;
  box.append(t);
  requestAnimationFrame(() => t.classList.add('is-in'));
  setTimeout(() => { t.classList.remove('is-in'); setTimeout(() => t.remove(), 400); }, 4200);
}

// ---------- отправка заявки ----------
// lead = { name, phone, furniture, message, source, details, project_url }
export async function submitLead(lead, preWin) {
  const row = {
    name: lead.name.trim().slice(0, 120),
    phone: lead.phone.trim(),
    furniture: lead.furniture || null,
    message: lead.message ? lead.message.slice(0, 3000) : null,
    source: lead.source || 'form',
    details: lead.details || null,
    project_url: lead.project_url || null,
  };
  // окно открываем сразу (до await), иначе браузер заблокирует всплывающее окно
  const win = preWin !== undefined ? preWin : (SITE.openWhatsAppAfterLead ? window.open('about:blank', '_blank') : null);
  let saved = true;
  try {
    const { error } = await sb.from('leads').insert(row);
    if (error) throw error;
  } catch (e) {
    console.warn('Lead not saved to DB:', e);
    saved = false;
  }

  const text =
    `Здравствуйте! Заявка с сайта ${SITE.brand}\n` +
    `Имя: ${row.name}\nТелефон: ${row.phone}\n` +
    (row.furniture ? `Мебель: ${row.furniture}\n` : '') +
    (row.message ? `${row.message}\n` : '') +
    (row.project_url ? `Мой проект: ${row.project_url}\n` : '');

  const link = waLink(text);
  if (win) win.location.href = link;
  // если база недоступна и окно не открыто — показываем кнопку WhatsApp в интерфейсе
  return { saved, text, link, opened: !!win };
}

// ---------- сжатие фото перед загрузкой ----------
export function compressImage(file, maxSide = 2000, quality = 0.86) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('compress failed'))), 'image/jpeg', quality);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
