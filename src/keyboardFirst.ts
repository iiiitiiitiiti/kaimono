import { useEffect, type RefObject } from "react";

const STORE_OFF = "kaimono:keyboard-first-off";

/*
 * iPhone は、画面の下にある入力欄を押すと「キーボードに隠れる」と判断して、
 * キーボードが出る間にページ全体を上へずらす。ずれが終わってから画面を戻すので、
 * ヘッダーが一度消えて戻ってくるように見える。
 *
 * そこで足す欄の入力欄（品名・数量メモ）を指で押したときは、自分でフォーカスを動かす。
 * - キーボードが閉じているとき: まず画面の一番上にある見えない欄でキーボードを出す（上の欄は隠れないので、ずらされない）。
 *   キーボードが出きって画面が縮んだら、押した入力欄へ移す。そのとき入力欄はキーボードのすぐ上にあり、隠れないので、やはりずらされない。
 * - キーボードが出ているとき（品名から数量メモへ移るなど）: ずらさない指定でそのまま移す。
 *
 * 移し替えが効かなかった（キーボードが閉じた）端末では、次からこの仕掛けを使わない。
 */
export function useKeyboardFirst(
  formRef: RefObject<HTMLElement | null>,
  proxyRef: RefObject<HTMLInputElement | null>,
): void {
  useEffect(() => {
    const form = formRef.current;
    const proxy = proxyRef.current;
    const vv = window.visualViewport;
    if (!form || !proxy || !vv) return;

    const isOff = () => {
      try {
        return localStorage.getItem(STORE_OFF) === "1";
      } catch {
        return false;
      }
    };
    const turnOff = () => {
      try {
        localStorage.setItem(STORE_OFF, "1");
      } catch {
        /* 覚えられない環境では毎回試す */
      }
    };
    const keyboardOpen = () => {
      const a = document.activeElement;
      return (
        window.innerHeight - vv.height > 120 ||
        a instanceof HTMLInputElement ||
        a instanceof HTMLTextAreaElement ||
        a instanceof HTMLSelectElement
      );
    };
    // 移したあと、フォーカスが残っていなければ次から使わない
    const focusAndCheck = (target: HTMLInputElement) => {
      target.focus({ preventScroll: true });
      window.setTimeout(() => {
        if (document.activeElement !== target) turnOff();
      }, 80);
    };

    let startX = 0;
    let startY = 0;
    let cancelPending: (() => void) | null = null;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
    };

    const onEnd = (e: TouchEvent) => {
      const target = e.target instanceof Element ? e.target.closest("input") : null;
      if (!target || isOff()) return;
      if (target === document.activeElement) return; // 入力中の欄の中を押した（文字の位置を動かす）
      const t = e.changedTouches[0];
      if (Math.hypot(t.clientX - startX, t.clientY - startY) > 10) return; // 指を滑らせただけ
      e.preventDefault(); // iPhone 自身にはフォーカスさせない

      if (keyboardOpen()) {
        focusAndCheck(target);
        return;
      }

      cancelPending?.();
      proxy.focus({ preventScroll: true });
      let done = false;
      const move = () => {
        if (done) return;
        done = true;
        vv.removeEventListener("resize", onResize);
        window.clearTimeout(timer);
        cancelPending = null;
        if (document.activeElement !== proxy) return; // その間にほかを押した
        focusAndCheck(target);
      };
      const onResize = () => {
        if (window.innerHeight - vv.height > 120) move();
      };
      // 画面の高さは src/viewport.ts が先に縮めている（そちらの resize が先に登録されている）
      vv.addEventListener("resize", onResize);
      // 外付けキーボードなどで画面が縮まないときの逃げ道
      const timer = window.setTimeout(move, 700);
      cancelPending = () => {
        done = true;
        vv.removeEventListener("resize", onResize);
        window.clearTimeout(timer);
      };
    };

    form.addEventListener("touchstart", onStart, { passive: true });
    form.addEventListener("touchend", onEnd, { passive: false });
    return () => {
      cancelPending?.();
      form.removeEventListener("touchstart", onStart);
      form.removeEventListener("touchend", onEnd);
    };
  }, [formRef, proxyRef]);
}
