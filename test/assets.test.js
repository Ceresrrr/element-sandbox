/*
 * 交付物自检：页面引用的文件都真实存在，且保持"双击即可打开"的离线属性。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('index.html 引用的每个本地文件都存在', function () {
  const refs = [];
  const re = /(?:src|href)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) refs.push(m[1]);
  assert.ok(refs.length >= 5, '应该引用样式和 4 个脚本，实际 ' + refs.length);
  for (const r of refs) {
    if (/^(https?:)?\/\//.test(r) || r.startsWith('data:')) continue;
    const p = path.join(ROOT, r);
    assert.ok(fs.existsSync(p), 'index.html 引用了不存在的文件：' + r);
  }
});

test('脚本以经典脚本加载（file:// 双击也能跑）', function () {
  assert.ok(!/type\s*=\s*"module"/.test(html), '用了 ES module，file:// 下会被 CORS 拦掉');
  for (const f of ['js/elements.js', 'js/sim.js', 'js/presets.js', 'js/main.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/^\s*(import|export)\s/m.test(src), f + ' 里出现了 ESM 语法，会破坏经典脚本加载');
  }
});

test('没有任何外链资源（完全离线）', function () {
  const bad = html.match(/(?:src|href)="(https?:)?\/\/[^"]+"/g);
  assert.equal(bad, null, '不应有外部依赖：' + bad);
  for (const f of ['css/style.css', 'js/elements.js', 'js/sim.js', 'js/presets.js', 'js/main.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/https?:\/\/(?!127\.0\.0\.1)/.test(src), f + ' 里出现了外部 URL');
  }
});

test('四个脚本声明的全局名字和 main.js 取用的一致', function () {
  const names = {
    'js/elements.js': 'SandElements',
    'js/sim.js': 'SandPhysics',
    'js/presets.js': 'SandPresets',
  };
  for (const [f, name] of Object.entries(names)) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(src.includes('root.' + name + ' ='), f + ' 应该挂到 window.' + name);
    assert.ok(html.indexOf(f) !== -1, 'index.html 应该引入 ' + f);
  }
  const main = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');
  for (const name of Object.values(names)) {
    assert.ok(main.includes('window.' + name), 'main.js 应该读取 window.' + name);
  }
});

test('main.js 里用到的 DOM id 在 index.html 中都存在', function () {
  const main = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');
  const re = /getElementById\('([^']+)'\)/g;
  let m;
  const ids = [];
  while ((m = re.exec(main)) !== null) ids.push(m[1]);
  assert.ok(ids.length >= 8, '应该抓取到多个 DOM 节点');
  for (const id of ids) {
    assert.ok(html.includes('id="' + id + '"'), 'index.html 缺少 id="' + id + '"');
  }
});

test('README 描述了玩法与测试方法', function () {
  const p = path.join(ROOT, 'README.md');
  assert.ok(fs.existsSync(p), '缺少 README.md');
  const md = fs.readFileSync(p, 'utf8');
  assert.ok(md.includes('node --test'), 'README 应该写清怎么跑测试');
  assert.ok(md.includes('index.html'), 'README 应该写清怎么打开');
});
