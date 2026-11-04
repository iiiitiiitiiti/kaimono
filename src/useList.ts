import { useEffect, useMemo, useState } from "react";
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
import { historyId, isSection, OTHER, type HistoryEntry, type Item, type Section } from "./model";

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

/** 2人で共有するリストを購読し、書き込み操作を返す */
export function useList(listKey: string, onWriteError: () => void) {
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const refs = useMemo(() => {
    const db = getDb();
    return {
      db,
      items: collection(db, "lists", listKey, "items"),
      history: collection(db, "lists", listKey, "history"),
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
    return () => {
      window.clearTimeout(timer);
      unItems();
      unHistory();
    };
  }, [refs]);

  const actions = useMemo(() => {
    // 書き込みは待たない（電波が無くても画面にはすぐ出し、つながったら送られる）
    const run = (p: Promise<unknown>) => {
      p.catch((e: unknown) => {
        console.error("書き込みに失敗しました", e);
        onWriteError();
      });
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
      forgetHistory(entry: HistoryEntry) {
        run(deleteDoc(doc(refs.history, entry.id)));
      },
    };
  }, [refs, onWriteError]);

  return { items, history, state, actions };
}
