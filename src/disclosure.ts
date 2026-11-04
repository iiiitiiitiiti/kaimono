/**
 * 畳める欄（<details>）の開け閉めに、高さが伸び縮みする動きを付ける。
 * ブラウザ任せだと一瞬で開閉する。iPhone の Safari は CSS だけでは高さを auto まで動かせないので、
 * 見出しが押されたときに開閉を引き取り、Web Animations で高さを動かす。
 * 閉じる間は data-closing を付ける（矢印の向きを先に戻すため。styles.css）。
 */
const DURATION = 260;
const EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
const running = new WeakMap<HTMLDetailsElement, Animation>();

function closedHeight(el: HTMLDetailsElement, summary: HTMLElement): number {
  const s = getComputedStyle(el);
  const extra = ["borderTopWidth", "borderBottomWidth", "paddingTop", "paddingBottom"] as const;
  return summary.getBoundingClientRect().height + extra.reduce((n, k) => n + parseFloat(s[k]), 0);
}

function toggle(el: HTMLDetailsElement, summary: HTMLElement) {
  const from = el.getBoundingClientRect().height;
  const opening = !el.open || el.hasAttribute("data-closing");
  running.get(el)?.cancel();
  el.style.overflow = "hidden";

  let to: number;
  if (opening) {
    el.removeAttribute("data-closing");
    el.open = true;
    to = el.getBoundingClientRect().height;
  } else {
    el.setAttribute("data-closing", "");
    to = closedHeight(el, summary);
  }

  const anim = el.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: DURATION, easing: EASING });
  running.set(el, anim);
  anim.onfinish = () => {
    if (running.get(el) !== anim) return;
    running.delete(el);
    if (!opening) {
      el.open = false;
      el.removeAttribute("data-closing");
    }
    el.style.overflow = "";
  };
}

export function animateDisclosures() {
  document.addEventListener("click", (e) => {
    if (!(e.target instanceof Element)) return;
    const summary = e.target.closest("summary");
    const el = summary?.parentElement;
    if (!summary || !(el instanceof HTMLDetailsElement) || el.querySelector(":scope > summary") !== summary) return;
    e.preventDefault();
    toggle(el, summary);
  });
}
