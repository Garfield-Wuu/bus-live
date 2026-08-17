// busapi.mjs — 车来了(chelaile)逆向接口封装
// 已验证: MD5签名 + AES-256-ECB解密 + **YGKJ{}##包壳
import { createHash, createDecipheriv } from 'node:crypto';
import https from 'node:https';
import zlib from 'node:zlib';

const BASE = 'https://web.chelaile.net.cn';
const BASE_API = `${BASE}/api`;
const SALT = 'qwihrnbtmj';
const AES_KEY = 'FF32AE65FBFD19414EAAFF6291A54B42';

const DEF = {
  s: 'h5', wxs: 'wx_app', sign: '1', h5RealData: '1', v: '3.11.28',
  src: 'weixinapp_cx', ctm_mp: 'mp_wx', vc: '2', favoriteGray: '1',
  gpstype: 'wgs', geo_type: 'wgs', scene: '1256',
};

const HDRS = {
  Host: 'web.chelaile.net.cn',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13) XWEB/18055',
  'xweb_xhr': '1', Accept: '*/*', 'Sec-Fetch-Site': 'cross-site',
  'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty',
  Referer: 'https://servicewechat.com/wx71d589ea01ce3321/814/page-frame.html',
  'Accept-Encoding': 'gzip, deflate, br', 'Accept-Language': 'zh-CN,zh;q=0.9',
};

function sign(params) {
  const str = Object.entries(params)
    .map(([k, v]) => `"${k}"="${v}"`).join('&') + SALT;
  return createHash('md5').update(str).digest('hex');
}
function decrypt(c) {
  const d = createDecipheriv('aes-256-ecb', Buffer.from(AES_KEY, 'utf8'), null);
  return d.update(c, 'base64', 'utf8') + d.final('utf8');
}
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { headers: HDRS, timeout: 15000 }, (r) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => {
        let b = Buffer.concat(chunks);
        const enc = r.headers['content-encoding'];
        if (enc === 'br') b = zlib.brotliDecompressSync(b);
        else if (enc === 'gzip') b = zlib.gunzipSync(b);
        else if (enc === 'deflate') b = zlib.inflateSync(b);
        resolve(b.toString('utf8'));
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function call(path, params) {
  const all = { ...DEF, ...params };
  const u = new URL(BASE_API + path);
  u.search = new URLSearchParams({ ...all, cryptoSign: sign(all) }).toString();
  const raw = await httpsGet(u);
  // 剥掉 `**YGKJ{...}YGKJ##` 包壳；找不到就假设整段是 JSON
  const m = raw.match(/\*\*YGKJ(\{.*\})YGKJ##\s*$/s);
  const body = m ? m[1] : raw;
  const j = JSON.parse(body);
  const d = j?.jsonr?.data;
  if (!d) throw new Error('上游无数据: ' + body.slice(0, 200));
  if (d.encryptResult) return JSON.parse(decrypt(d.encryptResult));
  return d;
}

/** 城市列表 → 按名称包含匹配，返回 [cityId] */
export async function findCity(cityName = '深圳') {
  const u = new URL(`${BASE}/wwd/ncitylist`);
  u.search = new URLSearchParams(DEF).toString();
  const raw = await httpsGet(u);
  const j = JSON.parse(raw);
  const list = j.data?.cityList ?? [];
  return list.filter((c) => (c.cityName || '').includes(cityName))[0] || null;
}

/** 搜索线路 → 返回 lineId/名称/起止/方向 */
export async function searchLine(cityId, keyword) {
  const r = await call('/bus/query!nSearch.action', {
    cityId, localCityId: cityId, key: keyword, supportPhyStn: 'true',
  });
  const l = r?.result?.lines?.[0] || null;
  return l
    ? { lineId: l.lineId, name: l.name, startSn: l.startSn, endSn: l.endSn, direction: l.direction }
    : null;
}

/** 搜索线路 → 返回完整候选列 (多条) */
export async function searchLines(cityId, keyword) {
  const r = await call('/bus/query!nSearch.action', {
    cityId, localCityId: cityId, key: keyword, supportPhyStn: 'true',
  });
  return (r?.result?.lines ?? []).map((l) => ({
    lineId: l.lineId, name: l.name,
    startSn: l.startSn, endSn: l.endSn, direction: l.direction,
  }));
}

/** 从 busTagList 解析权威拥挤度等级(拥挤度_N)；取不到用 capacity 回退 */
function parseCrowd(b) {
  const t = (b.busTagList || []).find((t) => /^拥挤度_(\d+)$/.test(t.imageUrlKey || ''));
  if (t) return parseInt(t.imageUrlKey.match(/^拥挤度_(\d+)$/)[1], 10);
  return b.capacity ?? 0;
}

/** 线路详情：26站(WGS) + 全量实时车辆位置 */
export async function lineDetail(cityId, lineId) {
  const r = await call('/bus/line!encryptedLineDetail.action', {
    cityId, localCityId: cityId, lineId,
  });
  const stations = (r.stations ?? []).map((s) => ({
    order: s.order ?? 0, sId: s.sId ?? '', sn: s.sn ?? '',
    lat: s.wgsLat ?? s.lat ?? 0, lng: s.wgsLng ?? s.lng ?? 0,
  }));
  const buses = (r.buses ?? []).map((b) => ({
    busId: b.busId ?? '', licence: b.licence ?? '',
    order: b.order ?? 0, lat: b.lat ?? 0, lng: b.lng ?? 0,
    speed: b.speed ?? 0, crowd: parseCrowd(b),
    distanceToWaitStn: b.distanceToWaitStn ?? -1,
  }));
  return {
    line: {
      name: r.line?.name ?? '', lineId: r.line?.lineId ?? '',
      startSn: r.line?.startSn ?? '', endSn: r.line?.endSn ?? '',
      direction: r.line?.direction ?? 0,
      stationsNum: r.line?.stationsNum ?? stations.length,
      firstTime: r.line?.firstTime ?? '', lastTime: r.line?.lastTime ?? '',
    },
    stations, buses,
  };
}

/** 点到点实时：给指定候车站，返回每辆车到达该站的 ETA */
export async function stopRealtime(cityId, lineId, targetOrder, stationId, lat, lng) {
  const r = await call('/bus/line!encryptedBusDetail.action', {
    cshow: 'busDetail', specail: '0', specialType: 'undefined',
    cityId, localCityId: cityId, lineId,
    targetOrder: String(targetOrder), stationId,
    lat: String(lat), lng: String(lng), needBuses: '1',
  });
  return (r.buses ?? []).map((b) => {
    const t = b.travels?.[0];
    return {
      busId: b.busId ?? '', licence: b.licence ?? '',
      order: b.order ?? 0, lat: b.lat ?? 0, lng: b.lng ?? 0,
      speed: b.speed ?? 0, crowd: parseCrowd(b),
      distanceToWaitStn: b.distanceToWaitStn ?? -1,
      etaSec: t?.travelTime ?? null,
      etaTime: t?.recommTip ?? null,
      arrivalTime: t?.arrivalTime ?? null,
    };
  });
}

/** 线路轨迹 polyline (WGS) */
export async function lineRoute(cityId, lineId) {
  const r = await call('/bus/line!lineRoute.action', {
    cityId, localCityId: cityId, lineId, includeShape: 'true',
  });
  return (r.route ?? []).map((p) => [p.lat ?? 0, p.lng ?? 0]);
}
