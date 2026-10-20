// Синтез звуку через WebAudio (без аудіофайлів): двигун, гальма, поворотник, помилка, аварія.
export class SimAudio {
  private ctx: AudioContext | null = null
  private eng: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filt: BiquadFilterNode } | null = null
  private skid: { gain: GainNode } | null = null
  private noise: AudioBuffer | null = null
  private master: GainNode | null = null
  private tickT = 0
  muted = false

  /** Викликати з жесту користувача (браузер не дозволяє автозапуск). */
  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = this.muted ? 0 : 0.5
    this.master.connect(ctx.destination)

    const len = ctx.sampleRate
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1

    const osc = ctx.createOscillator(); osc.type = 'sawtooth'
    const osc2 = ctx.createOscillator(); osc2.type = 'square'
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 400
    const gain = ctx.createGain(); gain.gain.value = 0
    osc.connect(filt); osc2.connect(filt); filt.connect(gain); gain.connect(this.master)
    osc.start(); osc2.start()
    this.eng = { osc, osc2, gain, filt }

    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 3
    const sg = ctx.createGain(); sg.gain.value = 0
    src.connect(bp); bp.connect(sg); sg.connect(this.master); src.start()
    this.skid = { gain: sg }
  }

  setMuted(m: boolean): void {
    this.muted = m
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05)
  }

  /** Кожен кадр: v — швидкість u/с, gas/brake — педалі, signalOn — поворотник увімкнений. */
  update(v: number, gas: boolean, brake: boolean, signalOn: boolean, dt: number): void {
    const ctx = this.ctx
    if (!ctx || !this.eng) return
    const now = ctx.currentTime
    const rpm = 28 + v * 20 + (gas ? 8 : 0) // Гц основного тону
    this.eng.osc.frequency.setTargetAtTime(rpm, now, 0.08)
    this.eng.osc2.frequency.setTargetAtTime(rpm * 0.5, now, 0.08)
    this.eng.filt.frequency.setTargetAtTime(250 + v * 90 + (gas ? 250 : 0), now, 0.1)
    this.eng.gain.gain.setTargetAtTime(0.12 + (gas ? 0.14 : 0) + Math.min(0.1, v * 0.02), now, 0.1)
    this.skid?.gain.gain.setTargetAtTime(brake && v > 3 ? Math.min(0.12, (v - 3) * 0.05) : 0, now, 0.05)
    if (signalOn) {
      this.tickT += dt
      if (this.tickT >= 0.4) { this.tickT = 0; this.click() }
    } else this.tickT = 0.4
  }

  private click(): void {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'square'; o.frequency.value = 1800
    g.gain.setValueAtTime(0.15, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04)
    o.connect(g); g.connect(this.master); o.start(); o.stop(ctx.currentTime + 0.05)
  }

  /** Сигнал помилки. */
  beep(): void {
    const ctx = this.ctx
    if (!ctx || !this.master) return
    const o = ctx.createOscillator(); const g = ctx.createGain()
    o.type = 'sine'; o.frequency.setValueAtTime(520, ctx.currentTime); o.frequency.setValueAtTime(380, ctx.currentTime + 0.12)
    g.gain.setValueAtTime(0.25, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    o.connect(g); g.connect(this.master); o.start(); o.stop(ctx.currentTime + 0.32)
  }

  /** Удар: шум + низький «бум». */
  crash(): void {
    const ctx = this.ctx
    if (!ctx || !this.master || !this.noise) return
    const src = ctx.createBufferSource(); src.buffer = this.noise
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.7, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7)
    src.connect(lp); lp.connect(g); g.connect(this.master); src.start(); src.stop(ctx.currentTime + 0.75)
    const o = ctx.createOscillator(); const og = ctx.createGain()
    o.frequency.setValueAtTime(110, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(35, ctx.currentTime + 0.4)
    og.gain.setValueAtTime(0.7, ctx.currentTime); og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45)
    o.connect(og); og.connect(this.master); o.start(); o.stop(ctx.currentTime + 0.5)
  }

  dispose(): void {
    try { this.eng?.osc.stop(); this.eng?.osc2.stop() } catch { /* вже зупинено */ }
    void this.ctx?.close()
    this.ctx = null
  }
}
