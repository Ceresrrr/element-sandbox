/*
 * 元素定义表 —— 浏览器与 Node 共用（经典脚本 + CommonJS 双兼容，不用 ES module，
 * 这样双击 index.html 从 file:// 打开也能正常运行）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SandElements = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 元素 ID。数值会写进 Uint8Array，所以必须 <= 255。
  const E = {
    EMPTY: 0,
    SAND: 1,
    WATER: 2,
    OIL: 3,
    STONE: 4,
    WOOD: 5,
    FIRE: 6,
    SMOKE: 7,
    STEAM: 8,
    ICE: 9,
    PLANT: 10,
    SEED: 11,
    ACID: 12,
    LAVA: 13,
    SOURCE: 14,
  };

  const CAT = {
    EMPTY: 'empty',
    SOLID: 'solid',
    POWDER: 'powder',
    LIQUID: 'liquid',
    GAS: 'gas',
  };

  const DEFS = [];

  function def(id, key, name, color, opts) {
    DEFS[id] = Object.assign({
      id: id,
      key: key,
      name: name,
      color: color,           // [r, g, b]
      cat: CAT.SOLID,
      density: 10,            // 越大越"重"：重液体下沉，轻液体上浮
      jitter: 0.08,           // 颜色随机抖动幅度，制造颗粒质感
      flammable: 0,           // 每个相邻火焰每帧被点燃的概率
      dissolvable: 0,         // 每个相邻酸液每帧被腐蚀的概率
      life: [0, 0],           // [min, max] 初始寿命（火/烟/蒸汽/酸/岩浆计时）
      spread: 1,              // 液体水平滑动格数
      desc: '',
    }, opts || {});
    return DEFS[id];
  }

  def(E.EMPTY, 'empty', '橡皮', [10, 13, 19], {
    cat: CAT.EMPTY, density: 0, jitter: 0,
    desc: '擦除画过的东西',
  });

  def(E.SAND, 'sand', '沙子', [224, 192, 104], {
    cat: CAT.POWDER, density: 2.0, jitter: 0.16,
    desc: '会堆积成 45° 斜坡，能沉进水里',
  });

  def(E.WATER, 'water', '水', [58, 122, 216], {
    cat: CAT.LIQUID, density: 1.0, jitter: 0.07, spread: 6,
    desc: '向低处流并自动找平，浇灭火焰',
  });

  def(E.OIL, 'oil', '油', [122, 82, 30], {
    cat: CAT.LIQUID, density: 0.7, jitter: 0.10, spread: 5,
    flammable: 0.35,
    desc: '浮在水面上，一点就着',
  });

  def(E.STONE, 'stone', '石头', [124, 124, 134], {
    cat: CAT.SOLID, density: 10, jitter: 0.12,
    dissolvable: 0.06,
    desc: '不动的墙，能被酸慢慢腐蚀',
  });

  def(E.WOOD, 'wood', '木头', [139, 90, 43], {
    cat: CAT.SOLID, density: 10, jitter: 0.10,
    flammable: 0.03, dissolvable: 0.05,
    desc: '可燃，烧得慢',
  });

  def(E.FIRE, 'fire', '火', [255, 122, 24], {
    cat: CAT.GAS, density: -2.0, jitter: 0.18,
    life: [50, 110],
    desc: '向上窜，点燃可燃物，遇水熄灭变蒸汽',
  });

  def(E.SMOKE, 'smoke', '烟', [74, 74, 84], {
    cat: CAT.GAS, density: -1.0, jitter: 0.14,
    life: [120, 200],
    desc: '上升后消散',
  });

  def(E.STEAM, 'steam', '蒸汽', [185, 198, 212], {
    cat: CAT.GAS, density: -1.5, jitter: 0.10,
    life: [160, 260],
    desc: '上升，冷却后凝回水滴',
  });

  def(E.ICE, 'ice', '冰', [143, 216, 232], {
    cat: CAT.SOLID, density: 10, jitter: 0.08,
    dissolvable: 0.10,
    desc: '遇到火或岩浆会化成水',
  });

  def(E.PLANT, 'plant', '植物', [63, 156, 70], {
    cat: CAT.SOLID, density: 10, jitter: 0.12,
    flammable: 0.06, dissolvable: 0.08,
    desc: '由种子遇水长成，会顺着水往上爬',
  });

  def(E.SEED, 'seed', '种子', [185, 160, 60], {
    cat: CAT.POWDER, density: 1.2, jitter: 0.12,
    flammable: 0.05, dissolvable: 0.08,
    desc: '碰到水就发芽变成植物',
  });

  def(E.ACID, 'acid', '酸液', [166, 255, 46], {
    cat: CAT.LIQUID, density: 1.1, jitter: 0.12, spread: 5,
    life: [900, 1500],
    desc: '腐蚀石头/木头/植物/冰/沙子，自己会耗尽',
  });

  def(E.LAVA, 'lava', '岩浆', [217, 72, 15], {
    cat: CAT.LIQUID, density: 3.0, jitter: 0.16, spread: 3,
    life: [3000, 6000],
    desc: '点燃一切，遇水变成石头并冒蒸汽，放久了会自己冷却',
  });

  def(E.SOURCE, 'source', '水源', [34, 211, 238], {
    cat: CAT.SOLID, density: 10, jitter: 0.10,
    desc: '不会动的出水口：下面空了就往出冒水，可以造永久瀑布',
  });

  // UI 调色板顺序（也是数字键 1..9,0 / q,w,e,r,t 的顺序）
  const PALETTE = [
    E.SAND, E.WATER, E.OIL, E.FIRE, E.STONE,
    E.WOOD, E.ICE, E.LAVA, E.ACID, E.PLANT,
    E.SEED, E.STEAM, E.SMOKE, E.SOURCE, E.EMPTY,
  ];

  const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'q', 'w', 'e', 'r', 't'];

  function isFlammable(id) { return DEFS[id] ? DEFS[id].flammable > 0 : false; }

  return { E: E, CAT: CAT, DEFS: DEFS, PALETTE: PALETTE, HOTKEYS: HOTKEYS, isFlammable: isFlammable };
});
