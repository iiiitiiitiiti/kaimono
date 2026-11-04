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
    // 見えている範囲が画面より大きく縮んでいたら、キーボードが出ているとみなす
    root.toggleAttribute("data-kb", window.innerHeight - height > 120);
  };

  vv?.addEventListener("resize", apply);
  vv?.addEventListener("scroll", apply);
  window.addEventListener("resize", apply);
  apply();
}
