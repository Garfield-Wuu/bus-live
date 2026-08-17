#!/usr/bin/env node
// find.js — 交互查询某城市的线路/站点 ID，方便配置线路与候车站
// 用法：
//   node src/find.js --city 014 --kw 1路          # 在深圳搜 "1路"
//   node src/find.js --city 014 --kw 1路 --detail  # 搜索后列出候选线路的所有站点
//   node src/find.js                               # 默认城市=深圳, 提示输入关键词
import { createInterface } from 'node:readline';
import * as bus from './chelaile.js';
import { config } from './config.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const s = a.slice(2);
    if (s.includes('=')) { const [k, v] = s.split('='); out[k] = v; }
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[s] = argv[++i];
    else out[s] = '1';
  }
  return out;
}

function ask(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a.trim()); }));
}

const args = parseArgs(process.argv.slice(2));
const cityId = args.city || args.cityId || config.cityId;
let kw = args.kw || args.keyword;

if (!kw) kw = await ask(`城市 ${cityId} 下搜索线路关键词(如: 1路): `);
if (!kw) { console.log('未输入关键词'); process.exit(0); }

console.log(`\n🔍 在 ${cityId} 搜索 "${kw}" ...`);
const lines = await bus.searchLines(cityId, kw);
if (!lines.length) {
  console.log('未找到线路。可尝试更精确关键词(如 "1路" 而非 "1")。');
  process.exit(0);
}

console.log('\n候选线路:');
lines.forEach((l, i) => {
  console.log(`  [${i}] ${l.name}  ${l.startSn} → ${l.endSn}  (lineId=${l.lineId}${l.sn1 ? ', ' + l.sn1 : ''})`);
});

let pick = args.detail != null ? 0 : null;
if (pick == null) {
  const a = await ask('\n选择要查看站点的线路序号(回车=0): ');
  pick = parseInt(a || '0', 10) || 0;
}
const sel = lines[pick] || lines[0];
if (!sel) process.exit(0);

if (args.detail != null || pick != null) {
  console.log(`\n📍 ${sel.name} 全部站点:`);
  try {
    const d = await bus.lineDetail(cityId, sel.lineId);
    d.stations.forEach((s) => {
      const mark = (config.stopOrder === s.order && config.stopName === s.sn) ? '  ← 当前候车站' : '';
      console.log(`  序${String(s.order).padStart(2)} ${s.sn} (sId=${s.sId})${mark}`);
    });
    console.log('\n选一个候车站, 记下 站序(s.order) 和 sId, 写入 .env:');
    console.log('  BUS_STOP_NAME=站名');
    console.log('  BUS_STOP_ORDER=站序');
  } catch (e) {
    console.log('取站点失败:', e.message);
  }
}

console.log('\n✅ 配置方法参考 README.md 或 .env.example');
