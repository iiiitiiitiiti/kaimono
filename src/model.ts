// 画面に依存しない決まりごと（売り場・並べ方・名前の正規化）

export const SECTIONS = [
  "野菜・果物",
  "肉・魚",
  "卵・乳製品・豆腐",
  "パン・米・麺",
  "調味料・乾物",
  "冷凍食品",
  "お菓子・飲み物",
  "日用品",
  "薬・コスメ",
  "その他",
] as const;

export type Section = (typeof SECTIONS)[number];
export const OTHER: Section = "その他";

export function isSection(v: unknown): v is Section {
  return typeof v === "string" && (SECTIONS as readonly string[]).includes(v);
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

// 品名から売り場を当てるための手がかり（前から順に照合し、最初に当たった売り場にする）
const HINTS: [Section, string[]][] = [
  ["冷凍食品", ["冷凍", "アイス"]],
  ["卵・乳製品・豆腐", ["卵", "たまご", "玉子", "牛乳", "ミルク", "ヨーグルト", "チーズ", "バター", "生クリーム", "豆腐", "とうふ", "納豆", "なっとう", "油揚げ", "厚揚げ", "豆乳"]],
  ["肉・魚", ["肉", "豚", "鶏", "牛", "ひき", "ベーコン", "ハム", "ソーセージ", "ウインナー", "魚", "鮭", "さけ", "サーモン", "まぐろ", "マグロ", "さば", "サバ", "ぶり", "えび", "エビ", "いか", "たこ", "あさり", "しらす", "ちくわ", "かまぼこ", "刺身"]],
  ["野菜・果物", ["野菜", "キャベツ", "レタス", "白菜", "はくさい", "大根", "だいこん", "人参", "にんじん", "玉ねぎ", "たまねぎ", "ねぎ", "ネギ", "じゃがいも", "さつまいも", "トマト", "きゅうり", "なす", "ピーマン", "ブロッコリー", "ほうれん草", "小松菜", "もやし", "きのこ", "しめじ", "えのき", "舞茸", "まいたけ", "椎茸", "しいたけ", "生姜", "しょうが", "にんにく", "大葉", "水菜", "オクラ", "かぼちゃ", "ごぼう", "れんこん", "アボカド", "りんご", "バナナ", "みかん", "いちご", "ぶどう", "レモン", "キウイ", "果物", "フルーツ"]],
  ["パン・米・麺", ["パン", "食パン", "米", "ごはん", "ご飯", "パスタ", "スパゲッティ", "うどん", "そば", "ラーメン", "そうめん", "焼きそば", "餅", "もち", "シリアル", "グラノーラ"]],
  ["調味料・乾物", ["醤油", "しょうゆ", "味噌", "みそ", "塩", "砂糖", "酢", "みりん", "酒", "油", "オイル", "マヨネーズ", "ケチャップ", "ソース", "ドレッシング", "だし", "コンソメ", "カレー", "ルー", "胡椒", "こしょう", "小麦粉", "片栗粉", "パン粉", "海苔", "のり", "わかめ", "ひじき", "ごま", "缶", "ツナ", "スパイス"]],
  ["お菓子・飲み物", ["お菓子", "チョコ", "クッキー", "ポテチ", "スナック", "せんべい", "グミ", "ガム", "飴", "水", "お茶", "茶", "コーヒー", "紅茶", "ジュース", "炭酸", "ビール", "ワイン", "麦茶"]],
  ["薬・コスメ", ["薬", "絆創膏", "ばんそうこう", "目薬", "マスク", "シャンプー", "リンス", "コンディショナー", "ボディソープ", "洗顔", "化粧", "日焼け止め", "歯磨き", "歯ブラシ", "コンタクト", "ハンドクリーム", "リップ"]],
  ["日用品", ["ティッシュ", "トイレット", "ペーパー", "キッチンペーパー", "洗剤", "柔軟剤", "ラップ", "ホイル", "ゴミ袋", "ごみ袋", "スポンジ", "電池", "電球", "ハンドソープ", "漂白", "ジップ", "保存袋", "綿棒", "ハンガー"]],
];

/** 品名から売り場を当てる。過去に同じ物を足していればそれを優先する */
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
  return SECTIONS.map((section) => ({
    section,
    items: open.filter((i) => i.section === section).sort((a, b) => a.createdAt - b.createdAt),
  })).filter((g) => g.items.length > 0);
}

/** かごに入れた物。入れたのが新しい順 */
export function checkedItems(items: Item[]): Item[] {
  return items
    .filter((i) => i.checked)
    .sort((a, b) => (b.checkedAt ?? b.createdAt) - (a.checkedAt ?? a.createdAt));
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
