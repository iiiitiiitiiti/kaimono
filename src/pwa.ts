import { registerSW } from "virtual:pwa-register";

/*
 * 新しい版が届いても、使っている最中には入れ替えない。
 * 画面が裏に回ったときにだけ入れ替えて再読み込みする。
 */
export function setupPwa(): void {
  let waiting = false;
  const updateSW = registerSW({
    onNeedRefresh() {
      waiting = true;
      tryApply();
    },
  });

  function tryApply() {
    if (waiting && document.visibilityState === "hidden") {
      waiting = false;
      void updateSW(true);
    }
  }

  document.addEventListener("visibilitychange", tryApply);
}
