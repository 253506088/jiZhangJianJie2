export type Direction = 'expense' | 'income';

export interface Category {
  id: string;
  name: string;
  icon: string;
  direction: Direction;
  children: { id: string; name: string; icon: string }[];
}

export interface Entry {
  id: string;
  direction: Direction;
  categoryId: string;
  amountCents: number;
  date: string;
  accountId: string;
  note: string;
}

export const categories: Category[] = [
  {
    id: 'food',
    name: '餐饮',
    icon: 'utensils',
    direction: 'expense',
    children: [
      { id: 'breakfast', name: '早餐', icon: 'sunrise' },
      { id: 'meal', name: '正餐', icon: 'utensils' },
      { id: 'coffee', name: '咖啡饮品', icon: 'coffee' },
      { id: 'food-other', name: '其他', icon: 'more' },
    ],
  },
  {
    id: 'transport',
    name: '交通',
    icon: 'train',
    direction: 'expense',
    children: [
      { id: 'subway', name: '地铁公交', icon: 'train' },
      { id: 'taxi', name: '打车', icon: 'car' },
      { id: 'transport-other', name: '其他', icon: 'more' },
    ],
  },
  {
    id: 'daily',
    name: '日用',
    icon: 'basket',
    direction: 'expense',
    children: [
      { id: 'groceries', name: '超市购物', icon: 'basket' },
      { id: 'supplies', name: '生活用品', icon: 'shopping' },
    ],
  },
  {
    id: 'home',
    name: '居住',
    icon: 'home',
    direction: 'expense',
    children: [
      { id: 'rent', name: '房租', icon: 'home' },
      { id: 'utilities', name: '水电燃气', icon: 'bolt' },
    ],
  },
  {
    id: 'fun',
    name: '休闲',
    icon: 'film',
    direction: 'expense',
    children: [
      { id: 'movie', name: '电影娱乐', icon: 'film' },
      { id: 'travel', name: '旅行', icon: 'plane' },
    ],
  },
  {
    id: 'other',
    name: '其他',
    icon: 'more',
    direction: 'expense',
    children: [{ id: 'other-expense', name: '其他支出', icon: 'more' }],
  },
  {
    id: 'work',
    name: '工作',
    icon: 'briefcase',
    direction: 'income',
    children: [
      { id: 'salary', name: '工资', icon: 'briefcase' },
      { id: 'bonus', name: '奖金', icon: 'gift' },
    ],
  },
  {
    id: 'extra',
    name: '其他',
    icon: 'gift',
    direction: 'income',
    children: [
      { id: 'gift-income', name: '红包礼金', icon: 'gift' },
      { id: 'other-income', name: '其他收入', icon: 'more' },
    ],
  },
];

export const accounts = [
  {
    id: 'wechat',
    name: '微信钱包',
    shortName: '微信',
    icon: 'wallet',
    tone: 'green',
    openingCents: 50000,
  },
  {
    id: 'bank',
    name: '储蓄卡',
    shortName: '储蓄卡',
    icon: 'card',
    tone: 'blue',
    openingCents: 120000,
  },
  { id: 'cash', name: '现金', shortName: '现金', icon: 'cash', tone: 'sand', openingCents: 10000 },
] as const;

export function todayLocal(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isValidDate(date: unknown): date is string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function money(cents: number): string {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function decimalToCents(value: string): number {
  if (!/^\d{1,8}(?:\.\d{0,2})?$/.test(value)) throw new Error('请输入金额，最多保留两位小数');
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function calculateAmount(expression: string): number {
  const parts = expression.replace(/\s/g, '').split(/([+-])/);
  if (parts.length > 39) throw new Error('计算太长了，请先按等号');
  let cents = decimalToCents(parts[0]);
  for (let index = 1; index < parts.length; index += 2) {
    cents += (parts[index] === '+' ? 1 : -1) * decimalToCents(parts[index + 1]);
  }
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 9999999999)
    throw new Error('金额需要大于 0，且不超过 99,999,999.99');
  return cents;
}

export function categoryFor(id: string) {
  const parent = categories.find((category) => category.children.some((child) => child.id === id));
  const child = parent?.children.find((category) => category.id === id);
  if (!parent || !child) throw new Error('请选择有效的二级分类');
  return { parent, child, path: `${parent.name} / ${child.name}` };
}

export function validateEntry(value: unknown): asserts value is Entry {
  if (!value || typeof value !== 'object') throw new Error('记录格式不正确');
  const entry = value as Entry;
  if (typeof entry.id !== 'string' || !entry.id || entry.id.length > 80)
    throw new Error('记录标识不正确');
  if (entry.direction !== 'expense' && entry.direction !== 'income')
    throw new Error('收支类型不正确');
  if (!isValidDate(entry.date)) throw new Error('日期不正确');
  if (
    !Number.isSafeInteger(entry.amountCents) ||
    entry.amountCents <= 0 ||
    entry.amountCents > 9999999999
  )
    throw new Error('金额不正确');
  if (!accounts.some((account) => account.id === entry.accountId)) throw new Error('账户不正确');
  if (typeof entry.note !== 'string' || entry.note.length > 120)
    throw new Error('备注最多 120 个字');
  if (categoryFor(entry.categoryId).parent.direction !== entry.direction)
    throw new Error('分类与收支类型不匹配');
}

export function saveEntry(entries: Entry[], entry: Entry): Entry[] {
  validateEntry(entry);
  const existing = entries.findIndex((item) => item.id === entry.id);
  if (existing === -1) return [entry, ...entries];
  return entries.map((item) => (item.id === entry.id ? entry : item));
}

export function monthEntries(entries: Entry[], month: string) {
  return entries
    .filter((entry) => entry.date.startsWith(`${month}-`))
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function totals(entries: Entry[]) {
  return entries.reduce(
    (sum, entry) => {
      sum[entry.direction] += entry.amountCents;
      return sum;
    },
    { income: 0, expense: 0 },
  );
}

export function categoryTotals(entries: Entry[], direction: Direction) {
  const amounts = new Map<string, { categoryId: string; cents: number; count: number }>();
  for (const entry of entries.filter((item) => item.direction === direction)) {
    const item = amounts.get(entry.categoryId) ?? {
      categoryId: entry.categoryId,
      cents: 0,
      count: 0,
    };
    item.cents += entry.amountCents;
    item.count += 1;
    amounts.set(entry.categoryId, item);
  }
  return [...amounts.values()].sort((a, b) => b.cents - a.cents);
}

export function accountBalance(entries: Entry[], id: string) {
  const account = accounts.find((item) => item.id === id);
  if (!account) throw new Error('账户不存在');
  return entries
    .filter((entry) => entry.accountId === id)
    .reduce<number>(
      (balance, entry) => balance + (entry.direction === 'income' ? 1 : -1) * entry.amountCents,
      account.openingCents,
    );
}

export function createDemoEntries(today = todayLocal()): Entry[] {
  const day = Number(today.slice(8));
  const date = (d: number) => `${today.slice(0, 7)}-${String(Math.min(d, day)).padStart(2, '0')}`;
  return [
    {
      id: 'demo-coffee',
      direction: 'expense',
      categoryId: 'coffee',
      amountCents: 1800,
      date: today,
      accountId: 'wechat',
      note: '一杯拿铁 · 演示',
    },
    {
      id: 'demo-transit',
      direction: 'expense',
      categoryId: 'subway',
      amountCents: 600,
      date: today,
      accountId: 'cash',
      note: '上班路上 · 演示',
    },
    {
      id: 'demo-breakfast',
      direction: 'expense',
      categoryId: 'breakfast',
      amountCents: 1200,
      date: today,
      accountId: 'wechat',
      note: '豆浆和三明治 · 演示',
    },
    {
      id: 'demo-meal',
      direction: 'expense',
      categoryId: 'meal',
      amountCents: 6800,
      date: date(Math.max(1, day - 1)),
      accountId: 'wechat',
      note: '周末晚餐 · 演示',
    },
    {
      id: 'demo-groceries',
      direction: 'expense',
      categoryId: 'groceries',
      amountCents: 15680,
      date: date(Math.max(1, day - 1)),
      accountId: 'wechat',
      note: '补充日常用品 · 演示',
    },
    {
      id: 'demo-rent',
      direction: 'expense',
      categoryId: 'rent',
      amountCents: 180000,
      date: date(2),
      accountId: 'bank',
      note: '本月房租 · 演示',
    },
    {
      id: 'demo-salary',
      direction: 'income',
      categoryId: 'salary',
      amountCents: 860000,
      date: date(1),
      accountId: 'bank',
      note: '工资到账 · 演示',
    },
  ];
}

export function serializeBackup(entries: Entry[]) {
  return JSON.stringify({ format: 'keepaccounts-ui-demo', version: 1, entries }, null, 2);
}

export function parseBackup(text: string): Entry[] {
  if (text.length > 2_000_000) throw new Error('演示备份不能超过 2 MB');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的演示备份');
  }
  const backup = value as { format?: string; version?: number; entries?: unknown[] } | null;
  if (
    !backup ||
    backup.format !== 'keepaccounts-ui-demo' ||
    backup.version !== 1 ||
    !Array.isArray(backup.entries) ||
    backup.entries.length > 5000
  ) {
    throw new Error('这里只支持本预览导出的演示备份，不支持旧版 Excel');
  }
  const ids = new Set<string>();
  return backup.entries.map((value) => {
    validateEntry(value);
    if (ids.has(value.id)) throw new Error('备份中存在重复的记录标识');
    ids.add(value.id);
    return {
      id: value.id,
      direction: value.direction,
      categoryId: value.categoryId,
      amountCents: value.amountCents,
      date: value.date,
      accountId: value.accountId,
      note: value.note,
    };
  });
}
