import { describe, expect, it } from "vitest";
import { batchMessage, type AddedLine } from "../src/model";
import { BATCH_MS, createBatcher, DISCORD_MAX, type Send } from "../src/notify";

const URL = "https://discord.com/api/webhooks/1/x";
const line = (name: string, p: Partial<AddedLine> = {}): AddedLine => ({
  name,
  section: "スーパー",
  note: "",
  addedBy: "たろう",
  ...p,
});

/** 送った中身を記録する偽の送信。fail に入れた回数目は失敗させる */
function fakeSend(fail: number[] = []) {
  const calls: { content: string; messageId: string | null }[] = [];
  let n = 0;
  const send: Send = async (_url, content, messageId) => {
    calls.push({ content, messageId });
    n++;
    if (fail.includes(n)) return null;
    return messageId ?? `m${n}`;
  };
  return { calls, send };
}

describe("batchMessage", () => {
  it("1品なら今までの1行の形", () => {
    expect(batchMessage([line("牛乳")])).toBe("🛒 たろうが「牛乳」を足しました（スーパー）");
  });
  it("2品以上は品数と1行ずつの一覧", () => {
    expect(batchMessage([line("牛乳"), line("卵", { note: "10個" }), line("電池", { section: "家電量販店" })])).toBe(
      "🛒 たろうが3品を足しました\n・牛乳（スーパー）\n・卵（スーパー） メモ: 10個\n・電池（家電量販店）",
    );
  });
});

describe("createBatcher", () => {
  it("続けて足した物は1つ目の投稿を書き直す", async () => {
    let t = 0;
    const { calls, send } = fakeSend();
    const b = createBatcher(send, () => t);
    void b.add(URL, line("牛乳"));
    t += 60_000;
    void b.add(URL, line("卵"));
    t += 60_000;
    await b.add(URL, line("パン"));
    expect(calls.map((c) => c.messageId)).toEqual([null, "m1", "m1"]);
    expect(calls[2].content).toBe("🛒 たろうが3品を足しました\n・牛乳（スーパー）\n・卵（スーパー）\n・パン（スーパー）");
  });

  it("前に足してから5分たったら新しく投稿する", async () => {
    let t = 0;
    const { calls, send } = fakeSend();
    const b = createBatcher(send, () => t);
    await b.add(URL, line("牛乳"));
    t += BATCH_MS;
    await b.add(URL, line("卵"));
    expect(calls.map((c) => c.messageId)).toEqual([null, null]);
    expect(calls[1].content).toBe("🛒 たろうが「卵」を足しました（スーパー）");
  });

  it("足した人や送り先が変わったら新しく投稿する", async () => {
    const { calls, send } = fakeSend();
    const b = createBatcher(send, () => 0);
    await b.add(URL, line("牛乳"));
    await b.add(URL, line("卵", { addedBy: "はなこ" }));
    await b.add("https://discord.com/api/webhooks/2/y", line("パン", { addedBy: "はなこ" }));
    expect(calls.map((c) => c.messageId)).toEqual([null, null, null]);
  });

  it("書き直しに失敗したら新しく投稿する", async () => {
    const { calls, send } = fakeSend([2]);
    const b = createBatcher(send, () => 0);
    await b.add(URL, line("牛乳"));
    await b.add(URL, line("卵"));
    expect(calls.map((c) => c.messageId)).toEqual([null, "m1", null]);
    expect(calls[2].content).toBe("🛒 たろうが「卵」を足しました（スーパー）");
  });

  it("最初の投稿に失敗したら、次は新しく投稿する", async () => {
    const { calls, send } = fakeSend([1]);
    const b = createBatcher(send, () => 0);
    await b.add(URL, line("牛乳"));
    await b.add(URL, line("卵"));
    expect(calls.map((c) => c.messageId)).toEqual([null, null]);
  });

  it("字数の上限を超えるなら新しく投稿する", async () => {
    const { calls, send } = fakeSend();
    const b = createBatcher(send, () => 0);
    const long = "あ".repeat(60);
    for (let i = 0; i < 40; i++) await b.add(URL, line(`${long}${i}`));
    expect(calls.every((c) => c.content.length <= DISCORD_MAX)).toBe(true);
    expect(calls.filter((c) => c.messageId === null).length).toBe(2);
  });
});
