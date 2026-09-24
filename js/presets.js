/*
 * 预设场景。全部按网格尺寸的相对比例生成，换分辨率也不会走形。
 * 每个 build(world) 直接往 world 里写格子。
 */
(function (root, factory) {
  const deps = (typeof module === 'object' && module.exports)
    ? require('./elements.js')
    : root.SandElements;
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SandPresets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (EL) {
  'use strict';

  const E = EL.E;

  function rect(wd, x0, y0, x1, y1, el) {
    const ax = Math.max(0, Math.round(Math.min(x0, x1)));
    const bx = Math.min(wd.w - 1, Math.round(Math.max(x0, x1)));
    const ay = Math.max(0, Math.round(Math.min(y0, y1)));
    const by = Math.min(wd.h - 1, Math.round(Math.max(y0, y1)));
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) wd.setCell(wd.idx(x, y), el);
  }

  function disc(wd, cx, cy, r, el) {
    for (let y = Math.round(cy - r); y <= cy + r; y++) {
      for (let x = Math.round(cx - r); x <= cx + r; x++) {
        if (!wd.inBounds(x, y)) continue;
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r * r) wd.setCell(wd.idx(x, y), el);
      }
    }
  }

  // 从顶部往下找到第一个非空格子，用来把树种在起伏的地面上
  function surfaceY(wd, x) {
    for (let y = 0; y < wd.h; y++) if (wd.at(x, y) !== E.EMPTY) return y;
    return wd.h - 1;
  }

  function tree(wd, x, trunkH, canopyR) {
    const top = surfaceY(wd, x);
    const baseY = top - 1;
    if (baseY - trunkH < 0) return;
    rect(wd, x, baseY - trunkH, x + 1, baseY, E.WOOD);
    disc(wd, x + 0.5, baseY - trunkH - canopyR * 0.5, canopyR, E.PLANT);
  }

  const builders = {};

  // 默认场景：沙丘 + 湖 + 树 + 冰山 + 几颗种子（种子会在开头几秒长起来）
  builders.valley = function (wd) {
    const w = wd.w, h = wd.h;
    const groundY = h - 8;
    rect(wd, 0, groundY, w - 1, h - 1, E.STONE);              // 基岩
    const duneW = Math.round(w * 0.44);
    const maxH = Math.round(h * 0.22);
    for (let x = 0; x < duneW; x++) {                          // 沙丘
      const t = Math.max(0, 1 - Math.abs(x - duneW * 0.45) / (duneW * 0.6));
      const hh = Math.round(maxH * Math.pow(t, 1.15));
      for (let y = groundY - hh; y < groundY; y++) wd.setCell(wd.idx(x, y), E.SAND);
    }
    const wallX = Math.round(w * 0.45);
    rect(wd, wallX, groundY - Math.round(h * 0.26), wallX + 2, groundY, E.STONE);   // 隔水墙
    const lakeY = groundY - Math.round(h * 0.2);
    rect(wd, wallX + 3, lakeY, w - 1, groundY - 1, E.WATER);   // 湖
    rect(wd, w - 16, groundY - Math.round(h * 0.26), w - 6, groundY - 1, E.ICE);    // 冰山
    tree(wd, Math.round(duneW * 0.22), Math.round(h * 0.11), Math.round(h * 0.045));
    tree(wd, Math.round(duneW * 0.62), Math.round(h * 0.15), Math.round(h * 0.055));
    tree(wd, wallX - 4, Math.round(h * 0.08), Math.round(h * 0.035));
    for (let k = 0; k < 14; k++) {                              // 水面的种子
      const x = Math.round(w * 0.5 + k * (w * 0.032));
      wd.setCell(wd.idx(x, lakeY - 1 - (k % 3)), E.SEED);
    }
  };

  builders.hourglass = function (wd) {
    const w = wd.w, h = wd.h;
    const cx = w / 2, top = Math.round(h * 0.06), bot = h - 4;
    const midY = (top + bot) / 2;
    const halfH = (bot - top) / 2;
    for (let y = top; y <= bot; y++) {
      const t = Math.abs(y - midY) / halfH;                     // 两端 1，中间 0
      const half = 2 + t * (w * 0.33);
      rect(wd, cx - half - 2, y, cx - half, y, E.STONE);
      rect(wd, cx + half, y, cx + half + 2, y, E.STONE);
    }
    rect(wd, cx - w * 0.36, top - 2, cx + w * 0.36, top, E.STONE);   // 顶盖
    rect(wd, 0, bot, w - 1, bot + 3, E.STONE);                        // 底座
    for (let y = top + 1; y < midY - 1; y++) {                        // 上半部装沙
      const t = Math.abs(y - midY) / halfH;
      const half = 2 + t * (w * 0.33);
      rect(wd, cx - half + 1, y, cx + half - 1, y, E.SAND);
    }
    for (let k = 0; k < 26; k++) {                                    // 底部铺一层砂砾
      const x = Math.round(cx + (wd.rng() - 0.5) * w * 0.5);
      const y = bot - 1 - Math.round(wd.rng() * 2);
      wd.setCell(wd.idx(x, y), wd.rng() < 0.5 ? E.STONE : E.ICE);
    }
  };

  builders.volcano = function (wd) {
    const w = wd.w, h = wd.h;
    const cx = w * 0.5;
    const coneW = w * 0.44;
    const peakH = h * 0.74;
    const craterDepth = Math.round(h * 0.2);
    const craterHalf = Math.round(w * 0.07);
    const mesaY = h - 1 - peakH + craterDepth;      // 山尖被削平，台地在这一行

    for (let x = 0; x < w; x++) {                   // 锥体（顶部削平成台地）
      const t = Math.max(0, 1 - Math.abs(x - cx) / coneW);
      const top = h - 1 - Math.round(peakH * t);
      for (let y = h - 1; y >= Math.max(top, mesaY); y--) wd.setCell(wd.idx(x, y), E.STONE);
    }

    for (let dy = 0; dy < craterDepth; dy++) {      // 火山口：自上而下收窄的碗，碗壁是石头
      const y = mesaY + dy;
      const half = Math.max(1, Math.round(craterHalf * (1 - Math.pow(dy / craterDepth, 1.6))));
      for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
        if (!wd.inBounds(x, y)) continue;
        wd.setCell(wd.idx(x, y), dy > craterDepth * 0.15 ? E.LAVA : E.EMPTY);
      }
    }

    for (let k = 0; k < 4; k++) {                   // 山坡上的树
      const x = Math.round(cx + (k < 2 ? -1 : 1) * coneW * (0.34 + 0.2 * (k % 2)));
      if (x > 2 && x < w - 3) tree(wd, x, Math.round(h * 0.07), Math.round(h * 0.032));
    }
    rect(wd, 0, h - 3, w - 1, h - 1, E.STONE);      // 山脚地面
  };

  builders.waterfall = function (wd) {
    const w = wd.w, h = wd.h;
    const T = Math.round(h * 0.16);                 // 崖顶 = 水渠底面
    const cliffX = Math.round(w * 0.46);
    const cliffBottom = Math.round(h * 0.5);
    const chX0 = cliffX - 16, chX1 = cliffX + 22;

    rect(wd, 0, h - 3, w - 1, h - 1, E.STONE);              // 水下基岩
    rect(wd, 0, T, cliffX, cliffBottom, E.STONE);           // 崖体
    rect(wd, chX0, T, chX1, T + 1, E.STONE);                // 石渠底板（右段悬空）
    rect(wd, chX0, T - 5, chX0 + 1, T - 1, E.STONE);        // 渠左壁
    rect(wd, chX1 - 1, T - 5, chX1, T - 1, E.STONE);        // 渠右壁
    for (let x = chX0 + 2; x < chX1 - 1; x++) {             // 渠里的水
      for (let y = T - 3; y <= T - 1; y++) wd.setCell(wd.idx(x, y), E.WATER);
    }

    // 悬空段每隔 3 格开一个出水口：口子下面是空的，所以每个口子每帧都能出水
    for (let x = cliffX + 2; x <= chX1 - 3; x += 3) {
      wd.setCell(wd.idx(x, T), E.EMPTY);
      wd.setCell(wd.idx(x, T + 1), E.EMPTY);
      wd.setCell(wd.idx(x, T - 1), E.SOURCE);
    }
    wd.setCell(wd.idx(chX0 + 4, T - 1), E.SOURCE);          // 渠首的补水口，让渠一直是满的

    disc(wd, cliffX + 6, Math.round(h * 0.62), Math.round(h * 0.03), E.STONE);   // 水流砸上去溅开的岩台
    disc(wd, Math.round(w * 0.8), h - 12, Math.round(h * 0.05), E.STONE);        // 水潭里的礁石
    tree(wd, Math.round(w * 0.06), Math.round(h * 0.09), Math.round(h * 0.035));
    tree(wd, Math.round(w * 0.12), Math.round(h * 0.12), Math.round(h * 0.04));
  };

  builders.forest = function (wd) {
    const w = wd.w, h = wd.h;
    const groundY = h - Math.round(h * 0.18);
    rect(wd, 0, groundY, w - 1, h - 1, E.STONE);
    for (let x = 0; x < w; x++) {                                 // 起伏的地面(用沙土表现)
      const hh = Math.round(h * 0.05 * (1 + Math.sin(x / (w * 0.08))));
      for (let y = groundY - hh; y < groundY; y++) wd.setCell(wd.idx(x, y), E.SAND);
    }
    const pondX0 = Math.round(w * 0.4), pondX1 = Math.round(w * 0.62);
    rect(wd, pondX0, groundY - Math.round(h * 0.06), pondX1, h - 7, E.EMPTY);
    rect(wd, pondX0, h - 6, pondX1, h - 1, E.STONE);                       // 池塘底
    rect(wd, pondX0, groundY - Math.round(h * 0.04), pondX1, h - 8, E.WATER);
    for (let k = 0; k < 9; k++) {
      const x = Math.round(w * (0.05 + 0.105 * k));
      if (x > pondX0 - 4 && x < pondX1 + 4) continue;
      tree(wd, x, Math.round(h * (0.08 + 0.06 * wd.rng())), Math.round(h * (0.03 + 0.03 * wd.rng())));
    }
    for (let k = 0; k < 10; k++) {
      const x = Math.round(pondX0 + 2 + wd.rng() * (pondX1 - pondX0 - 4));
      wd.setCell(wd.idx(x, groundY - Math.round(h * 0.045)), E.SEED);
    }
  };

  builders.icefire = function (wd) {
    const w = wd.w, h = wd.h;
    const groundY = h - 8;
    rect(wd, 0, groundY, w - 1, h - 1, E.STONE);                        // 地面
    const iceW = Math.round(w * 0.24), iceTop = groundY - Math.round(h * 0.5);
    rect(wd, 0, iceTop, iceW, groundY - 1, E.ICE);                      // 左侧冰崖
    for (let k = 0; k < 5; k++) {                                       // 崖顶的冰棱
      const x = Math.round(iceW * (0.15 + 0.2 * k));
      const hh = Math.round(h * (0.04 + 0.05 * wd.rng()));
      rect(wd, x, iceTop - hh, x + 2, iceTop, E.ICE);
    }
    const lakeY = groundY - Math.round(h * 0.05);
    rect(wd, iceW + 2, lakeY, Math.round(w * 0.68), groundY - 1, E.WATER);   // 中间的冰湖
    for (let k = 0; k < 4; k++) {                                       // 湖里立着的冰柱
      const x = Math.round(w * (0.3 + 0.1 * k));
      const hh = Math.round(h * (0.05 + 0.06 * wd.rng()));
      rect(wd, x, groundY - 1 - hh, x + 1, groundY - 1, E.ICE);
    }
    const stoneX = Math.round(w * 0.7);
    rect(wd, stoneX, groundY - Math.round(h * 0.32), w - 1, groundY - 1, E.STONE);    // 右侧石台
    rect(wd, stoneX + 4, groundY - Math.round(h * 0.26), w - 5, groundY - 4, E.LAVA); // 台上的岩浆池
  };

  builders.clear = function (wd) { wd.clear(); };

  // 顺序即 UI 里的按钮顺序
  const PRESETS = [
    { id: 'valley', name: '山谷', build: builders.valley },
    { id: 'hourglass', name: '沙漏', build: builders.hourglass },
    { id: 'volcano', name: '火山', build: builders.volcano },
    { id: 'waterfall', name: '瀑布', build: builders.waterfall },
    { id: 'forest', name: '森林', build: builders.forest },
    { id: 'icefire', name: '冰与火', build: builders.icefire },
    { id: 'clear', name: '清空', build: builders.clear },
  ];

  function apply(world, id) {
    const p = PRESETS.find(function (p) { return p.id === id; });
    if (!p) return false;
    p.build(world);
    return true;
  }

  return { PRESETS: PRESETS, apply: apply, rect: rect, disc: disc, tree: tree, surfaceY: surfaceY };
});
