import { describe, expect, it } from "vitest";
import {
  allStores,
  checkedBySection,
  cleanStore,
  customStores,
  sortStores,
  checkedItems,
  cleanName,
  dayLabel,
  findOpenDuplicate,
  groupBySection,
  guessSection,
  historyId,
  keyFromHash,
  LOG_DAYS,
  logByDay,
  nameKey,
  suggestions,
  timeLabel,
  type AddLog,
  type HistoryEntry,
  type Item,
} from "../src/model";

const item = (p: Partial<Item>): Item => ({
  id: p.id ?? Math.random().toString(36),
  name: "x",
  section: "その他",
  note: "",
  addedBy: "",
  checked: false,
  createdAt: 0,
  checkedAt: null,
  ...p,
});

const hist = (p: Partial<HistoryEntry>): HistoryEntry => ({
  id: p.id ?? Math.random().toString(36),
  name: "x",
  section: "その他",
  count: 1,
  lastAt: 0,
  ...p,
});

describe("cleanName", () => {
  it("空白だけは null", () => {
    expect(cleanName("   ")).toBeNull();
    expect(cleanName("")).toBeNull();
  });
  it("全角英数を半角に、連続空白を1つに", () => {
    expect(cleanName("  ＡＢＣ　　牛乳 ")).toBe("ABC 牛乳");
  });
  it("60字で切る", () => {
    expect(cleanName("あ".repeat(80))!.length).toBe(60);
  });
});

describe("nameKey", () => {
  it("カタカナとひらがな・全角半角・大小を同じに見る", () => {
    expect(nameKey("トマト")).toBe(nameKey("とまと"));
    expect(nameKey("ＡＢＣ")).toBe(nameKey("abc"));
    expect(nameKey("食 パン")).toBe(nameKey("食パン"));
  });
});

describe("historyId", () => {
  it("スラッシュを含んでも文書 ID に使える形になる", () => {
    expect(historyId("a/b")).not.toContain("/");
  });
});

describe("guessSection", () => {
  it("手がかりの言葉から当てる", () => {
    expect(guessSection("牛乳", [])).toBe("スーパー");
    expect(guessSection("冷凍うどん", [])).toBe("スーパー");
    expect(guessSection("トイレットペーパー", [])).toBe("ドラッグストア");
    expect(guessSection("舌ブラシ", [])).toBe("ドラッグストア");
    expect(guessSection("単3電池", [])).toBe("家電量販店");
    expect(guessSection("園芸用の土", [])).toBe("ホームセンター");
    expect(guessSection("文庫本", [])).toBe("本屋");
  });
  it("食べ物の言葉を含む別の物を取り違えない", () => {
    expect(guessSection("パンツ", [])).toBe("服屋");
    expect(guessSection("灯油", [])).toBe("ホームセンター");
    expect(guessSection("フライパン", [])).toBe("ホームセンター");
    expect(guessSection("水着", [])).toBe("服屋");
    expect(guessSection("茶碗", [])).toBe("100円ショップ");
  });
  it("当たらなければその他", () => {
    expect(guessSection("ふしぎな物", [])).toBe("その他");
  });
  it("過去に足した売り場を優先する", () => {
    expect(guessSection("牛乳", [hist({ name: "ぎゅうにゅう", section: "その他" })])).toBe("スーパー");
    expect(guessSection("ギュウニュウ", [hist({ name: "ぎゅうにゅう", section: "その他" })])).toBe("その他");
  });
});

describe("groupBySection", () => {
  it("お店の順に並べ、チェック済みは除く", () => {
    const g = groupBySection([
      item({ name: "a", section: "ドラッグストア", createdAt: 1 }),
      item({ name: "b", section: "スーパー", createdAt: 2 }),
      item({ name: "c", section: "スーパー", createdAt: 1 }),
      item({ name: "d", section: "本屋", checked: true }),
    ]);
    expect(g.map((x) => x.section)).toEqual(["スーパー", "ドラッグストア"]);
    expect(g[0].items.map((i) => i.name)).toEqual(["c", "b"]);
  });
});

describe("checkedItems", () => {
  it("チェックした新しい順", () => {
    const c = checkedItems([
      item({ name: "a", checked: true, checkedAt: 1 }),
      item({ name: "b", checked: true, checkedAt: 3 }),
      item({ name: "c" }),
    ]);
    expect(c.map((i) => i.name)).toEqual(["b", "a"]);
  });
});

describe("checkedBySection", () => {
  it("お店の順に並べ、お店の中はチェックした新しい順。買っていない物は除く", () => {
    const g = checkedBySection([
      item({ name: "a", section: "ドラッグストア", checked: true, checkedAt: 5 }),
      item({ name: "b", section: "スーパー", checked: true, checkedAt: 1 }),
      item({ name: "c", section: "スーパー", checked: true, checkedAt: 3 }),
      item({ name: "d", section: "本屋" }),
    ]);
    expect(g.map((x) => x.section)).toEqual(["スーパー", "ドラッグストア"]);
    expect(g[0].items.map((i) => i.name)).toEqual(["c", "b"]);
  });
});

describe("自分で入れたお店", () => {
  it("固定のお店 → 自分のお店（五十音）→ その他 の順に並べる", () => {
    expect(sortStores(["その他", "業務スーパー", "ドラッグストア", "イケア", "スーパー", "ドラッグストア"])).toEqual([
      "スーパー",
      "ドラッグストア",
      "イケア",
      "業務スーパー",
      "その他",
    ]);
  });
  it("選べるお店は固定の10種に、保存したお店と品物に出てくるお店を足す", () => {
    const all = allStores(["業務スーパー"], [item({ section: "ニトリ" })]);
    expect(all).toHaveLength(12);
    expect(all.at(-1)).toBe("その他");
    expect(customStores(["業務スーパー"], [item({ section: "ニトリ" }), item({ section: "スーパー" })])).toEqual(["ニトリ", "業務スーパー"]);
  });
  it("名前を整え、表記ゆれは既にあるお店にまとめる", () => {
    const existing = ["スーパー", "業務スーパー"];
    expect(cleanStore("  ｷﾞｮｳﾑ  ", existing)).toBe("ギョウム");
    expect(cleanStore("すーぱー", existing)).toBe("スーパー");
    expect(cleanStore("業務すーぱー", existing)).toBe("業務スーパー");
    expect(cleanStore("   ", existing)).toBeNull();
    expect(cleanStore("あ".repeat(30), existing)).toHaveLength(20);
  });
  it("自分のお店の品物もお店ごとにまとめる", () => {
    const g = groupBySection([item({ name: "a", section: "その他" }), item({ name: "b", section: "業務スーパー" }), item({ name: "c", section: "スーパー" })]);
    expect(g.map((x) => x.section)).toEqual(["スーパー", "業務スーパー", "その他"]);
  });
});

describe("suggestions", () => {
  const history = [
    hist({ name: "牛乳", count: 5 }),
    hist({ name: "卵", count: 9 }),
    hist({ name: "ぎょうざ", count: 1 }),
    hist({ name: "消した物", count: 0 }),
  ];
  it("回数の多い順で、リストにある物と0回の物は出さない", () => {
    const s = suggestions(history, [item({ name: "卵" })], "");
    expect(s.map((h) => h.name)).toEqual(["牛乳", "ぎょうざ"]);
  });
  it("チェック済みの物は候補に戻る", () => {
    const s = suggestions(history, [item({ name: "卵", checked: true })], "");
    expect(s[0].name).toBe("卵");
  });
  it("入力で絞り込み、前方一致を先にする", () => {
    const s = suggestions([hist({ name: "牛乳", count: 1 }), hist({ name: "ぎゅうにく", count: 9 }), hist({ name: "こぎゅう", count: 20 })], [], "ぎゅう");
    expect(s.map((h) => h.name)).toEqual(["ぎゅうにく", "こぎゅう"]);
  });
});

describe("findOpenDuplicate", () => {
  it("未チェックの同じ物だけを見つける", () => {
    const items = [item({ id: "1", name: "トマト", checked: true }), item({ id: "2", name: "とまと" })];
    expect(findOpenDuplicate(items, "トマト")?.id).toBe("2");
    expect(findOpenDuplicate([items[0]], "トマト")).toBeUndefined();
  });
});

describe("keyFromHash", () => {
  const k = "0123456789abcdef0123456789abcdef";
  it("#k= から32桁の鍵を取る", () => {
    expect(keyFromHash(`#k=${k}`)).toBe(k);
    expect(keyFromHash(`#x=1&k=${k}`)).toBe(k);
  });
  it("形が違えば null", () => {
    expect(keyFromHash("#k=short")).toBeNull();
    expect(keyFromHash("")).toBeNull();
    expect(keyFromHash(`#k=${k}zz`)).toBeNull();
  });
});

describe("追加履歴", () => {
  const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
  const now = at(2026, 11, 15, 18);
  const log = (id: string, ms: number): AddLog => ({ id, name: id, section: "スーパー", addedBy: "", at: ms });

  it("日付の見出しは今日・昨日・月日（曜日）、年が違えば年も付ける", () => {
    expect(dayLabel(at(2026, 11, 15, 0, 1), now)).toBe("今日");
    expect(dayLabel(at(2026, 11, 14, 23, 59), now)).toBe("昨日");
    expect(dayLabel(at(2026, 11, 13), now)).toBe("11月13日（金）");
    expect(dayLabel(at(2025, 12, 31), now)).toBe("2025年12月31日（水）");
  });

  it("時刻は 時:分 で分を2桁にする", () => {
    expect(timeLabel(at(2026, 11, 15, 9, 5))).toBe("9:05");
  });

  it("新しい順に日ごとへまとめ、残す日数より古い物は除く", () => {
    const days = logByDay(
      [
        log("a", at(2026, 11, 14, 9)),
        log("b", at(2026, 11, 15, 8)),
        log("c", at(2026, 11, 15, 17)),
        log("old", now - (LOG_DAYS + 1) * 86400000),
      ],
      now,
    );
    expect(days.map((d) => d.label)).toEqual(["今日", "昨日"]);
    expect(days[0].entries.map((l) => l.id)).toEqual(["c", "b"]);
    expect(days[1].entries.map((l) => l.id)).toEqual(["a"]);
  });

  it("記録が無ければ空", () => {
    expect(logByDay([], now)).toEqual([]);
  });
});
