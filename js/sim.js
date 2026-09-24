/*
 * 沙盒物理引擎。
 * 纯逻辑、不碰 DOM，所以可以直接在 Node 里 require 跑测试（见 test/sim.test.js）。
 *
 * 网格数据用并列的 TypedArray 存：
 *   cells  元素 ID
 *   shade  每格随机色值（渲染时的颗粒质感）
 *   data   元素私有数据（火焰寿命、植物能量、酸/岩浆计时）
 *   moved  本帧是否已处理过，避免同一粒子被更新多次
 */
(function (root, factory) {
  const deps = (typeof module === 'object' && module.exports)
    ? require('./elements.js')
    : root.SandElements;
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SandPhysics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (EL) {
  'use strict';

  const E = EL.E;
  const DEFS = EL.DEFS;
  const CAT = EL.CAT;

  // 确定性随机数：同一个 seed 得到完全相同的演化，测试才能稳定断言。
  function mulberry32(a) {
    a = a | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const NEI4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];

  class World {
    constructor(w, h, seed) {
      this.w = w | 0;
      this.h = h | 0;
      this.n = this.w * this.h;
      this.cells = new Uint8Array(this.n);
      this.shade = new Uint8Array(this.n);
      this.data = new Uint8Array(this.n);
      this.moved = new Uint8Array(this.n);
      this.rng = mulberry32(seed === undefined ? 0x9E3779B9 : seed);
      this.frame = 0;
      for (let i = 0; i < this.n; i++) this.shade[i] = (this.rng() * 256) | 0;
    }

    // ---------- 基础存取 ----------

    idx(x, y) { return y * this.w + x; }
    inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

    // 边界外当作石头：四周等于有墙，粒子不会漏出去。
    at(x, y) { return this.inBounds(x, y) ? this.cells[y * this.w + x] : E.STONE; }

    chance(p) { return this.rng() < p; }

    defaultData(el) {
      const d = DEFS[el];
      if (!d || !d.life || d.life[1] === 0) return 0;
      const a = d.life[0], b = d.life[1];
      return a + ((this.rng() * (b - a + 1)) | 0);
    }

    setCell(i, el, data) {
      this.cells[i] = el;
      this.shade[i] = (this.rng() * 256) | 0;
      this.data[i] = (data === undefined) ? this.defaultData(el) : data;
      this.moved[i] = 1;
    }

    swap(i, j) {
      const c = this.cells[i]; this.cells[i] = this.cells[j]; this.cells[j] = c;
      const s = this.shade[i]; this.shade[i] = this.shade[j]; this.shade[j] = s;
      const d = this.data[i]; this.data[i] = this.data[j]; this.data[j] = d;
      this.moved[i] = 1; this.moved[j] = 1;
    }

    clear() {
      this.cells.fill(0);
      this.data.fill(0);
    }

    counts() {
      const out = new Uint32Array(DEFS.length);
      for (let i = 0; i < this.n; i++) out[this.cells[i]]++;
      return out;
    }

    // ---------- 移动规则 ----------

    // 当前元素能否进入 (x, y)：空位可以，比它轻的液体/气体可以，固体粉末不行。
    canPass(el, d, x, y) {
      if (!this.inBounds(x, y)) return false;
      const other = this.cells[y * this.w + x];
      if (other === E.EMPTY) return true;
      // 火焰是"反应区"而不是气泡：液体不许把它顶走，否则油一流动就把火挤出去，
      // 火还没来得及点燃燃料就飘到空中了。
      if (d.cat === CAT.LIQUID && other === E.FIRE) return false;
      const od = DEFS[other];
      if (od.cat === CAT.SOLID || od.cat === CAT.POWDER) return false;
      return od.density < d.density;
    }

    tryStep(i, x, y, el, d, dx, dy) {
      const nx = x + dx, ny = y + dy;
      if (!this.canPass(el, d, nx, ny)) return false;
      this.swap(i, ny * this.w + nx);
      return true;
    }

    hasNeighbor(x, y, want) {
      for (let k = 0; k < 4; k++) {
        if (this.at(x + NEI4[k][0], y + NEI4[k][1]) === want) return true;
      }
      return false;
    }

    consumeNeighbor(x, y, want) {
      for (let k = 0; k < 4; k++) {
        const nx = x + NEI4[k][0], ny = y + NEI4[k][1];
        if (this.at(nx, ny) === want) {
          this.setCell(this.idx(nx, ny), E.EMPTY);
          return true;
        }
      }
      return false;
    }

    updatePowder(i, x, y, el, d) {
      if (this.tryStep(i, x, y, el, d, 0, 1)) return;
      const dir = this.chance(0.5) ? -1 : 1;
      if (this.tryStep(i, x, y, el, d, dir, 1)) return;
      this.tryStep(i, x, y, el, d, -dir, 1);
    }

    updateLiquid(i, x, y, el, d) {
      // 浮力：把上方更轻的液体顶上去（油浮到水面）
      const above = this.at(x, y - 1);
      if (above !== E.EMPTY) {
        const ad = DEFS[above];
        if (ad && ad.cat === CAT.LIQUID && ad.density < d.density && this.chance(0.6)) {
          this.swap(i, i - this.w);
          return;
        }
      }
      if (this.tryStep(i, x, y, el, d, 0, 1)) return;
      const dir = this.chance(0.5) ? -1 : 1;
      if (this.tryStep(i, x, y, el, d, dir, 1)) return;
      if (this.tryStep(i, x, y, el, d, -dir, 1)) return;
      // 水平滑动：逐格推进，所以不会穿墙，水面也会自己变平
      const total = d.spread || 1;
      let cx = x, ci = i;
      for (let s = 0; s < total; s++) {
        const nx = cx + dir;
        if (!this.canPass(el, d, nx, y)) break;
        const ni = y * this.w + nx;
        this.swap(ci, ni);
        ci = ni; cx = nx;
      }
    }

    updateGas(i, x, y, el, d) {
      let life = this.data[i];
      if (life > 0) {
        life--;
        this.data[i] = life;
        if (life === 0) { this.die(i, el); return; }
      }
      // 火焰大部分帧原地舔舐燃料，只有一部分帧往上窜——否则一帧就飘走，根本点不着东西
      if (el === E.FIRE && this.chance(0.6)) return;
      if (this.tryStep(i, x, y, el, d, 0, -1)) return;
      const dir = this.chance(0.5) ? -1 : 1;
      if (this.tryStep(i, x, y, el, d, dir, -1)) return;
      if (this.tryStep(i, x, y, el, d, -dir, -1)) return;
      if (this.chance(0.5)) this.tryStep(i, x, y, el, d, dir, 0);
    }

    die(i, el) {
      if (el === E.FIRE) this.setCell(i, this.chance(0.35) ? E.SMOKE : E.EMPTY);
      else if (el === E.STEAM) this.setCell(i, this.chance(0.6) ? E.WATER : E.EMPTY);
      else this.setCell(i, E.EMPTY);
    }

    // ---------- 元素之间的反应 ----------

    react(i, x, y, el, d) {
      switch (el) {
        case E.FIRE: return this.reactFire(i, x, y);
        case E.ACID: return this.reactAcid(i, x, y, el, d);
        case E.ICE: return this.reactIce(i, x, y);
        case E.LAVA: return this.reactLava(i, x, y, el, d);
        case E.PLANT: return this.reactPlant(i, x, y, el, d);
        case E.SEED: return this.reactSeed(i, x, y);
        case E.SOURCE: return this.reactSource(i, x, y);
        default: return false;
      }
    }

    reactFire(i, x, y) {
      for (let k = 0; k < 4; k++) {
        const nx = x + NEI4[k][0], ny = y + NEI4[k][1];
        if (!this.inBounds(nx, ny)) continue;
        const ni = ny * this.w + nx;
        const n = this.cells[ni];
        if (n === E.EMPTY) continue;
        if (n === E.WATER || n === E.ICE) {
          if (this.chance(0.7)) {
            if (n === E.ICE) this.setCell(ni, E.WATER);   // 顺手把冰化开
            this.setCell(i, E.STEAM);
            return true;
          }
          continue;
        }
        const nd = DEFS[n];
        if (nd.flammable > 0 && this.chance(nd.flammable)) this.setCell(ni, E.FIRE);
      }
      return false;
    }

    reactAcid(i, x, y, el, d) {
      const life = this.data[i];
      if (life > 0) {
        this.data[i] = life - 1;
        if (life - 1 === 0) { this.setCell(i, E.EMPTY); return true; }
      }
      for (let k = 0; k < 4; k++) {
        const nx = x + NEI4[k][0], ny = y + NEI4[k][1];
        if (!this.inBounds(nx, ny)) continue;
        const ni = ny * this.w + nx;
        const n = this.cells[ni];
        if (n === E.EMPTY || n === el) continue;
        const nd = DEFS[n];
        if (nd.dissolvable > 0 && this.chance(nd.dissolvable)) {
          this.setCell(ni, this.chance(0.3) ? E.SMOKE : E.EMPTY);
          if (this.chance(0.45)) { this.setCell(i, E.EMPTY); return true; }   // 酸也被消耗
        }
      }
      return false;
    }

    reactIce(i, x, y) {
      if (this.hasNeighbor(x, y, E.FIRE) || this.hasNeighbor(x, y, E.LAVA)) {
        this.setCell(i, E.WATER);
        return true;
      }
      return false;
    }

    reactLava(i, x, y, el, d) {
      const life = this.data[i];
      if (life > 0) {
        this.data[i] = life - 1;
        if (life - 1 === 0) { this.setCell(i, E.STONE); return true; }   // 自然冷却
      }
      for (let k = 0; k < 4; k++) {
        const nx = x + NEI4[k][0], ny = y + NEI4[k][1];
        if (!this.inBounds(nx, ny)) continue;
        const ni = ny * this.w + nx;
        const n = this.cells[ni];
        if (n === E.EMPTY) continue;
        if (n === E.WATER) {
          this.setCell(ni, E.STEAM);
          if (this.chance(0.45)) { this.setCell(i, E.STONE); return true; }
          continue;
        }
        if (n === E.ICE) {
          this.setCell(ni, E.WATER);
          if (this.chance(0.45)) { this.setCell(i, E.STONE); return true; }
          continue;
        }
        const nd = DEFS[n];
        if (nd.flammable > 0 && this.chance(Math.min(0.9, nd.flammable * 2))) {
          this.setCell(ni, E.FIRE);
        }
      }
      if (this.inBounds(x, y - 1) && this.at(x, y - 1) === E.EMPTY && this.chance(0.01)) {
        this.setCell(i - this.w, E.FIRE);   // 岩浆上方冒火苗
      }
      return false;
    }

    reactPlant(i, x, y, el, d) {
      const energy = this.data[i];
      if (energy <= 0) return false;                 // 能量耗尽就停止生长
      const watered = this.hasNeighbor(x, y, E.WATER);
      if (!this.chance(watered ? 0.25 : 0.05)) return false;
      if (watered && this.chance(0.4)) this.consumeNeighbor(x, y, E.WATER);

      // 往上长：空格或水里都能顶上去（在水下就是"藤蔓穿过水"）
      const upEl = this.at(x, y - 1);
      if ((upEl === E.EMPTY || upEl === E.WATER) && this.chance(0.8)) {
        this.setCell(this.idx(x, y - 1), E.PLANT, energy - 1);
        return false;
      }
      const dir = this.chance(0.5) ? -1 : 1;
      const sideEl = this.at(x + dir, y);
      if ((sideEl === E.EMPTY || sideEl === E.WATER) && this.chance(0.25)) {
        this.setCell(this.idx(x + dir, y), E.PLANT, Math.max(0, energy - 3));
      }
      return false;
    }

    reactSeed(i, x, y) {
      if (this.hasNeighbor(x, y, E.WATER) && this.chance(0.2)) {
        this.setCell(i, E.PLANT, 10 + ((this.rng() * 6) | 0));
        return true;
      }
      return false;
    }

    // 水源：下面空了就往出冒水；下面堵住就往左右渗（这样贴在地上的水源也能用）。
    // 水位一旦高过水源自己，它就自动停手，所以不会无限灌满整个屏幕。
    reactSource(i, x, y) {
      if (this.at(x, y + 1) === E.EMPTY) {
        this.setCell(i + this.w, E.WATER);      // 出水口每帧都冒，瀑布才连得起来
        return false;
      }
      if (!this.chance(0.5)) return false;
      const dir = this.chance(0.5) ? -1 : 1;
      for (let k = 0; k < 2; k++) {
        const nx = x + (k === 0 ? dir : -dir);
        if (this.at(nx, y) === E.EMPTY) { this.setCell(this.idx(nx, y), E.WATER); return false; }
      }
      return false;
    }

    // ---------- 主循环 ----------

    step() {
      this.frame++;
      this.moved.fill(0);
      const w = this.w, h = this.h;

      // 第一遍：元素之间的反应（点燃、腐蚀、融化、发芽……）
      // 必须和位移分开：否则一个粒子被别的粒子挤开时会被标成"已处理"，
      // 那一帧的反应就被跳过了——火焰会被流动的油推着走，永远点不着油。
      for (let y = h - 1; y >= 0; y--) {
        const row = y * w;
        const flip = ((this.frame + y) & 1) === 0;
        for (let k = 0; k < w; k++) {
          const x = flip ? k : (w - 1 - k);
          const i = row + x;
          if (this.moved[i]) continue;
          const el = this.cells[i];
          if (el === E.EMPTY) continue;
          this.react(i, x, y, el, DEFS[el]);
        }
      }

      // 第二遍：位移。自下而上扫描，每行左右交替，避免整体朝一个方向偏。
      for (let y = h - 1; y >= 0; y--) {
        const row = y * w;
        const flip = ((this.frame + y) & 1) === 0;
        for (let k = 0; k < w; k++) {
          const x = flip ? k : (w - 1 - k);
          const i = row + x;
          if (this.moved[i]) continue;
          const el = this.cells[i];
          if (el === E.EMPTY) continue;
          const d = DEFS[el];
          if (d.cat === CAT.POWDER) this.updatePowder(i, x, y, el, d);
          else if (d.cat === CAT.LIQUID) this.updateLiquid(i, x, y, el, d);
          else if (d.cat === CAT.GAS) this.updateGas(i, x, y, el, d);
        }
      }
    }

    steps(count) { for (let k = 0; k < count; k++) this.step(); }

    // ---------- 画笔 ----------

    paint(cx, cy, el, radius) {
      const d = DEFS[el];
      const fill = d.cat === CAT.POWDER ? 0.7 : (d.cat === CAT.LIQUID ? 0.85 : (d.cat === CAT.GAS ? 0.5 : 1));
      const r = Math.max(0, radius | 0);
      const r2 = r * r + r;   // 稍松一点，圆点更饱满
      for (let y = cy - r; y <= cy + r; y++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (!this.inBounds(x, y)) continue;
          const dx = x - cx, dy = y - cy;
          if (dx * dx + dy * dy > r2) continue;
          if (el !== E.EMPTY && this.rng() > fill) continue;
          this.setCell(y * this.w + x, el);
        }
      }
    }

    // 拖动时在两点之间补点，快速划动也不会断线
    paintLine(x0, y0, x1, y1, el, radius) {
      let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
      let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        this.paint(x0, y0, el, radius);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }
  }

  return { World: World, mulberry32: mulberry32, E: E, DEFS: DEFS, CAT: CAT };
});
