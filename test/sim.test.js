/*
 * 物理引擎行为测试。跑：node --test
 * 每个 World 都带固定 seed，所以结果是确定性的，断言不会偶发失败。
 */
const test = require('node:test');
const assert = require('node:assert');

const PH = require('../js/sim.js');
const EL = require('../js/elements.js');
const PR = require('../js/presets.js');

const World = PH.World;
const E = PH.E;
const DEFS = PH.DEFS;
const CAT = PH.CAT;

function count(world, el) {
  let n = 0;
  for (let i = 0; i < world.n; i++) if (world.cells[i] === el) n++;
  return n;
}

function cellsOf(world, el) {
  const out = [];
  for (let i = 0; i < world.n; i++) {
    if (world.cells[i] === el) out.push({ x: i % world.w, y: (i / world.w) | 0 });
  }
  return out;
}

function avgY(list) {
  let s = 0;
  for (const p of list) s += p.y;
  return s / (list.length || 1);
}

function box(world, x0, y0, x1, y1, el) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) world.setCell(world.idx(x, y), el);
}

function assertValid(world) {
  for (let i = 0; i < world.n; i++) {
    const v = world.cells[i];
    assert.ok(v >= 0 && v < DEFS.length, '格子 ' + i + ' 出现了越界元素 ' + v);
  }
}

test('沙子会掉到底部并停住', function () {
  const w = new World(20, 30, 1);
  w.setCell(w.idx(10, 2), E.SAND);
  w.steps(80);
  assert.equal(count(w, E.SAND), 1, '沙子不能凭空消失');
  const [p] = cellsOf(w, E.SAND);
  assert.ok(p.y >= 28, '沙子应该落到最底下几行，实际 y=' + p.y);
});

test('沙堆形成斜坡且没有悬空颗粒', function () {
  const w = new World(60, 40, 7);
  box(w, 28, 0, 33, 9, E.SAND);            // 6x10 = 60 粒，悬在半空
  assert.equal(count(w, E.SAND), 60);
  w.steps(900);
  assert.equal(count(w, E.SAND), 60);
  const bottom = cellsOf(w, E.SAND).filter(function (p) { return p.y === w.h - 1; });
  assert.ok(bottom.length >= 5, '60 粒沙应该摊出斜坡，最底层只有 ' + bottom.length + ' 粒');
  for (const p of cellsOf(w, E.SAND)) {
    if (p.y < w.h - 1) {
      assert.notEqual(w.at(p.x, p.y + 1), E.EMPTY, '第 ' + p.y + ' 行有悬空沙子');
    }
  }
});

test('水会流开并找平，总量不变', function () {
  const w = new World(30, 30, 3);
  box(w, 10, 0, 19, 9, E.WATER);
  assert.equal(count(w, E.WATER), 100);
  w.steps(900);
  assert.equal(count(w, E.WATER), 100, '水是交换式移动，总量必须守恒');
  const all = cellsOf(w, E.WATER);
  const minY = Math.min.apply(null, all.map(function (p) { return p.y; }));
  assert.ok(minY >= 26, '水应该全部沉到池底，最高的一格在 y=' + minY);
  const topRow = all.filter(function (p) { return p.y === w.h - 1; });
  assert.equal(topRow.length, 30, '水应该把最底层铺满');
});

test('油浮在水面上', function () {
  const w = new World(40, 50, 11);
  box(w, 0, 30, 39, 49, E.WATER);
  box(w, 15, 20, 24, 25, E.OIL);
  const oil0 = count(w, E.OIL);
  w.steps(1200);
  assert.equal(count(w, E.OIL), oil0);
  const oilY = avgY(cellsOf(w, E.OIL));
  const waterY = avgY(cellsOf(w, E.WATER));
  assert.ok(oilY < waterY, '油的平均高度 ' + oilY.toFixed(1) + ' 应该高于水 ' + waterY.toFixed(1));
});

test('火会点燃油并蔓延', function () {
  const w = new World(24, 24, 5);
  box(w, 0, 22, 23, 23, E.STONE);
  box(w, 8, 16, 15, 21, E.OIL);
  const before = count(w, E.OIL);
  w.setCell(w.idx(7, 20), E.FIRE);
  w.steps(300);
  const after = count(w, E.OIL);
  assert.ok(after < before * 0.5, '油应该被烧掉大半：' + before + ' -> ' + after);
});

test('火遇到水会熄灭并变成蒸汽', function () {
  const w = new World(10, 10, 2);
  box(w, 0, 0, 9, 9, E.STONE);
  box(w, 4, 4, 6, 6, E.EMPTY);
  box(w, 4, 4, 6, 6, E.WATER);          // 水里包一团火：四周持续有水
  w.setCell(w.idx(5, 5), E.FIRE);
  let steamSeen = false;
  let alive = 0;
  for (let k = 0; k < 60; k++) {
    w.step();
    if (count(w, E.STEAM) > 0) steamSeen = true;
    if (count(w, E.FIRE) > 0) alive++;
  }
  assert.equal(count(w, E.FIRE), 0, '火应该被水浇灭');
  assert.ok(alive <= 6, '灭火应该很快，实际存活了 ' + alive + ' 帧');
  assert.ok(steamSeen, '浇灭的瞬间应该产生蒸汽');
});

test('蒸汽最终会冷凝或消散', function () {
  const w = new World(20, 20, 4);
  w.setCell(w.idx(10, 10), E.STEAM);
  w.steps(600);
  assert.equal(count(w, E.STEAM), 0, '蒸汽不能永远飘着');
});

test('种子遇到水会长成植物并向上生长', function () {
  const w = new World(40, 30, 9);
  box(w, 0, 29, 39, 29, E.STONE);
  box(w, 5, 24, 34, 28, E.WATER);
  for (let k = 0; k < 8; k++) w.setCell(w.idx(8 + k * 3, 23), E.SEED);
  w.steps(1500);
  const plants = cellsOf(w, E.PLANT);
  assert.ok(plants.length >= 3, '应该有植物长出来，实际 ' + plants.length);
  const minY = Math.min.apply(null, plants.map(function (p) { return p.y; }));
  assert.ok(minY < 23, '植物应该长到种子那行以上，最高只到 y=' + minY);
  assertValid(w);
});

test('酸液会腐蚀石头', function () {
  const w = new World(20, 20, 6);
  box(w, 5, 10, 14, 19, E.STONE);
  box(w, 5, 7, 14, 9, E.ACID);
  const before = count(w, E.STONE);
  w.steps(800);
  const after = count(w, E.STONE);
  assert.ok(after < before, '石头应该被腐蚀：' + before + ' -> ' + after);
});

test('岩浆遇水变成石头并冒蒸汽', function () {
  const w = new World(20, 20, 8);
  box(w, 0, 0, 19, 19, E.STONE);
  box(w, 8, 8, 12, 12, E.EMPTY);
  w.setCell(w.idx(10, 10), E.LAVA);
  box(w, 8, 8, 9, 12, E.WATER);
  box(w, 11, 8, 12, 12, E.WATER);
  const stoneBefore = count(w, E.STONE);
  let steamSeen = false;
  for (let k = 0; k < 400; k++) {
    w.step();
    if (count(w, E.STEAM) > 0) steamSeen = true;
  }
  assert.ok(steamSeen, '水碰到岩浆应该产生蒸汽');
  assert.ok(count(w, E.STONE) > stoneBefore, '岩浆应该冷却成石头');
});

test('水不会穿过石头地面', function () {
  const w = new World(20, 20, 12);
  box(w, 0, 18, 19, 19, E.STONE);
  box(w, 5, 10, 14, 14, E.WATER);
  w.steps(400);
  assert.equal(count(w, E.STONE), 40, '石头地面必须完好');
  assert.ok(cellsOf(w, E.WATER).every(function (p) { return p.y < 18; }), '水不能漏到石头下面');
});

test('纯物理元素总量守恒（沙+水混合）', function () {
  const w = new World(60, 40, 21);
  for (let k = 0; k < 200; k++) w.setCell(w.idx((w.rng() * 60) | 0, (w.rng() * 20) | 0), E.SAND);
  for (let k = 0; k < 200; k++) w.setCell(w.idx((w.rng() * 60) | 0, (w.rng() * 20) | 0), E.WATER);
  const sand0 = count(w, E.SAND), water0 = count(w, E.WATER);
  w.steps(600);
  assert.equal(count(w, E.SAND), sand0, '沙子总量必须守恒');
  assert.equal(count(w, E.WATER), water0, '水总量必须守恒');
});

test('所有元素混在一起跑不会崩、不会越界', function () {
  const w = new World(80, 60, 33);
  const ids = EL.PALETTE.slice();
  for (let k = 0; k < 1500; k++) {
    w.setCell(w.idx((w.rng() * 80) | 0, (w.rng() * 60) | 0), ids[(w.rng() * ids.length) | 0]);
  }
  w.steps(400);
  assertValid(w);
});

test('相同 seed 得到完全相同的结果（可复现）', function () {
  const a = new World(40, 30, 12345);
  const b = new World(40, 30, 12345);
  // 坐标必须来自独立的随机源：如果从 a.rng() 取，a 世界的随机数流会多走几步，
  // 两个世界就不再同步了（这是测试自身的坑，不是引擎的）。
  const place = PH.mulberry32(999);
  for (let k = 0; k < 120; k++) {
    const x = (place() * 40) | 0, y = (place() * 30) | 0;
    const el = [E.SAND, E.WATER, E.OIL, E.FIRE, E.PLANT][k % 5];
    a.setCell(a.idx(x, y), el);
    b.setCell(b.idx(x, y), el);
  }
  assert.deepEqual(Array.from(a.cells), Array.from(b.cells), '初始棋盘应该一致');
  assert.deepEqual(Array.from(a.data), Array.from(b.data), '初始私有数据应该一致');
  a.steps(300);
  b.steps(300);
  assert.deepEqual(Array.from(a.cells), Array.from(b.cells), '同 seed 应该逐格一致');
});

test('画笔半径正确，且不会画出边界', function () {
  const w = new World(40, 40, 15);
  w.paint(20, 20, E.STONE, 4);
  const n = count(w, E.STONE);
  assert.ok(n > 40 && n < 70, '半径 4 的实心圆应该 50 格左右，实际 ' + n);
  for (const p of cellsOf(w, E.STONE)) {
    const d = Math.hypot(p.x - 20, p.y - 20);
    assert.ok(d <= 4.6, '画到了半径外：d=' + d.toFixed(2));
  }
  w.paint(20, 20, E.EMPTY, 6);
  assert.equal(count(w, E.STONE), 0, '大半径擦除应该把圆心附近的石头清干净');

  const w2 = new World(20, 20, 17);           // 角落越界测试
  w2.paint(0, 0, E.STONE, 6);
  assertValid(w2);
  assert.ok(count(w2, E.STONE) > 20, '角落应该能正常画，实际 ' + count(w2, E.STONE));
});

test('paintLine 会补上拖动路径', function () {
  const w = new World(40, 40, 16);
  w.paintLine(5, 5, 35, 35, E.STONE, 0);
  assert.ok(count(w, E.STONE) >= 30, '对角线至少 31 格，实际 ' + count(w, E.STONE));
});

test('水源会持续出水，水位到顶就自动停', function () {
  const w = new World(30, 30, 31);
  box(w, 0, 28, 29, 29, E.STONE);
  w.setCell(w.idx(5, 27), E.SOURCE);
  const sources0 = count(w, E.SOURCE);
  w.steps(30);
  assert.equal(count(w, E.SOURCE), sources0, '水源不应该自己消失');
  assert.ok(count(w, E.WATER) > 0, '水源应该开始冒水');
  w.steps(600);
  assert.ok(count(w, E.WATER) > 20, '一直跑应该有水积下来，实际 ' + count(w, E.WATER));
  assert.ok(count(w, E.WATER) < 30 * 8, '水位应该稳定住，不能把整个世界灌满');
});

test('水最终会全部落地，不会停在半空', function () {
  const w = new World(30, 30, 41);
  box(w, 4, 4, 10, 8, E.WATER);       // 7x5 = 35 滴水悬在空中
  assert.equal(count(w, E.WATER), 35);
  w.steps(400);
  const wa = cellsOf(w, E.WATER);
  assert.equal(wa.length, 35, '水不会凭空消失');
  for (const p of wa) {
    if (p.y < w.h - 1) {
      assert.notEqual(w.at(p.x, p.y + 1), E.EMPTY, '水停在半空 (' + p.x + ',' + p.y + ')');
    }
  }
});

test('全部预设场景都能生成有效棋盘', function () {
  for (const p of PR.PRESETS) {
    const w = new World(120, 80, 99);
    p.build(w);
    assertValid(w);
    if (p.id === 'clear') {
      assert.equal(count(w, E.EMPTY), w.n, '清空场景应该全空');
    } else {
      assert.ok(count(w, E.EMPTY) < w.n - 50, p.name + ' 场景几乎是空的，可能没画上');
    }
  }
});

test('预设场景在引擎里跑得动（性能烟测）', function () {
  const w = new World(240, 150, 42);
  PR.apply(w, 'valley');
  PR.apply(w, 'volcano');
  const t0 = Date.now();
  w.steps(150);
  const ms = Date.now() - t0;
  assert.ok(ms < 4000, '150 帧 240x150 用时 ' + ms + 'ms，太慢了');
  assertValid(w);
});
