/**
 * 各视图的渲染模板
 * 约定：模板只负责结构，交互由 app.js 事件委托处理（data-action）
 */
import { icon } from './icons.js';
import { MODULES } from './config.js';
import { SCHEDULE, WEEK, NEWS, COUPONS, PRICE_COMPARE } from './data.js';
import { getData } from './store.js';
import { viewTodoList, viewTodoQuadrant, viewTodoOverview } from './todo-views.js';
import { QUADRANTS, quadOf, fmtDue } from './todo-model.js';

const money = (n, digits = 2) =>
  n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const pad = (n) => String(n).padStart(2, '0');

/** 迷你折线图（纯 SVG，避免引入图表库） */
function spark(points, color = 'var(--primary)') {
  const w = 120, h = 40;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (points.length - 1)) * w).toFixed(1)},${(h - 4 - ((p - min) / span) * (h - 10)).toFixed(1)}`)
    .join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path class="line" d="${d}" stroke="${color}" />
  </svg>`;
}

/* 总览里的迷你待办条目：只读展示，数据取自待办模块的新模型 */
function miniTodoItem(t) {
  const q = QUADRANTS.find((x) => x.id === quadOf(t.tags));
  const p = (getData().projects || []).find((x) => x.id === t.projectId);
  return `<li class="todo ${t.done ? 'done' : ''}" data-id="${t.id}" tabindex="0" role="checkbox" aria-checked="${t.done}" aria-label="${t.title}">
    <span class="check" aria-hidden="true">${icon('check', 12, 2.4)}</span>
    <span class="txt">
      <span class="t">${t.title}</span>
      <span class="m">
        ${q ? `<span class="prio" style="--c:${q.accent}"><i style="background:${q.accent}"></i>${q.label}</span>` : ''}
        ${p ? `<span class="dot-line"></span><span>${p.title}</span>` : ''}
        ${t.due ? `<span class="dot-line"></span><span>${fmtDue(t.due)}</span>` : ''}
      </span>
    </span>
  </li>`;
}

/* =========================================================
   施工中（未开发模块的占位）
   ========================================================= */
function viewWip(title) {
  return `<div class="wip">
    <div class="wip__icon">${icon('settings', 30, 1.4)}</div>
    <h3>施工中</h3>
    <p><b>${title}</b> 正在开发，敬请期待</p>
    <span class="wip__tag">当前可用：待办</span>
  </div>`;
}

function stateBlock({ kind = 'empty', title, desc, action = '' }) {
  const ic = kind === 'error' ? 'bolt' : kind === 'loading' ? 'refresh' : 'inbox';
  return `<div class="state" data-state="${kind}">
    <span class="ring">${icon(ic, 22, 1.6)}</span>
    <h4>${title}</h4><p>${desc}</p>${action}
  </div>`;
}

/* =========================================================
   总览
   ========================================================= */
function viewOverview() {
  const total = todos().length, done = todos().filter((t) => t.done).length;
  const pct = Math.round((done / total) * 100);
  const r = 56, c = 2 * Math.PI * r;
  const openP0 = todos().filter((t) => !t.done && (t.tags || []).includes('q1')).length;

  return `
  <div class="hero">
    <div>
      <div class="greet">Today's focus</div>
      <h2>今天有 <em>${openP0} 件</em>必须先交付的事，先把 10:30 的需求评审扛过去。</h2>
      <p>今日 8 小时里有 3 小时被会议占住，建议把「写周报」挪到 16:00 后的空档。</p>
      <div class="tag-row" style="margin-top:14px">
        <span class="chip chip--live">${icon('clock', 12)} 评审 22 分钟后开始</span>
        <span class="chip">${icon('food', 12)} 饿了么 ¥12 券 · 剩 2 小时</span>
        <span class="chip">${icon('wallet', 12)} 今日已到手 ¥<span data-live="salary-mini">0.00</span></span>
        <span class="chip">${icon('clock', 12)} 距离下班 <b id="offworkLeft" style="font-weight:750">—</b></span>
      </div>
    </div>
    <div class="hero__ring" role="img" aria-label="今日任务完成度 ${pct}%">
      <svg width="132" height="132" viewBox="0 0 132 132">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#6366f1"/><stop offset="60%" stop-color="#8b5cf6"/><stop offset="100%" stop-color="#22d3ee"/>
          </linearGradient>
        </defs>
        <circle cx="66" cy="66" r="${r}" fill="none" stroke="rgba(163,177,198,.35)" stroke-width="10"/>
        <circle cx="66" cy="66" r="${r}" fill="none" stroke="url(#ringGrad)" stroke-width="10" stroke-linecap="round"
          stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}" style="transition:stroke-dashoffset .6s var(--ease-out)"/>
      </svg>
      <div class="txt"><b>${done}/${total}</b><span>今日完成</span></div>
    </div>
  </div>

  <div class="grid grid--12">
    <div class="col-8 card">
      <div class="card-head"><h3 class="card-title">今天的时间块</h3><span class="card-sub">5 个日程 · 3h 05m</span></div>
      <div class="timeline">
        ${SCHEDULE.map((s) => `<div class="tl-item" data-state="${s.state}">
          <div class="time">${s.time}</div>
          <div class="rail-dot"><i></i></div>
          <div class="body">${s.title}<span>${s.note}</span></div>
        </div>`).join('')}
      </div>
    </div>

    <div class="col-4" style="display:flex;flex-direction:column;gap:14px">
      <div class="card">
        <div class="card-head"><h3 class="card-title">距离下班</h3><span class="chip">18:00</span></div>
        <div class="countdown" id="countdown">
          ${['时', '分', '秒'].map((u) => `<div class="u"><b data-cd="${u}">--</b><span>${u}</span></div>`).join('')}
        </div>
        <p class="card-sub" style="margin-top:10px">按 09:30–18:00 计算，含 1 小时午休</p>
      </div>

      <div class="card">
        <div class="card-head"><h3 class="card-title">今日待办</h3><a href="#" class="card-sub" data-jump="todo">全部 ${todos().filter((t) => !t.done).length} 件</a></div>
        <div class="todo-list" id="todoMini">
          ${todos().filter((t) => !t.done).slice(0, 3).map(miniTodoItem).join('')}
        </div>
      </div>
    </div>

    <div class="col-4 card">
      <div class="card-head"><h3 class="card-title">资讯速读</h3><a href="#" class="card-sub" data-jump="news">更多</a></div>
      <div class="mini-list">
        ${NEWS.slice(0, 3).map((n) => `<li><span class="heat" style="width:22px;height:22px;border-radius:7px;display:grid;place-items:center;font-size:10px;font-weight:800;box-shadow:var(--sh-in-sm)">${n.hot}</span><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.title}</span></li>`).join('')}
      </div>
    </div>

    <div class="col-4 card">
      <div class="card-head"><h3 class="card-title">今日可领</h3><a href="#" class="card-sub" data-jump="food">去领券</a></div>
      <div class="mini-list">
        ${coupons().filter((x) => !x.claimed).slice(0, 3).map((c) => `<li><span style="width:22px;height:22px;border-radius:7px;display:grid;place-items:center;color:#fff;font-size:10px;font-weight:800;background:${c.accent}">${c.short}</span><span>${c.brand} ¥${c.amount}</span><span class="when">${c.expire}</span></li>`).join('')}
      </div>
    </div>

    <div class="col-4 card">
      <div class="card-head"><h3 class="card-title">本周节奏</h3><span class="card-sub">完成率</span></div>
      <div class="settee">
        ${WEEK.map((w) => `<div class="settee__row"><span class="nm">${w.d}</span><span class="meter"><i style="--v:${w.load}%"></i></span><span class="val">${w.done} 件</span></div>`).join('')}
      </div>
    </div>
  </div>`;
}

function viewProgress() {
  const max = Math.max(...WEEK.map((w) => w.hours));
  return `
    <div class="view-actions">
      <span class="segmented"><button class="is-active">本周</button><button>上周</button></span>
    </div>
  <div class="grid grid--12">
    ${WEEK.map((w, i) => `<div class="col-3 calc-card">
      <div class="k"><span class="ico">${icon('clock', 14)}</span>${w.d}</div>
      <div class="v">${w.hours.toFixed(1)}<small>h 专注</small></div>
      <div class="d">完成 ${w.done} 件 · 负载 ${w.load}%</div>
      ${spark([20 + i * 4, 34, 26 + i * 3, 44, 38 + i * 2, 52, 48], 'var(--primary)')}
    </div>`).join('')}
    <div class="col-4"></div>
    <div class="col-8 card">
      <div class="card-head"><h3 class="card-title">每日专注时长</h3><span class="card-sub">目标 6h / 天</span></div>
      <div style="display:flex;align-items:flex-end;gap:18px;height:170px;padding-top:8px">
        ${WEEK.map((w) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:8px">
          <span style="font-size:11.5px;font-weight:700">${w.hours}h</span>
          <span style="width:100%;max-width:46px;height:${(w.hours / max) * 120}px;border-radius:10px;background:linear-gradient(180deg,var(--primary-soft),var(--primary));box-shadow:4px 4px 10px rgba(99,102,241,.25)"></span>
          <span style="font-size:11px;color:var(--ink-3)">${w.d}</span>
        </div>`).join('')}
      </div>
    </div>
    <div class="col-4 card">
      <div class="card-head"><h3 class="card-title">提醒</h3></div>
      <div class="mini-list">
        <li>周二负载 86%，建议把 2 件 P2 调到周五<span class="when">建议</span></li>
        <li>连续 3 天有 14:00 的会，午休被切碎<span class="when">观察</span></li>
        <li>周五专注时长下降 22%，属正常回落<span class="when">正常</span></li>
      </div>
    </div>
  </div>`;
}

/* =========================================================
   资讯
   ========================================================= */
function viewNewsFeed() {
  const lead = NEWS[0];
  return `
    <div class="view-actions">
      <span class="segmented"><button class="is-active">热门</button><button>最新</button><button>订阅</button></span>
      <button class="btn btn--ghost btn--sm">${icon('refresh', 14)} 刷新</button>
    </div>

  <div class="news-lead">
    <article class="news-feature">
      <div class="tag-row"><span class="chip chip--primary">${lead.topic}</span><span class="chip">热度 ${lead.hot}</span></div>
      <h3>${lead.title}</h3>
      <p>${lead.summary}</p>
      <div class="foot">
        <span>${lead.source}</span><span class="dot-line"></span><span>${lead.time}</span>
        <span style="margin-left:auto">${icon('clock', 13)} 阅读约 4 分钟</span>
      </div>
    </article>
    <div class="card" style="display:flex;flex-direction:column">
      <div class="card-head"><h3 class="card-title">午休速览</h3><span class="card-sub">3 条 · 约 6 分钟</span></div>
      <div class="news-list" style="flex:1">
        ${NEWS.slice(1, 4).map((n) => `<div class="news-item" style="grid-template-columns:minmax(0,1fr) auto;padding:10px 4px">
          <div><h4>${n.title}</h4><div class="meta"><span>${n.source}</span><span class="dot-line"></span><span>${n.time}</span></div>
          <span class="card-sub">${icon('chevronRight', 14)}</span>
        </div>`).join('')}
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h3 class="card-title">全部动态</h3><span class="card-sub">共 ${NEWS.length} 条</span></div>
    <div class="news-list">
      ${NEWS.map((n) => `<div class="news-item">
        <div class="heat">${n.hot}</div>
        <div><h4>${n.title}</h4><div class="meta"><span class="chip" style="height:20px;font-size:10.5px">${n.topic}</span><span>${n.source}</span><span class="dot-line"></span><span>${n.time}</span></div>
        <button class="btn btn--icon" style="width:30px;height:30px" aria-label="收藏：${n.title}" data-action="save-news">${icon('book', 14)}</button>
      </div>`).join('')}
    </div>
  </div>`;
}

function viewNewsTopics() {
  const topics = [
    { n: '行业动态', c: 12, on: true }, { n: '职场生存', c: 8, on: true }, { n: '效率工具', c: 6, on: true },
    { n: '外卖省钱', c: 4, on: false }, { n: '消费观察', c: 5, on: true }, { n: 'AI 与工作', c: 9, on: false },
  ];
  return `
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
    ${topics.map((t) => `<div class="card" style="display:flex;align-items:center;gap:12px">
      <span style="width:36px;height:36px;border-radius:12px;display:grid;place-items:center;box-shadow:var(--sh-in-sm);color:var(--primary)">${icon('layers', 17)}</span>
      <div style="flex:1"><b style="font-size:13px">${t.n}</b><div class="card-sub">本周 ${t.c} 条</div></div>
      <button class="switch" role="switch" aria-checked="${t.on}" aria-label="订阅 ${t.n}" data-action="toggle"></button>
    </div>`).join('')}
  </div>`;
}

function viewNewsSaved() {
  return `
  <div class="card">
    <div class="news-list">
      ${NEWS.slice(2, 5).map((n, i) => `<div class="news-item">
        <div class="heat">${['4分', '9分', '6分'][i]}</div>
        <div><h4>${n.title}</h4><div class="meta"><span>${n.source}</span><span class="dot-line"></span><span>已读 ${[0, 30, 65][i]}%</span></div>
          <div class="meter" style="margin-top:8px;height:5px"><i style="--v:${[0, 30, 65][i]}%"></i></div>
        </div>
        <button class="btn btn--icon" style="width:30px;height:30px" aria-label="移除">${icon('close', 14)}</button>
      </div>`).join('')}
    </div>
  </div>
  <div class="card">
    ${stateBlock({ title: '还有 3 篇已读完', desc: '归档到「历史阅读」，可在设置里导出为 Markdown', action: '<button class="btn btn--ghost btn--sm" style="margin-top:8px">查看归档</button>' })}
  </div>`;
}

/* =========================================================
   外卖
   ========================================================= */
function viewFoodCoupons() {
  return `
    <div class="view-actions">
      <span class="segmented"><button class="is-active">全部</button><button>无门槛</button><button>大额</button></span>
      <button class="btn btn--primary btn--sm" data-action="claim-all">${icon('bolt', 14, 2)} 一键领取</button>
    </div>

  <div class="perk-row">
    <div class="perk"><span class="em">🎁</span><div><b>美团神券节</b><div class="card-sub">每天 11:00 开抢</div></div>
    <div class="perk"><span class="em">🕛</span><div><b>饿了么午间红包</b><div class="card-sub">11:30–13:00 放大</div></div>
    <div class="perk"><span class="em">🏪</span><div><b>便利店满减</b><div class="card-sub">满 15 减 3</div></div>
    <div class="perk"><span class="em">🛵</span><div><b>免配送费</b><div class="card-sub">下单前再领</div></div>
  </div>
  <div class="coupon-grid">
    ${coupons().map((c) => `<div class="coupon ${c.soldOut ? 'faded' : ''}" style="--accent:${c.accent}">
      <div class="brand"><span class="logo">${c.short}</span>${c.brand}</div>
      <div class="amt"><small>¥</small>${c.amount}<small> 元</small></div>
      <div class="cond">${c.cond}</div>
      <div class="bar">
        <span class="left">${c.expire}</span>
        <button class="btn ${c.claimed ? 'btn--ghost' : 'btn--primary'} btn--sm" ${c.claimed ? 'disabled' : ''} data-claim="${c.id}" style="height:26px;font-size:11.5px;padding:0 10px">
          ${c.soldOut ? '已抢完' : c.claimed ? '已领取' : '去领取'}
        </button>
      </div>
    </div>`).join('')}
  </div>
  <div class="card">
    <div class="card-head"><h3 class="card-title">领券小提示</h3></div>
    <p class="card-sub">同一家店在不同平台的门槛不同，先比价再领券能多省 3–5 元。打开「比价」页看看今天常点的那几家。</p>
  </div>`;
}

function viewFoodCompare() {
  return `
    <div class="view-actions">
      <button class="btn btn--ghost btn--sm">${icon('refresh', 14)} 重新查询</button>
    </div>
  <div class="grid grid--12">
    <div class="col-8 card">
      <div class="card-head"><h3 class="card-title">常点商家到手价</h3><span class="card-sub">单位：元</span></div>
      <table class="price-table">
        <thead><tr><th>商家 / 商品</th><th>美团</th><th>饿了么</th><th>京东秒送</th><th>最低</th></tr></thead>
        <tbody>
          ${PRICE_COMPARE.map((r) => {
            const bestVal = Math.min(r.meituan, r.eleme, r.jd);
            const cell = (v, key) => `<td class="${r.best === key ? 'best' : ''}">${v.toFixed(2)}</td>`;
            return `<tr><td style="font-weight:600">${r.store}</td>${cell(r.meituan, 'meituan')}${cell(r.eleme, 'eleme')}${cell(r.jd, 'jd')}<td><span class="chip chip--primary">省 ¥${(Math.max(r.meituan, r.eleme, r.jd) - bestVal).toFixed(1)}</span></td></tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    <div class="col-4 card">
      <div class="card-head"><h3 class="card-title">30 天省下</h3><span class="chip chip--primary">${icon('trendUp', 12)} 12%</span></div>
      <div class="v" style="font-size:34px;font-weight:800;letter-spacing:-.04em;font-variant-numeric:tabular-nums">¥186.40</div>
      <p class="card-sub" style="margin:4px 0 12px">相当于 2 天的午餐钱</p>
      <div style="flex:1;display:flex;align-items:flex-end">
        ${spark([12, 18, 15, 24, 20, 28, 26, 33, 30, 38, 36, 44]).replace('class="spark"', 'class="spark spark--lg"')}
      </div>
    </div>
  </div>`;
}

function viewFoodWallet() {
  const rows = [
    { d: '10-26', s: '黄焖鸡 · 京东秒送', a: 22.4, saved: 8.6 },
    { d: '10-25', s: '沙拉 · 饿了么', a: 26.0, saved: 6.2 },
    { d: '10-24', s: '牛肉面 · 美团', a: 18.0, saved: 4.5 },
    { d: '10-23', s: '烧腊饭 · 饿了么', a: 29.8, saved: 5.1 },
  ];
  return `
    <div class="view-actions">
      <button class="btn btn--ghost btn--sm">${icon('layers', 14)} 导出 CSV</button>
    </div>
  <div class="grid grid--12">
    <div class="col-4" style="display:flex;flex-direction:column;gap:14px">
      ${[['本月已省', '¥186.40', '+12% 环比'], ['本月外卖支出', '¥742.60', '共 28 单'], ['平均每单省下', '¥6.66', '≈ 一杯豆浆']].map(([k, v, d]) => `
        <div class="calc-card"><div class="k">${k}</div><div class="v" style="font-size:22px">${v}</div><div class="d">${d}</div></div>`).join('')}
    </div>
    <div class="col-12 card">
      <div class="card-head"><h3 class="card-title">最近订单</h3><span class="card-sub">按省钱金额排序</span></div>
      <table class="price-table">
        <thead><tr><th>日期</th><th>订单</th><th>实付</th><th>省下</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${r.d}</td><td style="font-weight:600">${r.s}</td><td>¥${r.a.toFixed(2)}</td><td class="best">-¥${r.saved.toFixed(2)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </div>`;
}

/* =========================================================
   读秒计薪
   ========================================================= */
function viewSalaryLive() {
  return `
    <div class="view-actions">
      <span class="chip chip--primary">${icon('play', 12)} 计算中</span>
      <button class="btn btn--ghost btn--sm" data-action="toggle-pay">${icon('pause', 14)} 暂停</button>
    </div>

  <div class="salary-wrap">
    <div class="salary-clock">
      <div class="glow"></div>
      <div class="clock-top">
        <span class="chip">今日 · 10 月 26 日</span>
        <span class="card-sub">09:30 上班 · 18:00 下班</span>
      </div>
      <div class="clock-amount" role="timer" aria-live="off">
        <span class="cur">¥</span><span data-live="salary-int">0</span><span class="frac" data-live="salary-frac">.00</span>
      </div>
      <div class="clock-sub">
        <span>今日已工作 <b data-live="worked">—</b></span>
        <span>时薪 <b>¥60.10</b></span>
        <span>本秒到账 <b>¥0.0167</b></span>
      </div>
      <div class="clock-bars" id="clockBars" aria-hidden="true"></div>
      <div class="clock-foot">
        <span>目标：今天赚满 <b>¥481</b></span>
        <span>还需 <b data-live="left">—</b></span>
      </div>
    </div>

    <div class="salary-side">
      <div class="odo">
        <div><div class="k">今日</div><div class="v" data-live="d-day">¥0</div></div>
        <div><div class="k">本周</div><div class="v">¥1,264</div></div>
        <div><div class="k">本月</div><div class="v">¥4,890</div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3 class="card-title">等价换算</h3><span class="card-sub">让数字更有体感</span></div>
        <div class="mini-list">
          <li><span class="num">¥<span data-live="eq-coffee">0</span></span><span class="card-sub">≈ 几杯咖啡（¥18/杯）</span></li>
          <li><span class="num">¥<span data-live="eq-takeout">0</span></span><span class="card-sub">≈ 几顿外卖（¥28/顿）</span></li>
          <li><span class="num">¥<span data-live="eq-taxi">0</span></span><span class="card-sub">≈ 几次打车回家（¥45/趟）</span></li>
        </div>
      </div>
      <div class="card card--inline">
        <span class="icon-chip">${icon('coffee', 18)}</span>
        <div class="card--inline__txt"><b>摸鱼 5 分钟扣多少钱？</b><span class="card-sub">¥5.01 · 相当于 1/4 杯咖啡</span></div>
        <button class="switch" role="switch" aria-checked="false" aria-label="开启摸鱼提示" data-action="toggle"></button>
      </div>
    </div>
  </div>`;
}

function viewSalaryTimeline() {
  return `
    <div class="view-actions">
      <span class="chip">距离下次发薪 20 天</span>
    </div>
  <div class="grid grid--12">
    <div class="col-7 card">
      <div class="card-head"><h3 class="card-title">10 月工资进度</h3><span class="card-sub">已计薪 26 / 31 天</span></div>
      <div class="meter" style="height:10px"><i style="--v:84%"></i></div>
      <div style="display:flex;justify-content:space-between;margin-top:8px" class="card-sub"><span>¥4,890 已累计</span><span>预计 ¥5,830</span></div>
      <div class="card-head" style="margin-top:22px"><h3 class="card-title">每日到账</h3><span class="card-sub">单位：元</span></div>
      <div style="display:flex;gap:4px;align-items:flex-end;height:110px">
        ${Array.from({ length: 26 }, (_, i) => {
          const h = 40 + ((i * 37) % 60);
          return `<span style="flex:1;height:${h}%;border-radius:4px;background:${i === 25 ? 'linear-gradient(180deg,var(--violet),var(--primary))' : 'rgba(99,102,241,.22)'}" title="第 ${i + 1} 天"></span>`;
        }).join('')}
      </div>
    </div>
    <div class="col-5 card">
      <div class="card-head"><h3 class="card-title">关键节点</h3></div>
      <div class="timeline">
        <div class="tl-item" data-state="done"><div class="time">10-01</div><div class="rail-dot"><i></i></div><div class="body">本月开始<span>计薪周期 10-01 → 10-31</span></div>
        <div class="tl-item" data-state="now"><div class="time">10-26</div><div class="rail-dot"><i></i></div><div class="body">今天<span>累计 ¥4,890</span></div>
        <div class="tl-item" data-state="todo"><div class="time">11-05</div><div class="rail-dot"><i></i></div><div class="body">绩效考核<span>结果影响年终奖系数</span></div>
        <div class="tl-item" data-state="todo"><div class="time">11-15</div><div class="rail-dot"><i></i></div><div class="body">发薪日<span>预计到账 ¥6,180</span></div>
      </div>
    </div>
  </div>`;
}

function viewSalaryRules() {
  return `
    <div class="view-actions">
      <button class="btn btn--primary btn--sm" data-action="save-rules">${icon('check', 14, 2.4)} 保存</button>
    </div>
  <div class="grid grid--12">
    <div class="col-7 card">
      <div class="rate-form">
        <div class="field"><label for="r-month">月薪（元）</label><input id="r-month" type="number" value="12000" inputmode="decimal" /></div>
        <div class="field"><label for="r-days">月计薪天数</label><input id="r-days" type="number" value="21.75" step="0.25" inputmode="decimal" /></div>
        <div class="field"><label for="r-start">上班时间</label><input id="r-start" type="time" value="09:30" /></div>
        <div class="field"><label for="r-end">下班时间</label><input id="r-end" type="time" value="18:00" /></div>
        <div class="field"><label for="r-break">午休时长（分钟）</label><input id="r-break" type="number" value="60" inputmode="numeric" /></div>
        <div class="field"><label for="r-ot">加班倍率</label>
          <select id="r-ot"><option>1.0×（平时）</option><option selected>1.5×（周末）</option><option>3.0×（法定）</option></select>
        </div>
      </div>
      <p class="card-sub" style="margin-top:14px">按「月薪 ÷ 21.75 ÷ 8 小时」计算时薪，午休不计薪。规则可随时修改，历史数据不回溯。</p>
    </div>
    <div class="col-5 card card--in">
      <div class="card-head"><h3 class="card-title">规则预览</h3></div>
      <div class="mini-list">
        <li>时薪<span class="when" style="color:var(--ink);font-weight:750">¥68.97</span></li>
        <li>每分钟<span class="when" style="color:var(--ink);font-weight:750">¥1.15</span></li>
        <li>每天（8h）<span class="when" style="color:var(--ink);font-weight:750">¥551.72</span></li>
        <li>周末加班（8h）<span class="when" style="color:var(--ink);font-weight:750">¥827.58</span></li>
      </div>
    </div>
  </div>`;
}

/* =========================================================
   报表
   ========================================================= */
function viewReportTime() {
  const seg = [
    { n: '工作', v: 42, c: 'var(--primary)' }, { n: '会议', v: 18, c: 'var(--violet)' },
    { n: '通勤', v: 12, c: 'var(--cyan)' }, { n: '睡眠', v: 26, c: 'var(--ink-4)' },
  ];
  let acc = 0;
  const total = seg.reduce((s, x) => s + x.v, 0);
  const stops = seg.map((s) => {
    const from = (acc / total) * 100;
    acc += s.v;
    const to = (acc / total) * 100;
    return `${s.c} ${from}% ${to}%`;
  }).join(', ');
  return `
  <div class="grid grid--12">
    <div class="col-5 card" style="display:flex;align-items:center;gap:18px">
      <div style="position:relative;width:150px;height:150px;flex:none">
        <div style="position:absolute;inset:0;border-radius:50%;background:conic-gradient(${stops});box-shadow:var(--sh-sm)"></div>
        <div style="position:absolute;inset:26px;border-radius:50%;background:var(--surface);box-shadow:var(--sh-in-sm);display:grid;place-content:center;text-align:center">
          <b style="font-size:22px;font-weight:800;letter-spacing:-.03em">9.4h</b><span class="card-sub" style="font-size:10.5px">今日在线</span>
        </div>
      </div>
      <ul class="mini-list" style="flex:1">
        ${seg.map((s) => `<li><span style="width:8px;height:8px;border-radius:3px;background:${s.c}"></span>${s.n}<span class="when">${s.v}%</span></li>`).join('')}
      </ul>
    </div>
    <div class="col-7 card">
      <div class="card-head"><h3 class="card-title">近 7 天工作时段</h3><span class="card-sub">颜色越深表示越忙</span></div>
      <div style="display:grid;grid-template-columns:34px repeat(7,1fr);gap:4px;align-items:center">
        <span></span>${['一', '二', '三', '四', '五', '六', '日'].map((d) => `<span class="card-sub" style="text-align:center;font-size:11px">${d}</span>`).join('')}
        ${[9, 11, 13, 15, 17, 19, 21].map((h, hi) => `
          <span class="card-sub" style="font-size:11px">${pad(h)}:00</span>
          ${Array.from({ length: 7 }, (_, di) => `<span style="height:26px;border-radius:6px;background:rgba(99,102,241,${(0.08 + ((hi * 7 + di * 3) % 9) / 12).toFixed(2)})"></span>`).join('')}
        `).join('')}
      </div>
    </div>
  </div>`;
}

function viewReportSpend() {
  return `
  <div class="grid grid--12">
    <div class="col-7 card">
      <div class="card-head"><h3 class="card-title">按平台</h3><span class="card-sub">本月 28 单</span></div>
      <div class="settee">
        ${[['美团', 62, '¥460'], ['饿了么', 28, '¥208'], ['京东秒送', 10, '¥74']].map(([n, v, m]) => `<div class="settee__row"><span class="nm">${n}</span><span class="meter"><i style="--v:${v}%"></i></span><span class="val">${m}</span></div>`).join('')}
      </div>
    </div>
    <div class="col-5 card">
      <div class="card-head"><h3 class="card-title">时段偏好</h3></div>
      <div class="mini-list"><li>午餐 12:00–13:00<span class="when">18 单</span></li><li>加班晚餐 19:00 后<span class="when">7 单</span></li><li>下午茶<span class="when">3 单</span></li></div>
    </div>
  </div>`;
}

const VIEWS = {
  'overview:today': viewOverview,
  'overview:progress': viewProgress,
  'todo:list': viewTodoList,
  'todo:quadrant': viewTodoQuadrant,
  'todo:overview': viewTodoOverview,
  'news:feed': viewNewsFeed,
  'news:topics': viewNewsTopics,
  'news:saved': viewNewsSaved,
  'food:coupons': viewFoodCoupons,
  'food:compare': viewFoodCompare,
  'food:wallet': viewFoodWallet,
  'salary:live': viewSalaryLive,
  'salary:timeline': viewSalaryTimeline,
  'salary:rules': viewSalaryRules,
  'report:time': viewReportTime,
  'report:spend': viewReportSpend,
};

/* ---- 用户数据 getter：每次渲染都读最新存储，保证两种模式一致 ---- */
const todos = () => getData().todos || [];
const coupons = () => {
  const claims = getData().claims || {};
  return COUPONS.map((c) => ({
    ...c,
    claimed: !!claims[c.id] || !!c.claimed,
    soldOut: !claims[c.id] && c.soldOut, // 已领取的券不再显示「已抢完」
  }));
};

export function renderView(moduleId, viewId) {
  const mod = MODULES.find((m) => m.id === moduleId);
  // 未开发模块统一显示「施工中」，避免旧演示视图的数据结构拖累主线开发
  if (!mod?.ready) return viewWip(mod?.title || mod?.label || '该模块');
  const fn = VIEWS[`${moduleId}:${viewId}`];
  if (!fn) return stateBlock({ kind: 'error', title: '视图加载失败', desc: '找不到这个视图的模板，请检查模块配置' });
  return fn();
}

export { spark, stateBlock, money };
