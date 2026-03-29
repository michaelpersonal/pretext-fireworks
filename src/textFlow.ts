/**
 * textFlow.ts — Real-time text reflow using @chenglou/pretext
 *
 * How it works (the "Chika demo" technique, applied to fireworks):
 *
 * 1.  PREPARE (once, when text changes):
 *     `prepareWithSegments(text, font)` pre-measures every word/grapheme via
 *     canvas measureText, returning cached segment widths. This is the slow
 *     part (~5–20ms for a long paragraph) but happens only on text change.
 *
 * 2.  LAYOUT (every animation frame, ~0.5–2ms total):
 *     We iterate through vertical "line slots" top-to-bottom. For each Y row:
 *       a. Query the current set of obstacle rectangles (fireworks canvas + active
 *          particle clusters) to find the widest unoccluded horizontal span.
 *       b. Call `layoutNextLine(prepared, cursor, availableWidth)` to get the
 *          next chunk of text that fits in that span.
 *       c. Position the corresponding DOM <span> at (x, y) for that span.
 *       d. Advance the cursor (line.end) and move to the next row.
 *
 * 3.  RENDER:
 *     Text is rendered as absolutely-positioned DOM <span> elements (NOT on a
 *     canvas), so it remains **fully selectable and copyable** while still
 *     moving in real time around the fireworks.
 *
 * 4.  PERFORMANCE:
 *     - A fixed pool of MAX_SPANS spans is pre-created; no DOM allocation in the
 *       hot path, just textContent + style updates.
 *     - Layout is throttled to ~30 fps (every other animation frame) since the
 *       particle occlusion changes fast but exact per-pixel accuracy isn't needed.
 *     - Unused spans are hidden with display:none (not removed).
 */

import {
  prepareWithSegments,
  layoutNextLine,
  type PreparedTextWithSegments,
  type LayoutCursor,
} from '@chenglou/pretext';

import type { Rect } from './particles';

// -----------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------

/** CSS font string must match the Google Fonts import and the Caveat weight */
export const TEXT_FONT = '22px "Caveat", cursive';

/** Vertical line spacing (px) */
const LINE_HEIGHT = 30;

/** Horizontal padding inside each available text segment */
const H_PAD = 10;

/** Minimum segment width worth placing text into */
const MIN_SEG_WIDTH = 100;

/** Pre-allocate this many span elements in the pool */
const MAX_SPANS = 300;

/** Top margin (below the UI bar) and bottom margin */
const MARGIN_TOP = 58;
const MARGIN_BOTTOM = 50;

// -----------------------------------------------------------------------
// Obstacle-aware line-width helpers
// -----------------------------------------------------------------------

/**
 * Given a horizontal band [y, y+lineHeight] and a list of obstacle rects,
 * returns the set of unoccluded horizontal segments in [0, viewportWidth].
 *
 * These segments are the "slots" where a line of text can be placed.
 */
function availableSegments(
  y: number,
  lineHeight: number,
  viewportWidth: number,
  obstacles: Rect[],
): Array<{ x: number; width: number }> {
  // Filter obstacles that overlap the Y band
  const blocking = obstacles.filter(
    o => o.x < viewportWidth && o.x + o.width > 0 && o.y < y + lineHeight && o.y + o.height > y,
  );

  // Build merged X-intervals from overlapping obstacles
  const intervals: Array<[number, number]> = blocking.map(
    o => [Math.max(0, o.x), Math.min(viewportWidth, o.x + o.width)],
  );
  intervals.sort((a, b) => a[0] - b[0]);

  const merged: Array<[number, number]> = [];
  for (const [lo, hi] of intervals) {
    if (merged.length && lo <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], hi);
    } else {
      merged.push([lo, hi]);
    }
  }

  // Gaps between merged intervals are where text can go
  const segs: Array<{ x: number; width: number }> = [];
  let cursor = 0;
  for (const [lo, hi] of merged) {
    if (lo > cursor) segs.push({ x: cursor, width: lo - cursor });
    cursor = hi;
  }
  if (cursor < viewportWidth) segs.push({ x: cursor, width: viewportWidth - cursor });

  return segs.filter(s => s.width >= MIN_SEG_WIDTH);
}

// -----------------------------------------------------------------------
// TextFlowEngine
// -----------------------------------------------------------------------

export class TextFlowEngine {
  private container: HTMLElement;
  private spans: HTMLSpanElement[] = [];
  private prepared: PreparedTextWithSegments | null = null;

  /** Skip a frame flag for 30fps throttling */
  private skipFrame = false;

  /** Cached line layout — only rebuild when dirty or obstacles change significantly */
  private linesDirty = true;

  constructor(container: HTMLElement) {
    this.container = container;
    this._buildSpanPool();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Call once (or when text changes) to re-prepare measurement data. */
  setText(text: string): void {
    // prepareWithSegments is the expensive call (~5–20ms); do it off the hot path.
    this.prepared = prepareWithSegments(text, TEXT_FONT);
    this.linesDirty = true;
  }

  /**
   * Called every animation frame.
   *
   * obstacles — Rect[] in viewport (CSS pixel) coordinates describing areas
   *             that text must avoid. Typically: the fireworks canvas rect +
   *             the current particle-cluster bounding rect.
   *
   * viewportWidth / viewportHeight — current window dimensions.
   */
  layout(
    obstacles: Rect[],
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    if (!this.prepared) return;

    // Throttle to ~30fps: skip every other frame unless text is dirty.
    // Particle positions change fast, but at 30fps the reflow still looks live.
    this.skipFrame = !this.skipFrame;
    if (this.skipFrame && !this.linesDirty) return;
    this.linesDirty = false;

    // -------------------------------------------------------------------
    // Walk line slots top → bottom, asking pretext how much text fits in
    // each available horizontal segment.
    // -------------------------------------------------------------------
    let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
    let spanIdx = 0;
    let y = MARGIN_TOP;
    const bottom = viewportHeight - MARGIN_BOTTOM;

    while (y < bottom && spanIdx < this.spans.length) {
      const segs = availableSegments(y, LINE_HEIGHT, viewportWidth, obstacles);

      if (segs.length === 0) {
        // Entire row is blocked — skip the row without advancing the text cursor.
        y += LINE_HEIGHT;
        continue;
      }

      // Pick the widest available segment for this line.
      const seg = segs.reduce((best, s) => (s.width > best.width ? s : best));
      const usableWidth = seg.width - H_PAD * 2;

      if (usableWidth < MIN_SEG_WIDTH) {
        y += LINE_HEIGHT;
        continue;
      }

      // Ask pretext: "starting at `cursor`, how much text fits in `usableWidth`?"
      // This is pure arithmetic on cached segment widths — ~0.003ms per call.
      const line = layoutNextLine(this.prepared, cursor, usableWidth);

      if (!line) break; // All text has been placed.

      // Update the pre-allocated span (no DOM allocation!)
      const span = this.spans[spanIdx];
      span.textContent = line.text;
      span.style.left = `${seg.x + H_PAD}px`;
      span.style.top = `${y}px`;
      span.style.display = '';

      // Advance pretext cursor to the start of the next line.
      cursor = line.end;
      y += LINE_HEIGHT;
      spanIdx++;
    }

    // Hide any leftover spans from the previous frame.
    for (let i = spanIdx; i < this.spans.length; i++) {
      this.spans[i].style.display = 'none';
    }
  }

  /** Force a layout rebuild on the next frame (e.g. after window resize). */
  markDirty(): void {
    this.linesDirty = true;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Pre-create MAX_SPANS spans and add them to the container (hidden). */
  private _buildSpanPool(): void {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < MAX_SPANS; i++) {
      const span = document.createElement('span');
      span.style.display = 'none';
      frag.appendChild(span);
      this.spans.push(span);
    }
    this.container.appendChild(frag);
  }
}
