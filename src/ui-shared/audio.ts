// Звук тренажера: усе синтезується в Web Audio (без файлів). Запускається після першого дотику/натискання.
// Двигун (залежить від швидкості й газу), шум дороги, тікання покажчика, гальма, сигнали помилок, зіткнення, фініш.

import type { Fault } from '../engine/sim';

export interface SoundSim {
  readonly player: { readonly v: number; readonly sig: -1 | 0 | 1; readonly sigT: number; readonly braking: boolean };
  readonly traffic: { readonly cars: ReadonlyArray<{ readonly x: number; readonly z: number; readonly v: number }> };
  readonly x: number;
  readonly z: number;
  readonly gb?: { readonly manual: boolean; readonly gear: number; readonly rpm: number; readonly stalled: boolean; readonly clutch: number };
}

const KEY = 'sound.muted';

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engA!: OscillatorNode;
  private engB!: OscillatorNode;
  private engGain!: GainNode;
  private engFilter!: BiquadFilterNode;
  private roadGain!: GainNode;
  private trafficGain!: GainNode;
  private brakeGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private lastTick = -1;
  private lastSig = 0;
  private lastGear = 0;
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem(KEY) === '1'; } catch { /* без сховища */ }
  }

  get ready(): boolean { return this.ctx !== null; }

  // Викликати з обробника дотику/кліку.
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.build();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try { localStorage.setItem(KEY, m ? '1' : '0'); } catch { /* без сховища */ }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.03);
  }

  private noise(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    return s;
  }

  private build(): void {
    const c = this.ctx!;
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp).connect(c.destination);

    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Двигун: пила + прямокутна з нижчим тоном крізь фільтр.
    this.engA = c.createOscillator(); this.engA.type = 'sawtooth';
    this.engB = c.createOscillator(); this.engB.type = 'square';
    this.engFilter = c.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 400; this.engFilter.Q.value = 1.2;
    this.engGain = c.createGain(); this.engGain.gain.value = 0;
    const gB = c.createGain(); gB.gain.value = 0.5;
    this.engA.connect(this.engFilter); this.engB.connect(gB).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);
    this.engA.start(); this.engB.start();

    // Шум дороги/вітру.
    const road = this.noise();
    const rf = c.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 500; rf.Q.value = 0.5;
    this.roadGain = c.createGain(); this.roadGain.gain.value = 0;
    road.connect(rf).connect(this.roadGain).connect(this.master);
    road.start();

    // Міський фон: інші авто поруч.
    const tr = this.noise();
    const tf = c.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.value = 220;
    this.trafficGain = c.createGain(); this.trafficGain.gain.value = 0;
    tr.connect(tf).connect(this.trafficGain).connect(this.master);
    tr.start();

    // Скрип гальм.
    const br = this.noise();
    const bf = c.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 2600; bf.Q.value = 6;
    this.brakeGain = c.createGain(); this.brakeGain.gain.value = 0;
    br.connect(bf).connect(this.brakeGain).connect(this.master);
    br.start();
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number): void {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private burst(dur: number, vol: number, freq: number, q = 0.7, delay = 0): void {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  fault(f: Fault): void {
    if (!this.ctx) return;
    if (f.code === 'crash' || f.code === 'pedestrianHit') {
      this.burst(0.5, 1.0, 180, 0.5);
      this.burst(0.25, 0.8, 1800, 0.6);
      this.tone(70, 0.5, 'sine', 0.9, 0, 35);
      return;
    }
    if (f.severity === 'serious') { this.tone(300, 0.18, 'square', 0.25); this.tone(220, 0.3, 'square', 0.25, 0.2); }
    else this.tone(520, 0.16, 'triangle', 0.3);
  }

  finish(passed: boolean): void {
    if (!this.ctx) return;
    const notes = passed ? [523, 659, 784, 1047] : [392, 349, 294, 220];
    notes.forEach((n, i) => this.tone(n, 0.28, passed ? 'triangle' : 'sawtooth', 0.28, i * 0.16));
  }

  // Щокадру. gas — натиснуто газ.
  update(sim: SoundSim, gas: boolean, active: boolean): void {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime;
    const v = active ? sim.player.v : 0;
    // «Передачі»: оберти ростуть до зміни передачі, потім падають.
    const gears = [0, 4, 8, 13, 19, 30];
    let g = 1; while (g < gears.length - 1 && v > gears[g]!) g++;
    const lo = gears[g - 1]!, hi = gears[g]!;
    const rpm = (v - lo) / (hi - lo + 1e-6);
    const gb = sim.gb;
    let f0 = 28 + rpm * 38 + g * 3 + (gas ? 4 : 0);
    let loud = active ? (gas ? 0.2 : 0.11) : 0, bright = 260 + rpm * 260 + (gas ? 220 : 0);
    if (gb?.manual) { // механіка: звук за реальними оборотами коробки
      const r = Math.max(0, Math.min(1, (gb.rpm - 800) / 5200));
      f0 = 26 + r * 62 + (gas ? 3 : 0); bright = 240 + r * 520 + (gas ? 200 : 0);
      if (gb.stalled || !active) loud = 0; else loud = (gas ? 0.14 + 0.1 * r : 0.09 + 0.05 * r);
      if (gb.gear !== this.lastGear && active) { this.lastGear = gb.gear; this.tone(95, 0.06, 'square', 0.05); } // «клац» важеля
    } else this.lastGear = 0;
    this.engA.frequency.setTargetAtTime(f0, t, 0.05);
    this.engB.frequency.setTargetAtTime(f0 * 0.5, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(bright, t, 0.08);
    this.engGain.gain.setTargetAtTime(loud, t, 0.08);
    this.roadGain.gain.setTargetAtTime(active ? Math.min(0.22, v * 0.012) : 0, t, 0.15);
    let near = 0;
    for (const car of sim.traffic.cars) { const d = Math.hypot(car.x - sim.x, car.z - sim.z); if (d < 45) near += (1 - d / 45) * (0.3 + Math.min(1, car.v / 10)); }
    this.trafficGain.gain.setTargetAtTime(active ? Math.min(0.28, near * 0.05) : 0, t, 0.3);
    this.brakeGain.gain.setTargetAtTime(active && sim.player.braking && v > 4 ? Math.min(0.09, (v - 4) * 0.006) : 0, t, 0.05);

    // Покажчик: тік на початку кожного циклу, ток посередині.
    if (active && sim.player.sig !== 0) {
      const phase = Math.floor(sim.player.sigT * 3);
      if (phase !== this.lastTick || this.lastSig !== sim.player.sig) {
        this.lastTick = phase;
        if (phase % 2 === 0) this.tone(1900, 0.03, 'square', 0.14); else this.tone(1300, 0.03, 'square', 0.1);
      }
    } else this.lastTick = -1;
    this.lastSig = sim.player.sig;
  }

  silence(): void {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime;
    for (const g of [this.engGain, this.roadGain, this.trafficGain, this.brakeGain]) g.gain.setTargetAtTime(0, t, 0.05);
  }
}
