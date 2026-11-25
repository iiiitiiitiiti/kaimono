// 画面に依存しない決まりごと（お店・並べ方・名前の正規化）

// お店の種類（スーパーだけでなく、買う店ごとにまとめる。2026-11-04 ユーザー指摘で売り場から変更）
export const SECTIONS = [
  "スーパー",
  "ドラッグストア",
  "コンビニ",
  "100円ショップ",
  "ホームセンター",
  "家電量販店",
  "服屋",
  "本屋",
  "ネット通販",
  "その他",
] as const;

/** お店の名前。固定の10種のほか、2人が自分で入れたお店（例: 業務スーパー）も入る */
export type Section = string;
export const OTHER: Section = "その他";
/** 自分で入れるお店の名前の長さの上限（firestore.rules の validSection と揃える） */
export const STORE_MAX = 20;

const FIXED: readonly string[] = SECTIONS;

/** 保存先から届いた値がお店の名前として使えるか */
export function isSection(v: unknown): v is Section {
  return typeof v === "string" && v.length >= 1 && v.length <= STORE_MAX;
}

export function isCustomStore(s: Section): boolean {
  return !FIXED.includes(s);
}

/** お店を並べる順。固定のお店（その他を除く）→ 自分で入れたお店（五十音）→ その他 */
export function sortStores(stores: Iterable<Section>): Section[] {
  const rank = (s: Section) => (s === OTHER ? 2 : FIXED.includes(s) ? 0 : 1);
  return [...new Set(stores)].sort(
    (a, b) => rank(a) - rank(b) || (rank(a) === 0 ? FIXED.indexOf(a) - FIXED.indexOf(b) : a.localeCompare(b, "ja")),
  );
}

/**
 * 選べるお店。固定の10種に、保存した自分のお店を足す。
 * 一覧に無いお店の品物（相手が消したのと行き違いで足した物など）も、そのお店の名前のまま出す
 */
export function allStores(saved: readonly Section[], items: Item[]): Section[] {
  return sortStores([...FIXED, ...saved, ...items.map((i) => i.section)]);
}

/** 自分で入れたお店（メニューで消せる物） */
export function customStores(saved: readonly Section[], items: Item[]): Section[] {
  return allStores(saved, items).filter(isCustomStore);
}

/** 自分で入れたお店の文書 ID。表記ゆれを同じお店にまとめる */
export function storeId(name: Section): string {
  return historyId(name);
}

/**
 * 入力されたお店の名前を整える。空なら null。
 * 既にあるお店と表記ゆれだけの違い（全角半角・カタカナひらがななど）なら、既にある方の名前を返す
 */
export function cleanStore(raw: string, existing: readonly Section[]): Section | null {
  const s = raw.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, STORE_MAX);
  if (!s) return null;
  const key = nameKey(s);
  return existing.find((e) => nameKey(e) === key) ?? s;
}

export interface Item {
  id: string;
  name: string;
  section: Section;
  note: string;
  addedBy: string;
  checked: boolean;
  createdAt: number; // ミリ秒。未送信のあいだは手元の時刻
  checkedAt: number | null;
}

export interface HistoryEntry {
  id: string;
  name: string;
  section: Section;
  count: number;
  lastAt: number;
}

export interface AddLog {
  id: string;
  name: string;
  section: Section;
  addedBy: string;
  at: number; // ミリ秒
}

/** 追加履歴を残す日数。これより古い記録は開いたときに消す */
export const LOG_DAYS = 90;

export const NAME_MAX = 60;
export const NOTE_MAX = 100;
export const PERSON_MAX = 20;

/** 入力された品名を整える。空なら null */
export function cleanName(raw: string): string | null {
  const s = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.slice(0, NAME_MAX);
}

/** 同じ物かどうかを見るための鍵（全角半角・大小・空白・カタカナひらがなの違いを無視） */
export function nameKey(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 履歴の文書 ID。Firestore で使えない文字を避けるためエンコードする */
export function historyId(name: string): string {
  return encodeURIComponent(nameKey(name)).slice(0, 700) || "_";
}

// 品名からお店を当てるための手がかり（前から順に照合し、最初に当たったお店にする）
// 「パンツ」が「パン」に、「灯油」が「油」に当たらないよう、食べ物（スーパー）は最後に置く
const HINTS: [Section, string[]][] = [
  ["服屋", ["服", "シャツ", "パンツ", "ズボン", "スカート", "靴下", "くつした", "靴", "下着", "ブラジャー", "パジャマ", "コート", "ジャケット", "セーター", "パーカー", "帽子", "手袋", "マフラー", "水着"]],
  ["本屋", ["雑誌", "漫画", "マンガ", "まんが", "絵本", "文庫", "小説", "参考書", "問題集"]],
  ["家電量販店", ["電池", "電球", "蛍光灯", "ケーブル", "充電器", "イヤホン", "ヘッドホン", "USB", "SDカード", "延長コード", "電源タップ", "インク", "プリンター", "ドライヤー", "家電", "テレビ", "パソコン", "スマホ", "マウス", "キーボード"]],
  ["ホームセンター", ["ネジ", "ねじ", "釘", "くぎ", "工具", "ドライバー", "ペンキ", "塗料", "園芸", "培養土", "肥料", "植木鉢", "プランター", "灯油", "木材", "突っ張り棒", "収納ケース", "フライパン", "ハンガー", "水筒"]],
  ["100円ショップ", ["食器", "皿", "コップ", "茶碗", "箸", "タッパー", "保存容器", "文房具", "ノート", "ボールペン", "油性ペン", "封筒"]],
  ["ドラッグストア", ["薬", "絆創膏", "ばんそうこう", "目薬", "マスク", "シャンプー", "リンス", "コンディショナー", "ボディソープ", "洗顔", "化粧", "日焼け止め", "歯磨き", "歯ブラシ", "ブラシ", "コンタクト", "ハンドクリーム", "リップ", "ティッシュ", "トイレット", "ペーパー", "洗剤", "柔軟剤", "ゴミ袋", "ごみ袋", "スポンジ", "ハンドソープ", "漂白", "綿棒", "生理用品", "おむつ", "オムツ", "サプリ", "香水"]],
  ["スーパー", ["冷凍", "アイス", "卵", "たまご", "玉子", "牛乳", "ミルク", "ヨーグルト", "チーズ", "バター", "豆腐", "とうふ", "納豆", "なっとう", "豆乳", "肉", "豚", "鶏", "牛", "ひき", "ベーコン", "ハム", "ソーセージ", "ウインナー", "魚", "鮭", "さけ", "サーモン", "まぐろ", "さば", "えび", "エビ", "いか", "たこ", "しらす", "ちくわ", "刺身", "野菜", "キャベツ", "レタス", "白菜", "はくさい", "大根", "だいこん", "人参", "にんじん", "玉ねぎ", "たまねぎ", "ねぎ", "ネギ", "じゃがいも", "トマト", "きゅうり", "なす", "ピーマン", "ブロッコリー", "ほうれん草", "小松菜", "もやし", "きのこ", "しめじ", "えのき", "しいたけ", "生姜", "しょうが", "にんにく", "かぼちゃ", "アボカド", "りんご", "バナナ", "みかん", "いちご", "レモン", "果物", "フルーツ", "パン", "米", "ごはん", "パスタ", "うどん", "そば", "ラーメン", "そうめん", "餅", "もち", "シリアル", "醤油", "しょうゆ", "味噌", "みそ", "塩", "砂糖", "酢", "みりん", "酒", "油", "マヨネーズ", "ケチャップ", "ソース", "ドレッシング", "だし", "コンソメ", "カレー", "胡椒", "こしょう", "小麦粉", "片栗粉", "海苔", "のり", "わかめ", "ごま", "缶", "ツナ", "ラップ", "ホイル", "お菓子", "チョコ", "クッキー", "ポテチ", "スナック", "せんべい", "グミ", "水", "お茶", "茶", "コーヒー", "紅茶", "ジュース", "炭酸", "ビール", "ワイン"]],
];

/** 品名からお店を当てる。過去に同じ物を足していればそれを優先する */
export function guessSection(name: string, history: HistoryEntry[]): Section {
  const key = nameKey(name);
  const past = history.find((h) => nameKey(h.name) === key);
  if (past) return past.section;
  const raw = name.normalize("NFKC");
  for (const [section, words] of HINTS) {
    if (words.some((w) => raw.includes(w) || key.includes(nameKey(w)))) return section;
  }
  return OTHER;
}

export interface SectionGroup {
  section: Section;
  items: Item[];
}

/** まだ買っていない物を売り場の順にまとめる。売り場の中は足した順 */
export function groupBySection(items: Item[]): SectionGroup[] {
  const open = items.filter((i) => !i.checked);
  return sortStores(open.map((i) => i.section)).map((section) => ({
    section,
    items: open.filter((i) => i.section === section).sort((a, b) => a.createdAt - b.createdAt),
  }));
}

/** 買った（チェックした）物。チェックしたのが新しい順 */
export function checkedItems(items: Item[]): Item[] {
  return items
    .filter((i) => i.checked)
    .sort((a, b) => (b.checkedAt ?? b.createdAt) - (a.checkedAt ?? a.createdAt));
}

/** 買った物を売り場の順にまとめる。売り場の中はチェックしたのが新しい順 */
export function checkedBySection(items: Item[]): SectionGroup[] {
  const checked = checkedItems(items);
  return sortStores(checked.map((i) => i.section)).map((section) => ({
    section,
    items: checked.filter((i) => i.section === section),
  }));
}

/** よく買う物の候補。リストに載っている（未チェックの）物は除き、入力があれば絞り込む */
export function suggestions(history: HistoryEntry[], items: Item[], query: string, limit = 12): HistoryEntry[] {
  const onList = new Set(items.filter((i) => !i.checked).map((i) => nameKey(i.name)));
  const q = nameKey(query);
  return history
    .filter((h) => h.count > 0 && !onList.has(nameKey(h.name)))
    .filter((h) => !q || nameKey(h.name).includes(q))
    .sort((a, b) => {
      if (q) {
        const ap = nameKey(a.name).startsWith(q) ? 0 : 1;
        const bp = nameKey(b.name).startsWith(q) ? 0 : 1;
        if (ap !== bp) return ap - bp;
      }
      return b.count - a.count || b.lastAt - a.lastAt;
    })
    .slice(0, limit);
}

/** 同じ物がまだ買われずにリストにあれば返す */
export function findOpenDuplicate(items: Item[], name: string): Item | undefined {
  const key = nameKey(name);
  return items.find((i) => !i.checked && nameKey(i.name) === key);
}

/** 足した人ごとの色（名前から決める） */
const PERSON_COLORS = 6;
export function personColor(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % PERSON_COLORS;
}

/** URL の #k=… から鍵を取り出す。形が合わなければ null */
export function keyFromHash(hash: string): string | null {
  const m = /(?:^#|&)k=([0-9a-f]{32})(?:&|$)/.exec(hash);
  return m ? m[1] : null;
}

export interface LogDay {
  label: string;
  entries: AddLog[];
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayLabel(ms: number, now: number): string {
  const day = startOfDay(ms);
  const today = startOfDay(now);
  if (day === today) return "今日";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.getTime()) return "昨日";
  const d = new Date(ms);
  const md = `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAYS[d.getDay()]}）`;
  return d.getFullYear() === new Date(now).getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

export function timeLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 追加履歴を新しい順に並べ、日ごとにまとめる。残す日数より古い物は除く */
export function logByDay(logs: AddLog[], now: number): LogDay[] {
  const cutoff = now - LOG_DAYS * 86400000;
  const days: LogDay[] = [];
  for (const log of [...logs].filter((l) => l.at >= cutoff).sort((a, b) => b.at - a.at)) {
    const label = dayLabel(log.at, now);
    const last = days[days.length - 1];
    if (last && last.label === label) last.entries.push(log);
    else days.push({ label, entries: [log] });
  }
  return days;
}

/**
 * Discord のウェブフック URL の形。firestore.rules の validNotify も同じ文字列で確かめる
 * （rules に書き写しやすいよう、バックスラッシュを使わない書き方にしている）
 */
export const WEBHOOK_PATTERN =
  "^https://((ptb|canary)[.])?discord(app)?[.]com/api/webhooks/[0-9]{1,25}/[A-Za-z0-9_-]{1,100}$";
const WEBHOOK_RE = new RegExp(WEBHOOK_PATTERN);

/** 貼られたウェブフック URL を整える。形が違えば null */
export function cleanWebhook(raw: string): string | null {
  // Discord のコピーには付かないが、末尾の / や ?以降が付いて貼られても通す
  const s = raw.trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
  return WEBHOOK_RE.test(s) ? s : null;
}

/** Discord で太字やリンクに化けないよう、記号の前に \ を付ける */
function escapeDiscord(s: string): string {
  return s.replace(/[\\*_~`|>#[\]<]/g, (c) => `\\${c}`);
}

/** 品物を足したときに Discord へ送る文 */
export function addedMessage(name: string, section: Section, note: string, addedBy: string): string {
  const who = addedBy || "だれか";
  let s = `🛒 ${escapeDiscord(who)}が「${escapeDiscord(name)}」を足しました（${escapeDiscord(section)}）`;
  if (note) s += `\nメモ: ${escapeDiscord(note)}`;
  return s;
}

/** Discord へ知らせる1品 */
export interface AddedLine {
  name: string;
  section: Section;
  note: string;
  addedBy: string;
}

/** 続けて足した物をまとめた投稿の文。1品だけなら addedMessage と同じ */
export function batchMessage(lines: AddedLine[]): string {
  if (lines.length === 1) {
    const l = lines[0];
    return addedMessage(l.name, l.section, l.note, l.addedBy);
  }
  const who = escapeDiscord(lines[0].addedBy || "だれか");
  const rows = lines.map(
    (l) => `・${escapeDiscord(l.name)}（${escapeDiscord(l.section)}）${l.note ? ` メモ: ${escapeDiscord(l.note)}` : ""}`,
  );
  return [`🛒 ${who}が${lines.length}品を足しました`, ...rows].join("\n");
}
