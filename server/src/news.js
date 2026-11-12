/**
 * 资讯模块数据通道
 *
 * 两个职责，都在 Worker 里完成（浏览器直连会被 CORS 与防盗链挡住）：
 *   1. 热榜聚合：微博 / 百度 / 知乎 / 小红书，各源独立超时与降级，
 *      单源挂掉不影响其它三列。
 *   2. 订阅源抓取：RSS 2.0 / Atom / JSON Feed / 普通网页。
 *      网页会先找 <link rel="alternate" type="application/rss+xml">，
 *      找不到再退化成「页面里的文章链接列表」。
 *
 * 安全边界（这个接口等于一个受限代理，必须防 SSRF）：
 *   - 只允许 http/https，只放行 80/443/8080/8443
 *   - 拒绝 IP 字面量与 localhost / .local / .internal / 云元数据地址
 *   - 手动跟随重定向，每一跳都重新校验
 *   - 响应体硬上限 700KB，8 秒超时，只取文本类内容
 */
import { ApiError } from './http.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
const FETCH_TIMEOUT = 8000;
const MAX_BYTES = 700 * 1024;
const HOT_TTL = 120;      // 热榜缓存 2 分钟
const FEED_TTL = 600;     // 订阅缓存 10 分钟
const MAX_SUBS = 12;
const MAX_ITEMS = 30;

/* ------------------------------------------------------------------ */
/* 通用工具                                                            */
/* ------------------------------------------------------------------ */

export function hashId(str) {
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 'n' + h.toString(36) + s.length.toString(36);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    const k = String(code).toLowerCase();
    if (k[0] === '#') {
      const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[k] ?? m;
  });
}

export function cleanText(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

function absUrl(base, href) {
  const raw = decodeEntities(String(href || '').trim());
  if (!raw || /^(javascript|data|mailto|tel|file):/i.test(raw)) return '';
  try {
    const u = new URL(raw, base);
    // 订阅源里混进 ftp: / chrome: 之类的链接时直接丢掉，别让它进 href
    if (!/^https?:$/.test(u.protocol)) return '';
    return u.toString();
  } catch {
    return '';
  }
}

/** 统一成毫秒时间戳：前端只做数字比较，避免时区/格式差异 */
function normDate(v) {
  if (!v) return 0;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

/**
 * 热度文本 → 数字。
 * 各家的写法不统一：「12345678」「4378 万热度」「1.2亿」都有，
 * 只抽数字会把「万」丢掉，把 4378 万显示成 4378，量级全错。
 */
function hotNumber(v) {
  const m = String(v ?? '').replace(/,/g, '').match(/([\d.]+)\s*(亿|万|w|k)?/i);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return 0;
  const unit = (m[2] || '').toLowerCase();
  if (unit === '亿') n *= 1e8;
  else if (unit === '万' || unit === 'w') n *= 1e4;
  else if (unit === 'k') n *= 1e3;
  return n;
}

/** 把热度数字压成「12.3万 / 1.2亿」，与小标题里的排版宽度匹配 */
function fmtHot(v) {
  const num = hotNumber(v);
  if (!num) return String(v || '').slice(0, 10);
  if (num >= 1e8) return (num / 1e8).toFixed(1).replace(/\.0$/, '') + '亿';
  if (num >= 1e4) return (num / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
  return String(Math.round(num));
}

/* ------------------------------------------------------------------ */
/* 受限抓取                                                            */
/* ------------------------------------------------------------------ */

function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home')) return true;
  if (h === 'metadata.google.internal') return true;
  // IPv4 字面量：私有段、回环、链路本地、云元数据
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  // IPv6 字面量：回环 / 唯一本地 / 链路本地
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
    return false;
  }
  return false;
}

export function assertPublicUrl(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    throw new ApiError('bad_url', '链接格式不正确，请以 http:// 或 https:// 开头', 400);
  }
  if (!/^https?:$/.test(u.protocol)) throw new ApiError('bad_url', '只支持 http / https 链接', 400);
  if (u.username || u.password) throw new ApiError('bad_url', '链接不能包含账号密码', 400);
  if (isPrivateHost(u.hostname)) throw new ApiError('bad_url', '该地址不允许订阅', 400);
  if (u.port && !['80', '443', '8080', '8443'].includes(u.port)) throw new ApiError('bad_url', '只支持标准端口', 400);
  return u;
}

async function readCapped(res, cap = MAX_BYTES) {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      chunks.push(value.subarray(0, Math.max(0, value.length - (total - cap))));
      try { await reader.cancel(); } catch { /* 已结束 */ }
      break;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(Math.min(total, cap));
  let off = 0;
  for (const c of chunks) {
    if (off >= out.length) break;
    const slice = c.subarray(0, out.length - off);
    out.set(slice, off);
    off += slice.length;
  }
  return out;
}

function decodeBody(bytes, contentType = '') {
  const m = /charset=([\w-]+)/i.exec(contentType);
  const cs = (m?.[1] || 'utf-8').toLowerCase();
  try {
    return new TextDecoder(cs === 'gb2312' ? 'gbk' : cs).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

async function fetchLimited(rawUrl, { headers = {}, timeout = FETCH_TIMEOUT, hops = 3 } = {}) {
  let current = assertPublicUrl(rawUrl).toString();
  for (let i = 0; i <= hops; i += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'user-agent': UA,
          accept: 'application/rss+xml, application/atom+xml, application/json, text/xml, text/html;q=0.9, */*;q=0.8',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.7',
          ...headers,
        },
      });
    } catch (err) {
      throw new ApiError('fetch_failed', err?.name === 'AbortError' ? '抓取超时' : '抓取失败，站点无法访问', 502);
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new ApiError('fetch_failed', '站点返回了空重定向', 502);
      current = assertPublicUrl(new URL(loc, current).toString()).toString();
      continue;
    }
    if (!res.ok) throw new ApiError('fetch_failed', `站点返回 ${res.status}`, 502);

    const type = res.headers.get('content-type') || '';
    if (type && !/xml|json|html|text\/plain/i.test(type)) {
      throw new ApiError('bad_content', '该地址不是网页或订阅源', 415);
    }
    const bytes = await readCapped(res);
    return { text: decodeBody(bytes, type), url: current, type };
  }
  throw new ApiError('fetch_failed', '重定向次数过多', 502);
}

/* ------------------------------------------------------------------ */
/* 缓存：Cache API + 进程内 Map（本地 dev 没有 caches.default 时兜底）    */
/* ------------------------------------------------------------------ */
const mem = new Map(); // key -> { at, ttl, data }

async function cacheGet(key) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < hit.ttl * 1000) return hit.data;
  try {
    const r = await caches.default.match(new Request(key));
    if (r) {
      const data = await r.json();
      mem.set(key, { at: Date.now(), ttl: FEED_TTL, data });
      return data;
    }
  } catch { /* 本地 dev 无 Cache API */ }
  return null;
}

async function cachePut(key, data, ttl) {
  mem.set(key, { at: Date.now(), ttl, data });
  // 进程内缓存无限增长会吃 isolate 内存，超过 80 条就清最早的一半
  if (mem.size > 80) {
    [...mem.keys()].slice(0, 40).forEach((k) => mem.delete(k));
  }
  try {
    await caches.default.put(new Request(key), new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json', 'cache-control': `max-age=${ttl}` },
    }));
  } catch { /* 同上 */ }
}

/* ------------------------------------------------------------------ */
/* 订阅源解析                                                          */
/* ------------------------------------------------------------------ */

function tagText(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = block.match(re);
  return m ? m[1] : '';
}

function attrOf(block, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*["']([^"']+)["'][^>]*>`, 'i');
  const m = block.match(re);
  return m ? m[1] : '';
}

function firstImg(html) {
  // 订阅源里的 content 常是转义过的 HTML（&lt;img src=…&gt;），先还原再抓
  const raw = decodeEntities(String(html || ''));
  const m = raw.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  return m ? m[1] : '';
}

function makeItem({ title, link, ts, image, excerpt }, base, source) {
  const url = absUrl(base, link);
  const t = cleanText(title).slice(0, 180);
  if (!url || !t) return null;
  return {
    id: hashId(url),
    title: t,
    url,
    ts: normDate(ts),
    image: image ? absUrl(base, image) : '',
    excerpt: cleanText(excerpt).slice(0, 140),
    source: String(source || '').slice(0, 40),
  };
}

export function parseRss(xml, baseUrl) {
  const channel = xml.split(/<item\b/i)[0] || xml;
  const title = cleanText(tagText(channel, 'title')) || '未命名订阅';
  const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)]
    .map((m) => m[0])
    .map((b) => {
      const content = tagText(b, 'content:encoded') || tagText(b, 'description') || '';
      const img = attrOf(b, 'enclosure', 'url')
        || attrOf(b, 'media:content', 'url')
        || attrOf(b, 'media:thumbnail', 'url')
        || firstImg(content);
      return makeItem({
        title: tagText(b, 'title'),
        link: tagText(b, 'link') || tagText(b, 'guid'),
        ts: tagText(b, 'pubDate') || tagText(b, 'dc:date'),
        image: img,
        excerpt: content,
      }, baseUrl, title);
    })
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
  return { title, type: 'rss', items };
}

export function parseAtom(xml, baseUrl) {
  const head = xml.split(/<entry\b/i)[0] || xml;
  const title = cleanText(tagText(head, 'title')) || '未命名订阅';
  const items = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)]
    .map((m) => m[0])
    .map((b) => {
      // Atom 的 link 是自闭合标签，优先 rel="alternate"
      const alt = b.match(/<link\b[^>]*\brel\s*=\s*["']alternate["'][^>]*>/i)?.[0]
        || b.match(/<link\b[^>]*\bhref\s*=\s*["'][^"']+["'][^>]*>/i)?.[0]
        || '';
      const content = tagText(b, 'content') || tagText(b, 'summary');
      return makeItem({
        title: tagText(b, 'title'),
        link: attrOf(alt, 'link', 'href'),
        ts: tagText(b, 'published') || tagText(b, 'updated'),
        image: firstImg(content),
        excerpt: content,
      }, baseUrl, title);
    })
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
  return { title, type: 'atom', items };
}

export function parseJsonFeed(obj, baseUrl) {
  const title = cleanText(obj?.title) || '未命名订阅';
  const items = (Array.isArray(obj?.items) ? obj.items : [])
    .map((it) => makeItem({
      title: it.title || it.summary || '',
      link: it.url || it.external_url || it.id,
      ts: it.date_published || it.date_modified,
      image: it.image || it.banner_image || firstImg(it.content_html),
      excerpt: it.summary || it.content_text || it.content_html,
    }, baseUrl, title))
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
  return { title, type: 'json', items };
}

/** 普通网页：优先自动发现 RSS，其次抽文章链接，最后退化成单条「网页」订阅 */
export function parsePage(html, baseUrl) {
  const head = html.split(/<body\b/i)[0] || html;
  const title = cleanText(
    html.match(/<meta\b[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)["']/i)?.[1]
    || tagText(head, 'title')
    || html.match(/<meta\b[^>]*name\s*=\s*["']title["'][^>]*content\s*=\s*["']([^"']+)["']/i)?.[1],
  ).slice(0, 60) || '网页订阅';

  const feedHref = [...head.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0])
    .find((tag) => /rel\s*=\s*["'][^"']*alternate/i.test(tag) && /(rss|atom)\+xml/i.test(tag))
    ?.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];

  const ogImage = html.match(/<meta\b[^>]*property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)["']/i)?.[1] || '';

  // 正文链接：同域、有可读文字、排除导航与锚点
  const seen = new Set();
  const links = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    const text = cleanText(m[2]);
    if (!href || text.length < 8 || text.length > 120) continue;
    if (/^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    const url = absUrl(baseUrl, href);
    if (!url || seen.has(url)) continue;
    if (new URL(url).hostname !== new URL(baseUrl).hostname) continue;
    seen.add(url);
    links.push({ title: text, url });
    if (links.length >= 15) break;
  }

  const items = links.length >= 3
    ? links.map((l) => makeItem({ title: l.title, link: l.url, ts: '', image: '', excerpt: '' }, baseUrl, title)).filter(Boolean)
    : [makeItem({
      title, link: baseUrl, ts: '', image: ogImage,
      excerpt: html.match(/<meta\b[^>]*property\s*=\s*["']og:description["'][^>]*content\s*=\s*["']([^"']+)["']/i)?.[1] || '',
    }, baseUrl, title)].filter(Boolean);

  return { title, type: 'page', feedHref: feedHref ? absUrl(baseUrl, feedHref) : '', items };
}

/* ------------------------------------------------------------------ */
/* 订阅入口                                                            */
/* ------------------------------------------------------------------ */

async function loadOneSource(url) {
  const key = `https://cache.workdesk.internal/feed?u=${encodeURIComponent(url)}`;
  const cached = await cacheGet(key);
  if (cached) return cached;

  let doc = null;
  let parsed = null;
  try {
    doc = await fetchLimited(url);
    const body = doc.text.trim();
    const ctype = doc.type || '';

    if (/^[[{]/.test(body) || /json/.test(ctype)) {
      let obj;
      try { obj = JSON.parse(body); } catch { obj = null; }
      if (obj && (Array.isArray(obj.items) || obj.version?.includes?.('jsonfeed'))) {
        parsed = parseJsonFeed(obj, doc.url);
      }
    }
    if (!parsed && /<(rss|feed|rdf:RDF)\b/i.test(body.slice(0, 800))) {
      parsed = /<feed\b/i.test(body.slice(0, 800)) ? parseAtom(body, doc.url) : parseRss(body, doc.url);
    }
    if (!parsed) {
      const page = parsePage(body, doc.url);
      if (page.feedHref) {
        // 网页里声明了订阅源：跟一跳，拿真正的条目
        try {
          const feedDoc = await fetchLimited(page.feedHref);
          const fb = feedDoc.text.trim();
          parsed = /<feed\b/i.test(fb.slice(0, 800)) ? parseAtom(fb, feedDoc.url) : parseRss(fb, feedDoc.url);
        } catch {
          parsed = page;
        }
      } else {
        parsed = page;
      }
    }
  } catch (err) {
    const out = { url, title: '', type: '', items: [], error: err?.message || '抓取失败' };
    // 失败只做短缓存，避免每次进页面都重试同一条坏链接
    await cachePut(key, out, 60);
    return out;
  }

  const out = {
    url,
    title: parsed.title || new URL(url).hostname,
    type: parsed.type || 'rss',
    siteUrl: doc?.url || url,
    items: parsed.items || [],
    error: '',
    at: Date.now(),
  };
  await cachePut(key, out, FEED_TTL);
  return out;
}

/* ------------------------------------------------------------------ */
/* 热榜                                                               */
/* ------------------------------------------------------------------ */

async function getJson(url, headers = {}) {
  const { text } = await fetchLimited(url, { headers });
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('bad_content', '数据格式异常', 502);
  }
}

export function parseWeibo(json) {
  const list = json?.data?.band_list || json?.data?.realtime || [];
  return list
    .filter((x) => x && !x.is_ad && (x.note || x.word))
    .map((x, i) => {
      const word = x.note || x.word;
      const q = x.word_scheme || `#${x.word || word}#`;
      return {
        rank: i + 1,
        title: String(word).trim(),
        url: `https://s.weibo.com/weibo?q=${encodeURIComponent(q)}`,
        hot: x.num ? fmtHot(x.num) : '',
      };
    });
}

export function parseBaidu(json) {
  const card = json?.data?.cards?.[0];
  const raw = card?.content?.[0]?.content || card?.content || [];
  return raw
    .filter((x) => x && x.word)
    .map((x, i) => ({
      rank: i + 1,
      title: String(x.word).trim(),
      url: x.url || `https://www.baidu.com/s?wd=${encodeURIComponent(x.word)}`,
      hot: x.hotScore ? fmtHot(x.hotScore) : '',
    }));
}

export function parseZhihu(json) {
  return (json?.data || [])
    .filter((x) => x?.target?.title)
    .map((x, i) => {
      const id = x.target.id || String(x.target.url || '').split('/').pop();
      return {
        rank: i + 1,
        title: String(x.target.title).trim(),
        url: /^https?:\/\//.test(x.target.url || '')
          ? String(x.target.url).replace('api.zhihu.com/questions/', 'www.zhihu.com/question/')
          : `https://www.zhihu.com/question/${id}`,
        hot: fmtHot(String(x.detail_text || '').replace(/热度$/, '')),
      };
    });
}

/** 小红书热榜：官方接口对机房 IP 不稳定，命中任意一个可用形状即可 */
export function parseXhs(json) {
  const box = json?.data || json;
  const raw = box?.items || box?.hot_list || box?.list || box?.words || [];
  return (Array.isArray(raw) ? raw : [])
    .map((x, i) => {
      const title = x?.title || x?.name || x?.word || x?.search_word || x?.query || '';
      if (!title) return null;
      const keyword = x?.search_word || x?.query || title;
      return {
        rank: i + 1,
        title: String(title).trim(),
        url: `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_search_result_notes`,
        hot: fmtHot(x?.hot_value || x?.heat || x?.score || ''),
      };
    })
    .filter(Boolean);
}

const HOT_SOURCES = [
  {
    id: 'weibo', label: '微博热搜', accent: '#f43f5e', home: 'https://s.weibo.com/top/summary',
    async load() {
      return parseWeibo(await getJson('https://weibo.com/ajax/statuses/hot_band', { referer: 'https://weibo.com/' }));
    },
  },
  {
    id: 'baidu', label: '百度热搜', accent: '#3b82f6', home: 'https://top.baidu.com/board?tab=realtime',
    async load() {
      return parseBaidu(await getJson('https://top.baidu.com/api/board?platform=wise&tab=realtime'));
    },
  },
  {
    id: 'zhihu', label: '知乎热榜', accent: '#6366f1', home: 'https://www.zhihu.com/hot',
    async load() {
      return parseZhihu(await getJson('https://api.zhihu.com/topstory/hot-list?limit=30&reverse_order=0', {
        referer: 'https://www.zhihu.com/',
      }));
    },
  },
  {
    id: 'xhs', label: '小红书热榜', accent: '#ff2442', home: 'https://www.xiaohongshu.com/explore',
    async load() {
      const headers = { referer: 'https://www.xiaohongshu.com/explore', origin: 'https://www.xiaohongshu.com' };
      const tries = [
        'https://www.xiaohongshu.com/api/sns/web/v1/search/hot_list',
        'https://www.xiaohongshu.com/web_api/sns/v1/search/hot_word',
      ];
      let last = null;
      for (const u of tries) {
        try {
          const items = parseXhs(await getJson(u, headers));
          if (items.length) return items;
          last = new ApiError('bad_content', '该源返回空榜单', 502);
        } catch (err) {
          last = err;
        }
      }
      void last;
      throw new ApiError('source_unavailable', '小红书榜单暂不可用，可稍后重试', 502);
    },
  },
];

/* ------------------------------------------------------------------ */
/* 对外接口                                                            */
/* ------------------------------------------------------------------ */

export async function hotBoards(env, only = '') {
  const key = 'https://cache.workdesk.internal/hot';
  const picks = only ? String(only).split(',').map((s) => s.trim()).filter(Boolean) : null;
  const cached = !picks ? await cacheGet(key) : null;
  if (cached) return cached;

  const boards = await Promise.all(HOT_SOURCES.map(async (s) => {
    if (picks && !picks.includes(s.id)) return null;
    try {
      // 热榜条目也要带主键与来源：稍后读/收藏只存一条快照，得知道它从哪来
      const items = (await s.load()).slice(0, 20).map((it) => ({
        ...it,
        id: it.id || hashId(it.url),
        source: s.label,
      }));
      return { id: s.id, label: s.label, accent: s.accent, home: s.home, items, error: '' };
    } catch (err) {
      return {
        id: s.id, label: s.label, accent: s.accent, home: s.home, items: [],
        // 单源失败不抛错：前端那一列显示「暂不可用」并给重试入口
        error: err?.code === 'bad_content' ? '数据源暂无榜单' : (err?.message || '抓取失败'),
      };
    }
  }));

  const out = { boards: boards.filter(Boolean), fetchedAt: Date.now() };
  if (!picks) await cachePut(key, out, HOT_TTL);
  return out;
}

/** 简单滑动窗口限流：单 isolate 内存足够挡住脚本刷接口 */
const hits = new Map();
function rateOk(ip, limit = 40, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const rec = hits.get(ip);
  if (!rec || now > rec.reset) {
    hits.set(ip, { n: 1, reset: now + windowMs });
    if (hits.size > 500) {
      [...hits.entries()].filter(([, v]) => now > v.reset).forEach(([k]) => hits.delete(k));
    }
    return true;
  }
  rec.n += 1;
  return rec.n <= limit;
}

export async function feedSources(env, req, body) {
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  if (!rateOk(ip)) throw new ApiError('too_many_requests', '刷新太频繁了，稍等几分钟再试', 429);

  const urls = [...new Set((Array.isArray(body?.urls) ? body.urls : [])
    .map((u) => String(u || '').trim())
    .filter(Boolean))].slice(0, MAX_SUBS);

  if (!urls.length) return { sources: [] };

  // 逐条校验：一个坏地址不该拖垮整批订阅
  const sources = await Promise.all(urls.map(async (u) => {
    try {
      assertPublicUrl(u);
      return await loadOneSource(u);
    } catch (err) {
      return { url: u, title: '', type: '', items: [], error: err?.message || '抓取失败', at: Date.now() };
    }
  }));
  return { sources };
}
