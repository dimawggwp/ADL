// =====================================================================
//  ADL · Разметка стены по 4 углам
//  1) detectWall(img) — сам ищет на фото линию пола, потолка и углы стены
//     (градиенты + ориентированное преобразование Хафа, без ИИ и сервера);
//  2) solveWall(points) — по 4 углам точно восстанавливает камеру
//     (высота, наклон, поворот, завал, угол обзора) и размеры стены.
//  Чистая математика, без three.js — работает мгновенно на телефоне.
// =====================================================================

const D2R = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ===================== КАМЕРА ===================== */
// Та же модель, что у THREE.PerspectiveCamera с rotation.order = 'YXZ':
// камера в (cx, h, D/2) смотрит на заднюю стену z = -D/2.
// Координаты на фото: u — от левого края, v — от верхнего, в долях ВЫСОТЫ кадра.
function rotation(yaw, pitch, roll) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  // R = Ry · Rx · Rz
  return [
    [cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp],
    [cp * sr, cp * cr, -sp],
    [-sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp],
  ];
}
export function project(cam, D, aspect, X, Y, Z) {
  const R = rotation(cam.yaw * D2R, cam.pitch * D2R, (cam.roll || 0) * D2R);
  const px = X - cam.x, py = Y - cam.h, pz = Z - D / 2;
  // p_cam = Rᵀ · (P − C)
  const xc = R[0][0] * px + R[1][0] * py + R[2][0] * pz;
  const yc = R[0][1] * px + R[1][1] * py + R[2][1] * pz;
  const zc = R[0][2] * px + R[1][2] * py + R[2][2] * pz;
  const f = 1 / (2 * Math.tan((cam.fov * D2R) / 2));
  const depth = -zc;
  return { u: aspect / 2 + (f * xc) / depth, v: 0.5 - (f * yc) / depth, ok: depth > 0.05 };
}

/* ===================== РЕШАТЕЛЬ ===================== */
// Левенберг — Марквардт с численным якобианом
function solveLinear(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function lm(resFn, x0, lo, hi, iters = 120) {
  const n = x0.length;
  let x = x0.slice(), r = resFn(x), cost = r.reduce((s, v) => s + v * v, 0), lambda = 1e-3;
  for (let it = 0; it < iters; it++) {
    const J = [];
    for (let j = 0; j < n; j++) {
      const h = 1e-5 * Math.max(1, Math.abs(x[j]));
      const xp = x.slice(); xp[j] += h;
      const rp = resFn(xp);
      J.push(rp.map((v, i) => (v - r[i]) / h));
    }
    const JTJ = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J[a].reduce((s, v, i) => s + v * J[b][i], 0)));
    const JTr = J.map((col) => col.reduce((s, v, i) => s + v * r[i], 0));
    let improved = false;
    for (let tries = 0; tries < 10 && !improved; tries++) {
      const A = JTJ.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-12 : v)));
      const dx = solveLinear(A, JTr.map((v) => -v));
      if (!dx) { lambda *= 10; continue; }
      const xn = x.map((v, j) => clamp(v + dx[j], lo[j], hi[j]));
      const rn = resFn(xn), cn = rn.reduce((s, v) => s + v * v, 0);
      if (cn < cost) {
        const dc = cost - cn;
        x = xn; r = rn; cost = cn; lambda = Math.max(lambda / 4, 1e-9); improved = true;
        if (dc < 1e-10 * (1 + cost)) return { x, cost };
      } else lambda *= 6;
    }
    if (!improved) break;
  }
  return { x, cost };
}

/**
 * Восстанавливает камеру и размеры стены по 4 углам.
 * @param pts  {fl, fr, cl, cr} — углы в долях кадра {x:0..1, y:0..1} (пол-лево, пол-право, потолок-лево, потолок-право)
 * @param o    { aspect, fov0, H (высота потолка, м), Hsure (введена вручную), Wm (ширина стены рулеткой, м | null), ceilHidden }
 */
export function solveWall(pts, o) {
  const A = o.aspect;
  const P = (p) => ({ u: p.x * A, v: p.y });
  const fl = P(pts.fl), fr = P(pts.fr), cl = P(pts.cl), cr = P(pts.cr);
  const f0 = 1 / (2 * Math.tan((o.fov0 * D2R) / 2));
  const H0 = o.H || 2.7;
  const SIG = 0.0035;               // точность пальца/лупы ≈ 3–4 px на 1000
  // параметры: [h, pitch, yaw, roll, fov, cx, W, D, H]
  const lo = [0.15, -60, -60, -20, 22, -4, 0.4, 0.6, 1.8];
  const hi = [2.8, 45, 60, 20, 115, 4, 14, 16, 4.5];
  const cam = (x) => ({ h: x[0], pitch: x[1], yaw: x[2], roll: x[3], fov: x[4], x: x[5] });
  const lineDist = (q, a, b) => { const dx = b.u - a.u, dy = b.v - a.v, L = Math.hypot(dx, dy) || 1e-9; return ((q.u - a.u) * dy - (q.v - a.v) * dx) / L; };

  const res = (x) => {
    const c = cam(x), W = x[6], D = x[7], H = x[8], z = -D / 2;
    const pFL = project(c, D, A, -W / 2, 0, z), pFR = project(c, D, A, W / 2, 0, z);
    const pCL = project(c, D, A, -W / 2, H, z), pCR = project(c, D, A, W / 2, H, z);
    const bad = !(pFL.ok && pFR.ok && pCL.ok && pCR.ok) ? 50 : 0;
    const r = [
      (pFL.u - fl.u) / SIG + bad, (pFL.v - fl.v) / SIG,
      (pFR.u - fr.u) / SIG, (pFR.v - fr.v) / SIG,
    ];
    if (o.ceilHidden) {
      // верхние точки лежат где-то на вертикальном ребре угла — высота неизвестна
      r.push(lineDist(cl, pFL, pCL) / SIG, lineDist(cr, pFR, pCR) / SIG);
    } else {
      r.push((pCL.u - cl.u) / SIG, (pCL.v - cl.v) / SIG, (pCR.u - cr.u) / SIG, (pCR.v - cr.v) / SIG);
    }
    // априорные знания: обычный телефон, человек стоит и держит его почти ровно
    r.push((x[4] - o.fov0) / (o.fovSure ? 3 : 9));
    r.push(x[3] / 4);
    r.push((x[0] - 1.4) / (o.ceilHidden && !o.Wm ? 0.25 : 0.9));
    r.push(x[5] / 2.5, x[2] / 35);
    r.push((x[8] - H0) / (o.Hsure ? 0.004 : o.ceilHidden ? 0.4 : 0.12));
    if (o.Wm) r.push((x[6] - o.Wm) / 0.004);
    return r;
  };

  // начальное приближение из геометрии четырёхугольника
  const hv = (Math.abs(fl.v - cl.v) + Math.abs(fr.v - cr.v)) / 2 || 0.5;
  const wv = (Math.abs(fr.u - fl.u) + Math.abs(cr.u - cl.u)) / 2 || 0.5;
  const D0 = clamp(H0 * f0 / (o.ceilHidden ? hv * 1.4 : hv), 1, 12);
  const W0 = clamp(o.Wm || H0 * wv / (o.ceilHidden ? hv * 1.4 : hv), 0.5, 12);
  const vh = (fl.v + fr.v) / 2 + (((cl.v + cr.v) / 2 - (fl.v + fr.v) / 2) * 1.4) / H0;
  const pitch0 = -Math.atan((0.5 - vh) / f0) / D2R;
  const um = (fl.u + fr.u + cl.u + cr.u) / 4;
  const yaw0 = Math.atan((um - A / 2) / f0) / D2R;
  const roll0 = -Math.atan2(fr.v - fl.v, fr.u - fl.u) / D2R * 0.5;
  const starts = [
    [1.4, pitch0, yaw0, roll0, o.fov0, 0, W0, D0, H0],
    [1.4, pitch0, 0, 0, o.fov0, 0, W0, D0, H0],
    [1.2, pitch0 - 6, yaw0 * 0.5, 0, o.fov0, 0.4, W0, D0 * 0.8, H0],
    [1.6, pitch0 + 6, yaw0 * 0.5, 0, o.fov0, -0.4, W0, D0 * 1.25, H0],
    [1.4, pitch0, -yaw0, 0, o.fov0 * 0.85, 0, W0, D0, H0],
  ].map((s) => s.map((v, j) => clamp(v, lo[j], hi[j])));
  let best = null;
  for (const s of starts) { const r = lm(res, s, lo, hi); if (!best || r.cost < best.cost) best = r; }
  const x = best.x, c = cam(x), W = x[6], D = x[7], H = x[8];

  // качество: невязка точек в пикселях (на 1000 px высоты) и ошибка в сантиметрах на стене
  const z = -D / 2;
  const P4 = [[-W / 2, 0, fl], [W / 2, 0, fr], ...(o.ceilHidden ? [] : [[-W / 2, H, cl], [W / 2, H, cr]])];
  const err = Math.sqrt(P4.reduce((s, [X, Y, q]) => { const p = project(c, D, A, X, Y, z); return s + (p.u - q.u) ** 2 + (p.v - q.v) ** 2; }, 0) / P4.length);
  const f = 1 / (2 * Math.tan((c.fov * D2R) / 2));
  const dist = Math.hypot(c.x, c.h - H / 2, D);
  const errCm = Math.max(0.5, (err + 0.002) * dist / f * 100);       // + 2 px на неточность пальца
  const scaleCm = o.Wm || o.Hsure ? 0 : (o.ceilHidden ? 0.08 : 0.03) * W * 100; // неизвестен масштаб
  return {
    cam: { h: c.h, pitch: c.pitch, yaw: c.yaw, roll: c.roll, fov: c.fov, x: c.x },
    room: { W, H, D: Math.max(D, 1.2) },
    errPx: err * 1000, errCm, scaleCm,
    quality: err < 0.006 ? 'good' : err < 0.015 ? 'ok' : 'rough',
  };
}

/* ===================== АВТОПОИСК УГЛОВ ===================== */
/**
 * Ищет на фото заднюю стену: линию пола, потолка и вертикальные углы.
 * @returns {{pts:{fl,fr,cl,cr}|null, snaps:{x,y}[], conf:number}}
 */
export function detectWall(img) {
  const SW = 384;
  const s = SW / img.naturalWidth, SH = Math.max(8, Math.round(img.naturalHeight * s));
  const cv = document.createElement('canvas'); cv.width = SW; cv.height = SH;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0, SW, SH);
  const px = cx.getImageData(0, 0, SW, SH).data;
  const N = SW * SH, g = new Float32Array(N);
  for (let i = 0; i < N; i++) g[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
  // лёгкое размытие 3×3
  const b = new Float32Array(N);
  for (let y = 1; y < SH - 1; y++) for (let x = 1; x < SW - 1; x++) {
    let sum = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += g[(y + dy) * SW + x + dx];
    b[y * SW + x] = sum / 9;
  }
  // Собель
  const mag = new Float32Array(N), ang = new Float32Array(N);
  const hist = new Uint32Array(256);
  for (let y = 2; y < SH - 2; y++) for (let x = 2; x < SW - 2; x++) {
    const i = y * SW + x;
    const gx = b[i - SW + 1] + 2 * b[i + 1] + b[i + SW + 1] - b[i - SW - 1] - 2 * b[i - 1] - b[i + SW - 1];
    const gy = b[i + SW - 1] + 2 * b[i + SW] + b[i + SW + 1] - b[i - SW - 1] - 2 * b[i - SW] - b[i - SW + 1];
    const m = Math.hypot(gx, gy); mag[i] = m; ang[i] = Math.atan2(gy, gx);
    hist[Math.min(255, m >> 2)]++;
  }
  let acc = 0, thr = 255; const need = N * 0.12;
  for (let k = 255; k >= 0; k--) { acc += hist[k]; if (acc >= need) { thr = k; break; } }
  thr = Math.max(14, thr * 4);

  // ориентированный Хаф: каждый пиксель голосует только за линии, перпендикулярные его градиенту
  const NT = 180, diag = Math.ceil(Math.hypot(SW, SH)), NR = diag * 2 + 1;
  const H = new Float32Array(NT * NR);
  const cosT = new Float32Array(NT), sinT = new Float32Array(NT);
  for (let t = 0; t < NT; t++) { cosT[t] = Math.cos(t * D2R); sinT[t] = Math.sin(t * D2R); }
  const edge = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (mag[i] < thr) continue;
    edge[i] = 1;
    const x = i % SW, y = (i / SW) | 0;
    let t0 = Math.round(ang[i] / D2R); t0 = ((t0 % 180) + 180) % 180;
    for (let dt = -2; dt <= 2; dt++) {
      const t = (t0 + dt + 180) % 180;
      const r = Math.round(x * cosT[t] + y * sinT[t]) + diag;
      H[t * NR + r] += 1;
    }
  }
  // пики
  const peaks = [];
  const minVotes = Math.min(SW, SH) * 0.12;
  for (let t = 0; t < NT; t++) for (let r = 2; r < NR - 2; r++) {
    const v = H[t * NR + r]; if (v < minVotes) continue;
    let isMax = true;
    for (let dt = -4; dt <= 4 && isMax; dt++) for (let dr = -6; dr <= 6; dr++) {
      if (!dt && !dr) continue;
      const tt = (t + dt + NT) % NT, rr = dt + t < 0 || dt + t >= NT ? NR - 1 - r + dr : r + dr;
      if (rr < 0 || rr >= NR) continue;
      if (H[tt * NR + rr] > v) { isMax = false; break; }
    }
    if (isMax) peaks.push({ t, r: r - diag, v });
  }
  peaks.sort((a, b2) => b2.v - a.v);
  const lines = peaks.slice(0, 60).map((p) => segment(p)).filter(Boolean);

  // опора линии: самый длинный участок, где реально есть край нужного направления
  function segment(p) {
    const c = cosT[p.t], sn = sinT[p.t];
    const dx = -sn, dy = c;                 // направление линии
    const x0 = p.r * c, y0 = p.r * sn;      // ближайшая к началу координат точка
    let best = null, run = null, gap = 0;
    for (let k = -diag; k <= diag; k++) {
      const x = x0 + dx * k, y = y0 + dy * k;
      if (x < 2 || y < 2 || x >= SW - 2 || y >= SH - 2) continue;
      let on = false;
      for (let o = -1; o <= 1 && !on; o++) {
        const xi = Math.round(x + c * o), yi = Math.round(y + sn * o), i = yi * SW + xi;
        if (!edge[i]) continue;
        let da = Math.abs(((ang[i] / D2R - p.t) % 180 + 180) % 180); da = Math.min(da, 180 - da);
        if (da < 9) on = true;
      }
      if (on) { if (!run) run = { a: k, b: k, n: 0 }; run.b = k; run.n++; gap = 0; }
      else if (run && ++gap > 7) { if (!best || run.n > best.n) best = run; run = null; gap = 0; }
    }
    if (run && (!best || run.n > best.n)) best = run;
    if (!best || best.n < 18) return null;
    const ax = x0 + dx * best.a, ay = y0 + dy * best.a, bx = x0 + dx * best.b, by = y0 + dy * best.b;
    return { t: p.t, r: p.r, c, s: sn, len: best.n, a: { x: ax, y: ay }, b: { x: bx, y: by }, mx: (ax + bx) / 2, my: (ay + by) / 2 };
  }

  const isH = (l) => Math.abs(l.t - 90) < 32;              // почти горизонтальная (нормаль вертикальна)
  const isV = (l) => l.t < 9 || l.t > 171;                  // почти вертикальная
  const hs = lines.filter(isH), vs = lines.filter(isV);
  const yAt = (l, x) => (l.r - x * l.c) / l.s;
  const xAt = (l, y) => (l.r - y * l.s) / l.c;
  const meet = (h, v) => { // пересечение двух прямых
    const det = h.c * v.s - h.s * v.c; if (Math.abs(det) < 1e-6) return null;
    return { x: (h.r * v.s - v.r * h.s) / det, y: (h.c * v.r - v.c * h.r) / det };
  };

  const floorC = hs.filter((l) => l.my > SH * 0.42 && l.my < SH * 0.985 && l.len > SW * 0.22)
    .map((l) => ({ l, sc: l.len * (0.55 + 0.6 * l.my / SH) * (1 - Math.abs(l.t - 90) / 60) }))
    .sort((a, b2) => b2.sc - a.sc);
  const ceilC = hs.filter((l) => l.my > SH * 0.01 && l.my < SH * 0.42 && l.len > SW * 0.22)
    .map((l) => ({ l, sc: l.len * (1.15 - 0.6 * l.my / SH) * (1 - Math.abs(l.t - 90) / 60) }))
    .sort((a, b2) => b2.sc - a.sc);
  const floor = floorC[0]?.l || null, ceil = ceilC[0]?.l || null;

  // вертикальные углы: длинная вертикаль, перекрывающая промежуток пол—потолок
  const pickV = (side) => {
    const c = vs.filter((l) => (side < 0 ? l.mx < SW * 0.5 : l.mx > SW * 0.5)).map((l) => {
      const yTop = ceil ? yAt(ceil, l.mx) : SH * 0.1, yBot = floor ? yAt(floor, l.mx) : SH * 0.85;
      const span = Math.max(20, yBot - yTop);
      const lo2 = Math.max(Math.min(l.a.y, l.b.y), yTop), hi2 = Math.min(Math.max(l.a.y, l.b.y), yBot);
      const cover = Math.max(0, hi2 - lo2) / span;
      // угол стены — вертикаль, которая доходит и до пола, и до потолка
      const reachBot = Math.max(l.a.y, l.b.y) > yBot - span * 0.12 ? 1 : 0.7;
      const reachTop = Math.min(l.a.y, l.b.y) < yTop + span * 0.12 ? 1 : 0.8;
      return { l, sc: cover * reachBot * reachTop * Math.min(1, l.len / (span * 0.8)), cover };
    }).filter((x) => x.cover > 0.45).sort((a, b2) => b2.sc - a.sc);
    return c[0]?.l || null;
  };
  const vl = pickV(-1), vr = pickV(1);

  // точки для «примагничивания»
  const snaps = [];
  const topH = hs.slice(0, 10), topV = vs.slice(0, 10);
  topH.forEach((h) => topV.forEach((v) => { const p = meet(h, v); if (p && p.x > -SW * 0.05 && p.x < SW * 1.05 && p.y > -SH * 0.05 && p.y < SH * 1.05) snaps.push({ x: p.x / SW, y: p.y / SH }); }));

  let conf = 0;
  if (!floor) return { pts: null, snaps, conf };
  const edgeX = (side) => (side < 0 ? 0.02 * SW : 0.98 * SW);
  const cornerOn = (hl, v, side, yFallback) => {
    if (hl && v) { const p = meet(hl, v); if (p) return p; }
    if (hl) return { x: v ? xAt(v, yAt(hl, edgeX(side))) : edgeX(side), y: yAt(hl, edgeX(side)) };
    const x = v ? xAt(v, yFallback) : edgeX(side);
    return { x, y: yFallback };
  };
  const fl = cornerOn(floor, vl, -1), fr = cornerOn(floor, vr, 1);
  const cl = ceil ? cornerOn(ceil, vl, -1) : { x: vl ? xAt(vl, SH * 0.08) : fl.x, y: SH * 0.08 };
  const cr = ceil ? cornerOn(ceil, vr, 1) : { x: vr ? xAt(vr, SH * 0.08) : fr.x, y: SH * 0.08 };
  // здравый смысл
  const okQuad = fr.x - fl.x > SW * 0.25 && cr.x - cl.x > SW * 0.2 && fl.y - cl.y > SH * 0.25 && fr.y - cr.y > SH * 0.25;
  if (!okQuad) return { pts: null, snaps, conf: 0 };
  conf = 0.4 + (ceil ? 0.2 : 0) + (vl ? 0.2 : 0) + (vr ? 0.2 : 0);
  const n = (p) => ({ x: clamp(p.x / SW, -0.2, 1.2), y: clamp(p.y / SH, -0.2, 1.2) });
  return { pts: { fl: n(fl), fr: n(fr), cl: n(cl), cr: n(cr) }, snaps, conf };
}

/* ===================== ЯРКОСТЬ ФОТО ===================== */
// средняя яркость и «теплота» фото, чтобы мебель не выглядела наклеенной
export function photoTone(img) {
  const c = document.createElement('canvas'); c.width = 48; c.height = Math.max(8, Math.round(48 * img.naturalHeight / img.naturalWidth));
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let r = 0, g = 0, b = 0; const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  r /= n; g /= n; b /= n;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const warm = clamp((r - b) / 80, -1, 1);
  return { lum, warm };
}
