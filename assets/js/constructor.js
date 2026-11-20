// =====================================================================
//  ADL · 3D-примерка мебели по фото комнаты
// =====================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { SITE } from './config.js';
import { sb, esc, phoneMask, phoneValid, toast, submitLead, compressImage } from './core.js';
import { readFocal35, fovFromFocal, imageToBase64, analyzeRoom, cleanPhoto, obstaclesToWorld, lightFromAI, OBSTACLE_NAMES } from './room-ai.js';
import { solveWall, detectWall, photoTone, project } from './wall-fit.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const deg = THREE.MathUtils.degToRad;
const uid = () => Math.random().toString(36).slice(2, 9);

/* ===================== ЦВЕТА И МАТЕРИАЛЫ ===================== */
// cat → коэффициент цены: ldsp 1 · enamel (МДФ эмаль) 1.5 · acryl 1.4 · mirror 1.15
const COLORS = [
  { id: 'white',     name: 'Белый матовый',     hex: '#F1EFEB', cat: 'ldsp' },
  { id: 'cashmere',  name: 'Кашемир',           hex: '#D8CCBC', cat: 'ldsp' },
  { id: 'greige',    name: 'Грейдж',            hex: '#B3A797', cat: 'ldsp' },
  { id: 'graphite',  name: 'Графит',            hex: '#4A4B4E', cat: 'ldsp' },
  { id: 'black',     name: 'Чёрный матовый',    hex: '#232323', cat: 'ldsp' },
  { id: 'sonoma',    name: 'Дуб сонома',        hex: '#D2B286', cat: 'ldsp', wood: true },
  { id: 'oak',       name: 'Дуб натуральный',   hex: '#C1925F', cat: 'ldsp', wood: true },
  { id: 'walnut',    name: 'Орех',              hex: '#6E4529', cat: 'ldsp', wood: true },
  { id: 'wenge',     name: 'Венге',             hex: '#3A281D', cat: 'ldsp', wood: true },
  { id: 'navy',      name: 'Синий ADL (эмаль)', hex: '#1F4467', cat: 'enamel' },
  { id: 'sage',      name: 'Шалфей (эмаль)',    hex: '#8C9A84', cat: 'enamel' },
  { id: 'terracotta',name: 'Терракота (эмаль)', hex: '#B0633F', cat: 'enamel' },
  { id: 'gloss',     name: 'Белый глянец (акрил)', hex: '#F8F8F6', cat: 'acryl', gloss: true },
  { id: 'mirror',    name: 'Зеркало',           hex: '#DDE4E8', cat: 'mirror', mirror: true },
];
const BODY_COLORS = COLORS.filter((c) => c.cat === 'ldsp');
const CAT_K = { ldsp: 1, enamel: 1.5, acryl: 1.4, mirror: 1.15 };
const HANDLES = [{ id: 'bar', name: 'Скоба' }, { id: 'knob', name: 'Кнопка' }, { id: 'profile', name: 'Профиль' }, { id: 'none', name: 'Без ручек' }];
const HANDLE_COLORS = [{ id: 'black', name: 'Чёрный', hex: '#1d1d1d' }, { id: 'gold', name: 'Золото', hex: '#C8A064' }, { id: 'chrome', name: 'Хром', hex: '#CDD2D6' }];
const TOPS = [
  { id: 'stoneW', name: 'Камень белый', hex: '#ECEAE6', perM: 120000 },
  { id: 'stoneB', name: 'Камень чёрный', hex: '#262626', perM: 120000 },
  { id: 'oak',    name: 'Дуб (ЛДСП)',    hex: '#C1925F', perM: 22000, wood: true },
  { id: 'concrete', name: 'Бетон (компакт)', hex: '#9C9893', perM: 75000 },
];
const FLOORS = [{ id: 'oak', name: 'Дуб', hex: '#B98D62' }, { id: 'light', name: 'Светлый дуб', hex: '#D8BC95' }, { id: 'walnut', name: 'Орех', hex: '#6E4A33' }, { id: 'tile', name: 'Плитка', hex: '#CFCBC4' }];
const WALLS = ['#ECE7DF', '#F6F4F0', '#DCD3C6', '#C9D0C8', '#BFC7CF', '#3E3A37'];

/* ===================== МОДУЛИ ===================== */
const ICON = {
  wardrobe: '<svg viewBox="0 0 44 38"><g fill="none" stroke="currentColor" stroke-width="1.6"><rect x="10" y="2" width="24" height="33" rx="1"/><path d="M22 2v33M19 16v6M25 16v6M12 35v2M32 35v2"/></g></svg>',
  kupe: '<svg viewBox="0 0 44 38"><g fill="none" stroke="currentColor" stroke-width="1.6"><rect x="6" y="2" width="32" height="34" rx="1"/><path d="M6 5h32M20 5v31M24 5v31"/><path d="M27 10l6 6M27 16l6 6" opacity=".6"/></g></svg>',
  tall: '<svg viewBox="0 0 44 38"><g fill="none" stroke="currentColor" stroke-width="1.6"><rect x="14" y="2" width="16" height="34" rx="1"/><path d="M14 22h16M27 24v5M27 15v5"/></g></svg>',
  dresser: '<svg viewBox="0 0 44 38"><g fill="none" stroke="currentColor" stroke-width="1.6"><rect x="6" y="12" width="32" height="21" rx="1"/><path d="M6 19h32M6 26h32M19 15.5h6M19 22.5h6M19 29.5h6M9 33v3M35 33v3"/></g></svg>',
  tv: '<svg viewBox="0 0 44 38"><g fill="none" stroke="currentColor" stroke-width="1.6"><rect x="10" y="4" width="24" height="14" rx="1"/><rect x="4" y="26" width="36" height="7" rx="1"/><path d="M16 29.5h4M24 29.5h4"/></g></svg>',
  base: '<svg viewBox="0 0 44 38"><g fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 10h36"/><rect x="6" y="12" width="32" height="22" rx="1"/><path d="M22 12v22M19 15v5M25 15v5M6 34v2h32v-2"/></g></svg>',
  upper: '<svg viewBox="0 0 44 38"><g fill="none" stroke="currentColor" stroke-width="1.6"><rect x="6" y="4" width="32" height="18" rx="1"/><path d="M22 4v18M19 17v3M25 17v3"/><path d="M4 32h36" opacity=".4"/></g></svg>',
  shelf: '<svg viewBox="0 0 44 38"><g fill="none" stroke="currentColor" stroke-width="1.6"><rect x="10" y="2" width="24" height="34" rx="1"/><path d="M10 11h24M10 19h24M10 27h24"/></g></svg>',
};
const DEFS = {
  wardrobe: { name: 'Распашной шкаф', sub: 'одежда, спальня', level: 'floor', d: { w: 1.6, h: 2.4, d: 0.6, elev: 0 }, lim: { w: [0.4, 6.0], h: [1.6, 3.4], d: [0.35, 0.7] }, refH: 2.4, opt: { handle: 'bar' } },
  kupe:     { name: 'Шкаф-купе', sub: 'раздвижные двери', level: 'floor', d: { w: 2.0, h: 2.4, d: 0.62, elev: 0 }, lim: { w: [1.0, 6.0], h: [1.8, 3.4], d: [0.45, 0.7] }, refH: 2.4, opt: { mirror: true, handle: 'none' } },
  tall:     { name: 'Пенал / колонна', sub: 'для кухни и ванной', level: 'floor', d: { w: 0.6, h: 2.1, d: 0.58, elev: 0 }, lim: { w: [0.3, 1.2], h: [1.6, 2.8], d: [0.3, 0.65] }, refH: 2.1, opt: { handle: 'bar' } },
  dresser:  { name: 'Комод / тумба', sub: 'ящики', level: 'floor', d: { w: 1.2, h: 0.85, d: 0.45, elev: 0 }, lim: { w: [0.4, 2.4], h: [0.4, 1.3], d: [0.3, 0.6] }, refH: 0.85, opt: { handle: 'bar', legs: true } },
  tv:       { name: 'ТВ-зона', sub: 'тумба + панель', level: 'floor', d: { w: 1.8, h: 0.4, d: 0.42, elev: 0.22 }, lim: { w: [1.0, 3.6], h: [0.3, 0.6], d: [0.3, 0.5], elev: [0, 0.6] }, refH: 0.4, opt: { handle: 'none', panel: true, tv: true } },
  base:     { name: 'Кухня: нижний', sub: 'столешница 85 см', level: 'floor', d: { w: 0.6, h: 0.86, d: 0.6, elev: 0 }, lim: { w: [0.3, 1.2], h: [0.8, 0.95], d: [0.5, 0.7] }, refH: 0.86, opt: { handle: 'bar', front: 'doors', insert: 'none', top: 'stoneW' } },
  upper:    { name: 'Кухня: верхний', sub: 'навесной шкаф', level: 'wall', d: { w: 0.6, h: 0.72, d: 0.32, elev: 1.45 }, lim: { w: [0.3, 1.2], h: [0.35, 1.0], d: [0.28, 0.4], elev: [1.2, 2.0] }, refH: 0.72, opt: { handle: 'bar', front: 'doors' } },
  shelf:    { name: 'Стеллаж', sub: 'открытые полки', level: 'floor', d: { w: 0.8, h: 1.8, d: 0.35, elev: 0 }, lim: { w: [0.4, 2.0], h: [0.6, 2.8], d: [0.25, 0.5] }, refH: 1.8, opt: {} },
};

/* ===================== СОСТОЯНИЕ ===================== */
const S = {
  mode: 'photo', photo: null,
  room: { W: 4, D: 4.5, H: 2.7, wall: WALLS[0], floor: 'oak' },
  cam: { h: 1.4, pitch: -5, fov: 58, yaw: 0, roll: 0, x: 0, light: 1 },
  fit: null,     // разметка углов стены: { pts, H, Hsure, Wm, ceilHidden, errCm, quality }
  guides: true,
  ai: null,      // результат ИИ-анализа фото
  focal: null,   // фокусное расстояние из EXIF
  mods: [],
};
let sel = null; // id выбранного модуля

function newMod(type, extra = {}) {
  const def = DEFS[type];
  return {
    id: uid(), type, x: 0, z: 0, rot: 0, ...def.d,
    facade: type === 'shelf' ? 'oak' : 'cashmere', body: type === 'tv' ? 'walnut' : 'white',
    hcolor: 'black', ...structuredClone(def.opt), ...extra,
  };
}

/* ===================== THREE.JS ===================== */
const canvas = $('#gl');
const stage = $('#stage');
const wrapEl = $('#stageWrap');
const photoEl = $('#photo');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const hemi = new THREE.HemisphereLight(0xfff6ec, 0x7a6550, 0.38);
const sun = new THREE.DirectionalLight(0xffeedb, 2.1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 5;
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 20 });
scene.add(hemi, sun, sun.target);

const camPhoto = new THREE.PerspectiveCamera(58, 1, 0.05, 50);
camPhoto.rotation.order = 'YXZ';
const cam3d = new THREE.PerspectiveCamera(50, 1, 0.05, 60);
const controls = new OrbitControls(cam3d, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 0.8; controls.maxDistance = 14;
controls.enabled = false;
const activeCam = () => (S.mode === 'photo' ? camPhoto : cam3d);

/* ---------- процедурные текстуры дерева ---------- */
const texCache = new Map();
function shade(hex, k) {
  const c = new THREE.Color(hex); const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, clamp(hsl.l * k, 0, 1)); return '#' + c.getHexString();
}
function woodTexture(hex, planks = false) {
  const key = hex + planks;
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const x = c.getContext('2d');
  let seed = parseInt(hex.slice(1), 16) % 9973 + 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const drawGrain = (x0, w) => {
    x.fillStyle = shade(hex, 0.92 + rnd() * 0.16); x.fillRect(x0, 0, w, 1024);
    for (let i = 0; i < w / 3; i++) {
      const gx = x0 + rnd() * w, amp = 2 + rnd() * 10, f = 0.004 + rnd() * 0.01, ph = rnd() * 6;
      x.strokeStyle = rnd() > 0.5 ? shade(hex, 0.78 + rnd() * 0.1) : shade(hex, 1.08 + rnd() * 0.08);
      x.globalAlpha = 0.18 + rnd() * 0.3; x.lineWidth = 0.6 + rnd() * 1.8;
      x.beginPath();
      for (let y = 0; y <= 1024; y += 16) {
        const px = gx + Math.sin(y * f + ph) * amp;
        y === 0 ? x.moveTo(px, y) : x.lineTo(px, y);
      }
      x.stroke();
    }
    x.globalAlpha = 1;
  };
  if (planks) {
    const pw = 128;
    for (let i = 0; i < 8; i++) {
      drawGrain(i * pw, pw);
      x.fillStyle = 'rgba(0,0,0,.28)'; x.fillRect(i * pw, 0, 2, 1024);
      const cut = rnd() * 1024; x.fillRect(i * pw, cut, pw, 2);
    }
  } else drawGrain(0, 1024);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  texCache.set(key, t);
  return t;
}
function tileTexture(hex) {
  const key = 'tile' + hex; if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d');
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { x.fillStyle = shade(hex, 0.96 + Math.random() * 0.08); x.fillRect(i * 256, j * 256, 256, 256); }
  x.strokeStyle = shade(hex, 0.75); x.lineWidth = 4; x.strokeRect(0, 0, 512, 512); x.beginPath(); x.moveTo(256, 0); x.lineTo(256, 512); x.moveTo(0, 256); x.lineTo(512, 256); x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; texCache.set(key, t); return t;
}

const matCache = new Map();
function colorMat(id) {
  const key = 'c:' + id; if (matCache.has(key)) return matCache.get(key);
  const c = COLORS.find((x) => x.id === id) || COLORS[0];
  let m;
  if (c.mirror) m = new THREE.MeshStandardMaterial({ color: 0xdfe7ea, metalness: 0.85, roughness: 0.1, envMapIntensity: 1.7 });
  else if (c.gloss) m = new THREE.MeshPhysicalMaterial({ color: c.hex, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 0.9 });
  else if (c.wood) m = new THREE.MeshStandardMaterial({ map: woodTexture(c.hex), roughness: 0.6, envMapIntensity: 0.5 });
  else m = new THREE.MeshStandardMaterial({ color: c.hex, roughness: c.cat === 'enamel' ? 0.45 : 0.62, envMapIntensity: 0.5 });
  matCache.set(key, m); return m;
}
function handleMat(id) {
  const key = 'h:' + id; if (matCache.has(key)) return matCache.get(key);
  const h = HANDLE_COLORS.find((x) => x.id === id) || HANDLE_COLORS[0];
  const m = new THREE.MeshStandardMaterial({ color: h.hex, metalness: id === 'black' ? 0.5 : 1, roughness: id === 'chrome' ? 0.15 : 0.32 });
  matCache.set(key, m); return m;
}
function topMat(id) {
  const key = 't:' + id; if (matCache.has(key)) return matCache.get(key);
  const t = TOPS.find((x) => x.id === id) || TOPS[0];
  const m = t.wood ? new THREE.MeshStandardMaterial({ map: woodTexture(t.hex), roughness: 0.55 })
    : new THREE.MeshStandardMaterial({ color: t.hex, roughness: t.id === 'concrete' ? 0.85 : 0.22, envMapIntensity: 0.8 });
  matCache.set(key, m); return m;
}
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.8 });
const steelMat = new THREE.MeshStandardMaterial({ color: 0xc9ced2, metalness: 1, roughness: 0.25 });
const glassBlack = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, metalness: 0.4, roughness: 0.08 });
const screenMat = new THREE.MeshStandardMaterial({ color: 0x0a0f16, metalness: 0.3, roughness: 0.12, emissive: 0x0b1a2a, emissiveIntensity: 0.6 });

/* ---------- построение мебели ---------- */
const T = 0.018; // толщина ЛДСП
function box(g, w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.001), Math.max(h, 0.001), Math.max(d, 0.001)), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
}
function carcass(g, w, h, d, body, y0 = 0) {
  const ih = h - y0;
  box(g, T, ih, d, body, -w / 2 + T / 2, y0 + ih / 2, 0);
  box(g, T, ih, d, body, w / 2 - T / 2, y0 + ih / 2, 0);
  box(g, w - 2 * T, T, d, body, 0, h - T / 2, 0);
  box(g, w - 2 * T, T, d, body, 0, y0 + T / 2, 0);
  box(g, w - 2 * T, ih - 2 * T, 0.004, body, 0, y0 + ih / 2, -d / 2 + 0.002);
  if (y0 > 0.02) box(g, w - 0.03, y0, 0.016, darkMat, 0, y0 / 2, d / 2 - 0.05);
}
function handle(g, m, x, y, z, vertical, len = 0.16) {
  const hm = handleMat(m.hcolor);
  if (m.handle === 'bar') {
    const L = vertical ? Math.max(len, 0.16) : len;
    box(g, vertical ? 0.012 : L, vertical ? L : 0.012, 0.012, hm, x, y, z + 0.03);
    [-1, 1].forEach((s) => box(g, 0.008, 0.008, 0.026, hm, x + (vertical ? 0 : s * L * 0.42), y + (vertical ? s * L * 0.42 : 0), z + 0.013));
  } else if (m.handle === 'knob') {
    const k = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.011, 0.028, 20), hm);
    k.rotation.x = Math.PI / 2; k.position.set(x, y, z + 0.014); k.castShadow = true; g.add(k);
  }
}
function door(g, m, x, y, w, h, z, mat, hpos) {
  box(g, w, h, T, mat, x, y, z + T / 2);
  if (!hpos) return;
  if (m.handle === 'profile') box(g, w * 0.96, 0.014, 0.022, handleMat(m.hcolor), x, hpos.top ? y + h / 2 - 0.007 : y - h / 2 + 0.007, z + T + 0.008);
  else handle(g, m, x + (hpos.dx || 0), y + (hpos.dy || 0), z + T, hpos.v, hpos.len);
}

const BUILD = {
  wardrobe(g, m) {
    const fac = colorMat(m.facade), body = colorMat(m.body), pl = 0.08, gap = 0.003;
    carcass(g, m.w, m.h, m.d, body, pl);
    const n = Math.max(1, Math.round(m.w / 0.5)), dw = (m.w - gap * (n + 1)) / n;
    const split = m.h > 2.35 ? m.h - 0.45 : null;
    for (let i = 0; i < n; i++) {
      const x = -m.w / 2 + gap + dw / 2 + i * (dw + gap);
      const left = (i % 2 === 1) || (n % 2 === 1 && i === n - 1 && n > 1);
      const hx = left ? -dw / 2 + 0.045 : dw / 2 - 0.045;
      const lowTop = split ?? m.h - gap; const lh = lowTop - pl - gap;
      door(g, m, x, pl + lh / 2, dw, lh, m.d / 2, fac, { dx: hx, dy: clamp(1.05 - (pl + lh / 2), -lh / 2 + 0.2, lh / 2 - 0.2), v: true, len: 0.3, top: true });
      if (split) { const uh = m.h - split - 2 * gap; door(g, m, x, split + gap + uh / 2, dw, uh, m.d / 2, fac, { dx: hx, dy: -uh / 2 + 0.07, v: false, len: 0.12 }); }
    }
  },
  kupe(g, m) {
    const fac = colorMat(m.facade), body = colorMat(m.body), hm = handleMat(m.hcolor), pl = 0.06;
    carcass(g, m.w, m.h, m.d, body, pl);
    box(g, m.w, 0.05, 0.08, hm, 0, m.h - 0.025, m.d / 2 + 0.04);
    const n = clamp(Math.round(m.w / 0.95), 2, 6), dw = m.w / n + 0.02, dh = m.h - 0.07;
    for (let i = 0; i < n; i++) {
      const x = -m.w / 2 + dw / 2 + (i * (m.w - dw)) / (n - 1);
      const z = m.d / 2 + (i % 2 ? 0.05 : 0.018);
      const isMirror = m.mirror && (n === 2 ? i === 1 : i === 1);
      box(g, dw - 0.05, dh, 0.012, isMirror ? colorMat('mirror') : fac, x, 0.01 + dh / 2, z);
      box(g, 0.026, dh, 0.03, hm, x - dw / 2 + 0.013, 0.01 + dh / 2, z);
      box(g, 0.026, dh, 0.03, hm, x + dw / 2 - 0.013, 0.01 + dh / 2, z);
      box(g, dw, 0.03, 0.02, hm, x, 0.025, z); box(g, dw, 0.03, 0.02, hm, x, dh - 0.005, z);
    }
  },
  tall(g, m) {
    const fac = colorMat(m.facade), body = colorMat(m.body), pl = 0.1, gap = 0.003;
    carcass(g, m.w, m.h, m.d, body, pl);
    const n = Math.max(1, Math.round(m.w / 0.6)), dw = (m.w - gap * (n + 1)) / n;
    const mid = Math.min(1.45, m.h * 0.65);
    for (let i = 0; i < n; i++) {
      const x = -m.w / 2 + gap + dw / 2 + i * (dw + gap), hx = (i % 2 ? -1 : 1) * (dw / 2 - 0.04);
      const lh = mid - pl - gap, uh = m.h - mid - 2 * gap;
      door(g, m, x, pl + lh / 2, dw, lh, m.d / 2, fac, { dx: hx, dy: lh / 2 - 0.16, v: true, len: 0.2, top: true });
      door(g, m, x, mid + gap + uh / 2, dw, uh, m.d / 2, fac, { dx: hx, dy: -uh / 2 + 0.14, v: true, len: 0.2 });
    }
  },
  dresser(g, m) {
    const fac = colorMat(m.facade), body = colorMat(m.body), gap = 0.003, leg = m.legs ? 0.12 : 0.06;
    carcass(g, m.w, m.legs ? m.h - leg : m.h, m.d, body, m.legs ? 0 : leg);
    if (m.legs) {
      g.children.forEach((c) => { c.position.y += leg; });
      const hm = handleMat(m.hcolor);
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.01, leg, 12), hm);
        l.position.set(sx * (m.w / 2 - 0.05), leg / 2, sz * (m.d / 2 - 0.05)); l.castShadow = true; g.add(l);
      });
    }
    const y0 = leg, hh = m.h - leg;
    const rows = hh > 0.75 ? 3 : hh > 0.5 ? 2 : 1, cols = m.w > 1.0 ? 2 : 1;
    const dw = (m.w - gap * (cols + 1)) / cols, dh = (hh - gap * (rows + 1)) / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x = -m.w / 2 + gap + dw / 2 + c * (dw + gap), y = y0 + gap + dh / 2 + r * (dh + gap);
      door(g, m, x, y, dw, dh, m.d / 2, fac, { dy: dh / 2 - 0.06, v: false, len: Math.min(0.2, dw * 0.4), top: true });
    }
  },
  tv(g, m) {
    const fac = colorMat(m.facade), body = colorMat(m.body), gap = 0.003, e = m.elev;
    if (m.panel) {
      const pw = m.w + 0.5, ph = Math.min(S.room.H - 0.05, 2.5);
      box(g, pw, ph, 0.016, body, 0, ph / 2, -m.d / 2 - 0.012);
      const n = Math.floor(pw / 0.055);
      for (let i = 1; i < n; i++) box(g, 0.022, ph, 0.012, body, -pw / 2 + i * (pw / n), ph / 2, -m.d / 2 + 0.002);
    }
    const cg = new THREE.Group(); cg.position.y = e; g.add(cg);
    carcass(cg, m.w, m.h, m.d, body, 0);
    const n = Math.max(2, Math.round(m.w / 0.6)), dw = (m.w - gap * (n + 1)) / n;
    for (let i = 0; i < n; i++) door(cg, m, -m.w / 2 + gap + dw / 2 + i * (dw + gap), m.h / 2, dw, m.h - 2 * gap, m.d / 2, fac, { dy: m.h / 2 - 0.06, v: false, len: 0.16, top: true });
    if (m.tv) {
      const sw = Math.min(m.w * 0.78, 1.45), sh = sw * 9 / 16, sy = e + m.h + 0.3 + sh / 2;
      box(g, sw, sh, 0.03, glassBlack, 0, sy, -m.d / 2 + 0.03);
      box(g, sw - 0.02, sh - 0.02, 0.002, screenMat, 0, sy, -m.d / 2 + 0.046);
    }
  },
  base(g, m) {
    const fac = colorMat(m.facade), body = colorMat(m.body), pl = 0.1, gap = 0.003, th = 0.038;
    const h = m.h - th;
    carcass(g, m.w, h, m.d - 0.02, body, pl);
    g.children.forEach((c) => { c.position.z -= 0.01; });
    box(g, m.w, th, m.d + 0.02, topMat(m.top), 0, h + th / 2, 0.01);
    const fz = m.d / 2 - 0.02 + 0.001, fh = h - pl - gap * 2;
    if (m.front === 'drawers') {
      const rows = 3, dh = (fh - gap * (rows - 1)) / rows;
      for (let r = 0; r < rows; r++) door(g, m, 0, pl + gap + dh / 2 + r * (dh + gap), m.w - 2 * gap, dh, fz, fac, { dy: dh / 2 - 0.05, v: false, len: Math.min(0.2, m.w * 0.4), top: true });
    } else {
      const n = m.w > 0.65 ? 2 : 1, dw = (m.w - gap * (n + 1)) / n;
      for (let i = 0; i < n; i++) door(g, m, -m.w / 2 + gap + dw / 2 + i * (dw + gap), pl + gap + fh / 2, dw, fh, fz, fac, { dx: (n === 2 ? (i ? -1 : 1) : 1) * (dw / 2 - 0.04), dy: fh / 2 - 0.1, v: true, len: 0.16, top: true });
    }
    if (m.insert === 'sink') {
      box(g, Math.min(0.5, m.w - 0.1), 0.004, 0.4, steelMat, 0, m.h + 0.001, 0.02);
      box(g, Math.min(0.44, m.w - 0.16), 0.006, 0.34, darkMat, 0, m.h + 0.002, 0.02);
      const f = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.3, 16), steelMat); f.position.set(0, m.h + 0.15, -m.d / 2 + 0.1); f.castShadow = true; g.add(f);
      box(g, 0.022, 0.022, 0.18, steelMat, 0, m.h + 0.29, -m.d / 2 + 0.18);
    } else if (m.insert === 'hob') {
      box(g, Math.min(0.58, m.w - 0.04), 0.006, 0.5, glassBlack, 0, m.h + 0.003, 0.01);
      [[-0.13, -0.1, 0.09], [0.13, -0.1, 0.07], [-0.13, 0.12, 0.07], [0.13, 0.12, 0.09]].forEach(([x, z, r]) => {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.004, r, 40), new THREE.MeshBasicMaterial({ color: 0x555555 }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(x, m.h + 0.0065, z + 0.01); g.add(ring);
      });
    }
  },
  upper(g, m) {
    const fac = colorMat(m.facade), body = colorMat(m.body), gap = 0.003;
    carcass(g, m.w, m.h, m.d, body, 0);
    if (m.front === 'lift') { door(g, m, 0, m.h / 2, m.w - 2 * gap, m.h - 2 * gap, m.d / 2, fac, { dy: -m.h / 2 + 0.05, v: false, len: Math.min(0.3, m.w * 0.5) }); return; }
    const n = m.w > 0.65 ? 2 : 1, dw = (m.w - gap * (n + 1)) / n;
    for (let i = 0; i < n; i++) door(g, m, -m.w / 2 + gap + dw / 2 + i * (dw + gap), m.h / 2, dw, m.h - 2 * gap, m.d / 2, fac, { dx: (n === 2 ? (i ? -1 : 1) : 1) * (dw / 2 - 0.04), dy: -m.h / 2 + 0.1, v: true, len: 0.16 });
  },
  shelf(g, m) {
    const body = colorMat(m.facade);
    carcass(g, m.w, m.h, m.d, body, 0);
    const n = Math.max(1, Math.round(m.h / 0.36) - 1);
    for (let i = 1; i <= n; i++) box(g, m.w - 2 * T, T, m.d - 0.01, body, 0, (i * m.h) / (n + 1), 0.005);
  },
};

/* ---------- объекты сцены ---------- */
const furniture = new THREE.Group(); scene.add(furniture);
const objs = new Map(); // id → group
function disposeGroup(g) { g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
function buildMod(m) {
  const old = objs.get(m.id);
  if (old) { furniture.remove(old); disposeGroup(old); }
  const g = new THREE.Group(); g.userData.id = m.id;
  BUILD[m.type](g, m);
  g.traverse((o) => { o.userData.id = m.id; });
  placeObj(g, m);
  if (m._grow) { g.userData.grow = performance.now(); delete m._grow; g.scale.y = 0.001; }
  furniture.add(g); objs.set(m.id, g);
  if (sel === m.id) updateHelper();
}
function placeObj(g, m) {
  g.position.set(m.x, m.type === 'tv' ? 0 : m.elev, m.z);
  g.rotation.y = deg(-m.rot);
}
const extents = (m) => {
  const swap = m.rot % 180 !== 0;
  const d = m.d + (m.type === 'tv' && m.panel ? 0.03 : 0) + (m.type === 'kupe' ? 0.07 : 0);
  const w = m.type === 'tv' && m.panel ? m.w + 0.5 : m.w;
  return swap ? { ex: d / 2, ez: w / 2 } : { ex: w / 2, ez: d / 2 };
};

/* ---------- комната ---------- */
const roomSolid = new THREE.Group(), photoCatch = new THREE.Group(), guides = new THREE.Group();
scene.add(roomSolid, photoCatch, guides);
let backWallMat = null, photoTex = null;
function clearGroup(gr) { while (gr.children.length) { const c = gr.children.pop(); disposeGroup(c); } }

function buildRoom() {
  const { W, D, H } = S.room;
  [roomSolid, photoCatch, guides].forEach(clearGroup);
  // пол
  const fl = FLOORS.find((f) => f.id === S.room.floor) || FLOORS[0];
  const ft = fl.id === 'tile' ? tileTexture(fl.hex).clone() : woodTexture(fl.hex, true).clone();
  ft.needsUpdate = true; ft.repeat.set(W / (fl.id === 'tile' ? 1.2 : 1.6), D / (fl.id === 'tile' ? 1.2 : 2.4));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.55, envMapIntensity: 0.4 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; roomSolid.add(floor);
  // стены
  backWallMat = new THREE.MeshStandardMaterial({ color: S.room.wall, roughness: 0.95 });
  applyWallPhoto();
  const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), backWallMat);
  back.position.set(0, H / 2, -D / 2); back.receiveShadow = true; roomSolid.add(back);
  const sideMat = new THREE.MeshStandardMaterial({ color: S.room.wall, roughness: 0.95 });
  const l = new THREE.Mesh(new THREE.PlaneGeometry(D, H), sideMat); l.rotation.y = Math.PI / 2; l.position.set(-W / 2, H / 2, 0); l.receiveShadow = true;
  const r = new THREE.Mesh(new THREE.PlaneGeometry(D, H), sideMat); r.rotation.y = -Math.PI / 2; r.position.set(W / 2, H / 2, 0); r.receiveShadow = true;
  roomSolid.add(l, r);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ color: 0xe4dfd7 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = H; roomSolid.add(ceil);
  const sk = new THREE.MeshStandardMaterial({ color: 0xf4f1ec, roughness: 0.6 });
  box(roomSolid, W, 0.08, 0.015, sk, 0, 0.04, -D / 2 + 0.0075);
  box(roomSolid, 0.015, 0.08, D, sk, -W / 2 + 0.0075, 0.04, 0);
  box(roomSolid, 0.015, 0.08, D, sk, W / 2 - 0.0075, 0.04, 0);
  // «ловцы теней» для режима фото
  const sf = new THREE.Mesh(new THREE.PlaneGeometry(W * 3, D * 3), new THREE.ShadowMaterial({ opacity: 0.38, depthWrite: false }));
  sf.rotation.x = -Math.PI / 2; sf.position.y = 0.001; sf.receiveShadow = true;
  const sb2 = new THREE.Mesh(new THREE.PlaneGeometry(W * 3, H * 2), new THREE.ShadowMaterial({ opacity: 0.22, depthWrite: false }));
  sb2.position.set(0, H, -D / 2 + 0.001); sb2.receiveShadow = true;
  photoCatch.add(sf, sb2);
  // направляющие (калибровка)
  const lm = new THREE.LineBasicMaterial({ color: 0x5aa2ff, transparent: true, opacity: 0.95 });
  const gm = new THREE.LineBasicMaterial({ color: 0x5aa2ff, transparent: true, opacity: 0.22 });
  const P = (a) => new THREE.BufferGeometry().setFromPoints(a.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  const w2 = W / 2, d2 = D / 2;
  const main = [[-w2, 0, -d2], [w2, 0, -d2], [w2, 0, -d2], [w2, H, -d2], [w2, H, -d2], [-w2, H, -d2], [-w2, H, -d2], [-w2, 0, -d2],
    [-w2, 0, -d2], [-w2, 0, d2], [w2, 0, -d2], [w2, 0, d2], [-w2, H, -d2], [-w2, H, d2], [w2, H, -d2], [w2, H, d2]];
  const grid = [];
  for (let x = -w2 + 0.5; x < w2; x += 0.5) grid.push([x, 0, -d2], [x, 0, d2]);
  for (let z = -d2 + 0.5; z < d2; z += 0.5) grid.push([-w2, 0, z], [w2, 0, z]);
  const ls = new THREE.LineSegments(P(main), lm); ls.renderOrder = 10;
  const gs = new THREE.LineSegments(P(grid), gm); gs.renderOrder = 9;
  guides.add(ls, gs);
  // зоны препятствий, найденные ИИ (окна, двери, радиаторы…)
  (S.ai?.obstacles || []).filter((o) => o.surface === 'back' && o.blocks).forEach((o) => {
    const w = Math.max(0.02, o.x1 - o.x0), h = Math.max(0.02, o.y1 - o.y0);
    const z = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xff6a55, transparent: true, opacity: 0.2, depthWrite: false }));
    z.position.set((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, -D / 2 + 0.004); z.renderOrder = 8;
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(z.geometry), new THREE.LineBasicMaterial({ color: 0xff6a55, transparent: true, opacity: 0.9 }));
    e.position.copy(z.position); e.renderOrder = 10;
    guides.add(z, e);
  });
  // свет: по фото (ИИ) или по умолчанию
  const L = S.ai?.light;
  if (L) { sun.position.set(...L.pos); sun.color.set(L.color); }
  else {
    sun.position.set(W * 0.55, H + 0.8, D * 0.45);
    const wk = S.mode === 'photo' && S.tone ? S.tone.warm : 0.3;
    sun.color.set(wk > 0.35 ? 0xffe2c2 : wk < -0.1 ? 0xe9f0ff : 0xfff0de);
  }
  sun.target.position.set(-W * 0.1, 0, -D / 2);
  applyMode();
}
function applyWallPhoto() {
  if (!backWallMat) return;
  if (S.mode === '3d' && photoTex) {
    const { W, H } = S.room, wa = W / H, img = photoTex.image, ia = img.width / img.height;
    photoTex.repeat.set(1, 1); photoTex.offset.set(0, 0);
    if (ia > wa) { photoTex.repeat.x = wa / ia; photoTex.offset.x = (1 - wa / ia) / 2; }
    else { photoTex.repeat.y = ia / wa; photoTex.offset.y = (1 - ia / wa) / 2; }
    backWallMat.map = photoTex; backWallMat.color.set(0xffffff);
  } else { backWallMat.map = null; backWallMat.color.set(S.room.wall); }
  backWallMat.needsUpdate = true;
}

/* ---------- режимы и камера ---------- */
function applyCam() {
  const c = S.cam;
  camPhoto.position.set(c.x, c.h, S.room.D / 2);
  camPhoto.rotation.set(deg(c.pitch), deg(c.yaw), deg(c.roll || 0));
  camPhoto.fov = c.fov; camPhoto.updateProjectionMatrix();
  sun.intensity = 2.1 * c.light; hemi.intensity = 0.38 * c.light;
}
function applyMode() {
  const photo = S.mode === 'photo' && !!S.photo;
  roomSolid.visible = !photo;
  photoCatch.visible = photo;
  guides.visible = photo && S.guides;
  photoEl.hidden = !photo;
  controls.enabled = S.mode === '3d';
  guides.visible = photo && S.guides && !FIT.on;
  canvas.style.visibility = FIT.on ? 'hidden' : '';
  $('#calibHint').hidden = !(photo && S.guides) || FIT.on;
  $('#calibHint').innerHTML = (S.ai?.obstacles || []).some((o) => o.blocks)
    ? '<b>Синяя рамка</b> — стена и пол. Красным — окна, двери, радиаторы'
    : '<b>Синяя рамка</b> — стена и пол, как их рассчитала программа';
  $('#btnCorners').hidden = !photo || FIT.on;
  $$('.cx-mode button').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === S.mode));
  applyWallPhoto();
  layout();
}
function reset3dCam() {
  const { W, D } = S.room;
  const far = cam3d.aspect < 1 ? 2.6 / cam3d.aspect : 1.6;
  cam3d.position.set(W * 0.18, 1.75, D / 2 + far);
  controls.target.set(0, 1.0, -D * 0.2); controls.update();
}

function layout() {
  const r = wrapEl.getBoundingClientRect();
  let aw = r.width, ah = r.height, ox = 0, oy = 0;
  if (FIT.on) { // поля вокруг фото, чтобы точки можно было вынести за край, и место под панель снизу
    const m = innerWidth <= 860 ? 20 : 44, sh = $('#fitSheet').offsetHeight;
    aw -= 2 * m; ah -= m + sh + 24; ox = m; oy = m;
  }
  let w = aw, h = ah;
  if (S.mode === 'photo' && S.photo && photoEl.naturalWidth) {
    const ia = photoEl.naturalWidth / photoEl.naturalHeight;
    if (w / h > ia) w = h * ia; else h = w / ia;
  }
  w = Math.max(40, Math.floor(w)); h = Math.max(40, Math.floor(h));
  Object.assign(stage.style, { width: w + 'px', height: h + 'px', left: ox + (aw - w) / 2 + 'px', top: oy + (ah - h) / 2 + 'px' });
  renderer.setSize(w, h, false);
  camPhoto.aspect = cam3d.aspect = w / h;
  camPhoto.updateProjectionMatrix(); cam3d.updateProjectionMatrix();
}
new ResizeObserver(layout).observe(wrapEl);

/* ---------- выделение ---------- */
const helper = new THREE.BoxHelper(undefined, 0x5aa2ff);
helper.material.depthTest = false; helper.material.transparent = true; helper.renderOrder = 11; helper.visible = false;
scene.add(helper);
function updateHelper() {
  const g = sel && objs.get(sel);
  if (g) { helper.setFromObject(g); helper.visible = true; } else helper.visible = false;
}
function select(id) {
  sel = id; updateHelper();
  showConflicts(S.mods.find((x) => x.id === id));
  $('#selTools').hidden = !id;
  $('#propsDot').classList.toggle('on', !!id);
  renderProps();
  if (id && innerWidth > 860) openTab('props');
}

/* ===================== ВЗАИМОДЕЙСТВИЕ ===================== */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
let drag = null, downAt = null;
function setNdc(e) { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, activeCam()); }
stage.addEventListener('pointerdown', (e) => {
  if (e.target !== canvas) return;
  setNdc(e); downAt = { x: e.clientX, y: e.clientY };
  const hits = ray.intersectObjects(furniture.children, true);
  if (hits.length) {
    const id = hits[0].object.userData.id; const m = S.mods.find((x) => x.id === id);
    if (sel !== id) select(id);
    if (ray.ray.intersectPlane(floorPlane, hit)) {
      drag = { m, ox: m.x - hit.x, oz: m.z - hit.z, pid: e.pointerId };
      controls.enabled = false; canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    }
  }
}, { capture: true });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) {
    if (e.pointerType === 'mouse') { setNdc(e); canvas.style.cursor = ray.intersectObjects(furniture.children, true).length ? 'grab' : ''; }
    return;
  }
  setNdc(e);
  if (!ray.ray.intersectPlane(floorPlane, hit)) return;
  moveTo(drag.m, hit.x + drag.ox, hit.z + drag.oz);
});
const endDrag = (e) => {
  if (drag) { drag = null; S.autoKind = null; controls.enabled = S.mode === '3d'; canvas.style.cursor = ''; save(); }
  else if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 5) {
    setNdc(e); if (!ray.intersectObjects(furniture.children, true).length) select(null);
  }
  downAt = null;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', () => { drag = null; controls.enabled = S.mode === '3d'; });

// зазор от стены из-за плинтуса (только для мебели, стоящей на полу)
const wallGap = (m) => (S.ai?.bb && DEFS[m.type].level === 'floor' && !(m.type === 'tv' && m.elev > 0.1) ? S.ai.bb : 0);
// вертикальный диапазон модуля
const vRange = (m) => (m.type === 'tv' ? [0, m.panel ? 2.5 : m.elev + m.h] : [m.elev, m.elev + m.h]);
// интервалы по задней стене, занятые препятствиями, которые мешают этому модулю
function blockedX(m) {
  const [y0, y1] = vRange(m);
  return (S.ai?.obstacles || []).filter((o) => o.surface === 'back' && o.blocks && o.y0 < y1 - 0.02 && o.y1 > y0 + 0.02)
    .map((o) => ({ a: o.x0 - o.margin, b: o.x1 + o.margin, o }));
}
function conflicts(m) {
  const { D } = S.room, { ex, ez } = extents(m);
  if (m.rot % 180 !== 0 || m.z - ez > -D / 2 + 0.35) return [];
  return blockedX(m).filter(({ a, b }) => m.x + ex > a && m.x - ex < b).map(({ o }) => o.label || OBSTACLE_NAMES[o.type]);
}
function moveTo(m, x, z) {
  const { W, D } = S.room, { ex, ez } = extents(m), SN = 0.12, zMin = -D / 2 + ez + wallGap(m);
  x = clamp(x, -W / 2 + ex, W / 2 - ex); z = clamp(z, zMin, D / 2 - ez);
  if (z < zMin + SN) z = zMin;                         // к задней стене (с учётом плинтуса)
  if (x < -W / 2 + ex + SN) x = -W / 2 + ex;          // к левой
  if (x > W / 2 - ex - SN) x = W / 2 - ex;            // к правой
  const lvl = DEFS[m.type].level;
  for (const o of S.mods) {                            // примыкание к соседям
    if (o.id === m.id || DEFS[o.type].level !== lvl) continue;
    const oe = extents(o);
    if (Math.abs(z - o.z) < 0.35) {
      if (Math.abs((x - ex) - (o.x + oe.ex)) < 0.08) x = o.x + oe.ex + ex;
      else if (Math.abs((x + ex) - (o.x - oe.ex)) < 0.08) x = o.x - oe.ex - ex;
    }
  }
  m.x = x; m.z = z;
  placeObj(objs.get(m.id), m); updateHelper();
  if (m.id === sel) showConflicts(m);
}
function showConflicts(m) {
  const c = m ? conflicts(m) : [];
  helper.material.color.set(c.length ? 0xff5a45 : 0x5aa2ff);
  const el = $('#aiWarn');
  el.hidden = !c.length;
  if (c.length) el.textContent = `Перекрывает: ${[...new Set(c)].join(', ')}`;
}
// свободные промежутки вдоль задней стены для модуля m (с учётом соседей и препятствий)
function wallGaps(m) {
  const { W } = S.room, lvl = DEFS[m.type].level;
  const ints = S.mods.filter((o) => o.id !== m.id && DEFS[o.type].level === lvl && o.rot % 180 === 0)
    .map((o) => [o.x - extents(o).ex, o.x + extents(o).ex]).concat(blockedX(m).map(({ a, b }) => [a, b]))
    .map(([a, b]) => [Math.max(a, -W / 2), Math.min(b, W / 2)]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const gaps = []; let cur = -W / 2;
  ints.forEach(([a, b]) => { if (a > cur + 1e-3) gaps.push([cur, a]); cur = Math.max(cur, b); });
  if (cur < W / 2 - 1e-3) gaps.push([cur, W / 2]);
  return gaps;
}
// поставить модуль к стене; если он не помещается — сузить до самого большого свободного места
function placeSmart(m) {
  const s = freeSpot(m);
  if (s.fit) { m.x = s.x; m.z = s.z; return true; }
  const L = DEFS[m.type].lim, big = wallGaps(m).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
  if (big && big[1] - big[0] >= L.w[0] && m.rot % 180 === 0) {
    m.w = Math.round(Math.min(m.w, big[1] - big[0] - 0.004) * 100) / 100;
    m.x = (big[0] + big[1]) / 2; m.z = -S.room.D / 2 + extents(m).ez + wallGap(m);
    return true;
  }
  m.x = s.x; m.z = -S.room.D / 2 + extents(m).ez + wallGap(m);
  return false;
}
function freeSpot(m) {
  const { W, D } = S.room, { ex, ez } = extents(m), lvl = DEFS[m.type].level;
  const z = -D / 2 + ez + wallGap(m);
  const taken = S.mods.filter((o) => o.id !== m.id && DEFS[o.type].level === lvl && Math.abs(o.z - z) < 0.5).map((o) => [o.x - extents(o).ex, o.x + extents(o).ex])
    .concat(m.rot % 180 === 0 ? blockedX(m).map(({ a, b }) => [a, b]) : []);
  const cands = [0];
  taken.forEach(([a, b]) => { cands.push(b + ex, a - ex); });
  cands.sort((p, q) => Math.abs(p) - Math.abs(q));
  for (const x of cands) {
    if (x - ex < -W / 2 - 1e-6 || x + ex > W / 2 + 1e-6) continue;
    if (!taken.some(([a, b]) => x + ex > a + 0.001 && x - ex < b - 0.001)) return { x, z, fit: true };
  }
  return { x: 0, z, fit: false };
}

function addMod(type, extra) {
  const m = newMod(type, extra); S.autoKind = null;
  placeSmart(m);
  S.mods.push(m); buildMod(m); select(m.id); refresh(); hideQuick(); setStep(S.photo || S.mode === '3d' ? 3 : 1);
  if (innerWidth <= 860) { toast(`${DEFS[type].name}: перетащите на место`); $('#panel').classList.add('is-collapsed'); }
  return m;
}
// «Вписать в нишу»: занять свободный промежуток у задней стены и, для шкафов, высоту до потолка
function fitNiche(m, quiet = false) {
  const { W, H } = S.room, L = DEFS[m.type].lim, lvl = DEFS[m.type].level;
  if (m.rot % 180 !== 0) { m.rot = 0; }
  const gaps = wallGaps(m);
  const fit = gaps.filter(([a, b]) => b - a >= L.w[0]);
  if (!fit.length) { if (!quiet) toast('Здесь не хватает свободного места', 'err'); return false; }
  const g = fit.find(([a, b]) => m.x >= a && m.x <= b) || fit.sort((p, q) => Math.abs((p[0] + p[1]) / 2 - m.x) - Math.abs((q[0] + q[1]) / 2 - m.x))[0];
  m.w = Math.round(Math.min(L.w[1], g[1] - g[0] - 0.004) * 100) / 100;
  if (['wardrobe', 'kupe', 'tall', 'shelf'].includes(m.type)) m.h = Math.round(Math.min(L.h[1], H - 0.03) * 100) / 100;
  const half = extents(m).ex;
  m.x = clamp(m.x, g[0] + half, g[1] - half);
  buildMod(m); moveTo(m, m.x, -99); renderProps(); refresh();
  if (!quiet) toast(`Вписано: ${Math.round(m.w * 100)} × ${Math.round(m.h * 100)} см`);
  return true;
}
function removeSel() {
  if (!sel) return;
  const g = objs.get(sel); furniture.remove(g); disposeGroup(g); objs.delete(sel);
  S.mods = S.mods.filter((m) => m.id !== sel); select(null); refresh();
}
function rotateSel() {
  const m = S.mods.find((x) => x.id === sel); if (!m) return;
  m.rot = (m.rot + 90) % 360; placeObj(objs.get(m.id), m); moveTo(m, m.x, m.z); refresh();
}
function copySel() {
  const m = S.mods.find((x) => x.id === sel); if (!m) return;
  const c = { ...structuredClone(m), id: uid() };
  const s = freeSpot(c); c.x = s.x; c.z = s.z;
  S.mods.push(c); buildMod(c); select(c.id); refresh();
}
$('#tRotate').addEventListener('click', rotateSel);
$('#tCopy').addEventListener('click', copySel);
$('#tDelete').addEventListener('click', removeSel);
addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); removeSel(); }
  if ((e.key === 'r' || e.key === 'к') && sel) rotateSel();
  if (e.key === 'Escape') select(null);
});

/* ===================== СВОДКА ===================== */
const dimsText = (m) => `${Math.round(m.w * 100)} × ${Math.round(m.h * 100)} × ${Math.round(m.d * 100)} см`;
function refresh() {
  const n = S.mods.length;
  $('#totalCount').textContent = n ? 'Смету подготовит менеджер' : 'Добавьте мебель из каталога';
  $('#totalSum').textContent = n ? `${n} ${plural(n, ['модуль', 'модуля', 'модулей'])}` : '—';
  if (sel) { const m = S.mods.find((x) => x.id === sel); const el = $('#selPrice'); if (m && el) el.textContent = dimsText(m); }
  save();
}
const plural = (n, f) => f[(n % 10 === 1 && n % 100 !== 11) ? 0 : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 1 : 2];

/* ===================== ПАНЕЛИ ===================== */
function openTab(name) {
  $$('.cx-tabs button').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
  $$('.cx-tab').forEach((p) => p.classList.toggle('is-active', p.dataset.pane === name));
  $('#panel').classList.remove('is-collapsed');
  if (name === 'room') renderRoom();
}
$$('.cx-tabs button').forEach((b) => b.addEventListener('click', () => {
  const p = $('#panel');
  if (innerWidth <= 860 && b.classList.contains('is-active')) { p.classList.toggle('is-collapsed'); return; }
  openTab(b.dataset.tab);
}));

$('#catalog').innerHTML = Object.entries(DEFS).map(([k, d]) => `<button class="cx-item" data-add="${k}">${ICON[k]}<b>${d.name}</b><small>${d.sub}</small></button>`).join('');
$$('[data-add]').forEach((b) => b.addEventListener('click', () => addMod(b.dataset.add)));

const PRESETS = [
  { name: 'Кухня 3 метра', sub: 'нижние + верхние модули, пенал', build() {
    const W = Math.min(3, S.room.W), fac = 'cashmere';
    const tall = newMod('tall', { facade: fac }); tall.x = -W / 2 + 0.3; tall.z = -S.room.D / 2 + tall.d / 2;
    const items = [tall]; let x = -W / 2 + 0.6;
    const ins = ['none', 'sink', 'none', 'hob', 'none'];
    for (let i = 0; i < 4; i++) {
      const b = newMod('base', { facade: fac, insert: ins[i], front: i === 2 ? 'drawers' : 'doors' }); b.x = x + 0.3; b.z = -S.room.D / 2 + b.d / 2 + 0.01;
      const u = newMod('upper', { facade: fac, front: i === 3 ? 'lift' : 'doors' }); u.x = x + 0.3; u.z = -S.room.D / 2 + u.d / 2;
      items.push(b, u); x += 0.6;
    }
    return items;
  } },
  { name: 'Гостиная с ТВ-зоной', sub: 'панель орех + тумба + стеллажи', build() {
    const z = (m) => -S.room.D / 2 + extents(m).ez;
    const tv = newMod('tv', { facade: 'white', body: 'walnut' }); tv.x = 0; tv.z = z(tv);
    const s1 = newMod('shelf', { facade: 'walnut', w: 0.6, h: 2.0 }); s1.x = -(1.15 + 0.3); s1.z = z(s1);
    const s2 = newMod('shelf', { facade: 'walnut', w: 0.6, h: 2.0 }); s2.x = 1.15 + 0.3; s2.z = z(s2);
    return [tv, s1, s2];
  } },
  { name: 'Спальня', sub: 'шкаф-купе с зеркалом + комод', build() {
    const k = newMod('kupe', { facade: 'oak', w: 2.2 }); k.x = -S.room.W / 2 + 1.1; k.z = -S.room.D / 2 + extents(k).ez;
    const d = newMod('dresser', { facade: 'navy', hcolor: 'gold' }); d.x = Math.min(S.room.W / 2 - 0.6, 1.0); d.z = -S.room.D / 2 + d.d / 2;
    return [k, d];
  } },
];
$('#presets').innerHTML = PRESETS.map((p, i) => `<button data-preset="${i}"><span>${p.name}<small>${p.sub}</small></span><span>→</span></button>`).join('');
$$('[data-preset]').forEach((b) => b.addEventListener('click', () => {
  if (S.mods.length && !confirm('Заменить текущую мебель готовым набором?')) return;
  clearMods(); hideQuick();
  S.mods = PRESETS[+b.dataset.preset].build();
  S.mods.forEach((m) => { buildMod(m); moveTo(m, m.x, m.z); });
  select(null); refresh();
}));

// --- элементы управления ---
function slider(label, val, min, max, step, unit, onInput, fmtv = (v) => (+v).toFixed(2).replace(/\.?0+$/, '') + unit) {
  const id = 'r' + uid();
  return { html: `<div class="cx-field"><div class="cx-field-l"><span>${label}</span><output id="${id}o">${fmtv(val)}</output></div><input class="range" type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}"></div>`,
    bind() { const r = $('#' + id); const p = () => r.style.setProperty('--p', ((r.value - min) / (max - min)) * 100 + '%'); p();
      r.addEventListener('input', () => { p(); $('#' + id + 'o').textContent = fmtv(r.value); onInput(+r.value); }); } };
}
function swatches(label, list, cur, onPick) {
  const id = 's' + uid();
  return { html: `<div class="cx-field"><div class="cx-field-l"><span>${label}</span></div><div class="swatches" id="${id}">${list.map((c) =>
      `<button class="swatch${c.id === cur ? ' is-on' : ''}" data-v="${c.id}" title="${esc(c.name)}" style="${c.wood ? `background-image:url(${swatchUrl(c.hex)})` : `background:${c.mirror ? 'linear-gradient(135deg,#aab6bb,#f4f7f8,#aab6bb)' : c.hex}`}"></button>`).join('')}</div><div class="swatch-name" id="${id}n">${esc((list.find((c) => c.id === cur) || {}).name || '')}</div></div>`,
    bind() { $$('#' + id + ' .swatch').forEach((b) => b.addEventListener('click', () => {
      $$('#' + id + ' .swatch').forEach((x) => x.classList.toggle('is-on', x === b));
      $('#' + id + 'n').textContent = list.find((c) => c.id === b.dataset.v).name; onPick(b.dataset.v); })); } };
}
function seg(label, list, cur, onPick) {
  const id = 'g' + uid();
  return { html: `<div class="cx-field"><div class="cx-field-l"><span>${label}</span></div><div class="seg" id="${id}">${list.map((o) => `<button class="${o.id === cur ? 'is-on' : ''}" data-v="${o.id}">${o.name}</button>`).join('')}</div></div>`,
    bind() { $$('#' + id + ' button').forEach((b) => b.addEventListener('click', () => {
      $$('#' + id + ' button').forEach((x) => x.classList.toggle('is-on', x === b)); onPick(b.dataset.v); })); } };
}
const swatchUrlCache = {};
function swatchUrl(hex) {
  if (!swatchUrlCache[hex]) { const c = document.createElement('canvas'); c.width = c.height = 64; c.getContext('2d').drawImage(woodTexture(hex).image, 0, 0, 256, 256, 0, 0, 64, 64); swatchUrlCache[hex] = c.toDataURL('image/jpeg', 0.7); }
  return swatchUrlCache[hex];
}

function renderProps() {
  const pane = $('#propsPane');
  const m = S.mods.find((x) => x.id === sel);
  if (!m) { pane.innerHTML = '<div class="cx-empty">Выберите мебель на сцене, чтобы изменить размеры, цвет и ручки.</div>'; return; }
  const def = DEFS[m.type], L = def.lim;
  const upd = (k, rebuild = true) => (v) => { m[k] = v; S.autoKind = null; if (rebuild) { buildMod(m); moveTo(m, m.x, m.z); } refresh(); };
  const ctrls = [
    slider('Ширина', m.w, L.w[0], L.w[1], 0.05, ' м', upd('w')),
    slider('Высота', m.h, L.h[0], L.h[1], 0.01, ' м', upd('h')),
    slider('Глубина', m.d, L.d[0], L.d[1], 0.01, ' м', upd('d')),
  ];
  if (L.elev) ctrls.push(slider(m.type === 'tv' ? 'Высота тумбы от пола' : 'Высота от пола', m.elev, L.elev[0], L.elev[1], 0.01, ' м', upd('elev')));
  ctrls.push(swatches(m.type === 'shelf' ? 'Цвет' : 'Фасады', m.type === 'shelf' ? BODY_COLORS : COLORS.filter((c) => !c.mirror || m.type === 'wardrobe' || m.type === 'tall'), m.facade, upd('facade')));
  if (m.type !== 'shelf') ctrls.push(swatches(m.type === 'tv' ? 'Корпус и стеновая панель' : 'Корпус', BODY_COLORS, m.body, upd('body')));
  if (m.type === 'kupe') ctrls.push(seg('Зеркало', [{ id: '1', name: 'С зеркалом' }, { id: '0', name: 'Без зеркала' }], m.mirror ? '1' : '0', (v) => upd('mirror')(v === '1')));
  if (m.type !== 'shelf' && m.type !== 'kupe') ctrls.push(seg('Ручки', HANDLES, m.handle, upd('handle')));
  if (m.type !== 'shelf') ctrls.push(seg(m.type === 'kupe' ? 'Цвет профиля' : 'Цвет ручек', HANDLE_COLORS, m.hcolor, upd('hcolor')));
  if (m.type === 'base') {
    ctrls.push(seg('Фасад', [{ id: 'doors', name: 'Двери' }, { id: 'drawers', name: 'Ящики' }], m.front, upd('front')));
    ctrls.push(seg('Встройка', [{ id: 'none', name: 'Нет' }, { id: 'sink', name: 'Мойка' }, { id: 'hob', name: 'Варочная' }], m.insert, upd('insert')));
    ctrls.push(seg('Столешница', TOPS, m.top, upd('top')));
  }
  if (m.type === 'upper') ctrls.push(seg('Открывание', [{ id: 'doors', name: 'Распашные' }, { id: 'lift', name: 'Подъёмник' }], m.front, upd('front')));
  if (m.type === 'dresser') ctrls.push(seg('Опоры', [{ id: '1', name: 'Ножки' }, { id: '0', name: 'Цоколь' }], m.legs ? '1' : '0', (v) => upd('legs')(v === '1')));
  if (m.type === 'tv') {
    ctrls.push(seg('Стеновая панель', [{ id: '1', name: 'Да' }, { id: '0', name: 'Нет' }], m.panel ? '1' : '0', (v) => upd('panel')(v === '1')));
    ctrls.push(seg('Телевизор', [{ id: '1', name: 'Показать' }, { id: '0', name: 'Скрыть' }], m.tv ? '1' : '0', (v) => upd('tv')(v === '1')));
  }
  pane.innerHTML = `<div class="cx-sel-head"><b>${def.name}</b><span id="selPrice">${dimsText(m)}</span></div>`
    + ctrls.map((c) => c.html).join('')
    + `<button class="cx-fit" id="pFit"><svg><use href="#i-spark"/></svg>Вписать в нишу${S.ai?.status === 'done' ? ' с учётом ИИ' : ''}</button>`
    + `<div class="cx-actions"><button id="pRot"><svg><use href="#i-rotate"/></svg>Повернуть</button><button id="pCopy"><svg><use href="#i-copy"/></svg>Копия</button><button id="pDel" class="danger"><svg><use href="#i-trash"/></svg>Удалить</button></div>`;
  ctrls.forEach((c) => c.bind());
  $('#pRot').onclick = rotateSel; $('#pCopy').onclick = copySel; $('#pDel').onclick = removeSel;
  $('#pFit').onclick = () => fitNiche(m);
}

function renderRoom() {
  const pane = $('#roomPane');
  const r = S.room, c = S.cam, photo = S.mode === 'photo' && S.photo;
  const rb = () => { buildRoom(); S.mods.forEach((m) => { if (m.type === 'tv') buildMod(m); moveTo(m, m.x, m.z); }); applyCam(); save(); };
  const ctrls = [];
  if (photo) {
    ctrls.push({ html: fitCard(), bind() { $('#fitOpen')?.addEventListener('click', () => openFit(!S.fit)); } });
    ctrls.push({ html: aiPanel(), bind() {} });
    if (S.photoRaw) ctrls.push({ html: `<button class="cx-small-btn cx-wide" id="photoToggle"><svg><use href="#i-image"/></svg>${S.clean ? 'Показать фото как было' : 'Показать очищенное фото'}</button>`, bind() { $('#photoToggle').onclick = togglePhoto; } });
    ctrls.push({ html: `<details class="cx-manual"><summary>Тонкая настройка камеры</summary><div class="cx-note">Обычно не нужна: камера рассчитывается по углам стены. Двигайте ползунки, если рамка чуть не совпадает с фото.</div>`, bind() {} });
    ctrls.push(slider('Высота камеры', c.h, 0.2, 2.8, 0.01, ' м', (v) => { c.h = v; applyCam(); save(); }));
    ctrls.push(slider('Наклон камеры', c.pitch, -60, 45, 0.5, '°', (v) => { c.pitch = v; applyCam(); save(); }, (v) => (+v).toFixed(1) + '°'));
    ctrls.push(slider('Угол обзора', c.fov, 22, 115, 0.5, '°', (v) => { c.fov = v; applyCam(); save(); }, (v) => Math.round(v) + '°'));
    ctrls.push(slider('Поворот', c.yaw, -60, 60, 0.5, '°', (v) => { c.yaw = v; applyCam(); save(); }, (v) => (+v).toFixed(1) + '°'));
    ctrls.push(slider('Завал горизонта', c.roll || 0, -20, 20, 0.1, '°', (v) => { c.roll = v; applyCam(); save(); }, (v) => (+v).toFixed(1) + '°'));
    ctrls.push(slider('Сдвиг влево-вправо', c.x, -4, 4, 0.01, ' м', (v) => { c.x = v; applyCam(); save(); }));
  }
  const manualEnd = photo ? [{ html: '</details>', bind() {} }] : [];
  ctrls.push(slider('Ширина комнаты', r.W, 1.5, 9, 0.05, ' м', (v) => { r.W = v; rb(); }));
  ctrls.push(slider('Глубина комнаты', r.D, 1.5, 9, 0.05, ' м', (v) => { r.D = v; rb(); }));
  ctrls.push(slider('Высота потолка', r.H, 2.2, 3.6, 0.01, ' м', (v) => { r.H = v; rb(); }));
  ctrls.splice(ctrls.length, 0, ...manualEnd);
  if (photo) ctrls.push(slider('Яркость мебели', c.light, 0.4, 1.8, 0.05, '', (v) => { c.light = v; applyCam(); save(); }, (v) => Math.round(v * 100) + '%'));
  if (!photo) {
    ctrls.push({ html: `<div class="cx-field"><div class="cx-field-l"><span>Цвет стен</span></div><div class="swatches" id="wallSw">${WALLS.map((w) => `<button class="swatch${w === r.wall ? ' is-on' : ''}" style="background:${w}" data-v="${w}"></button>`).join('')}</div></div>`,
      bind() { $$('#wallSw .swatch').forEach((b) => b.addEventListener('click', () => { r.wall = b.dataset.v; $$('#wallSw .swatch').forEach((x) => x.classList.toggle('is-on', x === b)); rb(); })); } });
    ctrls.push(seg('Пол', FLOORS, r.floor, (v) => { r.floor = v; rb(); }));
  }
  pane.innerHTML = ctrls.map((x) => x.html).join('') + `
    <div class="cx-btn-row">
      ${photo ? `<button class="cx-small-btn" id="gToggle"><svg><use href="#i-grid"/></svg>${S.guides ? 'Скрыть рамку' : 'Показать рамку'}</button>` : `<button class="cx-small-btn" id="camReset"><svg><use href="#i-reset"/></svg>Вид по умолчанию</button>`}
      <button class="cx-small-btn" id="clearAll"><svg><use href="#i-trash"/></svg>Очистить</button>
    </div>`;
  ctrls.forEach((x) => x.bind());
  $('#gToggle')?.addEventListener('click', () => { clearTimeout(guideT); S.guides = !S.guides; applyMode(); renderRoom(); save(); });
  $('#camReset')?.addEventListener('click', reset3dCam);
  $('#clearAll').addEventListener('click', () => {
    if (!S.mods.length || !confirm('Удалить всю мебель со сцены?')) return;
    clearMods(); refresh();
  });
}

/* ===================== РЕЖИМЫ / ФОТО ===================== */
$$('.cx-mode button').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.mode === 'photo' && !S.photo) { showStart(); return; }
  S.mode = b.dataset.mode; applyMode();
  if (S.mode === '3d' && !S.camSet) { reset3dCam(); S.camSet = true; }
  if ($('#roomPane').closest('.cx-tab').classList.contains('is-active')) renderRoom();
  save();
}));
const startEl = $('#start');
function showStart() { startEl.classList.remove('is-hidden'); }
function hideStart() { startEl.classList.add('is-hidden'); }
$('#btnPhoto').addEventListener('click', showStart);
$('#skipPhoto').addEventListener('click', () => {
  hideStart(); S.mode = '3d'; applyMode(); reset3dCam(); setStep(3);
  if (!S.mods.length) addMod('wardrobe');
  save();
});
startEl.addEventListener('click', (e) => { if (e.target === startEl && (S.photo || S.mods.length)) hideStart(); });
['#fileCam', '#fileGal'].forEach((s) => $(s).addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    S.focal = await readFocal35(f);
    const blob = await compressImage(f, 1600, 0.86);
    const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
    await setPhoto(url);
    S.mode = 'photo'; S.guides = true; S.ai = null; S.fit = null; S.tone = null; FIT.aiRes = null; S.photoRaw = null; S.clean = false;
    hideStart();
    openFit(true);
    save();
    runAI();
  } catch (err) { console.error(err); toast('Не удалось открыть фото, попробуйте другое', 'err'); }
}));
function setPhoto(url) {
  return new Promise((res, rej) => {
    S.photo = url;
    photoEl.onload = () => {
      if (photoTex) photoTex.dispose();
      photoTex = new THREE.Texture(photoEl); photoTex.colorSpace = THREE.SRGBColorSpace; photoTex.needsUpdate = true;
      layout(); applyWallPhoto(); res();
    };
    photoEl.onerror = rej;
    photoEl.src = url;
  });
}

/* ===================== РАЗМЕТКА УГЛОВ СТЕНЫ ===================== */
// После фото программа сама ищет углы стены, клиент проверяет их с лупой,
// и по 4 точкам точно рассчитывается камера и размеры стены.
const FIT = { on: false, pts: null, snaps: [], touched: false, hTyped: false, sol: null, aiRes: null, drag: null, anim: 0 };
const FIT_KEYS = ['cl', 'cr', 'fr', 'fl'];
const FIT_LABEL = { fl: 'Пол · левый угол', fr: 'Пол · правый угол', cl: 'Потолок · левый угол', cr: 'Потолок · правый угол' };
const FIT_NB = { fl: ['fr', 'cl'], fr: ['fl', 'cr'], cl: ['cr', 'fl'], cr: ['cl', 'fr'] };
const fitLayer = $('#fitLayer'), fitSvg = $('#fitSvg'), loupeEl = $('#loupe'), loupeCx = loupeEl.querySelector('canvas').getContext('2d');
const aspectNow = () => photoEl.naturalWidth / photoEl.naturalHeight;
const fov0 = () => fovFromFocal(S.focal || 26, photoEl.naturalWidth, photoEl.naturalHeight);
const defaultPts = () => ({ cl: { x: 0.16, y: 0.14 }, cr: { x: 0.84, y: 0.14 }, fr: { x: 0.84, y: 0.82 }, fl: { x: 0.16, y: 0.82 } });
const clonePts = (p) => JSON.parse(JSON.stringify(p));
const fmtM = (v) => v.toFixed(2).replace('.', ',') + ' м';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

fitLayer.insertAdjacentHTML('beforeend', FIT_KEYS.map((k) =>
  `<button class="fit-h fit-h--${k}" data-k="${k}" aria-label="${FIT_LABEL[k]}"><i></i><span>${FIT_LABEL[k]}</span></button>`).join(''));

function setStep(n) {
  $$('#steps li').forEach((li) => { const s = +li.dataset.s; li.classList.toggle('is-on', s === n); li.classList.toggle('is-done', s < n); });
}

function fitSettings() {
  const Hv = parseFloat(String($('#fitH').value).replace(',', '.'));
  const Wv = parseFloat(String($('#fitW').value).replace(',', '.'));
  return { H: Hv >= 2 && Hv <= 4.5 ? Hv : 2.7, Hsure: FIT.hTyped && Hv >= 2 && Hv <= 4.5, Wm: Wv >= 40 && Wv <= 1400 ? Wv / 100 : null, ceilHidden: $('#fitCeil').checked };
}
function fitSolve() {
  try { FIT.sol = solveWall(FIT.pts, { aspect: aspectNow(), fov0: fov0(), fovSure: !!S.focal, ...fitSettings() }); }
  catch (e) { console.warn('solveWall', e); FIT.sol = null; }
  drawFit();
}
const totalErr = (sol) => Math.max(1, Math.round(sol.errCm + sol.scaleCm));

function drawFit(dragging = false) {
  const p = FIT.pts; if (!p) return;
  const o = fitSettings(), sol = !dragging && FIT.sol;
  $$('.fit-h', fitLayer).forEach((h) => { const q = p[h.dataset.k]; h.style.left = q.x * 100 + '%'; h.style.top = q.y * 100 + '%'; h.classList.toggle('is-soft', o.ceilHidden && h.dataset.k[0] === 'c'); });
  const pt = (q) => `${q.x},${q.y}`;
  let svg = '';
  // сетка пола и стен по рассчитанной камере — сразу видно, «встала» ли перспектива
  if (sol) {
    const { W, H, D } = sol.room, A = aspectNow(), z0 = -D / 2, depth = Math.min(2.5, D - 0.3);
    const pr = (X, Y, Z) => { const q = project(sol.cam, D, A, X, Y, Z); return q.ok ? { x: q.u / A, y: q.v } : null; };
    const seg = (a, b) => (a && b ? `M${pt(a)}L${pt(b)}` : '');
    let g = '';
    for (let z = 0.5; z <= depth + 1e-6; z += 0.5) g += seg(pr(-W / 2, 0, z0 + z), pr(W / 2, 0, z0 + z));
    for (let x = -W / 2 + 0.5; x < W / 2 - 0.05; x += 0.5) g += seg(pr(x, 0, z0), pr(x, 0, z0 + depth)) + seg(pr(x, 0, z0), pr(x, Math.min(H, 0.25), z0));
    const side = seg(pr(-W / 2, 0, z0), pr(-W / 2, 0, z0 + depth)) + seg(pr(W / 2, 0, z0), pr(W / 2, 0, z0 + depth))
      + (o.ceilHidden ? '' : seg(pr(-W / 2, H, z0), pr(-W / 2, H, z0 + depth)) + seg(pr(W / 2, H, z0), pr(W / 2, H, z0 + depth)));
    svg += `<path class="fit-grid" d="${g}"/><path class="fit-side" d="${side}"/>`;
  }
  svg += `<polygon class="fit-wall" points="${[p.cl, p.cr, p.fr, p.fl].map(pt).join(' ')}"/>`;
  svg += `<path class="fit-edge" d="M${pt(p.fl)}L${pt(p.fr)}M${pt(p.fl)}L${pt(p.cl)}M${pt(p.fr)}L${pt(p.cr)}"/>`;
  svg += `<path class="fit-edge${o.ceilHidden ? ' fit-edge--soft' : ''}" d="M${pt(p.cl)}L${pt(p.cr)}"/>`;
  fitSvg.innerHTML = svg;
  // размеры прямо на фото
  const dims = $('#fitDims');
  if (sol) {
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const mb = mid(p.fl, p.fr), ml = mid(p.fl, p.cl);
    dims.innerHTML = `<span style="left:${mb.x * 100}%;top:${mb.y * 100}%" class="fit-dim fit-dim--w">${fmtM(sol.room.W)}</span>`
      + (o.ceilHidden ? '' : `<span style="left:${ml.x * 100}%;top:${ml.y * 100}%" class="fit-dim fit-dim--h">${fmtM(sol.room.H)}</span>`);
  } else if (!dragging) dims.innerHTML = '';
  // оценка точности
  const badge = $('#fitBadge');
  if (sol) {
    badge.className = 'fit-badge q--' + (sol.quality === 'rough' ? 'rough' : (o.Hsure || o.Wm) && sol.quality === 'good' ? 'good' : 'ok');
    badge.textContent = sol.quality === 'rough' ? 'Проверьте точки' : `Точность ±${totalErr(sol)} см`;
    $('#fitText').innerHTML = sol.quality === 'rough'
      ? 'Точки не складываются в одну стену. Поставьте их именно в углы: где стена встречается с полом и потолком.'
      : (o.Hsure || o.Wm)
        ? `Стена <b>${fmtM(sol.room.W)}</b> × <b>${fmtM(sol.room.H)}</b>. Отлично — размеры рассчитаны по вашему замеру.`
        : `Стена ≈ <b>${fmtM(sol.room.W)}</b>. Для точности до сантиметра укажите высоту потолка или ширину стены.`;
  }
}

/* --- перетаскивание точек --- */
$$('.fit-h', fitLayer).forEach((h) => {
  const k = h.dataset.k;
  h.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    cancelAnimationFrame(FIT.anim);
    const r = stage.getBoundingClientRect();
    FIT.drag = { k, sx: e.clientX, sy: e.clientY, p0: { ...FIT.pts[k] }, w: r.width, h: r.height };
    h.setPointerCapture(e.pointerId); h.classList.add('is-drag');
    loupeEl.hidden = false; drawLoupe(k);
  });
  h.addEventListener('pointermove', (e) => {
    const d = FIT.drag; if (!d || d.k !== k) return;
    // точка двигается вместе с пальцем, но не прыгает под него — палец не закрывает угол
    FIT.pts[k] = { x: clamp(d.p0.x + (e.clientX - d.sx) / d.w, -0.3, 1.3), y: clamp(d.p0.y + (e.clientY - d.sy) / d.h, -0.3, 1.3) };
    drawFit(true); drawLoupe(k);
  });
  const up = () => {
    if (!FIT.drag || FIT.drag.k !== k) return;
    FIT.drag = null; h.classList.remove('is-drag'); loupeEl.hidden = true;
    FIT.touched = true;
    if (snapPoint(k)) { h.classList.add('is-snap'); setTimeout(() => h.classList.remove('is-snap'), 400); }
    fitSolve();
  };
  h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  h.addEventListener('keydown', (e) => {
    const st = e.shiftKey ? 0.01 : 0.002, dv = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
    if (!dv) return; e.preventDefault();
    FIT.pts[k] = { x: FIT.pts[k].x + dv[0], y: FIT.pts[k].y + dv[1] }; FIT.touched = true; fitSolve();
  });
});
// «примагничивание» к найденным пересечениям линий
function snapPoint(k) {
  const p = FIT.pts[k], A = aspectNow();
  let best = null, bd = 0.018;
  FIT.snaps.forEach((s) => { const d = Math.hypot((s.x - p.x) * A, s.y - p.y); if (d < bd) { bd = d; best = s; } });
  if (!best) return false;
  FIT.pts[k] = { x: best.x, y: best.y };
  navigator.vibrate?.(8);
  return true;
}
// лупа: увеличенный фрагмент фото с перекрестием и соседними рёбрами стены
function drawLoupe(k) {
  const p = FIT.pts[k], c = loupeCx, S2 = 300, Z = 3.2;
  const r = stage.getBoundingClientRect(), nW = photoEl.naturalWidth, nH = photoEl.naturalHeight;
  const css = loupeEl.offsetWidth || 150;
  const sw = (css / Z) / r.width * nW, sh = (css / Z) / r.height * nH;
  let sx = p.x * nW - sw / 2, sy = p.y * nH - sh / 2;
  c.fillStyle = '#0f0e0c'; c.fillRect(0, 0, S2, S2);
  // обрезаем источник по границам фото (Safari не рисует «за краем»)
  const x0 = Math.max(0, sx), y0 = Math.max(0, sy), x1 = Math.min(nW, sx + sw), y1 = Math.min(nH, sy + sh);
  if (x1 > x0 && y1 > y0) c.drawImage(photoEl, x0, y0, x1 - x0, y1 - y0, (x0 - sx) / sw * S2, (y0 - sy) / sh * S2, (x1 - x0) / sw * S2, (y1 - y0) / sh * S2);
  const toL = (q) => [((q.x * nW - sx) / sw) * S2, ((q.y * nH - sy) / sh) * S2];
  c.lineWidth = 3; c.strokeStyle = 'rgba(141,187,255,.95)';
  FIT_NB[k].forEach((n) => { c.beginPath(); c.moveTo(S2 / 2, S2 / 2); c.lineTo(...toL(FIT.pts[n])); c.stroke(); });
  c.lineWidth = 4; c.strokeStyle = 'rgba(0,0,0,.55)';
  c.beginPath(); c.moveTo(S2 / 2 - 40, S2 / 2); c.lineTo(S2 / 2 - 10, S2 / 2); c.moveTo(S2 / 2 + 10, S2 / 2); c.lineTo(S2 / 2 + 40, S2 / 2);
  c.moveTo(S2 / 2, S2 / 2 - 40); c.lineTo(S2 / 2, S2 / 2 - 10); c.moveTo(S2 / 2, S2 / 2 + 10); c.lineTo(S2 / 2, S2 / 2 + 40); c.stroke();
  c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke();
  c.beginPath(); c.arc(S2 / 2, S2 / 2, 4, 0, Math.PI * 2); c.fillStyle = '#8DBBFF'; c.fill();
  loupeEl.classList.toggle('is-left', p.x > 0.5);
}

function animatePts(target, ms = 520, onDone = null) {
  cancelAnimationFrame(FIT.anim);
  const from = clonePts(FIT.pts), t0 = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - t0) / ms), e = easeOut(t);
    FIT_KEYS.forEach((k) => { FIT.pts[k] = { x: from[k].x + (target[k].x - from[k].x) * e, y: from[k].y + (target[k].y - from[k].y) * e }; });
    if (t < 1) { drawFit(true); FIT.anim = requestAnimationFrame(step); } else { FIT.pts = clonePts(target); fitSolve(); FIT.anim = 0; onDone?.(); }
  };
  FIT.anim = requestAnimationFrame(step);
}

function openFit(fresh) {
  if (!S.photo) { showStart(); return; }
  FIT.on = true; document.body.classList.add('is-fitting'); setStep(2); hideQuick();
  S.mode = 'photo'; select(null);
  if (fresh || !FIT.pts) {
    FIT.touched = false;
    FIT.pts = !fresh && S.fit?.pts ? clonePts(S.fit.pts) : { cl: { x: 0.5, y: 0.45 }, cr: { x: 0.5, y: 0.45 }, fr: { x: 0.5, y: 0.55 }, fl: { x: 0.5, y: 0.55 } };
  }
  const f = S.fit;
  $('#fitH').value = (!fresh && f?.H ? f.H : 2.7).toFixed(2); FIT.hTyped = !fresh && !!f?.Hsure;
  $('#fitW').value = !fresh && f?.Wm ? Math.round(f.Wm * 100) : '';
  $('#fitCeil').checked = !fresh && !!f?.ceilHidden;
  fitLayer.hidden = false; $('#fitSheet').hidden = false;
  applyMode(); layout();
  if (fresh) autoDetect(); else { if (S.fit?.pts) FIT.pts = clonePts(S.fit.pts); fitSolve(); }
}
function closeFit() {
  FIT.on = false; document.body.classList.remove('is-fitting');
  fitLayer.hidden = true; $('#fitSheet').hidden = true; loupeEl.hidden = true;
  applyMode(); layout();
}
async function autoDetect() {
  setScan(true, 'Ищем углы стены, пол и потолок…');
  drawFit(true);
  await wait(60);
  const t0 = performance.now();
  let det = null;
  try { det = detectWall(photoEl); } catch (e) { console.warn('detectWall', e); }
  FIT.snaps = det?.snaps || [];
  await wait(Math.max(0, 750 - (performance.now() - t0)));
  setScan(false);
  if (FIT.touched || !FIT.on) return;
  FIT.localConf = det?.pts ? det.conf : 0;
  const sure = FIT.localConf >= 0.8;
  animatePts(det?.pts || defaultPts(), 520, () => {
    if (sure && FIT.sol && FIT.sol.quality !== 'rough') autoApply('local');
  });
  $('#fitText').textContent = sure ? 'Нашли углы стены — вписываем мебель…'
    : FIT.aiState === 'busy' ? 'ИИ изучает фото и уточняет углы стены…'
    : det?.pts ? 'Нашли углы стены. Проверьте точки — если нужно, поправьте пальцем.'
    : 'Потяните 4 точки в углы стены: где стена встречается с полом и потолком.';
}
// автоматическое завершение разметки (клиент может поправить кнопкой «Углы стены»)
function autoApply(src) {
  setTimeout(() => {
    if (!FIT.on || FIT.touched || FIT.drag) return;
    fitDone(src);
  }, src === 'local' ? 700 : 400);
}
// точки ИИ «примагничиваем» к найденным линиям — смысл от ИИ, точность от пикселей
function refineWithSnaps(pts) {
  const A = aspectNow(), out = clonePts(pts);
  FIT_KEYS.forEach((k) => {
    let best = null, bd = 0.045;
    FIT.snaps.forEach((s) => { const d = Math.hypot((s.x - pts[k].x) * A, s.y - pts[k].y); if (d < bd) { bd = d; best = s; } });
    if (best) out[k] = { x: best.x, y: best.y };
  });
  return out;
}
// ввод высоты / ширины / «потолка не видно»
$('#fitH').addEventListener('input', () => { FIT.hTyped = true; fitSolve(); });
$('#fitW').addEventListener('input', fitSolve);
$('#fitCeil').addEventListener('change', fitSolve);
$('#fitReset').addEventListener('click', () => { FIT.touched = false; autoDetect(); });
$('#btnCorners').addEventListener('click', () => openFit(false));
$('#fitDone').addEventListener('click', () => fitDone(false));

function fitDone(auto = false) {
  if (auto instanceof Event) auto = false;
  fitSolve();
  const sol = FIT.sol;
  if (!sol) { toast('Не получилось рассчитать стену — проверьте точки', 'err'); return; }
  const o = fitSettings();
  S.fit = { pts: clonePts(FIT.pts), ...o, errCm: sol.errCm, scaleCm: sol.scaleCm, quality: sol.quality, auto: !!auto && !FIT.touched, src: auto || 'hand' };
  Object.assign(S.cam, sol.cam);
  Object.assign(S.room, sol.room);
  S.tone = photoTone(photoEl);
  S.cam.light = clamp(0.6 + S.tone.lum * 0.8, 0.6, 1.4);
  if (FIT.aiRes) applyAIExtras(FIT.aiRes);
  closeFit();
  buildRoom(); applyCam();
  if (!S.mods.length) autoSet('wardrobe', true);
  else if (S.autoKind) autoSet(S.autoKind, true);
  else {
    const order = [...S.mods]; S.mods = [];
    order.forEach((m) => { placeSmart(m); m._grow = true; S.mods.push(m); buildMod(m); });
    refresh();
  }
  flashGuides();
  setStep(3);
  showQuick();
  if (auto) toast('Стена размечена автоматически. Неточно? Нажмите «Углы стены»');
  if (sol.quality === 'rough') toast('Точки стоят неточно — мебель может «плыть». Нажмите «Углы стены», чтобы поправить', 'err');
  save();
}
let guideT;
function flashGuides() {
  S.guides = true; applyMode();
  clearTimeout(guideT);
  guideT = setTimeout(() => { S.guides = false; applyMode(); if ($('#roomPane').closest('.cx-tab').classList.contains('is-active')) renderRoom(); }, 2600);
}

/* --- быстрый выбор: что поставить у стены (вписывается от угла до угла) --- */
const QUICK = [
  { id: 'wardrobe', name: 'Шкаф' }, { id: 'kupe', name: 'Шкаф-купе' }, { id: 'kitchen', name: 'Кухня' },
  { id: 'tv', name: 'ТВ-зона' }, { id: 'dresser', name: 'Комод' },
];
wrapEl.insertAdjacentHTML('beforeend', `<div class="cx-quick" id="quick" hidden><span>Что поставить у этой стены?</span><div>${QUICK.map((q) => `<button data-q="${q.id}"${q.id === 'wardrobe' ? ' class="is-on"' : ''}>${q.name}</button>`).join('')}</div><button class="cx-quick-x" aria-label="Скрыть"><svg><use href="#i-close"/></svg></button></div>`);
const quickEl = $('#quick');
function showQuick() { quickEl.hidden = false; }
function hideQuick() { quickEl.hidden = true; }
$('.cx-quick-x').addEventListener('click', hideQuick);
$$('[data-q]', quickEl).forEach((b) => b.addEventListener('click', () => {
  $$('[data-q]', quickEl).forEach((x) => x.classList.toggle('is-on', x === b));
  autoSet(b.dataset.q);
}));

function clearMods() { objs.forEach((g) => { furniture.remove(g); disposeGroup(g); }); objs.clear(); S.mods = []; select(null); }
// ставит мебель в самый большой свободный промежуток стены — точно по размеру
function autoSet(kind, silent = false) {
  clearMods(); S.autoKind = kind;
  const { H } = S.room;
  const probe = newMod(kind === 'kitchen' ? 'base' : kind);
  const gaps = wallGaps(probe).sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]));
  const g = gaps[0] || [-S.room.W / 2, S.room.W / 2];
  const L = g[1] - g[0], mid = (g[0] + g[1]) / 2;
  const items = [];
  if (kind === 'wardrobe' || kind === 'kupe') {
    const m = newMod(kind); m.x = g[0] + 0.01; m._grow = true; S.mods.push(m);
    buildMod(m); fitNiche(m, true);
    if (!silent) toast(`${DEFS[kind].name} вписан: ${Math.round(m.w * 100)} × ${Math.round(m.h * 100)} см`);
    else toast(`Шкаф вписан по стене: ${Math.round(m.w * 100)} × ${Math.round(m.h * 100)} см`);
    refresh(); return;
  }
  if (kind === 'kitchen') {
    let a = g[0];
    const run = Math.min(L, 5.4);
    if (run >= 2.4) { const t = newMod('tall', { h: Math.round(Math.min(2.3, H - 0.1) * 100) / 100 }); t.x = a + 0.3; items.push(t); a += 0.6; }
    const rest = Math.min(g[1] - a, run - (a - g[0]));
    const n = Math.max(1, Math.round(rest / 0.6)), w = Math.floor(clamp(rest / n, 0.3, 1.2) * 100) / 100;
    for (let i = 0; i < n; i++) {
      const x = a + w * (i + 0.5);
      const ins = n >= 3 && i === 1 ? 'sink' : n >= 4 && i === n - 2 ? 'hob' : 'none';
      items.push(newMod('base', { w, x, insert: ins, front: i === n - 1 && n > 2 ? 'drawers' : 'doors' }));
      items.push(newMod('upper', { w, x, front: i === n - 2 && n > 3 ? 'lift' : 'doors' }));
    }
  } else if (kind === 'tv') {
    const m = newMod('tv'); m.w = Math.round(clamp(L * 0.6, 1.0, Math.min(3.0, L - 0.5)) * 100) / 100;
    if (m.w + 0.5 > L) m.panel = false;
    m.x = mid; items.push(m);
  } else {
    const m = newMod(kind); m.w = Math.round(clamp(L * 0.5, 0.6, 1.6) * 100) / 100; m.x = mid; items.push(m);
  }
  items.forEach((m, i) => { m._grow = true; S.mods.push(m); buildMod(m); moveTo(m, m.x, -99); if (m.type === 'upper') objs.get(m.id).userData.grow += 120; else objs.get(m.id).userData.grow += i * 40; });
  refresh();
  if (!silent) toast(kind === 'kitchen' ? `Кухня ${Math.round(Math.min(L, 5.4) * 100)} см вписана по стене` : `${DEFS[kind].name} поставлена по центру стены`);
}

/* ===================== ИИ-АНАЛИЗ КОМНАТЫ (если подключён) ===================== */
// ИИ работает в фоне: уточняет углы, находит окна, двери, радиаторы, плинтус и свет.
const SOURCE = { left: 'слева', right: 'справа', front: 'из окна напротив', behind: 'из-за спины', top: 'сверху' };
const WARMTH = { warm: 'тёплый', neutral: 'нейтральный', cool: 'холодный' };
function aiPanel() {
  const a = S.ai;
  if (!a || a.status !== 'done') return '';
  const obs = (a.obstacles || []).map((o) => o.label || OBSTACLE_NAMES[o.type]);
  const rows = [
    ['Плинтус', a.bbH ? `${Math.round(a.bbH)} см — мебель отодвинута` : 'не найден'],
    ['Препятствия', obs.length ? [...new Set(obs)].join(', ') : 'нет'],
    ['Свет', `${SOURCE[a.lightRaw?.main_source] || '—'}, ${WARMTH[a.lightRaw?.warmth] || ''}`],
  ];
  return `<div class="cx-ai"><div class="cx-ai-h"><b><svg><use href="#i-spark"/></svg>ИИ изучил комнату</b></div>
    <dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${a.advice ? `<p class="cx-ai-adv">${esc(a.advice)}</p>` : ''}</div>`;
}
function fitCard() {
  const f = S.fit;
  if (!f) return `<div class="cx-ai cx-fitcard"><b><svg><use href="#i-corner"/></svg>Стена не размечена</b><p>Отметьте 4 угла стены — и мебель встанет точно по размерам.</p><button class="cx-fit" id="fitOpen"><svg><use href="#i-corner"/></svg>Разметить углы</button></div>`;
  const err = Math.max(1, Math.round((f.errCm || 1) + (f.scaleCm || 0)));
  return `<div class="cx-ai cx-fitcard"><div class="cx-ai-h"><b><svg><use href="#i-corner"/></svg>Стена размечена</b><span class="q q--${f.quality === 'rough' ? 'rough' : (f.Hsure || f.Wm) ? 'good' : 'ok'}">±${err} см</span></div>
    <dl><div><dt>Ширина</dt><dd>${fmtM(S.room.W)}${f.Wm ? ' · по замеру' : ''}</dd></div><div><dt>Высота</dt><dd>${fmtM(S.room.H)}${f.Hsure ? ' · по замеру' : f.ceilHidden ? ' · примерно' : ''}</dd></div></dl>
    ${!f.Hsure && !f.Wm ? '<p class="cx-ai-adv">Укажите высоту потолка или ширину стены по рулетке — размеры станут точными до сантиметра.</p>' : ''}
    <button class="cx-small-btn" id="fitOpen"><svg><use href="#i-corner"/></svg>Поправить углы и размеры</button></div>`;
}
function setScan(on, text) { $('#aiScan').hidden = !on; if (text) $('#aiScan span').lastChild.textContent = text; }
let aiRun = 0;
function aiCorners(res) {
  const bw = res?.back_wall || {};
  const ok = (l) => Array.isArray(l) && l.length >= 2 && l.every((q) => Number.isFinite(q?.x) && Number.isFinite(q?.y));
  if (!ok(bw.floor_line)) return null;
  const yOn = (l, x) => { const [a, b] = [...l].sort((p, q) => p.x - q.x); const t = (x - a.x) / ((b.x - a.x) || 1e-6); return a.y + (b.y - a.y) * t; };
  const xs = bw.floor_line.map((q) => q.x);
  const lx = Number.isFinite(bw.left_corner_x) ? bw.left_corner_x : Math.min(...xs);
  const rx = Number.isFinite(bw.right_corner_x) ? bw.right_corner_x : Math.max(...xs);
  const ceil = ok(bw.ceiling_line) ? bw.ceiling_line : null;
  const P = (x, y) => ({ x: x / 1000, y: y / 1000 });
  return {
    ceilHidden: !ceil,
    pts: { fl: P(lx, yOn(bw.floor_line, lx)), fr: P(rx, yOn(bw.floor_line, rx)), cl: ceil ? P(lx, yOn(ceil, lx)) : P(lx, 30), cr: ceil ? P(rx, yOn(ceil, rx)) : P(rx, 30) },
  };
}
function applyAIExtras(res) {
  S.ai = {
    status: 'done', light: lightFromAI(res.light, S.room), lightRaw: res.light,
    obstacles: obstaclesToWorld(res, { cam: S.cam, room: S.room }, aspectNow()),
    bb: res.baseboard?.present ? 0.015 : 0, bbH: res.baseboard?.present ? res.baseboard.height_cm : 0,
    advice: res.advice || '',
  };
}
async function runAI() {
  if (!S.photo || !photoEl.naturalWidth) return;
  const run = ++aiRun;
  FIT.aiRes = null; FIT.aiState = 'busy'; cleanRun++;
  try {
    const res = await analyzeRoom(imageToBase64(photoEl, 1280));
    if (run !== aiRun) return;
    FIT.aiRes = res;
    if (/^#[0-9a-f]{6}$/i.test(res.wall_color || '')) S.room.wall = res.wall_color;
    FIT.aiState = 'done';
    if (res.clutter?.present) cleanClutter(res.clutter.items || []);
    const c = aiCorners(res);
    const refined = c ? refineWithSnaps(c.pts) : null;
    const far = (a, b) => FIT_KEYS.some((k) => Math.hypot((a[k].x - b[k].x) * aspectNow(), a[k].y - b[k].y) > 0.03);
    if (FIT.on && c && !FIT.touched) {
      if (Number(res.ceiling_height_m) && !FIT.hTyped) $('#fitH').value = clamp(Number(res.ceiling_height_m), 2.3, 3.6).toFixed(2);
      $('#fitCeil').checked = c.ceilHidden;
      $('#fitText').textContent = 'ИИ нашёл углы стены — вписываем мебель…';
      animatePts(refined, 520, () => { if (FIT.sol && FIT.sol.quality !== 'rough') autoApply('ai'); else $('#fitText').textContent = 'Проверьте точки — поставьте их точно в углы стены.'; });
    } else if (!FIT.on && S.fit?.auto && c && far(refined, S.fit.pts)) {
      // ИИ уверен, что стена в другом месте — тихо переразмечаем (клиент точки не трогал)
      if (Number(res.ceiling_height_m) && !S.fit.Hsure) $('#fitH').value = clamp(Number(res.ceiling_height_m), 2.3, 3.6).toFixed(2);
      $('#fitCeil').checked = c.ceilHidden;
      FIT.pts = refined; fitSolve();
      if (FIT.sol && FIT.sol.quality !== 'rough') fitDone('ai');
    } else if (!FIT.on && S.fit) {
      applyAIExtras(res); buildRoom(); applyCam();
      // мебель, поставленную автоматически, переставляем с учётом окон, дверей и радиаторов
      if (S.autoKind) autoSet(S.autoKind, true); else S.mods.forEach((m) => moveTo(m, m.x, m.z));
      if ($('#roomPane').closest('.cx-tab').classList.contains('is-active')) renderRoom();
      const n = S.ai.obstacles.filter((o) => o.blocks).length;
      if (n) toast(`ИИ нашёл препятствия на стене: ${n}. Они отмечены красным`);
    }
  } catch (e) {
    FIT.aiState = 'fail';
    console.info('room-ai недоступен:', e.message);
    if (FIT.on && !FIT.touched && !FIT.anim) $('#fitText').textContent = 'Потяните 4 точки в углы стены: где стена встречается с полом и потолком.';
  }
}

/* ---------- ИИ убирает с фото мусор и временные предметы ---------- */
let cleanRun = 0;
async function cleanClutter(items) {
  const run = ++cleanRun;
  const what = [...new Set(items)].slice(0, 4).join(', ');
  toast(what ? `Убираем с фото: ${what}…` : 'Убираем с фото лишние предметы…');
  try {
    const url = await cleanPhoto(photoEl);
    if (run !== cleanRun) return;
    S.photoRaw = S.photo;
    await setPhoto(url);
    S.clean = true;
    toast('Фото очищено — мебель смотрится как в пустой комнате');
    renderRoomIfActive(); save();
  } catch (e) { console.info('clean:', e.message); }
}
function renderRoomIfActive() { if ($('#roomPane').closest('.cx-tab').classList.contains('is-active')) renderRoom(); }
async function togglePhoto() {
  if (!S.photoRaw) return;
  const [a, b] = [S.photoRaw, S.photo];
  S.photoRaw = b; await setPhoto(a); S.clean = !S.clean; renderRoomIfActive(); save();
}

/* ===================== СОХРАНЕНИЕ ===================== */
let saveT;
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try {
      const data = { v: 2, mode: S.mode, room: S.room, cam: S.cam, guides: S.guides, mods: S.mods, ai: S.ai?.status === 'done' ? S.ai : null, focal: S.focal, fit: S.fit, tone: S.tone };
      localStorage.setItem('adl-cx', JSON.stringify(data));
      if (S.photo) { try { localStorage.setItem('adl-cx-photo', S.photo); } catch { localStorage.removeItem('adl-cx-photo'); } }
    } catch {}
  }, 400);
}
async function restore() {
  try {
    const d = JSON.parse(localStorage.getItem('adl-cx') || 'null');
    if (!d) return false;
    Object.assign(S.room, d.room); Object.assign(S.cam, d.cam); S.guides = d.guides ?? true; S.ai = d.ai || null; S.focal = d.focal || null;
    S.fit = d.v === 2 ? d.fit || null : null; S.tone = d.tone || null;
    S.mods = (d.mods || []).filter((m) => DEFS[m.type]);
    const p = localStorage.getItem('adl-cx-photo');
    if (p) await setPhoto(p).catch(() => {});
    S.mode = d.mode === 'photo' && S.photo ? 'photo' : '3d';
    return S.mods.length > 0 || !!S.photo;
  } catch { return false; }
}

/* ===================== ОТПРАВКА ПРОЕКТА ===================== */
function snapshot() {
  const hv = helper.visible, gv = guides.visible;
  helper.visible = false; guides.visible = false;
  renderer.render(scene, activeCam());
  const src = renderer.domElement, sc = Math.min(1, 1600 / src.width);
  const w = Math.round(src.width * sc), h = Math.round(src.height * sc), band = Math.round(w * 0.07);
  const c = document.createElement('canvas'); c.width = w; c.height = h + band;
  const x = c.getContext('2d');
  x.fillStyle = '#171513'; x.fillRect(0, 0, w, h + band);
  if (S.mode === 'photo' && S.photo) x.drawImage(photoEl, 0, 0, w, h);
  x.drawImage(src, 0, 0, w, h);
  x.fillStyle = '#ECE7DF'; x.font = `400 ${Math.round(band * 0.34)}px Geologica, sans-serif`; x.textBaseline = 'middle';
  x.fillText('ADL · проект мебели', band * 0.4, h + band / 2);
  x.textAlign = 'right'; x.fillStyle = '#ECE7DF'; x.fillText(SITE.phoneDisplay, w - band * 0.4, h + band / 2);
  helper.visible = hv; guides.visible = gv;
  return c;
}
function describe() {
  const cn = (id) => (COLORS.find((c) => c.id === id) || {}).name || id;
  return S.mods.map((m, i) => {
    const d = DEFS[m.type]; const dims = `${m.w.toFixed(2)}×${m.h.toFixed(2)}×${m.d.toFixed(2)} м`;
    const extra = [m.type !== 'shelf' ? `фасад: ${cn(m.facade)}` : `цвет: ${cn(m.facade)}`, m.type !== 'shelf' ? `корпус: ${cn(m.body)}` : '',
      m.type === 'base' ? `столешница: ${TOPS.find((t) => t.id === m.top)?.name}` : '', m.type === 'kupe' && m.mirror ? 'с зеркалом' : '',
      m.handle && m.type !== 'kupe' && m.type !== 'shelf' ? `ручки: ${HANDLES.find((h) => h.id === m.handle)?.name.toLowerCase()}` : ''].filter(Boolean).join(', ');
    return `${i + 1}. ${d.name} ${dims} — ${extra}`;
  }).join('\n');
}
const sendModal = $('#sendModal');
let snapCanvas = null;
$('#btnSend').addEventListener('click', () => {
  if (!S.mods.length) { toast('Сначала добавьте мебель из каталога', 'err'); return; }
  select(null);
  snapCanvas = snapshot();
  $('#sendPreview').src = snapCanvas.toDataURL('image/jpeg', 0.8);
  sendModal.classList.add('is-open'); sendModal.setAttribute('aria-hidden', 'false'); setStep(4);
});
$$('[data-close]', sendModal).forEach((b) => b.addEventListener('click', () => { sendModal.classList.remove('is-open'); sendModal.setAttribute('aria-hidden', 'true'); setStep(3); }));
phoneMask($('#sPhone'));
$('#sendForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#sName').value.trim(), phone = $('#sPhone').value;
  if (!name || !phoneValid(phone)) { toast('Укажите имя и номер телефона', 'err'); return; }
  const win = SITE.openWhatsAppAfterLead ? window.open('about:blank', '_blank') : null;
  const btn = $('#sendForm button[type=submit]'); btn.disabled = true;
  let url = null;
  try {
    const blob = await new Promise((r) => snapCanvas.toBlob(r, 'image/jpeg', 0.85));
    const path = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${uid()}.jpg`;
    const { error } = await sb.storage.from('projects').upload(path, blob, { contentType: 'image/jpeg' });
    if (error) throw error;
    url = sb.storage.from('projects').getPublicUrl(path).data.publicUrl;
  } catch (err) { console.warn('snapshot upload:', err.message); }
  const message = `Проект из 3D-конструктора:\n${describe()}` + ($('#sMsg').value.trim() ? `\nКомментарий: ${$('#sMsg').value.trim()}` : '');
  const res = await submitLead({ name, phone, furniture: '3D-проект', message, source: 'constructor', project_url: url, details: { room: S.room, mods: S.mods } }, win);
  $('#sendBody').innerHTML = `<div class="cx-done"><b>Проект отправлен</b><p>Мастер посмотрит его, подготовит смету и свяжется с вами. Срочно — <a href="tel:${SITE.phoneTel}">${SITE.phoneDisplay}</a></p>
    <a class="b b--wa b--full" href="${esc(res.link)}" target="_blank" rel="noopener"><svg><use href="#i-wa"/></svg>${res.opened ? 'Открыть WhatsApp' : 'Отправить в WhatsApp'}</a></div>`;
});

/* ===================== СТАРТ ===================== */
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
function loop() {
  if (S.mode === '3d') controls.update();
  const now = performance.now();
  objs.forEach((g) => { if (g.userData.grow) { const t = Math.min(1, (now - g.userData.grow) / 650); g.scale.y = Math.max(0.001, easeOut(t)); if (t >= 1) { delete g.userData.grow; g.scale.y = 1; updateHelper(); } } });
  renderer.render(scene, activeCam());
  requestAnimationFrame(loop);
}
(async function init() {
  const had = await restore();
  buildRoom(); applyCam();
  S.mods.forEach(buildMod);
  if (S.mode === '3d') { reset3dCam(); S.camSet = true; }
  refresh(); applyMode();
  if (had) hideStart();
  setStep(had ? (S.photo && !S.fit ? 2 : 3) : 1);
  loop();
  if (had && S.photo && !S.fit) openFit(true);
  setTimeout(() => $('#loading').classList.add('is-hidden'), 150);
})();
