/**
 * textFlow.ts — Real-time two-column book layout using @chenglou/pretext
 *
 * Layout model:
 *   The viewport is treated as an open book: two pages side by side with a
 *   centre spine gutter. Text flows down the LEFT page, then continues onto
 *   the RIGHT page — exactly like reading a physical book.
 *
 * How real-time reflow works:
 *
 * 1. PREPARE (once per text change, ~5–20 ms):
 *    `prepareWithSegments(text, font)` segments the text and measures every
 *    word via canvas.measureText, building a cache of segment widths.
 *
 * 2. LAYOUT (every frame, ~0.5–2 ms total):
 *    For each column, we walk Y rows top → bottom. Per row we:
 *      a. Compute the available width within that column, minus any explosion
 *         occlusion rects that intersect this Y band at this column's X range.
 *      b. Call `layoutNextLine(prepared, cursor, availableWidth)` — pure
 *         arithmetic on the cached widths, no DOM access, ~0.003 ms/call.
 *      c. Write the resulting text + x/y into a pre-allocated DOM <span>.
 *      d. Advance the shared text cursor to `line.end` and move to next row.
 *    After filling the left column the cursor continues into the right column.
 *
 * 3. RENDER:
 *    Text lives in absolutely-positioned DOM <span> elements so it stays
 *    fully selectable and copyable while dynamically repositioning every frame.
 */

import {
  prepareWithSegments,
  layoutNextLine,
  type PreparedTextWithSegments,
  type LayoutCursor,
} from '@chenglou/pretext';

import type { Rect } from './particles';

// ─── Layout constants ──────────────────────────────────────────────────────

/** Must match the @font-face / Google Fonts import exactly */
export const TEXT_FONT = '17px "IM Fell English", serif';

const LINE_HEIGHT  = 26;   // px between baselines
const H_PAD        = 16;   // inner horizontal padding per column
const MIN_COL_W    = 120;  // narrowest usable column (px)
const PAGE_MARGIN  = 48;   // left / right outer page margin
const GUTTER       = 72;   // centre spine gutter width
const MARGIN_TOP   = 148;  // below top bar + book title banner + "We The People" header
const MARGIN_BOTTOM = 44;  // above bottom edge
const MAX_SPANS    = 400;

// ─── Column geometry ───────────────────────────────────────────────────────

interface Column { x: number; width: number }

/**
 * Returns the two column definitions for the current viewport.
 * On narrow screens (mobile) falls back to a single column.
 */
export function getColumns(vw: number): Column[] {
  if (vw < 640) {
    // Single column on mobile
    return [{ x: PAGE_MARGIN, width: vw - PAGE_MARGIN * 2 }];
  }
  const colW = (vw - PAGE_MARGIN * 2 - GUTTER) / 2;
  return [
    { x: PAGE_MARGIN,              width: colW },
    { x: PAGE_MARGIN + colW + GUTTER, width: colW },
  ];
}

/** X coordinate of the centre spine (used by the column-rule element) */
export function spineX(vw: number): number {
  const colW = (vw - PAGE_MARGIN * 2 - GUTTER) / 2;
  return PAGE_MARGIN + colW + GUTTER / 2;
}

// ─── Per-column occlusion helper ───────────────────────────────────────────

/**
 * Given a column rect and a list of explosion-occlusion rects, returns the
 * available { x, width } for a text line at `y` within that column.
 *
 * Strategy: find the largest unblocked horizontal run inside the column.
 */
function columnAvail(
  y: number,
  col: Column,
  obstacles: Rect[],
): { x: number; width: number } | null {
  const colRight = col.x + col.width;

  // Obstacles that overlap this Y row AND this column's X range
  const blocking = obstacles.filter(o =>
    o.y < y + LINE_HEIGHT && o.y + o.height > y &&
    o.x < colRight         && o.x + o.width  > col.x,
  );

  if (blocking.length === 0) {
    return { x: col.x, width: col.width };
  }

  // Convert to column-local [lo, hi] intervals
  const ivs: [number, number][] = blocking
    .map(o => [Math.max(0, o.x - col.x), Math.min(col.width, o.x + o.width - col.x)] as [number, number])
    .filter(([lo, hi]) => lo < hi);

  ivs.sort((a, b) => a[0] - b[0]);

  // Merge overlapping intervals
  const merged: [number, number][] = [];
  for (const [lo, hi] of ivs) {
    if (merged.length && lo <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], hi);
    } else {
      merged.push([lo, hi]);
    }
  }

  // Collect gaps (unblocked segments)
  const gaps: { x: number; width: number }[] = [];
  let cur = 0;
  for (const [lo, hi] of merged) {
    if (lo > cur) gaps.push({ x: col.x + cur, width: lo - cur });
    cur = hi;
  }
  if (cur < col.width) gaps.push({ x: col.x + cur, width: col.width - cur });

  if (gaps.length === 0) return null;
  // Return the widest gap
  return gaps.reduce((a, b) => b.width > a.width ? b : a);
}

// ─── TextFlowEngine ────────────────────────────────────────────────────────

export class TextFlowEngine {
  private container: HTMLElement;
  private spans: HTMLSpanElement[] = [];
  private prepared: PreparedTextWithSegments | null = null;
  private linesDirty = true;
  private firstSpanIdx = 0; // index of the first body-text span (after title span)

  constructor(container: HTMLElement) {
    this.container = container;
    this._buildPool();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setText(text: string): void {
    this.prepared    = prepareWithSegments(text, TEXT_FONT);
    this.linesDirty  = true;
  }

  /**
   * Main layout call — invoked every animation frame from main.ts.
   *
   * obstacles  : explosion occlusion rects in viewport-px coordinates
   * vw / vh    : current window dimensions
   */
  layout(obstacles: Rect[], vw: number, vh: number): void {
    if (!this.prepared) return;

    this.linesDirty = false;

    const columns = getColumns(vw);
    const bottom  = vh - MARGIN_BOTTOM;

    // Shared pretext cursor — advances through both columns in reading order
    let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
    let spanIdx = this.firstSpanIdx;
    let textExhausted = false;

    for (const col of columns) {
      if (textExhausted) break;

      let y = MARGIN_TOP;

      while (y < bottom && spanIdx < this.spans.length) {
        const avail = columnAvail(y, col, obstacles);

        if (!avail || avail.width - H_PAD * 2 < MIN_COL_W) {
          // Row blocked — skip row, do NOT advance the text cursor
          y += LINE_HEIGHT;
          continue;
        }

        // Ask pretext: how much text fits in this width?
        const line = layoutNextLine(this.prepared, cursor, avail.width - H_PAD * 2);

        if (!line) { textExhausted = true; break; }

        const span = this.spans[spanIdx];
        span.textContent = line.text;
        span.style.left  = `${avail.x + H_PAD}px`;
        span.style.top   = `${y}px`;
        span.style.display = '';

        cursor = line.end;
        y      += LINE_HEIGHT;
        spanIdx++;
      }
    }

    // Hide leftover spans from previous frame
    for (let i = spanIdx; i < this.spans.length; i++) {
      this.spans[i].style.display = 'none';
    }
  }

  markDirty(): void { this.linesDirty = true; }

  // ── Private ───────────────────────────────────────────────────────────────

  private _buildPool(): void {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < MAX_SPANS; i++) {
      const s = document.createElement('span');
      s.style.display = 'none';
      frag.appendChild(s);
      this.spans.push(s);
    }
    this.container.appendChild(frag);
    this.firstSpanIdx = 0;
  }
}
