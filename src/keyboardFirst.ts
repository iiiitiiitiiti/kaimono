import { useEffect, type RefObject } from "react";

const STORE_OFF = "kaimono:keyboard-first-off";

/*
 * iPhone は、画面の下にある入力欄を押すと「キーボードに隠れる」と判断して、
 * キーボードが出る間にページ全体を上へずらす。ずれが終わってから画面を戻すので、
 * ヘッダーが一度消えて戻ってくるように見える。
 *
 * そこで指で押したときは、まず画面の一番上にある見えない欄でキーボードを出す（上の欄は隠れないので、ずらされない）。
 * キーボードが出きって画面が縮んだら、本物の入力欄へ移す。そのとき本物はキーボードのすぐ上にあり、隠れないので、やはりずらされない。
 *
 * 移し替えが効かなかった（キーボードが閉じた）端末では、次からこの仕掛けを使わない。
 */
export function useKeyboardFirst(
  inputRef: RefObject<HTMLInputElement | null>,
  proxyRef: RefObject<HTMLInputElement | null>,
): void {
  useEffect(() => {
    const input = inputRef.current;
    const proxy = proxyRef.current;
    const vv = window.visualViewport;
    if (!input || !proxy || !vv) return;

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

    let startX = 0;
    let startY = 0;
    let cancelPending: (() => void) | null = null;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
    };

    const onEnd = (e: TouchEvent) => {
      if (isOff() || keyboardOpen()) return;
      const t = e.changedTouches[0];
      if (Math.hypot(t.clientX - startX, t.clientY - startY) > 10) return; // 指を滑らせただけ
      e.preventDefault(); // 本物にはまだフォーカスさせない
      proxy.focus({ preventScroll: true });

      let done = false;
      const move = () => {
        if (done) return;
        done = true;
        vv.removeEventListener("resize", onResize);
        window.clearTimeout(timer);
        cancelPending = null;
        if (document.activeElement !== proxy) return; // その間にほかを押した
        input.focus({ preventScroll: true });
        window.setTimeout(() => {
          if (document.activeElement !== input) turnOff();
        }, 80);
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

    input.addEventListener("touchstart", onStart, { passive: true });
    input.addEventListener("touchend", onEnd, { passive: false });
    return () => {
      cancelPending?.();
      input.removeEventListener("touchstart", onStart);
      input.removeEventListener("touchend", onEnd);
    };
  }, [inputRef, proxyRef]);
}
