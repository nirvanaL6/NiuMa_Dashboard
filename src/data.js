/**
 * 演示数据（全部为示例，非真实业务数据）
 *
 * 说明：数据层从「模块常量」改成了「可持久化的种子」。
 * 首次访问时把种子写进本地存储，之后所有读写都走 store.js，
 * 这样免登录与登录两种模式看到的是同一份用户数据。
 */

const TODOS = [
  { id: 't1', title: '提交 Q4 需求评审材料', meta: '项目 · 产品组', due: '今天 10:30', prio: 'p0', urgent: true, important: true, done: false },
  { id: 't2', title: '和设计对齐新版工作台视觉', meta: '会议 · 30 min', due: '今天 11:00', prio: 'p0', urgent: true, important: true, done: false },
  { id: 't3', title: '写本周周报（含数据复盘）', meta: '汇报 · 自己', due: '今天 18:00', prio: 'p1', urgent: false, important: true, done: false },
  { id: 't4', title: '回复甲方三封未读邮件', meta: '沟通 · 外部', due: '今天 14:00', prio: 'p1', urgent: true, important: false, done: false },
  { id: 't5', title: '整理下月迭代排期', meta: '计划 · 团队', due: '明天 10:00', prio: 'p2', urgent: false, important: true, done: false },
  { id: 't6', title: '报销上月的打车发票', meta: '杂事 · 财务', due: '本周五', prio: 'p2', urgent: false, important: false, done: false },
  { id: 't7', title: '早会同步排期风险', meta: '会议 · 15 min', due: '已完成 09:15', prio: 'p1', urgent: false, important: true, done: true },
  { id: 't8', title: '清理测试环境脏数据', meta: '杂事 · 开发', due: '已完成 09:40', prio: 'p2', urgent: false, important: false, done: true },
];

const SCHEDULE = [
  { time: '09:15', title: '站会同步', note: '10 人 · 会议室 A', state: 'done' },
  { time: '10:30', title: '需求评审', note: 'Q4 第一批 · 需提前看材料', state: 'now' },
  { time: '14:00', title: '甲方复盘会', note: '线上 · 预计 45 分钟', state: 'todo' },
  { time: '16:30', title: '设计走查', note: '工作台 v2 · 与设计同学', state: 'todo' },
  { time: '18:00', title: '提交周报', note: '自动提醒', state: 'todo' },
];

const WEEK = [
  { d: '周一', hours: 8.5, done: 6, load: 72 },
  { d: '周二', hours: 9.2, done: 5, load: 86 },
  { d: '周三', hours: 7.8, done: 7, load: 64 },
  { d: '周四', hours: 8.1, done: 4, load: 78 },
  { d: '周五', hours: 6.4, done: 3, load: 52 },
];

const NEWS = [
  {
    id: 'n1', hot: 98, source: '36氪', time: '12 分钟前', topic: '行业',
    title: 'AI 工具开始接管重复性汇报，产品经理的一天被切成三块',
    summary: '从自动生成周报到会议纪要归档，一线团队把 3.2 小时/天的文字工作交了出去，留出的时间是给「判断」的。',
  },
  { id: 'n2', hot: 91, source: '虎嗅', time: '38 分钟前', topic: '职场', title: '弹性工作制试点半年：离职率降了 18%，但加班没少' },
  { id: 'n3', hot: 87, source: '少数派', time: '1 小时前', topic: '效率', title: '把待办拆成「15 分钟就能做完」的样子，拖延会少一半' },
  { id: 'n4', hot: 79, source: '晚点', time: '2 小时前', topic: '消费', title: '外卖平台补贴战再起：同一份黄焖鸡，三家相差 9 元' },
  { id: 'n5', hot: 72, source: '极客公园', time: '3 小时前', topic: '行业', title: '打工人的第二块屏幕，正在被会议软件占满' },
  { id: 'n6', hot: 64, source: '界面', time: '4 小时前', topic: '职场', title: '「隐形加班」写进合同之后，工时统计该怎么做' },
];

const COUPONS = [
  { id: 'c1', brand: '美团外卖', short: '美', amount: 8, cond: '满 25 可用', expire: '今日 14:00 前', accent: '#f59e0b', claimed: false },
  { id: 'c2', brand: '饿了么', short: '饿', amount: 12, cond: '满 30 可用', expire: '剩 2 小时', accent: '#3b82f6', claimed: false },
  { id: 'c3', brand: '京东秒送', short: '京', amount: 6, cond: '无门槛', expire: '今日有效', accent: '#f43f5e', claimed: false },
  { id: 'c4', brand: '美团神券节', short: '神', amount: 15, cond: '满 50 可用', expire: '剩 1 天', accent: '#8b5cf6', claimed: true },
  { id: 'c5', brand: '抖音团购', short: '抖', amount: 10, cond: '到店自取', expire: '剩 3 天', accent: '#1e2438', claimed: false },
  { id: 'c6', brand: '便利店搭子', short: '便', amount: 3, cond: '满 15 可用', expire: '已抢完', accent: '#7a839a', claimed: true, soldOut: true },
];

const PRICE_COMPARE = [
  { store: '黄焖鸡米饭 · 大份', meituan: 22.4, eleme: 24.9, jd: 20.8, best: 'jd' },
  { store: '轻食沙拉碗 · 鸡胸', meituan: 28.6, eleme: 26.0, jd: 29.9, best: 'eleme' },
  { store: '兰州牛肉面 · 加肉', meituan: 18.0, eleme: 19.5, jd: 18.0, best: 'meituan' },
  { store: '粤式烧腊双拼饭', meituan: 31.2, eleme: 29.8, jd: 33.0, best: 'eleme' },
];


/**
 * 首次进入时的数据种子（也是「重置为示例数据」的基准）
 * @param {Array} todos 若要保留用户已建待办，可传入已有列表做合并
 */
export function seedData() {
  return {
    v: 2,
    todos: TODOS.map((t) => ({ ...t })),
    prefs: { payTick: true, couponPush: true, quiet: false },
    claims: {}, // 外卖券领取状态 { [couponId]: 领取时间 }
    savedNews: [], // 收藏的资讯 id
    topics: {}, // 资讯订阅开关 { [topic]: bool }
    weeklyView: 'week',
    savedAt: 0,
  };
}

export { TODOS, SCHEDULE, WEEK, NEWS, COUPONS, PRICE_COMPARE };
