/**
 * main.ts — Gesture Fireworks · Live Text Flow
 *
 * Orchestrates:
 *   • MediaPipe hand tracking (webcam → gesture events)
 *   • ParticleSystem (firework physics + rendering on canvas)
 *   • TextFlowEngine (pretext-based real-time text reflow)
 *   • AudioManager (synthesised sounds + optional background music)
 *
 * Frame pipeline (each requestAnimationFrame):
 *   1. mediapipe.detect(video)           — async hand landmark inference
 *   2. gestureDetector.update(results)   — emit GestureEvents
 *   3. particleSystem.update()           — physics step
 *   4. [canvas] clearRect → dark fill → particles → hand skeleton
 *   5. textFlow.layout(obstacles, w, h)  — pretext reflow (throttled 30fps)
 */

import './style.css';
import { ParticleSystem, type Rect } from './particles';
import { AudioManager } from './audio';
import { CameraManager, HandTracker, GestureDetector, HandRenderer } from './gestures';
import { TextFlowEngine } from './textFlow';

// -----------------------------------------------------------------------
// US Constitution preamble + opening of Article I (default text).
// This is the default text that flows around the fireworks. 250 years!
// -----------------------------------------------------------------------
const DEFAULT_TEXT = `We the People of the United States, in Order to form a more perfect Union, establish Justice, insure domestic Tranquility, provide for the common defence, promote the general Welfare, and secure the Blessings of Liberty to ourselves and our Posterity, do ordain and establish this Constitution for the United States of America.

All legislative Powers herein granted shall be vested in a Congress of the United States, which shall consist of a Senate and House of Representatives. The House of Representatives shall be composed of Members chosen every second Year by the People of the several States, and the Electors in each State shall have the Qualifications requisite for Electors of the most numerous Branch of the State Legislature.

No Person shall be a Representative who shall not have attained to the Age of twenty five Years, and been seven Years a Citizen of the United States, and who shall not, when elected, be an Inhabitant of that State in which he shall be chosen. Representatives and direct Taxes shall be apportioned among the several States which may be included within this Union, according to their respective Numbers.

The Senate of the United States shall be composed of two Senators from each State, chosen by the Legislature thereof, for six Years; and each Senator shall have one Vote. Immediately after they shall be assembled in Consequence of the first Election, they shall be divided as equally as may be into three Classes.

No Person shall be a Senator who shall not have attained to the Age of thirty Years, and been nine Years a Citizen of the United States, and who shall not, when elected, be an Inhabitant of that State for which he shall be chosen. The Vice President of the United States shall be President of the Senate, but shall have no Vote, unless they be equally divided.

Each House shall keep a Journal of its Proceedings, and from time to time publish the same, excepting such Parts as may in their Judgment require Secrecy; and the Yeas and Nays of the Members of either House on any question shall, at the Desire of one fifth of those Present, be entered on the Journal.

The Congress shall have Power To lay and collect Taxes, Duties, Imposts and Excises, to pay the Debts and provide for the common Defence and general Welfare of the United States; but all Duties, Imposts and Excises shall be uniform throughout the United States; To borrow Money on the credit of the United States; To regulate Commerce with foreign Nations, and among the several States, and with the Indian Tribes.

Done in Convention by the Unanimous Consent of the States present the Seventeenth Day of September in the Year of our Lord one thousand seven hundred and Eighty seven and of the Independence of the United States of America the Twelfth. In witness whereof We have hereunto subscribed our Names. — George Washington, President and deputy from Virginia.`;

// -----------------------------------------------------------------------
// App
// -----------------------------------------------------------------------
class App {
  // DOM
  private video      = document.getElementById('video')         as HTMLVideoElement;
  private canvas     = document.getElementById('fireworks-canvas') as HTMLCanvasElement;
  private textLayer  = document.getElementById('text-layer')    as HTMLDivElement;
  private startScrn  = document.getElementById('start-screen')  as HTMLDivElement;
  private startBtn   = document.getElementById('start-btn')     as HTMLButtonElement;
  private editBtn    = document.getElementById('edit-btn')      as HTMLButtonElement;
  private editorPanel = document.getElementById('editor-panel') as HTMLDivElement;
  private textInput  = document.getElementById('text-input')    as HTMLTextAreaElement;
  private resetBtn   = document.getElementById('reset-btn')     as HTMLButtonElement;
  private applyBtn   = document.getElementById('apply-btn')     as HTMLButtonElement;
  private fpsCounter = document.getElementById('fps-counter')   as HTMLSpanElement;
  private errorScrn  = document.getElementById('error-screen')  as HTMLDivElement;
  private errorMsg   = document.getElementById('error-msg')     as HTMLParagraphElement;

  // Core systems
  private ctx        = this.canvas.getContext('2d')!;
  private camera     = new CameraManager(this.video);
  private tracker    = new HandTracker();
  private gestures   = new GestureDetector();
  private renderer   = new HandRenderer(this.canvas, this.video);
  private particles  = new ParticleSystem();
  private audio      = new AudioManager();
  private textFlow   = new TextFlowEngine(this.textLayer);

  // State
  private running    = false;
  private handsData  = null as import('./gestures').HandsResults | null;
  private lastHandsAt = 0;
  private showHint   = false;

  // FPS tracking
  private frameCount = 0;
  private lastFpsTs  = 0;
  private fps        = 60;

  // Hand-status DOM (injected into body)
  private leftIndicator!:  HTMLElement;
  private rightIndicator!: HTMLElement;

  // -----------------------------------------------------------------------
  // Init
  // -----------------------------------------------------------------------
  constructor() {
    this._buildHandStatusUI();
    this._bindEvents();
  }

  private _buildHandStatusUI(): void {
    const el = document.createElement('div');
    el.id = 'hand-status';
    el.innerHTML = `
      <div class="hand-indicator" id="left-ind">
        <span class="charge-dot"></span><span class="hand-label">Left hand</span>
      </div>
      <div class="hand-indicator" id="right-ind">
        <span class="charge-dot"></span><span class="hand-label">Right hand</span>
      </div>`;
    document.body.appendChild(el);
    this.leftIndicator  = document.getElementById('left-ind')!;
    this.rightIndicator = document.getElementById('right-ind')!;
  }

  private _bindEvents(): void {
    this.startBtn.addEventListener('click', () => this._start());

    this.editBtn.addEventListener('click', () => {
      this.editorPanel.classList.remove('hidden');
      this.textInput.value = this.textInput.dataset.current ?? DEFAULT_TEXT;
    });

    this.applyBtn.addEventListener('click', () => {
      const t = this.textInput.value.trim();
      if (t) {
        this.textInput.dataset.current = t;
        this.textFlow.setText(t);
      }
      this.editorPanel.classList.add('hidden');
    });

    this.resetBtn.addEventListener('click', () => {
      this.textInput.value = DEFAULT_TEXT;
    });

    // Close editor on backdrop click
    this.editorPanel.addEventListener('click', (e) => {
      if (e.target === this.editorPanel) this.editorPanel.classList.add('hidden');
    });

    // Keyboard shortcut: Escape closes editor
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.editorPanel.classList.add('hidden');
    });

    window.addEventListener('resize', () => {
      this._resize();
      this.textFlow.markDirty();
    });
  }

  private _resize(): void {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.renderer.resize();
    this.renderer.updateVideoBounds();
  }

  // -----------------------------------------------------------------------
  // Start
  // -----------------------------------------------------------------------
  private async _start(): Promise<void> {
    // Fade out start screen
    this.startScrn.classList.add('fade-out');

    try {
      await this.audio.initialize();
      await this.tracker.initialize();

      this.tracker.onResults((r) => { this.handsData = r; });

      const ok = await this.camera.start();
      if (!ok) {
        this._showError('Camera access denied — please allow and refresh.');
        return;
      }

      this._resize();

      // Wait for Caveat font to load before preparing text (font metrics must be accurate).
      await document.fonts.ready;
      this.textInput.dataset.current = DEFAULT_TEXT;
      this.textFlow.setText(DEFAULT_TEXT);

      this.running = true;
      this.lastHandsAt = Date.now();
      this._loop();
    } catch (err: unknown) {
      this._showError(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private _showError(msg: string): void {
    this.errorMsg.textContent = msg;
    this.errorScrn.classList.remove('hidden');
  }

  // -----------------------------------------------------------------------
  // Main loop
  // -----------------------------------------------------------------------
  private async _loop(): Promise<void> {
    if (!this.running) return;

    // ---- FPS tracking ------------------------------------------------
    const now = Date.now();
    this.frameCount++;
    if (now - this.lastFpsTs >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTs = now;
      this.fpsCounter.textContent = `${this.fps} fps`;
      // Adaptive: reduce particles on slow devices
      if (this.fps < 30) {
        this.particles.maxParticles = Math.max(200, this.particles.maxParticles - 50);
      }
    }

    // ---- Hand detection (async — results arrive via callback) --------
    if (this.video.readyState >= 2) {
      await this.tracker.detect(this.video);
      this.renderer.updateVideoBounds();
    }

    // ---- Gesture → firework events -----------------------------------
    const events = this.gestures.update(this.handsData);
    for (const ev of events) {
      if (ev.type === 'firework') {
        const pos = this.renderer.landmarkToCanvas(ev.position);
        if (ev.hand === 'left') {
          // Left hand pinch → ground rocket
          this.particles.launchGroundRocket(pos.x, this.canvas.height);
          this.audio.playExplosion(0.2);
        } else {
          // Right hand pinch → instant burst at fingertip
          this.particles.createFirework(pos.x, pos.y, ev.charge);
          this.audio.playExplosion(ev.charge);
        }
      } else if (ev.type === 'launch') {
        const pos = this.renderer.landmarkToCanvas(ev.position);
        this.particles.launchGroundRocket(pos.x, this.canvas.height);
        this.audio.playExplosion(0.2);
      }
    }

    // ---- Audio charge feedback ---------------------------------------
    this._updateChargeAudio();

    // ---- Physics step ------------------------------------------------
    this.particles.update();

    // ---- Canvas render -----------------------------------------------
    this._drawCanvas();

    // ---- Text reflow (pretext) ---------------------------------------
    //
    // Build the obstacle list for this frame:
    //   • Particle occlusion rect — bounding box of all bright active particles
    //     (in canvas / viewport coordinates, since canvas is full-screen)
    //
    // The text layer (z-index 1, below the canvas) re-lays out so no text
    // appears where particles are glowing.
    //
    const obstacles: Rect[] = this.particles.getOcclusionRects();
    this.textFlow.layout(obstacles, window.innerWidth, window.innerHeight);

    // ---- Hints -------------------------------------------------------
    this._checkHint();

    requestAnimationFrame(() => this._loop());
  }

  // -----------------------------------------------------------------------
  // Canvas rendering
  // -----------------------------------------------------------------------
  private _drawCanvas(): void {
    const { canvas, ctx } = this;

    // Semi-transparent dark fill creates motion-blur / fading trails effect.
    // Lower alpha = longer trails (slower fade). 0.18 gives nice comet tails.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(3, 2, 10, 0.18)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw fireworks particles (additive blending done inside particles.draw)
    this.particles.draw(ctx);

    // Draw hand skeleton overlays
    if (this.handsData?.multiHandLandmarks) {
      for (let i = 0; i < this.handsData.multiHandLandmarks.length; i++) {
        const lm   = this.handsData.multiHandLandmarks[i];
        const wristX  = lm[0].x;
        const isLeft  = wristX > 0.5;
        const state   = this.gestures[isLeft ? 'leftHand' : 'rightHand'];
        this.renderer.drawHandSkeleton(lm, isLeft, state.charge * 100);
        this.renderer.drawPinchIndicator(lm[4], lm[8], state.charging);
      }
    }

    if (this.showHint) this.renderer.drawHint('👋 Show your hands to the camera');
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------
  private _updateChargeAudio(): void {
    const updateHand = (charging: boolean, charge: number, id: string) => {
      if (charging) {
        this.audio.playCharge(id);
        this.audio.updateChargeIntensity(id, charge);
      } else {
        this.audio.stopCharge(id);
      }
    };
    updateHand(this.gestures.leftHand.charging, this.gestures.leftHand.charge, 'left');
    updateHand(this.gestures.rightHand.charging, this.gestures.rightHand.charge, 'right');

    // Update bottom status indicators
    this._updateHandIndicator(this.leftIndicator, this.gestures.leftHand.charging, this.gestures.leftHand.charge, 'Left hand');
    this._updateHandIndicator(this.rightIndicator, this.gestures.rightHand.charging, this.gestures.rightHand.charge, 'Right hand');
  }

  private _updateHandIndicator(el: HTMLElement, charging: boolean, charge: number, label: string): void {
    const lbl = el.querySelector('.hand-label') as HTMLSpanElement;
    if (charging) {
      el.classList.add('charging');
      if (lbl) lbl.textContent = `${label} ${Math.round(charge * 100)}%`;
    } else {
      el.classList.remove('charging');
      if (lbl) lbl.textContent = label;
    }
  }

  private _checkHint(): void {
    const hasHands = (this.handsData?.multiHandLandmarks?.length ?? 0) > 0;
    if (hasHands) {
      this.lastHandsAt = Date.now();
      this.showHint = false;
    } else if (Date.now() - this.lastHandsAt > 3000) {
      this.showHint = true;
    }
  }
}

// Boot
new App();
