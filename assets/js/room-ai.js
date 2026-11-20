// =====================================================================
//  ADL · ИИ-анализ комнаты: вызов Gemini (через Supabase Edge Function),
//  автокалибровка камеры по найденным линиям, препятствия в метрах.
// =====================================================================
import * as THREE from 'three';
import { SUPABASE } from './config.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const deg = THREE.MathUtils.degToRad;

/* ---------- EXIF: фокусное расстояние в эквиваленте 35 мм ---------- */
export async function readFocal35(file) {
  try {
    const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (buf.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off < buf.byteLength - 4) {
      const marker = buf.getUint16(off), len = buf.getUint16(off + 2);
      if (marker === 0xffe1 && buf.getUint32(off + 4) === 0x45786966) { // "Exif"
        const t = off + 10, le = buf.getUint16(t) === 0x4949;
        const u16 = (p) => buf.getUint16(t + p, le), u32 = (p) => buf.getUint32(t + p, le);
        const readIFD = (p) => { const n = u16(p), tags = {}; for (let i = 0; i < n; i++) { const e = p + 2 + i * 12; tags[u16(e)] = { type: u16(e + 2), val: e + 8 }; } return tags; };
        const ifd0 = readIFD(u32(4));
        if (!ifd0[0x8769]) return null;
        const exif = readIFD(u32(ifd0[0x8769].val));
        const f35 = exif[0xa405];
        if (f35) { const v = u16(f35.val); if (v > 8 && v < 300) return v; }
        return null;
      }
      off += 2 + len;
    }
  } catch { /* нет EXIF — не страшно */ }
  return null;
}
// вертикальный угол обзора для кадра w×h
export function fovFromFocal(f35, w, h) {
  const dHalf = Math.atan(43.27 / (2 * (f35 || 26)));
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(dHalf) * h / Math.hypot(w, h)));
}

/* ---------- подготовка фото и запрос к ИИ ---------- */
export function imageToBase64(img, maxSide = 1280) {
  const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}
export async function analyzeRoom(base64) {
  const r = await fetch(`${SUPABASE.url}/functions/v1/room-ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE.anonKey, Authorization: `Bearer ${SUPABASE.anonKey}` },
    body: JSON.stringify({ image: base64, mime: 'image/jpeg' }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d.result;
}

/* ---------- автокалибровка ---------- */
// точки ИИ: {x,y} в 0..1000 → координаты, где 1 = высота кадра
const P = (p, aspect) => ({ x: (p.x / 1000) * aspect, y: p.y / 1000 });
const valid = (pts) => Array.isArray(pts) && pts.length >= 2 && pts.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));

function distToLine(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1e-6;
  return ((p.x - a.x) * dy - (p.y - a.y) * dx) / L;
}

function nelderMead(f, x0, step, iters = 900) {
  const n = x0.length;
  let pts = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step[i]; pts.push(x); }
  let vals = pts.map(f);
  for (let k = 0; k < iters; k++) {
    const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    pts = idx.map((i) => pts[i]); vals = idx.map((i) => vals[i]);
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i][j] / n;
    const worst = pts[n];
    const xr = c.map((v, j) => v + (v - worst[j])), fr = f(xr);
    if (fr < vals[0]) {
      const xe = c.map((v, j) => v + 2 * (v - worst[j])), fe = f(xe);
      if (fe < fr) { pts[n] = xe; vals[n] = fe; } else { pts[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]) { pts[n] = xr; vals[n] = fr; }
    else {
      const xc = c.map((v, j) => v + 0.5 * (worst[j] - v)), fc = f(xc);
      if (fc < vals[n]) { pts[n] = xc; vals[n] = fc; }
      else { for (let i = 1; i <= n; i++) { pts[i] = pts[i].map((v, j) => pts[0][j] + 0.5 * (v - pts[0][j])); vals[i] = f(pts[i]); } }
    }
    if (Math.abs(vals[n] - vals[0]) < 1e-12) break;
  }
  const best = vals.indexOf(Math.min(...vals));
  return { x: pts[best], f: vals[best] };
}

/**
 * Подбирает камеру и размеры комнаты так, чтобы линии комнаты совпали с фото.
 * @returns {{cam:{h,pitch,yaw,fov,x}, room:{W,D,H}, error:number, quality:'good'|'ok'|'rough'}}
 */
export function calibrate(ai, aspect, fov0) {
  const H = clamp(Number(ai.ceiling_height_m) || 2.7, 2.3, 3.6);
  const Wg = clamp(Number(ai.back_wall_width_m) || 3.5, 1.2, 9);
  const bw = ai.back_wall || {};
  const floor = valid(bw.floor_line) ? bw.floor_line.map((p) => P(p, aspect)) : null;
  const ceil = valid(bw.ceiling_line) ? bw.ceiling_line.map((p) => P(p, aspect)) : null;
  const lf = valid(ai.left_floor_line) ? ai.left_floor_line.map((p) => P(p, aspect)) : null;
  const rf = valid(ai.right_floor_line) ? ai.right_floor_line.map((p) => P(p, aspect)) : null;
  const lcx = Number.isFinite(bw.left_corner_x) ? (bw.left_corner_x / 1000) * aspect : null;
  const rcx = Number.isFinite(bw.right_corner_x) ? (bw.right_corner_x / 1000) * aspect : null;
  if (!floor) throw new Error('ИИ не нашёл линию пола');

  const cam = new THREE.PerspectiveCamera(60, aspect, 0.01, 100);
  cam.rotation.order = 'YXZ';
  const v = new THREE.Vector3();
  const proj = (x, y, z) => { v.set(x, y, z).project(cam); return { x: ((v.x + 1) / 2) * aspect, y: (1 - v.y) / 2, ok: v.z < 1 }; };

  // p = [h, pitch, yaw, fov, camX, W, D]
  const f = (p) => {
    const [h, pitch, yaw, fov, cx, W, D] = p;
    cam.fov = fov; cam.updateProjectionMatrix();
    cam.position.set(cx, h, D / 2); cam.rotation.set(deg(pitch), deg(yaw), 0); cam.updateMatrixWorld();
    let e = 0;
    const z0 = -D / 2;
    const fa = proj(-W / 2, 0, z0), fb = proj(W / 2, 0, z0);
    if (!fa.ok || !fb.ok) return 1e6;
    floor.forEach((q) => { e += distToLine(q, fa, fb) ** 2 * 4; });
    if (ceil) { const ca = proj(-W / 2, H, z0), cb = proj(W / 2, H, z0); ceil.forEach((q) => { e += distToLine(q, ca, cb) ** 2 * 2; }); }
    if (lcx != null) e += (fa.x - lcx) ** 2 * 3;
    if (rcx != null) e += (fb.x - rcx) ** 2 * 3;
    const zn = D / 2 - Math.min(1, D * 0.4);
    if (lf) { const a = fa, b = proj(-W / 2, 0, zn); if (b.ok) lf.forEach((q) => { e += distToLine(q, a, b) ** 2; }); }
    if (rf) { const a = fb, b = proj(W / 2, 0, zn); if (b.ok) rf.forEach((q) => { e += distToLine(q, a, b) ** 2; }); }
    // мягкие «априорные» ограничения: типичный телефон, человек стоит ровно
    e += ((fov - fov0) / 12) ** 2 * 0.004;
    e += ((h - 1.4) / 0.5) ** 2 * 0.0015;
    e += (cx / 1.5) ** 2 * 0.0008;
    e += (yaw / 25) ** 2 * 0.0006;
    if (lcx == null || rcx == null) e += ((W - Wg) / Wg) ** 2 * 0.002;
    // жёсткие границы
    const pen = (val, lo, hi) => (val < lo ? (lo - val) ** 2 : val > hi ? (val - hi) ** 2 : 0);
    e += 10 * (pen(h, 0.5, 2.2) + pen(pitch, -45, 30) + pen(yaw, -45, 45) + pen(fov, 28, 105) + pen(cx, -3, 3) + pen(W, 1, 10) + pen(D, 1.2, 12));
    return e;
  };

  const starts = [
    [1.4, -5, 0, fov0, 0, Wg, 4],
    [1.2, -12, 0, fov0, 0, Wg, 3],
    [1.6, 0, 0, fov0, 0, Wg, 5.5],
    [1.4, -8, 8, fov0, 0.3, Wg, 4],
    [1.4, -8, -8, fov0, -0.3, Wg, 4],
  ];
  const step = [0.25, 6, 6, 8, 0.4, 0.8, 1.2];
  let best = null;
  for (const s of starts) {
    let r = nelderMead(f, s, step);
    r = nelderMead(f, r.x, step.map((v) => v * 0.25), 600);
    if (!best || r.f < best.f) best = r;
  }
  const [h, pitch, yaw, fov, cx, W, D] = best.x;
  const nPts = floor.length + (ceil?.length || 0) + (lf?.length || 0) + (rf?.length || 0);
  const rms = Math.sqrt(best.f / Math.max(1, nPts));
  return {
    cam: { h: clamp(h, 0.5, 2.2), pitch: clamp(pitch, -45, 30), yaw: clamp(yaw, -45, 45), fov: clamp(fov, 28, 105), x: clamp(cx, -3, 3) },
    room: { W: clamp(W, 1, 10), D: clamp(D, 1.2, 12), H },
    error: rms,
    quality: rms < 0.012 ? 'good' : rms < 0.03 ? 'ok' : 'rough',
  };
}

/* ---------- препятствия: из пикселей в метры ---------- */
const BLOCKING = { door: 0.05, radiator: 0.1, window: 0.03, pipe: 0.05, column: 0.02, furniture: 0.02, air_conditioner: 0.05, niche: 0, other: 0.02 };
export const OBSTACLE_NAMES = { window: 'окно', door: 'дверь', radiator: 'радиатор', outlet: 'розетка', switch: 'выключатель', pipe: 'труба', air_conditioner: 'кондиционер', column: 'колонна', niche: 'ниша', furniture: 'мебель', other: 'препятствие' };

export function obstaclesToWorld(ai, calib, aspect) {
  const cam = new THREE.PerspectiveCamera(calib.cam.fov, aspect, 0.01, 100);
  cam.rotation.order = 'YXZ';
  cam.position.set(calib.cam.x, calib.cam.h, calib.room.D / 2);
  cam.rotation.set(deg(calib.cam.pitch), deg(calib.cam.yaw), deg(calib.cam.roll || 0));
  cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const ray = new THREE.Raycaster(), hit = new THREE.Vector3();
  const { W, D, H } = calib.room;
  const planes = {
    back: new THREE.Plane(new THREE.Vector3(0, 0, 1), D / 2),
    floor: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    left: new THREE.Plane(new THREE.Vector3(1, 0, 0), W / 2),
    right: new THREE.Plane(new THREE.Vector3(-1, 0, 0), W / 2),
  };
  const at = (px, py, plane) => {
    ray.setFromCamera(new THREE.Vector2((px / 1000) * 2 - 1, -((py / 1000) * 2 - 1)), cam);
    return ray.ray.intersectPlane(plane, hit) ? hit.clone() : null;
  };
  const out = [];
  (ai.obstacles || []).forEach((o) => {
    const b = o.box; if (!b) return;
    const surf = planes[o.surface] ? o.surface : 'back';
    if (surf === 'back' || (surf === 'floor' && ['radiator', 'pipe', 'furniture', 'column', 'other'].includes(o.type))) {
      // предметы у задней стены: проецируем на стену
      const tl = at(b.xmin, b.ymin, planes.back), br = at(b.xmax, b.ymax, planes.back);
      if (!tl || !br) return;
      out.push({ type: o.type, label: OBSTACLE_NAMES[o.type] || o.label, surface: 'back',
        x0: clamp(Math.min(tl.x, br.x), -W / 2, W / 2), x1: clamp(Math.max(tl.x, br.x), -W / 2, W / 2),
        y0: clamp(Math.min(tl.y, br.y), 0, H), y1: clamp(Math.max(tl.y, br.y), 0, H),
        margin: BLOCKING[o.type] ?? 0, blocks: o.type in BLOCKING });
    } else if (surf === 'left' || surf === 'right') {
      const p = planes[surf], a = at(b.xmin, b.ymax, p), c = at(b.xmax, b.ymax, p), t = at((b.xmin + b.xmax) / 2, b.ymin, p);
      if (!a || !c || !t) return;
      out.push({ type: o.type, label: OBSTACLE_NAMES[o.type] || o.label, surface: surf,
        z0: Math.min(a.z, c.z), z1: Math.max(a.z, c.z), y0: clamp(Math.min(a.y, c.y), 0, H), y1: clamp(t.y, 0, H),
        margin: BLOCKING[o.type] ?? 0, blocks: o.type in BLOCKING });
    }
  });
  return out;
}

/* ---------- свет ---------- */
export function lightFromAI(l, room) {
  const { W, D, H } = room;
  const pos = {
    left: [-W * 0.9, H + 0.6, 0], right: [W * 0.9, H + 0.6, 0], front: [W * 0.15, H + 1, -D * 1.2],
    behind: [W * 0.2, H + 1, D * 1.1], top: [W * 0.2, H + 2.5, D * 0.1],
  }[l?.main_source] || [W * 0.55, H + 0.8, D * 0.45];
  const color = { warm: 0xffdcb8, neutral: 0xfff0dc, cool: 0xe6eeff }[l?.warmth] || 0xfff0dc;
  return { pos, color, k: clamp(0.55 + (Number(l?.brightness) || 0.6) * 0.75, 0.5, 1.4) };
}

/* ---------- очистка фото: ИИ убирает мусор и временные предметы ---------- */
// возвращает dataURL (JPEG) того же размера, что и исходное фото
export async function cleanPhoto(img) {
  const r = await fetch(`${SUPABASE.url}/functions/v1/room-ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE.anonKey, Authorization: `Bearer ${SUPABASE.anonKey}` },
    body: JSON.stringify({ action: 'clean', image: imageToBase64(img, 1536), mime: 'image/jpeg' }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok || !d.image) throw new Error(d.error || `HTTP ${r.status}`);
  const out = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `data:${d.mime || 'image/png'};base64,${d.image}`; });
  // приводим к точному размеру и пропорциям оригинала, чтобы разметка углов не съехала
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d');
  const ia = out.width / out.height, ta = c.width / c.height;
  let sw = out.width, sh = out.height, sx = 0, sy = 0;
  if (Math.abs(ia - ta) > 0.01) { if (ia > ta) { sw = out.height * ta; sx = (out.width - sw) / 2; } else { sh = out.width / ta; sy = (out.height - sh) / 2; } }
  x.drawImage(out, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.88);
}
