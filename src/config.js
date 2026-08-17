// config.js — 运行时配置加载（零依赖）
// 优先级：命令行参数 --key=value > 环境变量 > .env 文件 > 内置默认演示线路
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- 解析 .env 文件（简单 KV，忽略注释/空行） ----------
function loadEnvFile() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return {};
  const out = {};
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!k) continue;
    // 去掉可选引号
    out[k] = v.replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

// ---------- 解析命令行 --key=value / --key value ----------
function loadArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--') && !a.startsWith('-')) continue;
    const s = a.replace(/^--?/, '');
    if (s.includes('=')) {
      const [k, v] = s.split('=');
      out[k] = v;
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
      out[s] = argv[++i];
    } else out[s] = '1';
  }
  return out;
}

// ---------- 默认演示配置（深圳 1 路 → 东湖人行天桥） ----------
const DEFAULTS = {
  cityId: '014',
  cityName: '深圳',
  lineId: '0755-00010-0',
  lineNo: '1路',
  stopName: '东湖人行天桥',
  stopOrder: 4,
  port: 8787,
  upstreamMs: 10000,
};

// ---------- 按优先级合并 ----------
const env = { ...loadEnvFile(), ...process.env };
const args = loadArgs(process.argv.slice(2));

const MAP = {
  cityId: ['BUS_CITY_ID', 'city', 'cityId'],
  cityName: ['BUS_CITY_NAME', 'cityName'],
  lineId: ['BUS_LINE_ID', 'line', 'lineId'],
  lineNo: ['BUS_LINE_NO', 'lineNo'],
  stopName: ['BUS_STOP_NAME', 'stop', 'stopName'],
  stopOrder: ['BUS_STOP_ORDER', 'order', 'stopOrder'],
  port: ['BUS_PORT', 'port'],
  upstreamMs: ['BUS_UPSTREAM_MS', 'upstreamMs'],
};

function get(key) {
  for (const src of MAP[key] || []) {
    if (args[src] != null) return args[src];
    if (env[src] != null) return env[src];
  }
  return undefined;
}

export const config = {
  cityId: get('cityId') || DEFAULTS.cityId,
  cityName: get('cityName') || DEFAULTS.cityName,
  lineId: get('lineId') || DEFAULTS.lineId,
  lineNo: get('lineNo') || DEFAULTS.lineNo,
  stopName: get('stopName') || DEFAULTS.stopName,
  stopOrder: parseInt(get('stopOrder') || DEFAULTS.stopOrder, 10),
  port: parseInt(get('port') || DEFAULTS.port, 10),
  upstreamMs: parseInt(get('upstreamMs') || DEFAULTS.upstreamMs, 10),
};
