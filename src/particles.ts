/**
 * particles.ts
 *
 * Particle system ported from gesture-fireworks with one key addition:
 * getOcclusionRects() exposes a simplified set of bounding rectangles for
 * all "live" particle clusters. These are passed to the pretext layout engine
 * every frame so the flowing text can reflow around bright fireworks in real time.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RGB { r: number; g: number; b: number }

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  colorRgb: RGB;
  colorHex: string;
  size: number;
  initialSize: number;
  life: number;
  decay: number;
  gravity: number;
  flicker: boolean;
  trail: boolean;
  type: 'main' | 'ring';
}

interface Sparkle {
  x: number; y: number;
  vx: number; vy: number;
  colorRgb: RGB;
  size: number;
  life: number;
  decay: number;
  gravity: number;
}

interface TrailDot {
  x: number; y: number;
  colorRgb: RGB;
  size: number;
  life: number;
  decay: number;
}

interface Rocket {
  x: number; y: number;
  vx: number; vy: number;
  color: string;
  colorRgb: RGB;
  palette: string[];
  size: number;
  life: number;
  explodeHeight: number;
  trail: Array<{ x: number; y: number; life: number }>;
  phase: 'ignition' | 'ascending';
  ignitionTime: number;
}

// Vibrant 8-palette colour system from gesture-fireworks (unmodified)
const PALETTES: string[][] = [
  ['#ffd700', '#ffaa00', '#ff6600', '#ff3300', '#ffffff'],          // Golden Celebration
  ['#00ffff', '#00bfff', '#1e90ff', '#4169e1', '#ffffff'],          // Electric Blue
  ['#ff1493', '#ff69b4', '#ff00ff', '#da70d6', '#ffffff'],          // Pink Paradise
  ['#00ff00', '#32cd32', '#7fff00', '#adff2f', '#ffffff'],          // Green Aurora
  ['#9400d3', '#8a2be2', '#9932cc', '#ba55d3', '#ffffff'],          // Purple Galaxy
  ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#8b00ff'], // Rainbow Burst
  ['#ff4500', '#ff6347', '#ff7f50', '#ffa500', '#ffd700', '#ffffff'], // Fire Storm
  ['#e0ffff', '#b0e0e6', '#87ceeb', '#00ced1', '#ffffff'],          // Ice Crystal
];

const GRAVITY = 0.08;

function hexToRgb(hex: string): RGB {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function rgba(rgb: RGB, a: number): string {
  return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
}

export class ParticleSystem {
  particles: Particle[] = [];
  private sparkles: Sparkle[] = [];
  private trails: TrailDot[] = [];
  rockets: Rocket[] = [];
  maxParticles = 2000;

  // -----------------------------------------------------------------
  // Public API for gesture-fireworks compatibility
  // -----------------------------------------------------------------

  launchGroundRocket(targetX: number, canvasHeight: number): void {
    const palette = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    const colorHex = palette[Math.floor(Math.random() * palette.length)];
    const startX = targetX + (Math.random() - 0.5) * 100;
    const explodeY = 100 + Math.random() * (canvasHeight * 0.3);

    this.rockets.push({
      x: startX,
      y: canvasHeight - 20,
      vx: (Math.random() - 0.5) * 1.5,
      vy: -14 - Math.random() * 4,
      color: colorHex,
      colorRgb: hexToRgb(colorHex),
      palette,
      size: 5,
      life: 1,
      explodeHeight: explodeY,
      trail: [],
      phase: 'ignition',
      ignitionTime: 30,
    });

    this._createIgnitionSparks(startX, canvasHeight - 20, colorHex);
  }

  createFirework(x: number, y: number, charge: number, customPalette?: string[]): void {
    const palette = customPalette ?? PALETTES[Math.floor(Math.random() * PALETTES.length)];
    const mainCount = Math.floor(200 + charge * 200);
    const baseSpeed = 12 + charge * 15;

    // Main burst
    for (let i = 0; i < mainCount; i++) {
      if (this.particles.length >= this.maxParticles) break;
      const angle = (Math.PI * 2 * i) / mainCount + (Math.random() - 0.5) * 1.2;
      const speed = baseSpeed * (0.3 + Math.random() * 0.7);
      const colorHex = palette[Math.floor(Math.random() * palette.length)];
      const sz = 5 + Math.random() * 8;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        colorRgb: hexToRgb(colorHex),
        colorHex,
        size: sz, initialSize: sz,
        life: 1,
        decay: 0.006 + Math.random() * 0.008,
        gravity: GRAVITY * (0.5 + Math.random() * 0.5),
        flicker: Math.random() > 0.7,
        trail: Math.random() > 0.5,
        type: 'main',
      });
    }

    // White sparkles
    const sparkleCount = Math.floor(100 + charge * 100);
    for (let i = 0; i < sparkleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (baseSpeed * 0.5) * (0.5 + Math.random() * 0.5);
      this.sparkles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        colorRgb: { r: 255, g: 255, b: 255 },
        size: 2 + Math.random() * 3,
        life: 1,
        decay: 0.02 + Math.random() * 0.03,
        gravity: GRAVITY * 0.3,
      });
    }

    // Glitter ring
    const ringCount = Math.floor(50 + charge * 50);
    const ringSpeed = baseSpeed * 1.3;
    for (let i = 0; i < ringCount; i++) {
      if (this.particles.length >= this.maxParticles) break;
      const angle = (Math.PI * 2 * i) / ringCount;
      const colorHex = palette[Math.floor(Math.random() * palette.length)];
      const sz = 3 + Math.random() * 4;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * ringSpeed,
        vy: Math.sin(angle) * ringSpeed,
        colorRgb: hexToRgb(colorHex),
        colorHex,
        size: sz, initialSize: sz,
        life: 1,
        decay: 0.015 + Math.random() * 0.01,
        gravity: GRAVITY * 0.3,
        flicker: true,
        trail: false,
        type: 'ring',
      });
    }
  }

  update(): void {
    this._updateRockets();
    this._updateParticles();
    this._updateSparkles();
    this._updateTrails();
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.globalCompositeOperation = 'lighter'; // additive blending = glow

    this._drawRockets(ctx);
    this._drawTrails(ctx);
    this._drawParticles(ctx);
    this._drawSparkles(ctx);

    ctx.globalCompositeOperation = 'source-over';
  }

  clear(): void {
    this.particles = [];
    this.sparkles = [];
    this.trails = [];
    this.rockets = [];
  }

  // -----------------------------------------------------------------
  // Pretext integration: export occlusion shapes for text reflow
  //
  // Returns bounding rectangles of all "bright enough" particle clusters.
  // These are passed to the text layout engine each frame so text lines
  // automatically avoid positions occupied by live fireworks.
  //
  // Strategy:
  //   1. Collect all particles with life > BRIGHTNESS_THRESHOLD (still visually bright).
  //   2. Find their union bounding box (expanded by the particle's rendered glow radius).
  //   3. Also include in-flight rocket positions.
  //   4. Return as Rect[]. The text layout iterates these rects per-line.
  // -----------------------------------------------------------------
  getOcclusionRects(): Rect[] {
    const BRIGHTNESS_THRESHOLD = 0.15; // particles below this life are too dim to care
    const GLOW_MULTIPLIER = 3.5;       // radial gradient glow is size*2; add extra margin

    if (this.particles.length === 0 && this.rockets.length === 0) return [];

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let hasPoints = false;

    for (const p of this.particles) {
      if (p.life < BRIGHTNESS_THRESHOLD) continue;
      const r = p.size * GLOW_MULTIPLIER;
      if (p.x - r < minX) minX = p.x - r;
      if (p.y - r < minY) minY = p.y - r;
      if (p.x + r > maxX) maxX = p.x + r;
      if (p.y + r > maxY) maxY = p.y + r;
      hasPoints = true;
    }

    // Include rockets (they glow too)
    for (const r of this.rockets) {
      const rr = 30;
      if (r.x - rr < minX) minX = r.x - rr;
      if (r.y - rr < minY) minY = r.y - rr;
      if (r.x + rr > maxX) maxX = r.x + rr;
      if (r.y + rr > maxY) maxY = r.y + rr;
      hasPoints = true;
    }

    if (!hasPoints) return [];

    return [{
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    }];
  }

  // -----------------------------------------------------------------
  // Private update helpers
  // -----------------------------------------------------------------

  private _createIgnitionSparks(x: number, y: number, _colorHex: string): void {
    for (let i = 0; i < 30; i++) {
      this.sparkles.push({
        x: x + (Math.random() - 0.5) * 20,
        y: y + Math.random() * 10,
        vx: (Math.random() - 0.5) * 3,
        vy: -Math.random() * 2,
        colorRgb: { r: 255, g: 200 + Math.floor(Math.random() * 55), b: 50 },
        size: 2 + Math.random() * 2,
        life: 0.5 + Math.random() * 0.5,
        decay: 0.03 + Math.random() * 0.02,
        gravity: 0.05,
      });
    }
  }

  private _updateRockets(): void {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];

      if (r.phase === 'ignition') {
        r.ignitionTime--;
        if (Math.random() > 0.5) {
          this.sparkles.push({
            x: r.x + (Math.random() - 0.5) * 15,
            y: r.y + Math.random() * 5,
            vx: (Math.random() - 0.5) * 2,
            vy: -Math.random() * 1.5,
            colorRgb: { r: 255, g: 150 + Math.floor(Math.random() * 105), b: 0 },
            size: 1 + Math.random() * 2,
            life: 0.3 + Math.random() * 0.3,
            decay: 0.05,
            gravity: 0.02,
          });
        }
        if (r.ignitionTime <= 0) r.phase = 'ascending';
        continue;
      }

      // Ascending phase
      r.trail.push({ x: r.x, y: r.y, life: 1 });
      if (r.trail.length > 20) r.trail.shift();
      for (const t of r.trail) t.life -= 0.08;
      r.trail = r.trail.filter(t => t.life > 0);

      // Exhaust sparks
      if (Math.random() > 0.3) {
        this.sparkles.push({
          x: r.x + (Math.random() - 0.5) * 6,
          y: r.y + 5,
          vx: (Math.random() - 0.5) * 2,
          vy: 2 + Math.random() * 3,
          colorRgb: { r: 255, g: 200 + Math.floor(Math.random() * 55), b: 100 },
          size: 1 + Math.random() * 2,
          life: 0.3 + Math.random() * 0.2,
          decay: 0.05,
          gravity: 0.1,
        });
      }

      r.x += r.vx;
      r.y += r.vy;
      r.vy += 0.12; // drag reduces upward velocity

      if (r.y <= r.explodeHeight || r.vy >= -2) {
        this.createFirework(r.x, r.y, 1.0, r.palette);
        this.rockets.splice(i, 1);
        continue;
      }

      r.life -= 0.003;
      if (r.life <= 0) this.rockets.splice(i, 1);
    }
  }

  private _updateParticles(): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      if (p.trail && p.life > 0.3 && Math.random() > 0.5) {
        this.trails.push({
          x: p.x, y: p.y,
          colorRgb: p.colorRgb,
          size: p.size * 0.5,
          life: 0.5,
          decay: 0.05,
        });
      }

      p.x += p.vx; p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= 0.985; p.vy *= 0.985;
      p.life -= p.decay;
      p.size = p.initialSize * (0.3 + p.life * 0.7);

      if (p.life <= 0 || p.size < 0.3) this.particles.splice(i, 1);
    }
  }

  private _updateSparkles(): void {
    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const s = this.sparkles[i];
      s.x += s.vx; s.y += s.vy;
      s.vy += s.gravity;
      s.vx *= 0.95; s.vy *= 0.95;
      s.life -= s.decay;
      if (s.life <= 0) this.sparkles.splice(i, 1);
    }
  }

  private _updateTrails(): void {
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const t = this.trails[i];
      t.life -= t.decay;
      t.size *= 0.9;
      if (t.life <= 0 || t.size < 0.2) this.trails.splice(i, 1);
    }
  }

  // -----------------------------------------------------------------
  // Private draw helpers
  // -----------------------------------------------------------------

  private _drawRockets(ctx: CanvasRenderingContext2D): void {
    for (const r of this.rockets) {
      if (r.phase === 'ignition') {
        const g = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, 30);
        g.addColorStop(0, 'rgba(255,200,50,0.8)');
        g.addColorStop(0.5, 'rgba(255,100,0,0.4)');
        g.addColorStop(1, 'rgba(255,50,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(r.x, r.y, 30, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = r.color;
        ctx.beginPath(); ctx.ellipse(r.x, r.y - 10, 4, 12, 0, 0, Math.PI * 2); ctx.fill();
        continue;
      }

      for (let i = 0; i < r.trail.length; i++) {
        const t = r.trail[i];
        ctx.fillStyle = rgba(r.colorRgb, t.life * 0.9);
        ctx.beginPath();
        ctx.arc(t.x, t.y, 2 + 4 * (i / r.trail.length), 0, Math.PI * 2);
        ctx.fill();
      }

      const grd = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, r.size * 4);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.2, rgba(r.colorRgb, 0.9));
      grd.addColorStop(0.6, rgba(r.colorRgb, 0.4));
      grd.addColorStop(1, 'rgba(255,100,0,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.size * 4, 0, Math.PI * 2); ctx.fill();
    }
  }

  private _drawTrails(ctx: CanvasRenderingContext2D): void {
    for (const t of this.trails) {
      ctx.fillStyle = rgba(t.colorRgb, t.life * 0.6);
      ctx.beginPath(); ctx.arc(t.x, t.y, t.size, 0, Math.PI * 2); ctx.fill();
    }
  }

  private _drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      let alpha = p.life;
      if (p.flicker) alpha *= 0.7 + Math.random() * 0.3;

      const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
      grd.addColorStop(0, rgba(p.colorRgb, alpha));
      grd.addColorStop(0.4, rgba(p.colorRgb, alpha * 0.6));
      grd.addColorStop(1, rgba(p.colorRgb, 0));
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = rgba({ r: 255, g: 255, b: 255 }, alpha * 0.8);
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 0.3, 0, Math.PI * 2); ctx.fill();
    }
  }

  private _drawSparkles(ctx: CanvasRenderingContext2D): void {
    for (const s of this.sparkles) {
      ctx.fillStyle = rgba(s.colorRgb, s.life);
      ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2); ctx.fill();
    }
  }
}
