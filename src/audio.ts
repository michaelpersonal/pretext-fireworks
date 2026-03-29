/**
 * audio.ts — Synthesised Web Audio engine ported from gesture-fireworks.
 * Handles charging tones, explosion sounds, and background music.
 */

export class AudioManager {
  private ctx: AudioContext | null = null;
  private chargeSources = new Map<string, { osc: OscillatorNode; gain: GainNode }>();
  initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.initialized = true;

      // Try background music (optional file)
      const bgEl = document.getElementById('background-music') as HTMLAudioElement | null;
      if (bgEl) {
        bgEl.volume = 0.3;
        bgEl.play().catch(() => {/* no background.mp3 – that's fine */});
      }
    } catch {
      console.warn('[audio] Web Audio not available');
    }
  }

  playCharge(handId: string): void {
    if (!this.ctx || this.chargeSources.has(handId)) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(100, this.ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(300, this.ctx.currentTime + 2);

    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.15, this.ctx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();

    this.chargeSources.set(handId, { osc, gain });
  }

  stopCharge(handId: string): void {
    const src = this.chargeSources.get(handId);
    if (!src || !this.ctx) return;
    src.gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);
    setTimeout(() => src.osc.stop(), 150);
    this.chargeSources.delete(handId);
  }

  updateChargeIntensity(handId: string, charge: number): void {
    const src = this.chargeSources.get(handId);
    if (!src || !this.ctx) return;
    src.gain.gain.setValueAtTime(0.1 + charge * 0.2, this.ctx.currentTime);
    src.osc.frequency.setValueAtTime(100 + charge * 300, this.ctx.currentTime);
  }

  playExplosion(intensity = 1): void {
    if (!this.ctx) return;
    const sr = this.ctx.sampleRate;
    const bufLen = Math.floor(sr * 0.3);
    const buf = this.ctx.createBuffer(1, bufLen, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * 0.1));
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;

    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(1000 + intensity * 2000, this.ctx.currentTime);
    filt.frequency.linearRampToValueAtTime(200, this.ctx.currentTime + 0.3);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.3 * intensity, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.3);

    noise.connect(filt); filt.connect(gain); gain.connect(this.ctx.destination);
    noise.start();

    // High sparkle tone
    const sparkle = this.ctx.createOscillator();
    sparkle.type = 'sine';
    sparkle.frequency.setValueAtTime(2000 + Math.random() * 1000, this.ctx.currentTime);
    sparkle.frequency.linearRampToValueAtTime(500, this.ctx.currentTime + 0.2);

    const sGain = this.ctx.createGain();
    sGain.gain.setValueAtTime(0.1 * intensity, this.ctx.currentTime);
    sGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.2);

    sparkle.connect(sGain); sGain.connect(this.ctx.destination);
    sparkle.start(); sparkle.stop(this.ctx.currentTime + 0.3);
  }
}
