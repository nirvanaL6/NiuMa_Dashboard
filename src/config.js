/**
 * 模块 + 视图配置：一级导航 → 二级导航 → 视图
 * 所有文案均为页面逻辑，演示数据统一标注「示例」
 */

/** @typedef {{id:string,label:string,desc:string,views:{id:string,label:string,icon:string,hint:string}[]}} ModuleCfg */

export const MODULES = [
  {
    id: 'overview',
    wip: true,
    label: '总览',
    icon: 'overview',
    kicker: 'Overview',
    title: '我的今日',
    desc: '今天还剩多少能自由支配的时间',
    views: [
      { id: 'today', label: '今日速览', icon: 'overview', hint: '一屏看完待办、资讯、羊毛和到手工资' },
      { id: 'progress', label: '本周节奏', icon: 'chart', hint: '周一到周五的专注时长与任务完成率' },
    ],
  },
  {
    id: 'todo',
    label: '待办',
    icon: 'todo',
    kicker: 'Tasks',
    title: '待办',
    desc: '项目与待办、四宫格、概览，一套流程管到底',
    ready: true, // 已开发完成，其余模块显示「施工中」
    views: [
      { id: 'list', label: '项目&待办', icon: 'inbox', hint: '新建项目或单个待办，项目下可挂多条待办' },
      { id: 'quadrant', label: '四宫格', icon: 'target', hint: '按紧急性与重要性分格，拖进去即自动打标' },
      { id: 'overview', label: '概览', icon: 'calendar', hint: '日 / 周 / 月视图，拖到某日即自动排期' },
    ],
  },
  {
    id: 'news',
    wip: true,
    label: '资讯',
    icon: 'news',
    kicker: 'Briefing',
    title: '行业简报',
    desc: '午休 10 分钟能读完的量',
    views: [
      { id: 'feed', label: '今日推荐', icon: 'flame', hint: '按热度排序的行业动态' },
      { id: 'topics', label: '订阅话题', icon: 'layers', hint: '只推送你关心的话题' },
      { id: 'saved', label: '稍后读', icon: 'book', hint: '收藏但还没读完的内容' },
    ],
  },
  {
    id: 'food',
    wip: true,
    label: '外卖',
    icon: 'food',
    kicker: 'Deals',
    title: '薅羊毛',
    desc: '同一份外卖，换个 App 便宜 8 块',
    views: [
      { id: 'coupons', label: '优惠券', icon: 'coupon', hint: '今天能领的券，按门槛分组' },
      { id: 'compare', label: '比价', icon: 'chart', hint: '同一家店三平台到手价对比' },
      { id: 'wallet', label: '省钱账本', icon: 'wallet', hint: '这个月靠外卖券省下多少' },
    ],
  },
  {
    id: 'salary',
    wip: true,
    label: '计薪',
    icon: 'salary',
    kicker: 'Salary',
    title: '读秒计薪',
    desc: '看着数字往上跳，班就没那么难熬',
    views: [
      { id: 'live', label: '实时读秒', icon: 'salary', hint: '今天此刻已到手多少钱' },
      { id: 'timeline', label: '发薪日历', icon: 'calendar', hint: '下一次发薪还有多久' },
      { id: 'rules', label: '计薪规则', icon: 'settings', hint: '月薪、工时与加班倍率' },
    ],
  },
  {
    id: 'report',
    wip: true,
    label: '报表',
    icon: 'report',
    kicker: 'Insights',
    title: '时间去处',
    desc: '钱花在哪、时间死在哪儿',
    views: [
      { id: 'time', label: '时间分布', icon: 'clock', hint: '一天 24 小时的结构' },
      { id: 'spend', label: '外卖消费', icon: 'store', hint: '按商家和平台拆分' },
    ],
  },
];

export const SETTINGS_SECTIONS = [
  {
    label: '外观',
    rows: [
      { type: 'theme', title: '主题模式', desc: '浅色 / 深色跟随系统' },
      { type: 'accent', title: '强调色', desc: '影响按钮、选中态与进度' },
    ],
  },
  {
    label: '偏好',
    rows: [
      { type: 'switch', key: 'payTick', title: '薪资数字滚动', desc: '读秒时数字带轻微跳动' },
      { type: 'switch', key: 'couponPush', title: '外卖券推送', desc: '仅午饭前 30 分钟提醒' },
      { type: 'switch', key: 'quiet', title: '专注免打扰', desc: '开会时段收起所有提醒' },
    ],
  },
  {
    label: '数据',
    rows: [
      { type: 'link', title: '导入日历', desc: '把会议同步进待办', icon: 'calendar' },
      { type: 'link', title: '导出时间账本', desc: 'CSV / Markdown', icon: 'layers' },
    ],
  },
];

export const ACCENTS = [
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Cyan', value: '#22d3ee' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Teal', value: '#14b8a6' },
  { name: 'Rose', value: '#f43f5e' },
];
