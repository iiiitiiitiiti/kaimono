import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { getDb } from "./firebase";
import {
  addedMessage,
  cleanWebhook,
  historyId,
  isCustomStore,
  isSection,
  LOG_DAYS,
  OTHER,
  storeId,
  type AddLog,
  type HistoryEntry,
  type Item,
  type Section,
} from "./model";

export type LoadState = "loading" | "ready" | "denied" | "offline-timeout";

const toMillis = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : Date.now());

function toItem(id: string, d: DocumentData): Item {
  return {
    id,
    name: String(d.name ?? ""),
    section: isSection(d.section) ? d.section : OTHER,
    note: typeof d.note === "string" ? d.note : "",
    addedBy: typeof d.addedBy === "string" ? d.addedBy : "",
    checked: d.checked === true,
    createdAt: toMillis(d.createdAt),
    checkedAt: d.checkedAt ? toMillis(d.checkedAt) : null,
  };
}

function toHistory(id: string, d: DocumentData): HistoryEntry {
  return {
    id,
    name: String(d.name ?? ""),
    section: isSection(d.section) ? d.section : OTHER,
    count: typeof d.count === "number" ? d.count : 0,
    lastAt: toMillis(d.lastAt),
  };
}

function toLog(id: string, d: DocumentData): AddLog {
  return {
    id,
    name: String(d.name ?? ""),
    // 追加履歴は記録なので、消したお店の名前もそのまま出す
    section: typeof d.section === "string" && d.section ? d.section : OTHER,
    addedBy: typeof d.addedBy === "string" ? d.addedBy : "",
    at: toMillis(d.at),
  };
}

/** Discord へ送る。送れたら true。届かなかった理由はコンソールにだけ出す */
async function postDiscord(url: string, content: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 品名に @everyone などが入っても、だれも呼び出さない
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) console.error("Discord に送れませんでした", res.status);
    return res.ok;
  } catch (e) {
    console.error("Discord に送れませんでした", e);
    return false;
  }
}

/** 一度に消す古い追加履歴の上限（1回の書き込みにまとめられる数に収める） */
const PRUNE_MAX = 400;

/** 2人で共有するリストを購読し、書き込み操作を返す */
export function useList(listKey: string, onWriteError: () => void) {
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [logs, setLogs] = useState<AddLog[]>([]);
  const [stores, setStores] = useState<Section[]>([]);
  const storesRef = useRef<Section[]>([]);
  // Discord のウェブフック URL（2人で共有）。無ければ知らせない
  const [webhook, setWebhookState] = useState<string | null>(null);
  const webhookRef = useRef<string | null>(null);
  // 電波が無くて送れなかった知らせ。つながったら送り直す（アプリを閉じると消える）
  const pendingNotes = useRef<string[]>([]);
  const pruned = useRef(false);
  const [state, setState] = useState<LoadState>("loading");

  const refs = useMemo(() => {
    const db = getDb();
    return {
      db,
      items: collection(db, "lists", listKey, "items"),
      history: collection(db, "lists", listKey, "history"),
      log: collection(db, "lists", listKey, "log"),
      stores: collection(db, "lists", listKey, "stores"),
      notify: doc(db, "lists", listKey, "settings", "notify"),
    };
  }, [listKey]);

  useEffect(() => {
    let gotData = false;
    // 10秒たっても手元の写しすら出ないときだけ、つながらない旨を出す
    const timer = window.setTimeout(() => {
      if (!gotData) setState((s) => (s === "loading" ? "offline-timeout" : s));
    }, 10000);

    const fail = (e: { code?: string }) => {
      window.clearTimeout(timer);
      setState(e.code === "permission-denied" ? "denied" : "offline-timeout");
    };

    const unItems = onSnapshot(
      refs.items,
      (snap) => {
        gotData = true;
        window.clearTimeout(timer);
        setItems(snap.docs.map((d) => toItem(d.id, d.data({ serverTimestamps: "estimate" }))));
        setState("ready");
      },
      fail,
    );
    const unHistory = onSnapshot(
      refs.history,
      (snap) => setHistory(snap.docs.map((d) => toHistory(d.id, d.data({ serverTimestamps: "estimate" })))),
      fail,
    );
    pruned.current = false;
    // 追加履歴が読めなくても、リストは使えるようにする（fail を通さない）
    // 手元の写しと中身が同じだと届いた知らせが来ないので、metadata の変化も受け取る
    const unLog = onSnapshot(
      refs.log,
      { includeMetadataChanges: true },
      (snap) => {
        setLogs(snap.docs.map((d) => toLog(d.id, d.data({ serverTimestamps: "estimate" }))));
        // 手元の写しは古いことがあるので、保存先から届いた中身で1回だけ判定する
        if (pruned.current || snap.metadata.fromCache) return;
        pruned.current = true;
        const cutoff = Date.now() - LOG_DAYS * 86400000;
        const old = snap.docs.filter((d) => {
          const at = d.get("at");
          return at instanceof Timestamp && at.toMillis() < cutoff;
        });
        if (old.length === 0) return;
        const batch = writeBatch(refs.db);
        for (const d of old.slice(0, PRUNE_MAX)) batch.delete(d.ref);
        batch.commit().catch((e: unknown) => console.error("古い追加履歴を消せませんでした", e));
      },
      (e) => console.error("追加履歴を読めませんでした", e),
    );
    // 自分で入れたお店。読めなくてもリストは使えるようにする（固定の10種は選べる）
    const unStores = onSnapshot(
      refs.stores,
      (snap) => {
        const names = snap.docs.map((d) => d.get("name")).filter((n): n is Section => isSection(n) && isCustomStore(n));
        storesRef.current = names;
        setStores(names);
      },
      (e) => console.error("自分で入れたお店を読めませんでした", e),
    );
    // 知らせの設定。読めなくてもリストは使えるようにする
    const unNotify = onSnapshot(
      refs.notify,
      (snap) => {
        const raw = snap.get("discord");
        const url = typeof raw === "string" ? cleanWebhook(raw) : null;
        webhookRef.current = url;
        setWebhookState(url);
      },
      (e) => console.error("知らせの設定を読めませんでした", e),
    );
    return () => {
      window.clearTimeout(timer);
      unNotify();
      unItems();
      unHistory();
      unLog();
      unStores();
    };
  }, [refs]);

  useEffect(() => {
    const flush = () => {
      const url = webhookRef.current;
      const notes = pendingNotes.current.splice(0);
      if (!url) return;
      for (const n of notes) void postDiscord(url, n);
    };
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, []);

  const actions = useMemo(() => {
    // 書き込みは待たない（電波が無くても画面にはすぐ出し、つながったら送られる）
    const run = (p: Promise<unknown>) => {
      p.catch((e: unknown) => {
        console.error("書き込みに失敗しました", e);
        onWriteError();
      });
    };

    // 自分で入れたお店を一覧に残す。品物とは別に書き、保存できなくても品物は足せるようにする
    const saveStore = (section: Section) => {
      if (!isCustomStore(section) || storesRef.current.includes(section)) return;
      setDoc(doc(refs.stores, storeId(section)), { name: section }).catch((e: unknown) =>
        console.error("お店を保存できませんでした", e),
      );
    };

    // 足した物を Discord へ知らせる。電波が無ければ、つながったときに送る
    const notify = (content: string) => {
      const url = webhookRef.current;
      if (!url) return;
      if (!navigator.onLine) {
        pendingNotes.current.push(content);
        return;
      }
      void postDiscord(url, content);
    };

    const touchHistory = (name: string, section: Section, add: number) =>
      setDoc(
        doc(refs.history, historyId(name)),
        { name, section, count: increment(add), lastAt: serverTimestamp() },
        { merge: true },
      );

    return {
      add(name: string, section: Section, note: string, addedBy: string) {
        const ref = doc(refs.items);
        const data: DocumentData = { name, section, checked: false, createdAt: serverTimestamp() };
        if (note) data.note = note;
        if (addedBy) data.addedBy = addedBy;
        // 品物とよく買う物の回数は一緒に書く（片方だけ残ると回数がずれる）
        const batch = writeBatch(refs.db);
        batch.set(ref, data);
        batch.set(
          doc(refs.history, historyId(name)),
          { name, section, count: increment(1), lastAt: serverTimestamp() },
          { merge: true },
        );
        run(batch.commit());
        saveStore(section);
        // 品物とは別に書き、履歴が保存できなくても品物は足せるようにする
        const log: DocumentData = { name, section, at: serverTimestamp() };
        if (addedBy) log.addedBy = addedBy;
        setDoc(doc(refs.log), log).catch((e: unknown) => console.error("追加履歴を残せませんでした", e));
        notify(addedMessage(name, section, note, addedBy));
        return ref.id;
      },
      toggle(item: Item) {
        run(
          updateDoc(doc(refs.items, item.id), {
            checked: !item.checked,
            checkedAt: item.checked ? null : serverTimestamp(),
          }),
        );
      },
      edit(item: Item, next: { name: string; section: Section; note: string }) {
        const data: DocumentData = { name: next.name, section: next.section, note: next.note };
        run(updateDoc(doc(refs.items, item.id), data));
        // 売り場を直したら次からその売り場で出す
        run(touchHistory(next.name, next.section, 0));
        saveStore(next.section);
      },
      remove(itemsToRemove: Item[]) {
        const batch = writeBatch(refs.db);
        for (const i of itemsToRemove) batch.delete(doc(refs.items, i.id));
        run(batch.commit());
      },
      /** 消した物を元に戻す（取り消し用） */
      restore(itemsToRestore: Item[]) {
        const batch = writeBatch(refs.db);
        for (const i of itemsToRestore) {
          const data: DocumentData = {
            name: i.name,
            section: i.section,
            checked: i.checked,
            createdAt: Timestamp.fromMillis(i.createdAt),
          };
          if (i.note) data.note = i.note;
          if (i.addedBy) data.addedBy = i.addedBy;
          if (i.checkedAt != null) data.checkedAt = Timestamp.fromMillis(i.checkedAt);
          batch.set(doc(refs.items, i.id), data);
        }
        run(batch.commit());
      },
      /** Discord のウェブフック URL を入れる。null なら知らせを止める */
      setWebhook(url: string | null) {
        run(url ? setDoc(refs.notify, { discord: url }) : deleteDoc(refs.notify));
      },
      /** 入れた URL へ試しに送る */
      testNotify(url: string) {
        return postDiscord(url, "🛒 買い物リストの知らせはここに届きます");
      },
      forgetHistory(entry: HistoryEntry) {
        run(deleteDoc(doc(refs.history, entry.id)));
      },
      /**
       * 自分で入れたお店を消す。そのお店の品物とよく買う物は「その他」へ移す
       * （移さないと、同じ名前を入れ直したときに古い品物がそのお店へ戻る）
       */
      removeStore(name: Section, currentItems: Item[], currentHistory: HistoryEntry[]) {
        const batch = writeBatch(refs.db);
        batch.delete(doc(refs.stores, storeId(name)));
        for (const i of currentItems) if (i.section === name) batch.update(doc(refs.items, i.id), { section: OTHER });
        for (const h of currentHistory) if (h.section === name) batch.update(doc(refs.history, h.id), { section: OTHER });
        run(batch.commit());
      },
    };
  }, [refs, onWriteError]);

  return { items, history, logs, stores, webhook, state, actions };
}
