/**
 * gestures.ts
 *
 * Hand tracking and gesture recognition, ported from gesture-fireworks.
 * Wraps MediaPipe Hands (loaded via CDN) and converts normalized landmark
 * coordinates to canvas pixel coordinates.
 */

// MediaPipe is loaded globally via CDN script tag; declare the shapes we need.
declare const Hands: new (config: { locateFile: (f: string) => string }) => MediaPipeHands;

interface MediaPipeHands {
  setOptions(opts: Record<string, unknown>): void;
  onResults(cb: (r: HandsResults) => void): void;
  initialize(): Promise<void>;
  send(data: { image: HTMLVideoElement }): Promise<void>;
}

export interface Landmark {
  x: number; // 0..1 normalised
  y: number;
  z: number;
}

export interface HandsResults {
  multiHandLandmarks?: Landmark[][];
  multiHandedness?: Array<{ label: string; score: number }>;
}

export interface GestureEvent {
  type: 'firework' | 'launch';
  hand: 'left' | 'right';
  position: Landmark;
  charge: number;
  landmarks: Landmark[];
}

export interface HandState {
  charging: boolean;
  charge: number;
  wasPinching: boolean;
  positionHistory: number[];
  launchCooldown: boolean;
}

// Hand landmark connections for skeleton rendering
const HAND_CONNECTIONS: [number, number][] = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20],
  [5,9],[9,13],[13,17],
];

// -----------------------------------------------------------------
// CameraManager
// -----------------------------------------------------------------
export class CameraManager {
  private video: HTMLVideoElement;
  stream: MediaStream | null = null;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async start(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      return true;
    } catch (e) {
      console.error('[camera] error', e);
      return false;
    }
  }
}

// -----------------------------------------------------------------
// HandTracker
// -----------------------------------------------------------------
export class HandTracker {
  private hands: MediaPipeHands;
  private resultsCallback: ((r: HandsResults) => void) | null = null;

  constructor() {
    this.hands = new Hands({
      locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${f}`,
    });
    this.hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.4,
    });
    this.hands.onResults((r) => this.resultsCallback?.(r));
  }

  async initialize(): Promise<void> {
    await this.hands.initialize();
  }

  async detect(video: HTMLVideoElement): Promise<void> {
    await this.hands.send({ image: video });
  }

  onResults(cb: (r: HandsResults) => void): void {
    this.resultsCallback = cb;
  }
}

// -----------------------------------------------------------------
// GestureDetector
// -----------------------------------------------------------------
export class GestureDetector {
  private readonly PINCH_THRESHOLD = 0.10;
  private readonly CHARGE_RATE = 0.025;
  private readonly MIN_CHARGE = 0.15;
  private readonly SWIPE_VEL_THRESHOLD = 0.025;
  private readonly POS_HISTORY = 5;

  leftHand: HandState = this._freshState();
  rightHand: HandState = this._freshState();

  private _freshState(): HandState {
    return { charging: false, charge: 0, wasPinching: false, positionHistory: [], launchCooldown: false };
  }

  update(data: HandsResults | null): GestureEvent[] {
    const events: GestureEvent[] = [];
    let leftSeen = false, rightSeen = false;

    if (data?.multiHandLandmarks) {
      for (let i = 0; i < data.multiHandLandmarks.length; i++) {
        const lm = data.multiHandLandmarks[i];
        const wristX = lm[0].x;
        const wristY = lm[0].y;
        const isLeft = wristX > 0.5; // mirrored: right side of frame = your left hand
        const state = isLeft ? this.leftHand : this.rightHand;
        if (isLeft) leftSeen = true; else rightSeen = true;

        // Swipe-up detection
        const upVel = this._upwardVelocity(state, wristY);
        if (this._isOpenPalm(lm) && upVel > this.SWIPE_VEL_THRESHOLD && !state.launchCooldown) {
          events.push({ type: 'launch', hand: isLeft ? 'left' : 'right', position: lm[0], charge: 1, landmarks: lm });
          state.launchCooldown = true;
          setTimeout(() => { state.launchCooldown = false; }, 500);
        }

        const pinching = this._pinchDist(lm) < this.PINCH_THRESHOLD;

        if (pinching) {
          state.charging = true;
          state.charge = Math.min(1, state.charge + this.CHARGE_RATE);
        } else if (state.wasPinching && state.charge >= this.MIN_CHARGE) {
          events.push({
            type: 'firework',
            hand: isLeft ? 'left' : 'right',
            position: this._pinchPos(lm),
            charge: state.charge,
            landmarks: lm,
          });
          state.charge = 0;
          state.charging = false;
        } else {
          state.charge = Math.max(0, state.charge - this.CHARGE_RATE * 0.5);
          state.charging = false;
        }

        state.wasPinching = pinching;
      }
    }

    if (!leftSeen) this._resetState(this.leftHand);
    if (!rightSeen) this._resetState(this.rightHand);

    return events;
  }

  private _resetState(s: HandState) {
    s.charging = false; s.charge = 0; s.wasPinching = false; s.positionHistory = [];
  }

  private _pinchDist(lm: Landmark[]): number {
    const t = lm[4], i = lm[8];
    return Math.sqrt((t.x-i.x)**2 + (t.y-i.y)**2 + (t.z-i.z)**2);
  }

  private _pinchPos(lm: Landmark[]): Landmark {
    const t = lm[4], i = lm[8];
    return { x: (t.x+i.x)/2, y: (t.y+i.y)/2, z: (t.z+i.z)/2 };
  }

  private _upwardVelocity(state: HandState, y: number): number {
    state.positionHistory.push(y);
    if (state.positionHistory.length > this.POS_HISTORY) state.positionHistory.shift();
    if (state.positionHistory.length < 2) return 0;
    const oldest = state.positionHistory[0];
    const newest = state.positionHistory[state.positionHistory.length - 1];
    return oldest - newest;
  }

  private _isOpenPalm(lm: Landmark[]): boolean {
    const wrist = lm[0], idx = lm[8], mid = lm[12];
    return idx.y < wrist.y && mid.y < wrist.y && this._pinchDist(lm) > this.PINCH_THRESHOLD * 1.5;
  }
}

// -----------------------------------------------------------------
// Renderer — canvas drawing helpers
// -----------------------------------------------------------------
export class HandRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private video: HTMLVideoElement;
  private videoBounds = { offsetX: 0, offsetY: 0, drawW: 1, drawH: 1 };

  constructor(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.video = video;
  }

  resize(): void {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  /**
   * Convert a normalised MediaPipe landmark to canvas pixel coords.
   * Video is mirrored, so X is flipped.
   */
  landmarkToCanvas(lm: Landmark): { x: number; y: number } {
    const { offsetX, offsetY, drawW, drawH } = this.videoBounds;
    // Mirror X
    const x = this.canvas.width - (offsetX + lm.x * drawW);
    const y = offsetY + lm.y * drawH;
    return { x, y };
  }

  /** Update the cached video-to-canvas mapping (call after resize / on first draw). */
  updateVideoBounds(): void {
    const { videoWidth: vw, videoHeight: vh } = this.video;
    const { width: cw, height: ch } = this.canvas;
    if (!vw || !vh) return;

    const vA = vw / vh;
    const cA = cw / ch;
    let drawW: number, drawH: number, offsetX: number, offsetY: number;
    if (cA > vA) {
      drawW = cw; drawH = cw / vA; offsetX = 0; offsetY = (ch - drawH) / 2;
    } else {
      drawH = ch; drawW = ch * vA; offsetX = (cw - drawW) / 2; offsetY = 0;
    }
    this.videoBounds = { offsetX, offsetY, drawW, drawH };
  }

  drawHandSkeleton(landmarks: Landmark[], isLeft: boolean, chargePercent: number): void {
    const ctx = this.ctx;
    const color = isLeft ? '#ff6b6b' : '#4ecdc4';
    const glow = chargePercent / 100;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    if (glow > 0) { ctx.shadowColor = color; ctx.shadowBlur = 8 + glow * 18; }

    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = this.landmarkToCanvas(landmarks[a]);
      const pb = this.landmarkToCanvas(landmarks[b]);
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }

    for (const lm of landmarks) {
      const p = this.landmarkToCanvas(lm);
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    }

    ctx.shadowBlur = 0;
  }

  drawPinchIndicator(thumb: Landmark, index: Landmark, charging: boolean): void {
    const ctx = this.ctx;
    const tPos = this.landmarkToCanvas(thumb);
    const iPos = this.landmarkToCanvas(index);
    const col = charging ? '#ffd93d' : 'rgba(255,255,255,0.6)';
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.shadowColor = col; ctx.shadowBlur = charging ? 12 : 4;

    ctx.beginPath(); ctx.arc(tPos.x, tPos.y, 14, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(iPos.x, iPos.y, 14, 0, Math.PI * 2); ctx.stroke();

    if (charging) {
      ctx.beginPath(); ctx.moveTo(tPos.x, tPos.y); ctx.lineTo(iPos.x, iPos.y); ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  drawHint(msg: string): void {
    const ctx = this.ctx;
    const x = this.canvas.width / 2;
    const y = this.canvas.height / 2 + 80;
    ctx.save();
    ctx.font = '22px Inter, sans-serif';
    ctx.textAlign = 'center';
    const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 350);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(msg, x, y);
    ctx.restore();
  }
}
