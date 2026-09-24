/*
 * 渲染、交互、UI 装配。依赖 window.SandElements / SandPhysics / SandPresets。
 */
(function () {
  'use strict';

  const EL = window.SandElements;
  const PH = window.SandPhysics;
  const PR = window.SandPresets;
  const E = EL.E, DEFS = EL.DEFS, CAT = EL.CAT;

  const GRID_W = 240, GRID_H = 150;        // 模拟分辨率（与画布显示尺寸无关）

  // ---------- 世界 ----------
  const world = new PH.World(GRID_W, GRID_H, (Date.now() ^ 0x5f3759df) >>> 0);
  const shown = PR.PRESETS.find(function (p) { return p.id === 'valley'; });
  shown.build(world);

  // ---------- 画布 ----------
  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d', { alpha: false });
  const off = document.createElement('canvas');
  off.width = GRID_W; off.height = GRID_H;
  const offCtx = off.getContext('2d', { alpha: false });
  const img = offCtx.createImageData(GRID_W, GRID_H);
  const px = img.data;

  // 背景（空格子）只算一次：暗色 + 轻微渐变，看着比纯黑有层次
  const bg = new Uint8ClampedArray(GRID_W * GRID_H * 4);
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const o = (y * GRID_W + x) * 4;
      const t = y / GRID_H;
      const grid = (x % 20 === 0 || y % 20 === 0) ? 4 : 0;
      bg[o] = 10 + t * 6 + grid;
      bg[o + 1] = 13 + t * 6 + grid;
      bg[o + 2] = 19 + t * 8 + grid;
      bg[o + 3] = 255;
    }
  }

  const COL_R = new Uint8Array(DEFS.length);
  const COL_G = new Uint8Array(DEFS.length);
  const COL_B = new Uint8Array(DEFS.length);
  const JIT = new Float32Array(DEFS.length);
  for (let i = 0; i < DEFS.length; i++) {
    const d = DEFS[i];
    COL_R[i] = d.color[0]; COL_G[i] = d.color[1]; COL_B[i] = d.color[2];
    JIT[i] = d.jitter;
  }

  let particleCount = 0;

  function render() {
    px.set(bg);
    const cells = world.cells, shade = world.shade, data = world.data;
    const n = world.n, w = world.w;
    const frame = world.frame;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const el = cells[i];
      if (el === E.EMPTY) continue;
      count++;
      const o = i * 4;
      const j = ((shade[i] / 255) - 0.5) * 2 * JIT[el];
      let r, g, b;
      if (el === E.FIRE) {
        const t = Math.min(1, data[i] / 90);
        r = 255;
        g = 70 + 165 * t + j * 60;
        b = 15 + 50 * t;
      } else if (el === E.LAVA) {
        const pulse = 0.82 + 0.18 * Math.sin(frame * 0.07 + i * 0.013);
        r = COL_R[el] * pulse * (1 + j * 0.5);
        g = (COL_G[el] + 40 * pulse) * (1 + j * 0.5);
        b = COL_B[el] * (1 + j * 0.5);
      } else {
        r = COL_R[el] * (1 + j);
        g = COL_G[el] * (1 + j);
        b = COL_B[el] * (1 + j);
      }
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    }
    particleCount = count;
    offCtx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  }

  function resize() {
    const box = canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.max(240, box.width - 2);
    const cssH = Math.max(160, Math.round(cssW * GRID_H / GRID_W));
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.imageSmoothingEnabled = false;
  }
  window.addEventListener('resize', resize);

  // ---------- 调色板 ----------
  const paletteBox = document.getElementById('palette');
  let current = E.SAND;
  let brush = 5;

  function css(c) { return '#' + c.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join(''); }

  EL.PALETTE.forEach(function (id, k) {
    const d = DEFS[id];
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.el = String(id);
    b.title = d.name + '：' + d.desc;
    b.innerHTML = '<span class="sw" style="background:' + css(d.color) + '"></span>' +
      '<span class="nm">' + d.name + '</span>' +
      '<span class="hk">' + (EL.HOTKEYS[k] || '') + '</span>';
    b.addEventListener('click', function () { select(id); });
    paletteBox.appendChild(b);
  });

  const tipEl = document.getElementById('tip');
  function select(id) {
    current = id;
    Array.prototype.forEach.call(paletteBox.children, function (c) {
      c.classList.toggle('on', Number(c.dataset.el) === id);
    });
    const d = DEFS[id];
    tipEl.textContent = d.name + ' · ' + d.desc;
    updateHud();
  }

  // ---------- 笔刷 ----------
  const brushInput = document.getElementById('brush');
  const brushVal = document.getElementById('brushVal');
  function setBrush(v) {
    brush = Math.max(0, Math.min(24, v | 0));
    brushInput.value = String(brush);
    brushVal.textContent = String(brush);
  }
  brushInput.addEventListener('input', function () { setBrush(Number(brushInput.value)); });

  // ---------- 场景 / 天气 / 控制 ----------
  const presetBox = document.getElementById('presets');
  PR.PRESETS.forEach(function (p) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = p.name;
    b.addEventListener('click', function () {
      world.clear();
      p.build(world);
      flash(p.name);
    });
    presetBox.appendChild(b);
  });

  let weather = 'none';
  const weatherModes = [
    { id: 'none', name: '无' },
    { id: 'rain', name: '小雨' },
    { id: 'storm', name: '暴雨' },
    { id: 'acid', name: '酸雨' },
  ];
  const weatherBox = document.getElementById('weather');
  weatherModes.forEach(function (m) {
    const b = document.createElement('button');
    b.className = 'btn' + (m.id === weather ? ' on' : '');
    b.textContent = m.name;
    b.dataset.w = m.id;
    b.addEventListener('click', function () {
      weather = m.id;
      Array.prototype.forEach.call(weatherBox.children, function (c) {
        c.classList.toggle('on', c.dataset.w === weather);
      });
    });
    weatherBox.appendChild(b);
  });

  function weatherStep() {
    if (weather === 'none') return;
    const el = weather === 'acid' ? E.ACID : E.WATER;
    const drops = weather === 'storm' ? 5 : (weather === 'rain' ? 2 : 3);
    for (let k = 0; k < drops; k++) {
      const x = (world.rng() * GRID_W) | 0;
      const y = weather === 'storm' ? 0 : ((world.rng() * 3) | 0);
      const i = world.idx(x, y);
      if (world.cells[i] === E.EMPTY) world.setCell(i, el);
    }
  }

  let paused = false;
  let speed = 1;
  const pauseBtn = document.getElementById('pause');
  pauseBtn.addEventListener('click', function () { setPaused(!paused); });
  function setPaused(v) {
    paused = v;
    pauseBtn.textContent = paused ? '继续' : '暂停';
    pauseBtn.classList.toggle('on', paused);
  }
  document.getElementById('stepBtn').addEventListener('click', function () { world.step(); render(); });
  document.getElementById('clearBtn').addEventListener('click', function () { world.clear(); flash('已清空'); });

  const speedBox = document.getElementById('speed');
  [1, 2, 3].forEach(function (s) {
    const b = document.createElement('button');
    b.className = 'btn' + (s === 1 ? ' on' : '');
    b.textContent = s + '×';
    b.addEventListener('click', function () {
      speed = s;
      Array.prototype.forEach.call(speedBox.children, function (c) { c.classList.toggle('on', c.textContent === s + '×'); });
    });
    speedBox.appendChild(b);
  });

  const flashEl = document.getElementById('flash');
  let flashTimer = 0;
  function flash(text) {
    flashEl.textContent = text;
    flashEl.classList.add('show');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { flashEl.classList.remove('show'); }, 900);
  }

  // ---------- 输入 ----------
  let down = false, lastX = 0, lastY = 0, erasing = false;

  function toGrid(ev) {
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.round((ev.clientX - r.left) / r.width * GRID_W),
      y: Math.round((ev.clientY - r.top) / r.height * GRID_H),
    };
  }

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  canvas.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    canvas.setPointerCapture(ev.pointerId);
    down = true;
    erasing = (ev.button === 2) || ev.shiftKey;
    const p = toGrid(ev);
    lastX = p.x; lastY = p.y;
    world.paint(p.x, p.y, erasing ? E.EMPTY : current, brush);
  });

  canvas.addEventListener('pointermove', function (ev) {
    const p = toGrid(ev);
    hudCursor.textContent = p.x + ',' + p.y;
    if (!down) return;
    world.paintLine(lastX, lastY, p.x, p.y, erasing ? E.EMPTY : current, brush);
    lastX = p.x; lastY = p.y;
  });

  function endStroke(ev) {
    if (!down) return;
    down = false;
    try { canvas.releasePointerCapture(ev.pointerId); } catch (e) { /* 忽略 */ }
  }
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('pointerleave', function () { down = false; });

  canvas.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    setBrush(brush + (ev.deltaY < 0 ? 1 : -1));
  }, { passive: false });

  window.addEventListener('keydown', function (ev) {
    const tag = (ev.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    const k = ev.key.toLowerCase();
    const hi = EL.HOTKEYS.indexOf(k);
    if (hi >= 0 && EL.PALETTE[hi] !== undefined) { select(EL.PALETTE[hi]); return; }
    if (k === ' ') { ev.preventDefault(); setPaused(!paused); }
    else if (k === 'c') { world.clear(); flash('已清空'); }
    else if (k === '.') { world.step(); render(); }
    else if (k === '[') setBrush(brush - 1);
    else if (k === ']') setBrush(brush + 1);
  });

  // ---------- HUD ----------
  const hudFps = document.getElementById('hudFps');
  const hudCount = document.getElementById('hudCount');
  const hudEl = document.getElementById('hudEl');
  const hudCursor = document.getElementById('hudCursor');
  function updateHud() { hudEl.textContent = DEFS[current].name; }

  let fps = 60, lastStats = 0;
  function stats(ts) {
    if (ts - lastStats < 300) return;
    lastStats = ts;
    hudFps.textContent = String(Math.round(fps));
    hudCount.textContent = particleCount.toLocaleString('en-US');
  }

  // ---------- 主循环 ----------
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!paused) {
      weatherStep();
      for (let s = 0; s < speed; s++) world.step();
    }
    render();
    stats(ts);
  }

  resize();
  select(E.SAND);
  setBrush(5);
  updateHud();
  requestAnimationFrame(function (ts) {
    lastStats = ts;
    requestAnimationFrame(loop);
  });

  // 供调试用
  window.SandApp = { world: world, select: select, setBrush: setBrush };
})();
