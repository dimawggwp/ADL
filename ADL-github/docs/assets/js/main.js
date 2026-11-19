import { SITE, CATEGORIES, CALC } from './config.js';
import { sb, catName, esc, waLink, phoneMask, phoneValid, toast, submitLead } from './core.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

$('#year').textContent = new Date().getFullYear();

/* =================== ШАПКА =================== */
const hd = $('#hd');
const onScroll = () => hd.classList.toggle('is-solid', scrollY > 10);
addEventListener('scroll', onScroll, { passive: true }); onScroll();
const burger = $('#burger');
burger.addEventListener('click', () => {
  const open = document.body.classList.toggle('menu-open');
  burger.setAttribute('aria-expanded', open);
});
$$('#menu a').forEach((a) => a.addEventListener('click', () => document.body.classList.remove('menu-open')));
$$('[data-wa]').forEach((a) => { a.href = waLink(a.dataset.wa); a.target = '_blank'; a.rel = 'noopener'; });

/* =================== ПОЯВЛЕНИЕ =================== */
const io = new IntersectionObserver((es) => es.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
}), { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });
$$('.rv').forEach((el) => io.observe(el));

/* =================== ГРАФИК 14 ДНЕЙ =================== */
$('#gantt').innerHTML = Array.from({ length: 14 }, (_, i) => `<span class="${i >= 12 ? 'inst' : ''}" style="--i:${i}">${i + 1}</span>`).join('');

/* =================== ОБРАЗЦЫ МАТЕРИАЛОВ =================== */
function sample(hex, wood) {
  const c = document.createElement('canvas'); c.width = c.height = 320;
  const x = c.getContext('2d');
  let seed = parseInt(hex.slice(1), 16) % 9973 + 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  x.fillStyle = hex; x.fillRect(0, 0, 320, 320);
  if (wood) {
    for (let b = 0; b < 9; b++) { x.fillStyle = `rgba(${rnd() > .5 ? '255,245,230' : '60,30,10'},${0.03 + rnd() * 0.05})`; x.fillRect(rnd() * 320, 0, 10 + rnd() * 50, 320); }
    for (let i = 0; i < 240; i++) {
      const gx = rnd() * 340 - 10, amp = 0.4 + rnd() * 2.2, f = 0.004 + rnd() * 0.01, ph = rnd() * 6, drift = (rnd() - 0.5) * 6;
      x.strokeStyle = rnd() > 0.4 ? `rgba(45,22,6,${0.06 + rnd() * 0.16})` : `rgba(255,240,215,${0.05 + rnd() * 0.1})`;
      x.lineWidth = 0.4 + rnd() * 1.2; x.beginPath();
      for (let y = 0; y <= 320; y += 6) { const px = gx + Math.sin(y * f + ph) * amp + (y / 320) * drift; y ? x.lineTo(px, y) : x.moveTo(px, y); }
      x.stroke();
    }
  } else {
    const d = x.getImageData(0, 0, 320, 320);
    for (let i = 0; i < d.data.length; i += 4) { const n = (rnd() - 0.5) * 10; d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n; }
    x.putImageData(d, 0, 0);
  }
  return c.toDataURL('image/jpeg', 0.85);
}
const MATS = [
  ['Дуб натуральный', 'ЛДСП Egger', '#B88A5C', true], ['Орех', 'шпон', '#6A4329', true], ['Дуб сонома', 'ЛДСП Kronospan', '#CFB088', true],
  ['Кашемир', 'МДФ эмаль', '#D6CABA', false], ['Графит', 'ЛДСП Egger', '#4A4A4C', false], ['Синий ADL', 'МДФ эмаль', '#1F4467', false],
];
$('#mats').innerHTML = MATS.map(([n, t, hex, w]) => `<div class="mat"><div class="mat-c" style="background-image:url(${sample(hex, w)})"></div><b>${n}</b><small>${t}</small></div>`).join('');

/* =================== ГАЛЕРЕЯ =================== */
let track = $('#track');
let ALL = [], setWidth = 0, pos = 0, anim = null, pausedUntil = 0, hovering = false, activeCat = 'all', isAdmin = false;

async function checkAdmin() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return false;
    const { data } = await sb.rpc('is_admin');
    return !!data;
  } catch { return false; }
}

async function loadGallery() {
  try {
    const { data, error } = await sb.from('gallery_items').select('*').eq('is_published', true)
      .order('sort', { ascending: false }).order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    ALL = (data || []).filter((d) => d.images && d.images.length);
  } catch (e) { console.warn('gallery:', e.message); ALL = []; }
  renderChips(); applyFilter(activeCat);
}

function renderChips() {
  const present = new Set(ALL.map((i) => i.category));
  const cats = [{ id: 'all', name: 'Все работы' }, ...CATEGORIES.filter((c) => present.has(c.id))];
  if (!cats.find((c) => c.id === activeCat)) activeCat = 'all';
  $('#chips').innerHTML = ALL.length ? cats.map((c) => `<button class="${c.id === activeCat ? 'on' : ''}" data-cat="${c.id}">${c.name}</button>`).join('') : '';
  $$('#chips button').forEach((b) => b.addEventListener('click', () => {
    $$('#chips button').forEach((x) => x.classList.toggle('on', x === b)); applyFilter(b.dataset.cat);
  }));
  $('.arrows').hidden = !ALL.length;
}

const cardHTML = (it, i) => `<div class="card" data-id="${esc(it.id)}" role="button" aria-label="${esc(it.title)}">
  <div class="card-img"><img src="${esc(it.images[0])}" alt="${esc(it.title)} — ${esc(catName(it.category))} на заказ в Алматы" loading="${i < 8 ? 'eager' : 'lazy'}" decoding="async" draggable="false"></div>
  <div class="card-cap"><div><b>${esc(it.title)}</b><small>${esc(catName(it.category))}</small></div>${it.price ? `<i>${esc(it.price)}</i>` : ''}</div>
  ${isAdmin ? `<button class="card-del" data-del="${esc(it.id)}">Удалить</button>` : ''}
</div>`;

const empty = $('#worksEmpty');
function applyFilter(cat) {
  activeCat = cat; setWidth = 0;
  let list = cat === 'all' ? ALL : ALL.filter((i) => i.category === cat);
  if (!list.length) list = ALL;
  track.hidden = !list.length; empty.hidden = !!list.length;
  if (!list.length) return;
  const cardW = (innerWidth <= 680 ? innerWidth * 0.76 : Math.min(420, Math.max(240, innerHeight * 0.33))) + 16;
  const need = Math.ceil((innerWidth * 1.4) / cardW);
  let set = [...list];
  while (set.length < need) set = set.concat(list);
  const html = set.map(cardHTML).join('');
  track.innerHTML = html + html + html;
  requestAnimationFrame(() => {
    const cards = track.children;
    setWidth = cards[set.length].offsetLeft - cards[0].offsetLeft;
    pos = setWidth; track.scrollLeft = pos;
  });
}

function wrapPos() {
  if (!setWidth) return 0;
  let s = 0;
  if (pos < setWidth * 0.5) s = setWidth; else if (pos > setWidth * 1.5) s = -setWidth;
  if (s) { pos += s; track.scrollLeft = pos; }
  return s;
}
let programmatic = false;
track.addEventListener('scroll', () => {
  if (programmatic) { programmatic = false; return; }
  pos = track.scrollLeft;
  const s = wrapPos(); if (anim && s) { anim.from += s; anim.to += s; }
}, { passive: true });
const pause = (ms = 3000) => { pausedUntil = performance.now() + ms; };
['touchstart', 'wheel'].forEach((ev) => track.addEventListener(ev, () => { pause(); anim = null; }, { passive: true }));
track.addEventListener('mouseenter', () => { hovering = true; });
track.addEventListener('mouseleave', () => { hovering = false; });

let drag = null;
track.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('.card-del')) return;
  drag = { x: e.clientX, start: pos, moved: false, v: 0, lx: e.clientX, lt: performance.now() };
  anim = null; pause(4000);
});
addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  if (Math.abs(dx) > 5 && !drag.moved) { drag.moved = true; track.classList.add('is-drag'); }
  if (drag.moved) {
    const now = performance.now();
    drag.v = (e.clientX - drag.lx) / Math.max(1, now - drag.lt); drag.lx = e.clientX; drag.lt = now;
    pos = drag.start - dx; programmatic = true; track.scrollLeft = pos;
    const s = wrapPos(); if (s) drag.start += s;
  }
});
addEventListener('pointerup', () => {
  if (!drag) return;
  const moved = drag.moved, v = drag.v; drag = null;
  setTimeout(() => track.classList.remove('is-drag'), 0);
  if (moved && Math.abs(v) > 0.1) glide(-v * 16);
  pause(3000);
});
function glide(vel) {
  const step = () => { if (Math.abs(vel) < 0.2 || drag) return; pos += vel; vel *= 0.94; programmatic = true; track.scrollLeft = pos; wrapPos(); requestAnimationFrame(step); };
  step();
}
const cardStep = () => (track.children[0]?.offsetWidth || 300) + 16;
function slideBy(dx) { pause(4000); anim = { from: pos, to: (anim ? anim.to : pos) + dx, t0: performance.now(), dur: 650 }; }
$('#gNext').addEventListener('click', () => slideBy(cardStep()));
$('#gPrev').addEventListener('click', () => slideBy(-cardStep()));
track.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') { e.preventDefault(); slideBy(cardStep()); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); slideBy(-cardStep()); }
});
let galleryVisible = true;
new IntersectionObserver(([e]) => { galleryVisible = e.isIntersecting; }).observe($('#works'));
(function loop(now) {
  if (setWidth) {
    if (anim) {
      const k = Math.min(1, (now - anim.t0) / anim.dur), e = 1 - Math.pow(1 - k, 4);
      pos = anim.from + (anim.to - anim.from) * e; programmatic = true; track.scrollLeft = pos;
      const s = wrapPos(); if (s) { anim.from += s; anim.to += s; }
      if (k >= 1) anim = null;
    } else if (!drag && !hovering && galleryVisible && now > pausedUntil && !reduceMotion && !document.hidden) {
      pos += 0.4; programmatic = true; track.scrollLeft = pos; wrapPos();
    }
  }
  requestAnimationFrame(loop);
})(performance.now());
addEventListener('resize', (() => { let t, w = innerWidth; return () => { if (innerWidth === w) return; w = innerWidth; clearTimeout(t); t = setTimeout(() => applyFilter(activeCat), 250); }; })());

// удаление — видно только администратору (вошедшему через admin.html)
async function deleteItem(id) {
  const it = ALL.find((x) => String(x.id) === String(id));
  if (!it || !confirm(`Удалить «${it.title}» из галереи?`)) return false;
  const { error } = await sb.from('gallery_items').delete().eq('id', it.id);
  if (error) { toast('Не удалось удалить: ' + error.message, 'err'); return false; }
  const paths = (it.image_paths || []).filter(Boolean);
  if (paths.length) await sb.storage.from('gallery').remove(paths);
  ALL = ALL.filter((x) => x !== it);
  toast('Удалено из галереи');
  renderChips(); applyFilter(activeCat);
  return true;
}

/* =================== ОКНО РАБОТЫ =================== */
const modal = $('#workModal');
let current = null, lastFocus = null;
track.addEventListener('click', (e) => {
  const del = e.target.closest('.card-del');
  if (del) { e.stopPropagation(); deleteItem(del.dataset.del); return; }
  const card = e.target.closest('.card');
  if (!card || track.classList.contains('is-drag')) return;
  const it = ALL.find((x) => String(x.id) === card.dataset.id);
  if (it) openWork(it);
});
function openWork(it) {
  current = it; lastFocus = document.activeElement;
  $('#mCat').textContent = catName(it.category);
  $('#mTitle').textContent = it.title;
  $('#mPrice').innerHTML = it.price ? `${esc(it.price)}<small>Итоговая цена зависит от ваших размеров и комплектации</small>` : '<small>Стоимость рассчитаем под ваши размеры</small>';
  $('#mDesc').textContent = it.description || '';
  const spec = [['Материалы', it.materials], ['Механизмы', it.mechanisms], ['Размеры', it.dimensions], ['Срок', it.lead_time], ['Гарантия', `${SITE.warrantyYears} лет`]];
  $('#mSpec').innerHTML = spec.filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  const imgs = it.images || [];
  const show = (i) => { $('#mMain').innerHTML = `<img src="${esc(imgs[i])}" alt="${esc(it.title)}">`; $$('#mThumbs button').forEach((b, j) => b.classList.toggle('on', i === j)); };
  $('#mThumbs').innerHTML = imgs.length > 1 ? imgs.map((s, i) => `<button aria-label="Фото ${i + 1}"><img src="${esc(s)}" alt=""></button>`).join('') : '';
  $('#mThumbs').hidden = imgs.length < 2;
  $$('#mThumbs button').forEach((b, i) => b.addEventListener('click', () => show(i)));
  show(0);
  $('#mWa').href = waLink(`Здравствуйте! Интересует работа «${it.title}». Хочу узнать стоимость под мои размеры.`); $('#mWa').target = '_blank';
  $('#mDel').hidden = !isAdmin;
  modal.classList.add('is-open'); modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('.modal-x', modal).focus(), 50);
}
function closeWork() {
  modal.classList.remove('is-open'); modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  lastFocus?.focus?.({ preventScroll: true });
}
$$('[data-close]', modal).forEach((b) => b.addEventListener('click', closeWork));
addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('is-open')) closeWork(); });
$('#mDel').addEventListener('click', async () => { if (await deleteItem(current.id)) closeWork(); });
const TYPE_BY_CAT = { kitchen: 'Кухня', wardrobe: 'Шкаф-купе', dressing: 'Гардеробная', tv: 'ТВ-зона', dresser: 'Тумба / комод', hallway: 'Прихожая', kids: 'Детская' };
$('#mOrder').addEventListener('click', () => {
  closeWork();
  prefillLead(TYPE_BY_CAT[current.category] || 'Другое / несколько', `Хочу как «${current.title}» из галереи.`, 'gallery');
});

/* =================== КОНФИГУРАТОР =================== */
const st = { type: CALC.types[0].id, len: CALC.types[0].def, height: 2.6, body: CALC.body[0].id, facade: CALC.facade[0].id, fittings: CALC.fittings[0].id, top: CALC.countertops[0].id, extras: {} };
CALC.extras.forEach((x) => { st.extras[x.id] = x.qty ? x.def : false; });
const T = () => CALC.types.find((x) => x.id === st.type);
const fmtM = (v) => (+v).toFixed(2).replace(/0$/, '').replace(/\.0$/, '').replace('.', ',') + ' м';

function buildCfg() {
  const f = $('#cfgForm'), t = T();
  const radios = (name, list, cur, sub) => `<div class="opts">${list.map((o) => `<label class="opt"><input type="radio" name="${name}" value="${o.id}"${o.id === cur ? ' checked' : ''}><span>${o.name}${sub && o[sub] ? `<small>${o[sub]}</small>` : ''}</span></label>`).join('')}</div>`;
  const facades = CALC.facade.filter((x) => x.id !== 'mirror' || ['kupe', 'wardrobe', 'hallway', 'dressing'].includes(st.type));
  if (!facades.find((x) => x.id === st.facade)) st.facade = facades[0].id;
  const extras = CALC.extras.filter((x) => !x.only || x.only.includes(st.type));
  let n = 0; const num = () => String(++n).padStart(2, '0');
  f.innerHTML = `
    <div class="cg"><div class="cg-h"><b><i>${num()}</i>Что делаем</b></div>${radios('type', CALC.types, st.type)}</div>
    <div class="cg"><div class="cg-h"><b><i>${num()}</i>Длина</b><output id="oLen">${fmtM(st.len)}</output></div>
      <input class="range" type="range" id="rLen" min="${t.min}" max="${t.max}" step="0.1" value="${st.len}" aria-label="Длина">
      <div class="scale"><span>${fmtM(t.min)}</span><span>${fmtM(t.max)}</span></div>
      ${t.height ? `<div class="cg-h" style="margin-top:22px"><b>Высота</b><output id="oH">${fmtM(st.height)}</output></div>
      <input class="range" type="range" id="rH" min="2" max="3" step="0.05" value="${st.height}" aria-label="Высота">
      <div class="scale"><span>2 м</span><span>3 м, до потолка</span></div>` : ''}</div>
    <div class="cg"><div class="cg-h"><b><i>${num()}</i>Корпус</b></div>${radios('body', CALC.body, st.body)}</div>
    <div class="cg"><div class="cg-h"><b><i>${num()}</i>Фасады</b></div>${radios('facade', facades, st.facade)}</div>
    ${st.type === 'kitchen' ? `<div class="cg"><div class="cg-h"><b><i>${num()}</i>Столешница</b></div>${radios('top', CALC.countertops, st.top)}</div>` : ''}
    <div class="cg"><div class="cg-h"><b><i>${num()}</i>Фурнитура</b></div>${radios('fittings', CALC.fittings, st.fittings, 'note')}</div>
    <div class="cg"><div class="cg-h"><b><i>${num()}</i>Механизмы и опции</b></div><div class="extras">
      ${extras.map((x) => x.qty
        ? `<div class="extra"><span>${x.name}</span><span class="stepper"><button type="button" data-dec="${x.id}" aria-label="Меньше">−</button><output>${st.extras[x.id]}</output><button type="button" data-inc="${x.id}" aria-label="Больше">+</button></span></div>`
        : `<div class="extra"><label><input type="checkbox" data-ex="${x.id}"${st.extras[x.id] ? ' checked' : ''}><span>${x.name}</span></label></div>`).join('')}
    </div></div>`;
  $$('input[type=radio]', f).forEach((r) => r.addEventListener('change', () => {
    st[r.name] = r.value;
    if (r.name === 'type') { st.len = T().def; buildCfg(); }
    summary();
  }));
  const bindRange = (id, out, key) => {
    const r = $(id); if (!r) return;
    const p = () => r.style.setProperty('--p', ((r.value - r.min) / (r.max - r.min)) * 100 + '%'); p();
    r.addEventListener('input', () => { st[key] = +r.value; $(out).textContent = fmtM(r.value); p(); summary(); });
  };
  bindRange('#rLen', '#oLen', 'len'); bindRange('#rH', '#oH', 'height');
  $$('[data-ex]', f).forEach((c) => c.addEventListener('change', () => { st.extras[c.dataset.ex] = c.checked; summary(); }));
  $$('[data-inc],[data-dec]', f).forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.inc || b.dataset.dec, x = CALC.extras.find((e) => e.id === id);
    st.extras[id] = Math.max(0, Math.min(x.max, st.extras[id] + (b.dataset.inc ? 1 : -1)));
    b.parentElement.querySelector('output').textContent = st.extras[id]; summary();
  }));
}

let cfgData = null;
function summary() {
  const t = T();
  const body = CALC.body.find((x) => x.id === st.body), fac = CALC.facade.find((x) => x.id === st.facade);
  const fit = CALC.fittings.find((x) => x.id === st.fittings), top = CALC.countertops.find((x) => x.id === st.top);
  const ex = CALC.extras.filter((x) => (!x.only || x.only.includes(st.type)) && st.extras[x.id]).map((x) => x.qty ? `${x.name} × ${st.extras[x.id]}` : x.name);
  const score = body.k * fac.k * fit.k * (st.type === 'kitchen' ? top.k : 1) * (1 + ex.length * 0.03);
  const ci = CALC.classes.findIndex((c) => score <= c.max), cls = CALC.classes[ci];
  $$('#cfgMeter i').forEach((el, i) => el.classList.toggle('on', i <= ci));
  $('#cfgClass').textContent = cls.name; $('#cfgClassText').textContent = cls.text;
  const rows = [['Мебель', t.name], ['Размер', fmtM(st.len) + (t.height ? ' × ' + fmtM(st.height) : '')], ['Корпус', body.name], ['Фасады', fac.name]];
  if (st.type === 'kitchen') rows.push(['Столешница', top.name]);
  rows.push(['Фурнитура', fit.name], ['Опции', ex.length ? ex.join(', ') : '—']);
  $('#cfgList').innerHTML = rows.map(([k, v]) => `<li><span>${k}</span><b>${esc(v)}</b></li>`).join('');
  cfgData = { class: cls.name, rows };
}
buildCfg(); summary();

const cfgLead = $('#cfgLead');
phoneMask($('#cPhone'));
cfgLead.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#cName').value.trim(), phone = $('#cPhone').value;
  $('#cName').parentElement.classList.toggle('is-err', !name);
  $('#cPhone').parentElement.classList.toggle('is-err', !phoneValid(phone));
  if (!name || !phoneValid(phone)) { toast('Укажите имя и номер телефона', 'err'); return; }
  $('button', cfgLead).disabled = true;
  const message = `Конфигурация с сайта (класс: ${cfgData.class})\n` + cfgData.rows.map(([k, v]) => `${k}: ${v}`).join('\n') + '\nПрошу подготовить смету.';
  const res = await submitLead({ name, phone, furniture: T().name, message, source: 'calculator', details: cfgData });
  cfgLead.outerHTML = `<div class="cfg-done"><b>Спасибо, ${esc(name.split(' ')[0])}!</b><p>Менеджер подготовит смету и свяжется с вами. Срочно — <a href="tel:${SITE.phoneTel}">${SITE.phoneDisplay}</a></p>
    <a class="b b--wa b--full" href="${esc(res.link)}" target="_blank" rel="noopener"><svg><use href="#i-wa"/></svg>${res.opened ? 'Открыть WhatsApp' : 'Отправить в WhatsApp'}</a></div>`;
});

/* =================== ЗАЯВКА =================== */
let leadSource = 'form';
phoneMask($('#fPhone'));
function prefillLead(type, msg, source) {
  if (!$('#leadForm')) return;
  $('#fType').value = type; $('#fMsg').value = msg; leadSource = source;
  $('#contact').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  setTimeout(() => $('#fName').focus({ preventScroll: true }), 700);
}
$('#leadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  if ($('#fHp').value) return;
  const name = $('#fName').value.trim(), phone = $('#fPhone').value;
  $('#fName').parentElement.classList.toggle('is-err', !name);
  $('#fPhone').parentElement.classList.toggle('is-err', !phoneValid(phone));
  if (!name || !phoneValid(phone)) { toast('Укажите имя и номер телефона', 'err'); return; }
  $('button[type=submit]', form).disabled = true;
  const res = await submitLead({ name, phone, furniture: $('#fType').value, message: $('#fMsg').value.trim(), source: leadSource });
  form.outerHTML = `<div class="done"><b>Спасибо, ${esc(name.split(' ')[0])}!</b>
    <p>${res.saved ? 'Заявка принята — оператор перезвонит в ближайшее время.' : 'Отправьте заявку в WhatsApp, чтобы мы точно её получили.'}</p>
    <a class="b b--wa" href="${esc(res.link)}" target="_blank" rel="noopener"><svg><use href="#i-wa"/></svg>${res.opened ? 'Открыть WhatsApp' : 'Отправить в WhatsApp'}</a></div>`;
});

/* =================== СТАРТ =================== */
(async () => { isAdmin = await checkAdmin(); loadGallery(); })();
