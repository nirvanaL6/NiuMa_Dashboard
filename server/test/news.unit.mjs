/**
 * 资讯通道单元测试：解析器 + SSRF 防护
 * 运行：node server/test/news.unit.mjs
 */
import {
  parseRss, parseAtom, parseJsonFeed, parsePage,
  parseWeibo, parseBaidu, parseZhihu, parseXhs,
  assertPublicUrl, hashId, cleanText,
} from '../src/news.js';

let fails = 0;
const ok = (cond, msg, extra = '') => {
  if (!cond) fails += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}${extra ? ' — ' + extra : ''}`);
};

/* ---------------- RSS ---------------- */
const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
  <title><![CDATA[示例科技]]></title>
  <item>
    <title>第一条 &amp; 带实体</title>
    <link>https://example.com/post/1</link>
    <pubDate>Thu, 12 Nov 2026 09:00:00 +0800</pubDate>
    <description><![CDATA[<p>摘要<img src="https://example.com/a.jpg"></p>]]></description>
    <enclosure url="https://example.com/b.jpg" type="image/jpeg"/>
  </item>
  <item>
    <title>第二条</title>
    <link>/post/2</link>
    <dc:date>2026-11-11T10:00:00Z</dc:date>
  </item>
  <item><title>没有链接的条目</title></item>
</channel></rss>`;
const r = parseRss(rss, 'https://example.com/feed');
ok(r.title === '示例科技', 'RSS 取到频道标题');
ok(r.items.length === 2, `RSS 过滤掉无链接条目（${r.items.length}）`);
ok(r.items[0].title === '第一条 & 带实体', 'RSS 标题解码实体');
ok(r.items[0].image === 'https://example.com/b.jpg', 'RSS 优先 enclosure 图');
ok(r.items[1].url === 'https://example.com/post/2', 'RSS 相对链接补全');
ok(r.items[1].image === '', 'RSS 无图条目 image 为空');
ok(r.items[0].ts > 1.7e12, 'RSS 时间转成毫秒时间戳');
ok(r.items.every((x) => x.id && x.id.startsWith('n')), 'RSS 每条都有稳定 id');

/* ---------------- Atom ---------------- */
const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
  <title>阮一峰的网络日志</title>
  <entry><title>周刊 418</title><link rel="alternate" href="https://example.com/w418"/>
    <published>2026-11-12T08:00:00Z</published>
    <content type="html">&lt;img src="https://example.com/c.png"&gt;</content></entry>
  <entry><title>周刊 417</title><link href="https://example.com/w417"/><updated>2026-11-05T08:00:00Z</updated></entry>
</feed>`;
const a = parseAtom(atom, 'https://example.com/atom.xml');
ok(a.title === '阮一峰的网络日志', 'Atom 取到频道标题');
ok(a.items.length === 2, 'Atom 解析出两条');
ok(a.items[0].url === 'https://example.com/w418', 'Atom 优先 rel=alternate');
ok(a.items[0].image === 'https://example.com/c.png', 'Atom 从 content 抽图');
ok(a.items[1].url === 'https://example.com/w417', 'Atom 兜底取任意 link');

/* ---------------- JSON Feed ---------------- */
const jf = {
  version: 'https://jsonfeed.org/version/1.1',
  title: 'JSON 源',
  items: [
    { title: 'J1', url: 'https://example.com/j1', date_published: '2026-11-12T00:00:00Z', image: 'https://example.com/j1.png' },
    { title: 'J2', external_url: 'https://example.com/j2', summary: '摘要' },
    { title: '' },
  ],
};
const j = parseJsonFeed(jf, 'https://example.com/feed.json');
ok(j.items.length === 2, `JSON Feed 跳过空标题（${j.items.length}）`);
ok(j.items[1].url === 'https://example.com/j2', 'JSON Feed 支持 external_url');
ok(j.items[1].excerpt === '摘要', 'JSON Feed 摘要进 excerpt');

/* ---------------- 网页订阅 ---------------- */
const page = `<html><head>
  <title>某博客</title>
  <link rel="alternate" type="application/rss+xml" href="/rss.xml">
  <meta property="og:image" content="https://example.com/og.png">
</head><body>
  <a href="/post/a">这是一篇足够长的文章标题甲</a>
  <a href="/post/b">这是另一篇足够长的文章标题乙</a>
  <a href="/post/c">第三篇足够长的文章标题丙</a>
  <a href="https://other.com/x">外域链接不应该收进来</a>
  <a href="/short">短</a>
  <a href="#top">锚点不收录</a>
</body></html>`;
const p = parsePage(page, 'https://example.com/');
ok(p.title === '某博客', '网页取到标题');
ok(p.feedHref === 'https://example.com/rss.xml', '网页里自动发现 RSS');
ok(p.items.length === 3, `网页只收同域正文链接（${p.items.length}）`);
ok(p.items[0].url === 'https://example.com/post/a', '网页相对链接补全');
ok(!p.items.some((x) => x.url.includes('other.com')), '网页不收录外域链接');

const bare = '<html><head><title>单页</title><meta property="og:image" content="https://example.com/x.png"></head><body>没有列表</body></html>';
const bp = parsePage(bare, 'https://example.com/about');
ok(bp.items.length === 1 && bp.items[0].url === 'https://example.com/about', '无列表的网页退化成单条订阅');
ok(bp.items[0].image === 'https://example.com/x.png', '单条订阅沿用 og:image');

/* ---------------- 热榜 ---------------- */
const weibo = parseWeibo({ data: { band_list: [
  { word: 'A', note: 'A 话题', word_scheme: '#A#', num: 1234567, realpos: 1 },
  { word: '广告', is_ad: 1 },
  { word: 'B', num: 9800 },
] } });
ok(weibo.length === 2, `微博过滤广告（${weibo.length}）`);
ok(weibo[0].hot === '123.5万', `微博热度格式化（${weibo[0].hot}）`);
ok(weibo[0].url.includes('s.weibo.com'), '微博链接指向搜索页');
ok(weibo[1].hot === '9800', '不足一万保留原值');

const baidu = parseBaidu({ data: { cards: [{ content: [{ content: [
  { word: '热搜一', url: 'https://m.baidu.com/s?word=x', hotScore: '12345678' },
  { word: '热搜二' },
] }] }] } });
ok(baidu.length === 2, '百度解析两层 content');
ok(baidu[0].hot === '1234.6万', `百度热度格式化（${baidu[0].hot}）`);
ok(baidu[1].url.includes('baidu.com/s?wd='), '百度缺链接时自己拼');

const zhihu = parseZhihu({ data: [
  { target: { id: 1, title: '问题一', url: 'https://api.zhihu.com/questions/1' }, detail_text: '4378 万热度' },
  { target: { id: 2, title: '问题二', url: 'https://www.zhihu.com/question/2' }, detail_text: '' },
] });
ok(zhihu.length === 2, '知乎解析两条');
ok(zhihu[0].url === 'https://www.zhihu.com/question/1', `知乎 API 域名换成人读地址（${zhihu[0].url}）`);
ok(zhihu[0].hot === '4378万', `知乎热度去掉「热度」（${zhihu[0].hot}）`);

const xhs = parseXhs({ data: { items: [{ title: '小红书热点', hot_value: 880000 }] } });
ok(xhs.length === 1 && xhs[0].url.includes('search_result?keyword='), '小红书条目拼搜索链接');
ok(xhs[0].hot === '88万', `小红书热度格式化（${xhs[0].hot}）`);

/* ---------------- SSRF ---------------- */
const blocked = [
  'http://localhost:8080/feed',
  'http://127.0.0.1/feed',
  'http://10.1.2.3/feed',
  'http://192.168.1.1/feed',
  'http://172.20.0.1/feed',
  'http://169.254.169.254/latest/meta-data',
  'http://[::1]/feed',
  'file:///etc/passwd',
  'ftp://example.com/feed',
  'http://user:pass@example.com/feed',
  'http://example.com:6379/feed',
  'http://service.internal/feed',
];
let allBlocked = true;
for (const u of blocked) {
  try {
    assertPublicUrl(u);
    allBlocked = false;
    console.log(`   未被拦截：${u}`);
  } catch { /* 期望抛错 */ }
}
ok(allBlocked, `拦截 ${blocked.length} 种内网 / 非法地址`);

const allowed = ['https://example.com/feed', 'http://example.com:8080/feed', 'https://sspai.com/feed'];
ok(allowed.every((u) => { try { assertPublicUrl(u); return true; } catch { return false; } }), '放行正常公网地址');

ok(hashId('https://a.com/1') === hashId('https://a.com/1'), '同一链接 id 稳定');
ok(hashId('https://a.com/1') !== hashId('https://a.com/2'), '不同链接 id 不同');
ok(cleanText('<p>a<br>b</p><script>x</script>') === 'a b', `cleanText 去标签（${cleanText('<p>a<br>b</p><script>x</script>')}）`);

console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
process.exit(fails ? 1 : 0);
