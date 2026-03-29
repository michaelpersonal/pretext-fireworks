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
import { TextFlowEngine, getColumns, spineX } from './textFlow';

// -----------------------------------------------------------------------
// US Constitution preamble + opening of Article I (default text).
// This is the default text that flows around the fireworks. 250 years!
// -----------------------------------------------------------------------
// The "We the People" preamble is displayed as a large decorative header above
// the pretext-managed columns. The text below starts from Article I.
const DEFAULT_TEXT = `in Order to form a more perfect Union, establish Justice, insure domestic Tranquility, provide for the common defence, promote the general Welfare, and secure the Blessings of Liberty to ourselves and our Posterity, do ordain and establish this Constitution for the United States of America.

Article the First. All legislative Powers herein granted shall be vested in a Congress of the United States, which shall consist of a Senate and House of Representatives. The House of Representatives shall be composed of Members chosen every second Year by the People of the several States, and the Electors in each State shall have the Qualifications requisite for Electors of the most numerous Branch of the State Legislature. No Person shall be a Representative who shall not have attained to the Age of twenty five Years, and been seven Years a Citizen of the United States, and who shall not, when elected, be an Inhabitant of that State in which he shall be chosen. Representatives and direct Taxes shall be apportioned among the several States which may be included within this Union, according to their respective Numbers, which shall be determined by adding to the whole Number of free Persons, including those bound to Service for a Term of Years, and excluding Indians not taxed, three fifths of all other Persons.

The actual Enumeration shall be made within three Years after the first Meeting of the Congress of the United States, and within every subsequent Term of ten Years, in such Manner as they shall by Law direct. The Number of Representatives shall not exceed one for every thirty Thousand, but each State shall have at Least one Representative. The Senate of the United States shall be composed of two Senators from each State, chosen by the Legislature thereof, for six Years; and each Senator shall have one Vote. Immediately after they shall be assembled in Consequence of the first Election, they shall be divided as equally as may be into three Classes.

No Person shall be a Senator who shall not have attained to the Age of thirty Years, and been nine Years a Citizen of the United States, and who shall not, when elected, be an Inhabitant of that State for which he shall be chosen. The Vice President of the United States shall be President of the Senate, but shall have no Vote, unless they be equally divided. The Senate shall have the sole Power to try all Impeachments. When sitting for that Purpose, they shall be on Oath or Affirmation. When the President of the United States is tried, the Chief Justice shall preside: And no Person shall be convicted without the Concurrence of two thirds of the Members present.

Each House shall keep a Journal of its Proceedings, and from time to time publish the same, excepting such Parts as may in their Judgment require Secrecy; and the Yeas and Nays of the Members of either House on any question shall, at the Desire of one fifth of those Present, be entered on the Journal. Neither House, during the Session of Congress, shall, without the Consent of the other, adjourn for more than three days, nor to any other Place than that in which the two Houses shall be sitting.

The Congress shall have Power To lay and collect Taxes, Duties, Imposts and Excises, to pay the Debts and provide for the common Defence and general Welfare of the United States; but all Duties, Imposts and Excises shall be uniform throughout the United States; To borrow Money on the credit of the United States; To regulate Commerce with foreign Nations, and among the several States, and with the Indian Tribes; To establish an uniform Rule of Naturalization, and uniform Laws on the subject of Bankruptcies throughout the United States; To coin Money, regulate the Value thereof, and of foreign Coin, and fix the Standard of Weights and Measures; To provide for the Punishment of counterfeiting the Securities and current Coin of the United States; To establish Post Offices and post Roads; To promote the Progress of Science and useful Arts, by securing for limited Times to Authors and Inventors the exclusive Right to their respective Writings and Discoveries; To constitute Tribunals inferior to the supreme Court; To define and punish Piracies and Felonies committed on the high Seas, and Offences against the Law of Nations; To declare War, grant Letters of Marque and Reprisal, and make Rules concerning Captures on Land and Water.

Article the Second. The executive Power shall be vested in a President of the United States of America. He shall hold his Office during the Term of four Years, and, together with the Vice President, chosen for the same Term, be elected as follows: Each State shall appoint, in such Manner as the Legislature thereof may direct, a Number of Electors, equal to the whole Number of Senators and Representatives to which the State may be entitled in the Congress. No Senator or Representative, or Person holding an Office of Trust or Profit under the United States, shall be appointed an Elector. The President shall be Commander in Chief of the Army and Navy of the United States, and of the Militia of the several States, when called into the actual Service of the United States; he may require the Opinion, in writing, of the principal Officer in each of the executive Departments, upon any Subject relating to the Duties of their respective Offices, and he shall have Power to grant Reprieves and Pardons for Offences against the United States, except in Cases of Impeachment.

He shall have Power, by and with the Advice and Consent of the Senate, to make Treaties, provided two thirds of the Senators present concur; and he shall nominate, and by and with the Advice and Consent of the Senate, shall appoint Ambassadors, other public Ministers and Consuls, Judges of the supreme Court, and all other Officers of the United States, whose Appointments are not herein otherwise provided for, and which shall be established by Law.

Article the Third. The judicial Power of the United States, shall be vested in one supreme Court, and in such inferior Courts as the Congress may from time to time ordain and establish. The Judges, both of the supreme and inferior Courts, shall hold their Offices during good Behaviour, and shall, at stated Times, receive for their Services, a Compensation, which shall not be diminished during their Continuance in Office. The judicial Power shall extend to all Cases, in Law and Equity, arising under this Constitution, the Laws of the United States, and Treaties made, or which shall be made, under their Authority; to all Cases affecting Ambassadors, other public Ministers and Consuls; to all Cases of admiralty and maritime Jurisdiction; to Controversies to which the United States shall be a Party; to Controversies between two or more States.

The Trial of all Crimes, except in Cases of Impeachment, shall be by Jury; and such Trial shall be held in the State where the said Crimes shall have been committed; but when not committed within any State, the Trial shall be at such Place or Places as the Congress may by Law have directed. Treason against the United States, shall consist only in levying War against them, or in adhering to their Enemies, giving them Aid and Comfort.

Amendment the First. Congress shall make no law respecting an establishment of religion, or prohibiting the free exercise thereof; or abridging the freedom of speech, or of the press; or the right of the people peaceably to assemble, and to petition the Government for a redress of grievances.

Amendment the Second. A well regulated Militia, being necessary to the security of a free State, the right of the people to keep and bear Arms, shall not be infringed.

Amendment the Third. No Soldier shall, in time of peace be quartered in any house, without the consent of the Owner, nor in time of war, but in a manner to be prescribed by law.

Amendment the Fourth. The right of the people to be secure in their persons, houses, papers, and effects, against unreasonable searches and seizures, shall not be violated, and no Warrants shall issue, but upon probable cause, supported by Oath or affirmation, and particularly describing the place to be searched, and the persons or things to be seized.

Amendment the Fifth. No person shall be held to answer for a capital, or otherwise infamous crime, unless on a presentment or indictment of a Grand Jury, except in cases arising in the land or naval forces, or in the Militia, when in actual service in time of War or public danger; nor shall any person be subject for the same offence to be twice put in jeopardy of life or limb; nor shall be compelled in any criminal case to be a witness against himself, nor be deprived of life, liberty, or property, without due process of law; nor shall private property be taken for public use, without just compensation.

Amendment the Sixth. In all criminal prosecutions, the accused shall enjoy the right to a speedy and public trial, by an impartial jury of the State and district wherein the crime shall have been committed, which district shall have been previously ascertained by law, and to be informed of the nature and cause of the accusation; to be confronted with the witnesses against him; to have compulsory process for obtaining witnesses in his favor, and to have the Assistance of Counsel for his defence.

Amendment the Seventh. In Suits at common law, where the value in controversy shall exceed twenty dollars, the right of trial by jury shall be preserved, and no fact tried by a jury, shall be otherwise re-examined in any Court of the United States, than according to the rules of the common law.

Amendment the Eighth. Excessive bail shall not be required, nor excessive fines imposed, nor cruel and unusual punishments inflicted.

Amendment the Ninth. The enumeration in the Constitution, of certain rights, shall not be construed to deny or disparage others retained by the people.

Amendment the Tenth. The powers not delegated to the United States by the Constitution, nor prohibited by it to the States, are reserved to the States respectively, or to the people.

Done in Convention by the Unanimous Consent of the States present the Seventeenth Day of September in the Year of our Lord one thousand seven hundred and Eighty seven and of the Independance of the United States of America the Twelfth. In witness whereof We have hereunto subscribed our Names. George Washington, President and deputy from Virginia. Delaware: Geo. Read, Gunning Bedford jun., John Dickinson, Richard Bassett, Jaco. Broom. Maryland: James McHenry, Dan of St. Thos. Jenifer, Danl. Carroll. Virginia: John Blair, James Madison Jr. North Carolina: Wm. Blount, Richd. Dobbs Spaight, Hu Williamson. South Carolina: J. Rutledge, Charles Cotesworth Pinckney, Charles Pinckney, Pierce Butler. Georgia: William Few, Abr Baldwin. New Hampshire: John Langdon, Nicholas Gilman. Massachusetts: Nathaniel Gorham, Rufus King. Connecticut: Wm. Saml. Johnson, Roger Sherman. New York: Alexander Hamilton. New Jersey: Wil. Livingston, David Brearley, Wm. Paterson, Jona. Dayton. Pennsylvania: B. Franklin, Thomas Mifflin, Robt. Morris, Geo. Clymer, Thos. FitzSimons, Jared Ingersoll, James Wilson, Gouv. Morris.`;

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
  // Book-chrome DOM elements
  private pageLeft!:    HTMLElement;
  private pageRight!:   HTMLElement;
  private columnRule!:  HTMLElement;

  constructor() {
    this._buildBookChrome();
    this._buildHandStatusUI();
    this._bindEvents();
  }

  private _buildBookChrome(): void {
    // Left & right page panels (parchment overlay)
    this.pageLeft  = document.createElement('div');
    this.pageLeft.id = 'page-left';
    this.pageRight = document.createElement('div');
    this.pageRight.id = 'page-right';
    document.body.appendChild(this.pageLeft);
    document.body.appendChild(this.pageRight);

    // Centre spine column rule
    this.columnRule = document.createElement('div');
    this.columnRule.id = 'column-rule';
    document.body.appendChild(this.columnRule);

    // Book title banner (top bar area)
    const title = document.createElement('div');
    title.id = 'book-title';
    title.innerHTML = `
      <span class="title-main">The Constitution of the United States &nbsp;·&nbsp; MDCCLXXXVII</span>
      <span class="title-rule"></span>`;
    document.body.appendChild(title);

    // "We The People" — large decorative header, sits above the pretext columns
    const wtp = document.createElement('div');
    wtp.id = 'we-the-people';
    wtp.innerHTML = `<span>We the People</span>`;
    document.body.appendChild(wtp);

    this._positionBookChrome();
  }

  private _positionBookChrome(): void {
    const vw = window.innerWidth;
    const cols = getColumns(vw);
    const sx = spineX(vw);
    const wtp = document.getElementById('we-the-people')!;

    if (cols.length === 2) {
      this.pageLeft.style.cssText   = `left:0; width:${sx}px`;
      this.pageRight.style.cssText  = `right:0; width:${vw - sx}px`;
      this.columnRule.style.cssText = `left:${sx}px`;
      this.columnRule.style.display = '';
      // "We The People" spans the full page width
      wtp.style.cssText = `left:${cols[0].x}px; width:${vw - cols[0].x * 2}px`;
    } else {
      this.pageLeft.style.cssText  = `left:0; width:${vw}px`;
      this.pageRight.style.display = 'none';
      this.columnRule.style.display = 'none';
      wtp.style.cssText = `left:${cols[0].x}px; width:${vw - cols[0].x * 2}px`;
    }
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
    this._positionBookChrome();
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
