import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  checkedItems,
  cleanName,
  findOpenDuplicate,
  groupBySection,
  guessSection,
  keyFromHash,
  NOTE_MAX,
  NAME_MAX,
  PERSON_MAX,
  personColor,
  SECTIONS,
  suggestions,
  type HistoryEntry,
  type Item,
  type Section,
} from "./model";
import { flushSync } from "react-dom";
import { useKeyboardFirst } from "./keyboardFirst";
import { useList } from "./useList";

const STORE_KEY = "kaimono:key";
const STORE_ME = "kaimono:me";
const STORE_THEME = "kaimono:theme";

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* 保存できない環境ではその場限りで使う */
  }
};

/**
 * 鍵は URL の #k=… から取り、端末にも覚える。
 * iPhone はホーム画面に置いたアプリと Safari で保存場所が別なので、URL からは消さない。
 * 覚えた鍵で開いたときは URL に戻し、そのままホーム画面に置けるようにする。
 */
function loadKey(): string | null {
  const fromHash = keyFromHash(window.location.hash);
  if (fromHash) {
    write(STORE_KEY, fromHash);
    return fromHash;
  }
  const stored = read(STORE_KEY);
  if (stored && /^[0-9a-f]{32}$/.test(stored)) {
    window.history.replaceState(null, "", `#k=${stored}`);
    return stored;
  }
  return null;
}

type Theme = "light" | "dark";

export function App() {
  const [listKey, setListKey] = useState<string | null>(loadKey);
  const [me, setMe] = useState<string | null>(() => read(STORE_ME));
  const [theme, setTheme] = useState<Theme>(() => (read(STORE_THEME) === "dark" ? "dark" : "light"));

  useEffect(() => {
    const onHash = () => {
      const k = keyFromHash(window.location.hash);
      if (k) {
        write(STORE_KEY, k);
        setListKey(k);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#141614" : "#FBFAF6");
  }, [theme]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    write(STORE_THEME, next);
    setTheme(next);
  };

  const saveMe = (name: string) => {
    const v = name.normalize("NFKC").trim().slice(0, PERSON_MAX);
    write(STORE_ME, v);
    setMe(v);
  };

  const useLink = (key: string) => {
    write(STORE_KEY, key);
    window.history.replaceState(null, "", `#k=${key}`);
    setListKey(key);
  };

  if (!listKey) return <NoKey onKey={useLink} />;
  if (me === null) return <NameSetup onDone={saveMe} />;
  return <ListScreen listKey={listKey} me={me} onMe={saveMe} theme={theme} onTheme={toggleTheme} onKey={useLink} />;
}

/* ---------- 鍵が無いとき ---------- */

function LinkInput({ onKey }: { onKey: (k: string) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const hashPart = text.includes("#") ? text.slice(text.indexOf("#")) : `#k=${text.trim()}`;
    const key = keyFromHash(hashPart);
    if (!key) {
      setError("リンクの形が違います。届いたリンクをそのまま貼ってください");
      return;
    }
    onKey(key);
  };
  return (
    <form className="link-form" onSubmit={submit}>
      <label htmlFor="link">届いたリンクを貼る</label>
      <div className="row">
        <input id="link" value={text} onChange={(e) => setText(e.target.value)} inputMode="url" autoComplete="off" />
        <button className="btn primary" type="submit">
          開く
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function NoKey({ onKey, denied = false }: { onKey: (k: string) => void; denied?: boolean }) {
  return (
    <main className="center-screen">
      <Logo />
      <h1>{denied ? "このリンクでは開けません" : "ふたりの買い物リスト"}</h1>
      <p>{denied ? "届いたリンクをもう一度開いてください。" : "一緒に使う人から届いたリンクを開いてください。"}</p>
      <LinkInput onKey={onKey} />
    </main>
  );
}

function NameSetup({ onDone }: { onDone: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <main className="center-screen">
      <Logo />
      <h1>あなたの呼び名</h1>
      <p>足した物の横に出ます。</p>
      <form
        className="link-form"
        onSubmit={(e) => {
          e.preventDefault();
          onDone(name);
        }}
      >
        <label htmlFor="me" className="sr-only">
          呼び名
        </label>
        <div className="row">
          <input id="me" value={name} maxLength={PERSON_MAX} onChange={(e) => setName(e.target.value)} autoFocus />
          <button className="btn primary" type="submit" disabled={!name.trim()}>
            はじめる
          </button>
        </div>
        <button className="btn ghost" type="button" onClick={() => onDone("")}>
          名前なしではじめる
        </button>
      </form>
    </main>
  );
}

/* ---------- リスト ---------- */

interface ToastState {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

function ListScreen({
  listKey,
  me,
  onMe,
  theme,
  onTheme,
  onKey,
}: {
  listKey: string;
  me: string;
  onMe: (v: string) => void;
  theme: Theme;
  onTheme: () => void;
  onKey: (k: string) => void;
}) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const showToast = useCallback((message: string, action?: ToastState["action"]) => {
    setToast({ id: Date.now(), message, action });
  }, []);
  const clearToast = useCallback(() => setToast(null), []);
  // 保存の失敗は別に出す（同じ枠だと「取り消す」の案内を消してしまう）
  const [error, setError] = useState<ToastState | null>(null);
  const clearError = useCallback(() => setError(null), []);
  const onWriteError = useCallback(
    () => setError({ id: Date.now(), message: "保存できませんでした。つながってからもう一度試してください" }),
    [],
  );
  const { items, history, state, actions } = useList(listKey, onWriteError);

  const [editing, setEditing] = useState<Item | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  // 左になぞってボタンを出している行（同時に開くのは1行だけ）
  const [swiped, setSwiped] = useState<string | null>(null);
  useEffect(() => {
    if (!swiped) return;
    // ほかの場所に触れたら閉じる
    const close = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(`#item-${CSS.escape(swiped)}`)) setSwiped(null);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [swiped]);
  const inputRef = useRef<HTMLInputElement>(null);
  const proxyRef = useRef<HTMLInputElement>(null);

  // お店で絞る。選んだお店は覚えない（家で開いたときに品物が隠れていると、足し忘れや二重に足す元になる）
  const [store, setStore] = useState<Section | null>(null);
  const stores = SECTIONS.filter((s) => items.some((i) => i.section === s));
  // 選んだお店の品物が無くなったら（お店が1つだけになったときも）全部に戻す
  const shown = store && stores.length > 1 && stores.includes(store) ? store : null;
  const inShown = (i: Item) => !shown || i.section === shown;

  const groups = groupBySection(items.filter(inShown));
  const basket = checkedItems(items.filter(inShown));
  const openCount = items.filter((i) => !i.checked).length;

  // かごに入れるときは、行を縮めてから移す（並びが一瞬で飛ばないように）
  const check = (item: Item) => {
    if (item.checked) {
      actions.toggle(item);
      return;
    }
    // 押した行が消えてもキーボード操作の位置を見失わないよう、次の行（無ければ前の行）へ移す
    const checks = Array.from(document.querySelectorAll<HTMLButtonElement>(".group:not(.basket) .check"));
    const at = checks.findIndex((b) => b.closest("li")?.id === `item-${item.id}`);
    const nextBtn = checks[at + 1] ?? checks[at - 1] ?? null;
    const hadFocus = document.activeElement === checks[at];
    setLeaving((s) => new Set(s).add(item.id));
    window.setTimeout(() => {
      if (hadFocus) (nextBtn ?? document.querySelector<HTMLElement>(".list-area"))?.focus({ preventScroll: true });
      actions.toggle(item);
      setLeaving((s) => {
        const n = new Set(s);
        n.delete(item.id);
        return n;
      });
    }, 320);
  };

  const removeWithUndo = (list: Item[], message: string) => {
    if (list.length === 0) return;
    actions.remove(list);
    showToast(message, { label: "取り消す", run: () => actions.restore(list) });
  };

  const highlight = (id: string) => {
    // 絞っていて隠れている行なら、先に全部へ戻してから光らせる
    const target = items.find((i) => i.id === id);
    if (target && !inShown(target)) flushSync(() => setStore(null));
    setFlash(id);
    document.getElementById(`item-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    window.setTimeout(() => setFlash((f) => (f === id ? null : f)), 1600);
  };

  if (state === "denied") return <NoKey onKey={onKey} denied />;

  return (
    <div className="app">
      {/*
        指で足す欄を押したとき、先にキーボードを出すための見えない欄（keyboardFirst.ts）。
        画面の上端に置くため .app の直下に置く（足す欄の中だと足す欄の上端になる）。キーボードの種類は本物と揃える
      */}
      {/* 読み上げで選ばれると本物へ移れないので、読み上げからは隠す */}
      <input ref={proxyRef} className="keyboard-proxy" tabIndex={-1} aria-hidden="true" autoComplete="off" enterKeyHint="done" />
      <header className="top">
        <div className="top-inner">
          <h1 className="title">
            <Logo small />
            かいもの
          </h1>
          <p className="count" aria-live="polite">
            {state === "ready" ? (openCount > 0 ? `あと ${openCount} 品` : "") : ""}
          </p>
          <button className="icon-btn" type="button" onClick={onTheme} aria-label={theme === "dark" ? "明るい表示にする" : "暗い表示にする"}>
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <button className="icon-btn" type="button" onClick={() => setMenuOpen(true)} aria-label="メニュー" aria-haspopup="dialog">
            <MenuIcon />
          </button>
        </div>
      </header>

      <main className="list-area" tabIndex={-1}>
        <div className="list-content">
          {state === "loading" && <p className="status">読み込み中…</p>}
          {state === "offline-timeout" && (
            <div className="status">
              <p>つながりません。電波のよい所で開き直してください。</p>
              <button className="btn" type="button" onClick={() => window.location.reload()}>
                開き直す
              </button>
            </div>
          )}
          {state === "ready" && stores.length > 1 && (
            <details className="fold filter">
              <summary>
                お店で絞る
                {shown && <span className="filter-now">{shown}</span>}
              </summary>
              <div className="filter-chips" role="group" aria-label="お店で絞る">
                <button className="chip" type="button" aria-pressed={!shown} onClick={() => setStore(null)}>
                  全部
                </button>
                {stores.map((s) => (
                  <button key={s} className="chip" type="button" aria-pressed={shown === s} onClick={() => setStore(s)}>
                    {s}
                    <span className="chip-count">{items.filter((i) => i.section === s && !i.checked).length}</span>
                  </button>
                ))}
              </div>
            </details>
          )}
          {state === "ready" && groups.length === 0 && basket.length === 0 && <p className="empty">買う物はありません</p>}
          {state === "ready" && groups.length === 0 && basket.length > 0 && <p className="empty">全部かごに入りました</p>}

          {groups.map((g) => (
            <section key={g.section} className="group" aria-labelledby={`sec-${g.section}`}>
              <h2 id={`sec-${g.section}`} className={`sec sec-${SECTIONS.indexOf(g.section)}`}>
                {g.section}
              </h2>
              <ul className="items">
                {g.items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    leaving={leaving.has(item.id)}
                    flash={flash === item.id}
                    swiped={swiped === item.id}
                    onSwipe={(open) => setSwiped(open ? item.id : null)}
                    onCheck={() => check(item)}
                    onEdit={() => setEditing(item)}
                    onDelete={() => removeWithUndo([item], `「${item.name}」を消しました`)}
                  />
                ))}
              </ul>
            </section>
          ))}

          {basket.length > 0 && (
            // かごに入れた物はふだん畳んでおく
            <details className="group basket">
              <summary className="basket-head">
                <h2 className="sec">
                  かごに入れた <span className="badge">{basket.length}</span>
                </h2>
              </summary>
              <div className="basket-tools">
                <button className="btn small" type="button" onClick={() => removeWithUndo(basket, `${basket.length}品をリストから消しました`)}>
                  まとめて消す
                </button>
              </div>
              <ul className="items">
                {basket.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    leaving={false}
                    flash={flash === item.id}
                    swiped={swiped === item.id}
                    onSwipe={(open) => setSwiped(open ? item.id : null)}
                    onCheck={() => check(item)}
                    onEdit={() => setEditing(item)}
                    onDelete={() => removeWithUndo([item], `「${item.name}」を消しました`)}
                  />
                ))}
              </ul>
            </details>
          )}
        </div>
      </main>

      <Adder
        inputRef={inputRef}
        proxyRef={proxyRef}
        items={items}
        history={history}
        onAdd={(name, section, note) => {
          const dup = findOpenDuplicate(items, name);
          if (dup) {
            highlight(dup.id);
            showToast(`「${dup.name}」はもう入っています`);
          } else {
            actions.add(name, section, note, me);
            // 絞っているお店と違う物を足したら、足した物が見えるよう全部に戻す
            if (shown && section !== shown) setStore(null);
          }
          return true;
        }}
        onQuickAdd={(h) => {
          const id = actions.add(h.name, h.section, "", me);
          if (shown && h.section !== shown) setStore(null);
          showToast(`「${h.name}」を足しました`, {
            label: "取り消す",
            run: () => actions.remove([{ id } as Item]),
          });
        }}
      />

      {editing && (
        <EditDialog
          item={items.find((i) => i.id === editing.id) ?? editing}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            actions.edit(editing, next);
            setEditing(null);
          }}
          onDelete={() => {
            const target = items.find((i) => i.id === editing.id) ?? editing;
            setEditing(null);
            removeWithUndo([target], `「${target.name}」を消しました`);
          }}
        />
      )}

      {menuOpen && (
        <MenuDialog
          me={me}
          onMe={onMe}
          history={history}
          onForget={(h) => actions.forgetHistory(h)}
          onClose={() => setMenuOpen(false)}
          onToast={showToast}
        />
      )}

      <div className="toast-area" aria-live="polite">
        {error && <Toast key={`error-${error.id}`} toast={error} onDone={clearError} />}
        {toast && <Toast key={toast.id} toast={toast} onDone={clearToast} />}
      </div>
    </div>
  );
}

/** 左になぞったときに出すボタンの幅の合計 */
const SWIPE_W = 144;

function ItemRow({
  item,
  leaving,
  flash,
  swiped,
  onSwipe,
  onCheck,
  onEdit,
  onDelete,
}: {
  item: Item;
  leaving: boolean;
  flash: boolean;
  swiped: boolean;
  onSwipe: (open: boolean) => void;
  onCheck: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const checked = item.checked || leaving;
  const rowRef = useRef<HTMLDivElement>(null);
  const gesture = useRef({ id: -1, x: 0, y: 0, base: 0, offset: 0, mode: "idle" as "idle" | "pending" | "drag", eatClick: false });

  const place = (x: number, animate: boolean) => {
    const el = rowRef.current;
    if (!el) return;
    el.classList.toggle("dragging", !animate);
    el.style.transform = x ? `translateX(${x}px)` : "";
  };
  useEffect(() => {
    if (gesture.current.mode !== "drag") place(swiped ? -SWIPE_W : 0, true);
  }, [swiped]);

  const onPointerDown = (e: React.PointerEvent) => {
    const g = gesture.current;
    g.eatClick = false;
    if (leaving || (e.pointerType === "mouse" && e.button !== 0)) return;
    Object.assign(g, { id: e.pointerId, x: e.clientX, y: e.clientY, base: swiped ? -SWIPE_W : 0, mode: "pending" });
    g.offset = g.base;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (e.pointerId !== g.id || g.mode === "idle") return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (g.mode === "pending") {
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
        g.mode = "idle"; // 縦になぞった＝スクロール
        return;
      }
      if (Math.abs(dx) <= 8) return;
      g.mode = "drag";
      rowRef.current?.setPointerCapture(e.pointerId);
    }
    let x = Math.min(0, g.base + dx);
    if (x < -SWIPE_W) x = -SWIPE_W + (x + SWIPE_W) / 3; // 出しきったあとは重くする
    g.offset = x;
    place(x, false);
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (e.pointerId !== g.id) return;
    const wasDrag = g.mode === "drag";
    g.mode = "idle";
    g.id = -1;
    if (wasDrag) {
      // なぞったあとの「押した」は行の中のボタンに渡さない
      g.eatClick = true;
      const open = g.offset < -SWIPE_W / 2;
      place(open ? -SWIPE_W : 0, true);
      if (open !== swiped) onSwipe(open);
    } else if (swiped && e.type === "pointerup") {
      // 開いている行を押したら、閉じるだけにする
      g.eatClick = true;
      onSwipe(false);
    }
  };

  return (
    <li id={`item-${item.id}`} className={`item-wrap${leaving ? " leaving" : ""}`}>
      <div className="swipe">
        <div className="swipe-actions" aria-hidden={!swiped}>
          <button
            type="button"
            className="swipe-edit"
            tabIndex={swiped ? 0 : -1}
            onClick={() => {
              onSwipe(false);
              onEdit();
            }}
          >
            直す
          </button>
          <button
            type="button"
            className="swipe-delete"
            tabIndex={swiped ? 0 : -1}
            onClick={() => {
              onSwipe(false);
              onDelete();
            }}
          >
            消す
          </button>
        </div>
        <div
          ref={rowRef}
          className={`item${checked ? " checked" : ""}${flash ? " flash" : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onClickCapture={(e) => {
            if (!gesture.current.eatClick) return;
            gesture.current.eatClick = false;
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <button
            className="check"
            type="button"
            role="checkbox"
            aria-checked={checked}
            aria-label={item.name}
            onClick={onCheck}
            disabled={leaving}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="M7 12.5l3.2 3.2L17 9" />
            </svg>
          </button>
          <button className="item-body" type="button" onClick={onEdit} aria-label={`${item.name}を直す`}>
            <span className="name">{item.name}</span>
            {item.note && <span className="note">{item.note}</span>}
          </button>
          {item.addedBy && <span className={`who who-${personColor(item.addedBy)}`}>{item.addedBy}</span>}
        </div>
      </div>
    </li>
  );
}

/* ---------- 足す欄 ---------- */

function Adder({
  inputRef,
  proxyRef,
  items,
  history,
  onAdd,
  onQuickAdd,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  proxyRef: React.RefObject<HTMLInputElement | null>;
  items: Item[];
  history: HistoryEntry[];
  onAdd: (name: string, section: Section, note: string) => boolean;
  onQuickAdd: (h: HistoryEntry) => void;
}) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Section | null>(null);
  const [focused, setFocused] = useState(false);
  const [picking, setPicking] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // お店を選んだあと、さっきまで打っていた欄へ戻す
  const lastFieldRef = useRef<HTMLInputElement | null>(null);
  useKeyboardFirst(formRef, proxyRef);

  const cleaned = cleanName(name);
  const section = picked ?? (cleaned ? guessSection(cleaned, history) : "その他");
  const chips = suggestions(history, items, name);
  const showPicker = picking && focused && !!cleaned;

  // お店のボタンを押しても入力欄からフォーカスを外さない（キーボードを閉じさせない）
  const keepFocus = (e: React.PointerEvent | React.MouseEvent) => {
    if (lastFieldRef.current && document.activeElement === lastFieldRef.current) e.preventDefault();
  };
  const backToField = () => {
    const f = lastFieldRef.current;
    if (f && document.contains(f) && document.activeElement !== f) f.focus({ preventScroll: true });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!cleaned) return;
    if (onAdd(cleaned, section, note.normalize("NFKC").trim().slice(0, NOTE_MAX))) {
      setName("");
      setNote("");
      setPicked(null);
      setPicking(false);
    }
    inputRef.current?.focus();
  };

  return (
    <form
      ref={formRef}
      className={`adder${focused ? " open" : ""}`}
      onSubmit={submit}
      onFocus={(e) => {
        setFocused(true);
        if (e.target instanceof HTMLInputElement) lastFieldRef.current = e.target;
      }}
      onBlur={(e) => {
        if (!formRef.current?.contains(e.relatedTarget as Node)) {
          setFocused(false);
          setPicking(false);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") (document.activeElement as HTMLElement | null)?.blur();
      }}
    >
      {/* 一覧は足す欄の外に重ねる（足す欄の大きさが変わると、iPhone は入力中のカーソルを古い位置に描く） */}
      {showPicker && (
        <div id="section-picker" className="section-picker" role="group" aria-label="お店">
          <div className="section-picker-inner">
            {SECTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className="chip"
                aria-pressed={s === section}
                onPointerDown={keepFocus}
                onMouseDown={keepFocus}
                onClick={() => {
                  // 選んでも一覧は閉じない（選び直しやすくする。閉じるのはお店のボタンか、足したとき）
                  setPicked(s);
                  backToField();
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="adder-inner">
        {focused && chips.length > 0 && (
          <div className="chips" role="group" aria-label="よく買う物">
            {chips.map((h) => (
              <button
                key={h.id}
                type="button"
                className="chip"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => {
                  onQuickAdd(h);
                  setName("");
                  setPicked(null);
                  inputRef.current?.focus();
                }}
              >
                ＋ {h.name}
              </button>
            ))}
          </div>
        )}
        <div className="row">
          <label htmlFor="new-name" className="sr-only">
            買う物
          </label>
          <input
            id="new-name"
            ref={inputRef}
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => {
              setName(e.target.value);
              if (!e.target.value) {
                setPicked(null);
                setPicking(false);
              }
            }}
            placeholder="買う物を足す"
            autoComplete="off"
            enterKeyHint="done"
          />
          {/* 押しても入力欄から離れない。離れるとキーボードが閉じて足す欄が下へ動き、指を離す前にボタンが逃げる（2026-11-04 ユーザー指摘） */}
          <button className="btn primary add-btn" type="submit" disabled={!cleaned} onPointerDown={keepFocus} onMouseDown={keepFocus}>
            足す
          </button>
        </div>
        {cleaned && (
          <div className="row extra">
            <button
              type="button"
              className="section-btn"
              aria-label={`お店: ${section}`}
              aria-expanded={showPicker}
              aria-controls="section-picker"
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={() => {
                setPicking((p) => !p);
                backToField();
              }}
            >
              <span>{section}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={showPicker ? "M7 14l5-5 5 5" : "M7 10l5 5 5-5"} />
              </svg>
            </button>
            <label htmlFor="new-note" className="sr-only">
              数量・メモ
            </label>
            <input id="new-note" value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} placeholder="数量・メモ" autoComplete="off" />
          </div>
        )}
      </div>
    </form>
  );
}

/* ---------- ダイアログ ---------- */

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const d = ref.current;
    d?.showModal();
    return () => {
      // 閉じたら開く前の場所へ戻す。その要素が消えていればリストへ
      if (opener && document.contains(opener)) opener.focus();
      else document.querySelector<HTMLElement>(".list-area")?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="dlg-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="sheet-inner">
        <div className="sheet-head">
          <h2 id="dlg-title">{title}</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="閉じる">
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

function EditDialog({
  item,
  onClose,
  onSave,
  onDelete,
}: {
  item: Item;
  onClose: () => void;
  onSave: (next: { name: string; section: Section; note: string }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [section, setSection] = useState<Section>(item.section);
  const [note, setNote] = useState(item.note);
  const cleaned = cleanName(name);
  return (
    <Dialog title="直す" onClose={onClose}>
      <form
        className="fields"
        onSubmit={(e) => {
          e.preventDefault();
          if (cleaned) onSave({ name: cleaned, section, note: note.normalize("NFKC").trim().slice(0, NOTE_MAX) });
        }}
      >
        <label>
          <span>品名</span>
          <input value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </label>
        <label>
          <span>お店</span>
          <select value={section} onChange={(e) => setSection(e.target.value as Section)}>
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>数量・メモ</span>
          <input value={note} maxLength={NOTE_MAX} onChange={(e) => setNote(e.target.value)} autoComplete="off" />
        </label>
        {item.addedBy && <p className="muted">{item.addedBy}が足しました</p>}
        <div className="actions">
          <button className="btn danger" type="button" onClick={onDelete}>
            消す
          </button>
          <button className="btn primary" type="submit" disabled={!cleaned}>
            保存
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function MenuDialog({
  me,
  onMe,
  history,
  onForget,
  onClose,
  onToast,
}: {
  me: string;
  onMe: (v: string) => void;
  history: HistoryEntry[];
  onForget: (h: HistoryEntry) => void;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [name, setName] = useState(me);
  const sorted = [...history].filter((h) => h.count > 0).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"));

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: "ふたりの買い物リスト", url });
        return;
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(url);
      onToast("リンクをコピーしました");
    } catch {
      onToast("コピーできませんでした");
    }
  };

  return (
    <Dialog title="メニュー" onClose={onClose}>
      <div className="fields">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onMe(name);
            onToast("呼び名を変えました");
          }}
        >
          <label>
            <span>あなたの呼び名</span>
            <div className="row">
              <input value={name} maxLength={PERSON_MAX} onChange={(e) => setName(e.target.value)} autoComplete="off" />
              <button className="btn" type="submit" disabled={name.trim() === me}>
                変える
              </button>
            </div>
          </label>
        </form>

        <button className="btn wide" type="button" onClick={share}>
          一緒に使う人へリンクを送る
        </button>

        <details className="fold">
          <summary>ホーム画面に置くには</summary>
          <ol className="steps">
            <li>このページを Safari で開く（LINE で開いたときは右下のメニューから「Safari で開く」）</li>
            <li>下の共有ボタンを押す</li>
            <li>「ホーム画面に追加」を選ぶ</li>
          </ol>
        </details>

        <details className="fold">
          <summary>よく買う物の整理（{sorted.length}）</summary>
          {sorted.length === 0 ? (
            <p className="muted">よく買う物はまだありません</p>
          ) : (
            <ul className="history">
              {sorted.map((h) => (
                <li key={h.id}>
                  <span>{h.name}</span>
                  <span className="muted small">{h.count}回</span>
                  <button
                    className="btn small"
                    type="button"
                    onClick={(e) => {
                      // 消した行のボタンが無くなっても、次の行（無ければ見出し）へ移る
                      const li = e.currentTarget.closest("li");
                      const next = (li?.nextElementSibling ?? li?.previousElementSibling)?.querySelector("button");
                      const summary = e.currentTarget.closest("details")?.querySelector("summary");
                      onForget(h);
                      window.setTimeout(() => (next && document.contains(next) ? next : summary)?.focus(), 0);
                    }}
                    aria-label={`${h.name}を候補から消す`}
                  >
                    消す
                  </button>
                </li>
              ))}
            </ul>
          )}
        </details>
      </div>
    </Dialog>
  );
}

/* ---------- トースト ---------- */

function Toast({ toast, onDone }: { toast: ToastState; onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, toast.action ? 6000 : 3000);
    return () => window.clearTimeout(t);
  }, [toast, onDone]);
  return (
    <div className="toast">
      <span>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action!.run();
            onDone();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

/* ---------- アイコン ---------- */

function Logo({ small = false }: { small?: boolean }) {
  return (
    <svg className={small ? "logo small" : "logo"} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="var(--accent)" />
      <path d="M17 24h30l-3 22a4 4 0 0 1-4 3.5H24A4 4 0 0 1 20 46z" fill="var(--accent-text)" />
      <path d="M25 24a7 7 0 0 1 14 0" fill="none" stroke="var(--accent-text)" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

const MoonIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </svg>
);
const SunIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
  </svg>
);
const MenuIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
