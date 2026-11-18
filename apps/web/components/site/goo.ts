/**
 * A selector that moves like a drop of ink. The shape is a layer clipped to the selected item
 * (`.goo`: `clip-path: inset(0 var(--goo-r) 0 var(--goo-l))`), and its two edges are separate
 * registered custom properties with their own transitions: the edge in the direction of travel
 * leads with a quick overshoot, the other follows a beat later with a bounce, so the drop stretches
 * toward its target and squashes as it lands. CSS transitions re-target from the current value, so
 * a quick run over several items never jumps. Because the layer is clipped rather than moved, a
 * copy of the labels inside it can be drawn in the inverse colour and the colour change follows
 * the edge exactly (see `.goo` rules in `app/styles/chrome.css`).
 */

/** Read a goo edge in px (NaN if never set). */
function edge(el: HTMLElement, name: "--goo-l" | "--goo-r"): number {
  return Number.parseFloat(el.style.getPropertyValue(name));
}

/**
 * Move the drop on `el` so it covers from `left` px to `right` px in from the right edge.
 * `instant` (or a first placement) sets it with no motion.
 */
export function gooTo(el: HTMLElement, left: number, right: number, instant = false): void {
  const prevL = edge(el, "--goo-l");
  const prevR = edge(el, "--goo-r");
  if (instant || Number.isNaN(prevL) || Number.isNaN(prevR)) {
    el.dataset.goo = "none";
    el.style.setProperty("--goo-l", `${left}px`);
    el.style.setProperty("--goo-r", `${right}px`);
    // Commit the jump before a later call turns the transitions back on.
    void getComputedStyle(el).getPropertyValue("--goo-l");
    return;
  }
  if (left === prevL && right === prevR) return;
  // Travelling right means the right edge leads; travelling left, the left one.
  const towardRight = left > prevL || (left === prevL && right < prevR);
  el.dataset.goo = towardRight ? "right" : "left";
  el.style.setProperty("--goo-l", `${left}px`);
  el.style.setProperty("--goo-r", `${right}px`);
}
