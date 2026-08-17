// server.js — 实时公交看板后端
// 静态服务 + GET /api/line 聚合接口 + 缓存轮询（防上游风控）
//
// 用法：
//   node src/server.js                          # 用默认演示线路（见 config.js）
//   BUS_LINE_ID=xxxx BUS_STOP_NAME=xxx ... \     # 或 env 指定线路
//     node src/server.js
//   node src/server.js --city 014 --line xxx --stop xx --order 4   # 或 CLI 参数
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as bus from './chelaile.js';
import { config } from './config.js';

const PIDIR = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(PIDIR, '..', 'public');

// ---------- 缓存轮询 ----------
let cache = null;          // { data, ts, stale, error }
let lastOk = null;         // 上次成功数据(供 stale 容错)

async function refresh() {
  const { cityId, lineId, stopName, stopOrder } = config;
  try {
    const detail = await bus.lineDetail(cityId, lineId);
    // 由 detail 定位候车站（sId + WGS 坐标），再并发拉点到点 ETA 和轨迹
    const target = detail.stations.find((s) => s.order === stopOrder)
      || detail.stations.find((s) => s.sn === stopName)
      || detail.stations[0] || null;
    const [realtimeArray, route] = target
      ? await Promise.all([
          bus.stopRealtime(
            cityId, lineId, String(stopOrder),
            target.sId, String(target.lat), String(target.lng),
          ),
          bus.lineRoute(cityId, lineId),
        ])
      : [[], []];

    // 合成：以 stopRealtime(含ETA) 为准，detail 的 order 兜底车辆列表
    const targetOrder = target ? target.order : stopOrder;
    const buses = realtimeArray.map((b) => {
      const stopsToArrive = targetOrder - b.order;   // 可为负 → 已过站
      const passed = b.order > targetOrder || (b.etaSec == null && b.order >= targetOrder);
      return {
        busId: b.busId, licence: b.licence, order: b.order,
        lat: b.lat, lng: b.lng, speed: b.speed, crowd: b.crowd,
        distanceToWaitStn: b.distanceToWaitStn,
        stopsToArrive: passed ? null : Math.max(0, stopsToArrive),
        passed,
        etaSec: b.etaSec,
        etaMin: b.etaSec != null ? Math.round(b.etaSec / 60) : null,
        etaTime: b.etaTime,
      };
    })
      // 排序：有效ETA的按到站顺序，已过站/无ETA的排最后
      .sort((a, b) => {
        if (a.etaSec == null && b.etaSec == null) return 0;
        if (a.etaSec == null) return 1;
        if (b.etaSec == null) return -1;
        return a.etaSec - b.etaSec;
      });

    const data = {
      cfg: { cityName: config.cityName, lineNo: config.lineNo, stopName: config.stopName },
      line: detail.line,
      targetStop: target
        ? { order: target.order, sn: target.sn, sId: target.sId, lat: target.lat, lng: target.lng }
        : null,
      stations: detail.stations,
      route,
      buses,
      fetchedAt: Date.now(),
      stale: false,
    };
    cache = data;
    lastOk = data;
  } catch (e) {
    // 上游失败 → 用上次成功数据标记 stale
    cache = lastOk
      ? { ...lastOk, stale: true, fetchedAt: Date.now(), error: String(e && e.message || e) }
      : { stale: true, error: String(e && e.message || e), buses: [], stations: [], route: [] };
  }
}

// 立即拉一次 + 定时轮询
refresh();
setInterval(refresh, config.upstreamMs);

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/line') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(cache));
    return;
  }
  if (url.pathname === '/api/config') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ cfg: config, url: '/api/line' }));
    return;
  }
  // 静态文件（防目录穿越）
  let pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  let file = normalize(join(ROOT, pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
  res.end(readFileSync(file));
});

server.listen(config.port, () => {
  console.log(`🚌 Realtime Bus Monitor: http://localhost:${config.port}`);
  console.log(`已配置 ${config.cityName} ${config.lineNo} → ${config.stopName}(站序${config.stopOrder})`);
  console.log(`提示: 修改线路/站点后重启服务，或见 README.md 配置章节`);
});
