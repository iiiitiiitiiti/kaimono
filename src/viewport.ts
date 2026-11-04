/**
 * 見えている範囲（キーボードを除いた部分）の高さと位置を CSS 変数に入れる。
 * iPhone はキーボードが出ても画面全体の高さを変えないので、visualViewport から取る。
 */
export function trackViewport(): void {
  const root = document.documentElement;
  const vv = window.visualViewport;

  const apply = () => {
    const height = vv ? vv.height : window.innerHeight;
    const top = vv ? Math.max(0, vv.offsetTop) : 0;
    root.style.setProperty("--vvh", `${Math.round(height)}px`);
    root.style.setProperty("--vvtop", `${Math.round(top)}px`);
    // 入力欄を使っていて、見えている範囲が画面より大きく縮んでいたら、キーボードが出ているとみなす。
    // 入力欄を外したあとも iPhone の報告値が縮んだまま残ることがあるので、入力欄を使っているかも見る
    const a = document.activeElement;
    const typing = a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement;
    root.toggleAttribute("data-kb", typing && window.innerHeight - height > 120);
  };
  // キーボードが閉じきるまで報告値が変わり続けるので、外したあと何度か読み直す
  const applySoon = () => {
    apply();
    for (const ms of [100, 300, 700]) window.setTimeout(apply, ms);
  };

  // ヘッダーと足す欄はスクロールしない。ここで指を動かしてもページごとずらさせない（よく買う物の横スクロールと、入力欄の中のカーソル移動は残す）
  document.addEventListener(
    "touchmove",
    (e) => {
      const t = e.target;
      if (!(t instanceof Element) || t.closest(".chips, input, textarea, select")) return;
      if (t.closest(".app > .top, .app > .adder")) e.preventDefault();
    },
    { passive: false },
  );

  vv?.addEventListener("resize", apply);
  vv?.addEventListener("scroll", apply);
  window.addEventListener("resize", apply);
  document.addEventListener("focusin", apply);
  document.addEventListener("focusout", applySoon);
  apply();
}
