import { describe, expect, it } from "vitest";
import {
  checkedItems,
  cleanName,
  findOpenDuplicate,
  groupBySection,
  guessSection,
  historyId,
  keyFromHash,
  nameKey,
  suggestions,
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
    expect(guessSection("牛乳", [])).toBe("卵・乳製品・豆腐");
    expect(guessSection("キャベツ", [])).toBe("野菜・果物");
    expect(guessSection("豚こま", [])).toBe("肉・魚");
    expect(guessSection("冷凍うどん", [])).toBe("冷凍食品");
    expect(guessSection("トイレットペーパー", [])).toBe("日用品");
  });
  it("当たらなければその他", () => {
    expect(guessSection("ふしぎな物", [])).toBe("その他");
  });
  it("過去に足した売り場を優先する", () => {
    expect(guessSection("牛乳", [hist({ name: "ぎゅうにゅう", section: "その他" })])).toBe("卵・乳製品・豆腐");
    expect(guessSection("ギュウニュウ", [hist({ name: "ぎゅうにゅう", section: "その他" })])).toBe("その他");
  });
});

describe("groupBySection", () => {
  it("売り場の順に並べ、チェック済みは除く", () => {
    const g = groupBySection([
      item({ name: "a", section: "日用品", createdAt: 1 }),
      item({ name: "b", section: "野菜・果物", createdAt: 2 }),
      item({ name: "c", section: "野菜・果物", createdAt: 1 }),
      item({ name: "d", section: "肉・魚", checked: true }),
    ]);
    expect(g.map((x) => x.section)).toEqual(["野菜・果物", "日用品"]);
    expect(g[0].items.map((i) => i.name)).toEqual(["c", "b"]);
  });
});

describe("checkedItems", () => {
  it("かごに入れた新しい順", () => {
    const c = checkedItems([
      item({ name: "a", checked: true, checkedAt: 1 }),
      item({ name: "b", checked: true, checkedAt: 3 }),
      item({ name: "c" }),
    ]);
    expect(c.map((i) => i.name)).toEqual(["b", "a"]);
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
