import { batchMessage, type AddedLine } from "./model";

/** 前に足してからこの時間のうちに足した物は、同じ投稿に書き足す */
export const BATCH_MS = 5 * 60 * 1000;
/** Discord の1投稿の字数の上限。超えるときは新しく投稿する */
export const DISCORD_MAX = 2000;

/**
 * Discord へ送る。messageId があればその投稿を書き直し、無ければ新しく投稿する。
 * 送れたら投稿の ID、送れなければ null を返す
 */
export type Send = (url: string, content: string, messageId: string | null) => Promise<string | null>;

export const sendDiscord: Send = async (url, content, messageId) => {
  try {
    const res = await fetch(messageId ? `${url}/messages/${messageId}` : `${url}?wait=true`, {
      method: messageId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      // 品名に @everyone などが入っても、だれも呼び出さない
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) {
      console.error("Discord に送れませんでした", res.status);
      return null;
    }
    if (messageId) return messageId;
    const data: unknown = await res.json();
    const id = (data as { id?: unknown } | null)?.id;
    return typeof id === "string" ? id : null;
  } catch (e) {
    console.error("Discord に送れませんでした", e);
    return null;
  }
};

/**
 * 続けて足した物を1つの投稿にまとめる。1品目はすぐ新しく投稿し、
 * BATCH_MS のうちに同じ人が続けて足した物はその投稿を書き直して1行ずつ足す。
 * 書き直しに失敗したら新しく投稿し直す。送る順がずれないよう1件ずつ順に送る
 */
export function createBatcher(send: Send, now: () => number = Date.now) {
  let current: { url: string; addedBy: string; id: string; lines: AddedLine[]; at: number } | null = null;
  let chain: Promise<void> = Promise.resolve();

  const step = async (url: string, line: AddedLine) => {
    const t = now();
    if (current && current.url === url && current.addedBy === line.addedBy && t - current.at < BATCH_MS) {
      const lines = [...current.lines, line];
      const content = batchMessage(lines);
      if (content.length <= DISCORD_MAX) {
        const id = await send(url, content, current.id);
        if (id) {
          current = { ...current, lines, at: t };
          return;
        }
      }
    }
    const id = await send(url, batchMessage([line]), null);
    current = id ? { url, addedBy: line.addedBy, id, lines: [line], at: t } : null;
  };

  return {
    add(url: string, line: AddedLine): Promise<void> {
      chain = chain.then(() => step(url, line)).catch((e: unknown) => console.error("Discord に送れませんでした", e));
      return chain;
    },
  };
}
