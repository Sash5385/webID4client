// Коробка передач гравця: автомат (як було) або механіка — зчеплення, 1–5 + задня (R) + нейтраль (N), обороти, глухнення двигуна.
// Автомат рушій рахує сам; цей модуль — лише швидкість у режимі механіки. Швидкість зі знаком (назад < 0, лише в парковці).

export type Transmission = 'auto' | 'manual';
const VMAX = [2.2, 6, 11, 16, 21, 27] as const;   // м/с на кожній передачі при «відсічці» (індекс 0 — задня)
const ACC = [1.4, 3.4, 2.5, 1.8, 1.3, 0.9] as const; // розгін при повному газі, м/с²
const IDLE_RPM = 800, MAX_RPM = 6000;

export interface GearCtl { readonly gas: boolean; readonly brake: boolean; readonly clutch: boolean }

export class Gearbox {
  manual = false;
  gear = 0;              // −1 R, 0 N, 1..5
  clutch = 0;            // 0 відпущено … 1 вижато
  stalled = false;
  rpm = 0;
  private restartT = 0;
  note = '';             // останнє повідомлення для HUD (глухнення, «вижміть зчеплення»)
  constructor(public readonly minGear = 0) {}

  setManual(m: boolean): void { this.manual = m; this.gear = 0; this.clutch = 0; this.stalled = false; this.rpm = IDLE_RPM; this.note = ''; }
  get label(): string { return this.gear < 0 ? 'R' : this.gear === 0 ? 'N' : String(this.gear); }

  // Перемкнути передачу (потрібне вижате зчеплення). Повертає false, якщо не вийшло.
  shift(dir: 1 | -1): boolean {
    if (!this.manual) return false;
    if (this.clutch < 0.6) { this.note = 'Вижміть зчеплення, щоб перемкнути передачу'; return false; }
    const g = Math.max(this.minGear, Math.min(5, this.gear + dir));
    this.gear = g; this.note = '';
    return true;
  }

  // Швидкість після кроку (v зі знаком). P — параметри авто; grip — зчеплення шин з дорогою.
  step(v: number, ctl: GearCtl, P: { brake: number; coast: number }, grip: number, dt: number): number {
    // Педаль зчеплення: вижимається швидко, відпускається повільно (зона «хвату»).
    this.clutch += Math.max(-1.4 * dt, Math.min(8 * dt, (ctl.clutch ? 1 : 0) - this.clutch));
    const g = this.gear;
    let out = v;
    const sgn = Math.sign(v) || 0;
    // Гальмо та накат працюють завжди; далі додається привід від двигуна.
    const brakeDec = ctl.brake ? P.brake * grip : 0;
    const coast = P.coast;
    // Перезапуск двигуна: вижате зчеплення + газ/просто зчеплення при нейтралі.
    if (this.stalled) {
      if (this.clutch > 0.7) { this.restartT += dt; if (this.restartT > 0.6) { this.stalled = false; this.restartT = 0; this.rpm = IDLE_RPM; this.note = ''; } } else this.restartT = 0;
    }
    const k = g === 0 ? 0 : Math.max(0, Math.min(1, (0.85 - this.clutch) / 0.65)); // частка передачі крутного моменту
    const dir = g < 0 ? -1 : 1, vmax = VMAX[g < 0 ? 0 : g]!, sp = v * dir;       // sp — швидкість «по передачі»
    let a = 0;
    if (k > 0) {
      if (this.stalled) {
        a = -dir * 2.2 * k * Math.min(1, Math.abs(v)); // двигун заглух — передача гальмує
      } else {
        if (ctl.gas && sp < vmax) a += dir * ACC[g < 0 ? 0 : g]! * (0.4 + 0.6 * grip) * (1 - Math.pow(Math.max(0, sp) / vmax, 3)) * k;
        else if (sp > vmax * 1.02) a -= dir * (2 + (sp - vmax) * 2) * k; // за відсічкою — сильне гальмування двигуном
        else if (!ctl.gas) a -= Math.sign(sp || 1) * dir * (0.3 + 1.6 * Math.min(1, Math.abs(sp) / vmax)) * k; // гальмування двигуном
        // Рух проти передачі (наприклад, назад на 1-й) — двигун опирається.
        if (sp < -0.05) a += dir * 2 * k;
        // Глухнення: зчеплення відпущене, швидкість нижче мінімуму передачі, а газу недостатньо.
        if (this.clutch < 0.18 && Math.abs(sp) < vmax * 0.12 && !(ctl.gas && Math.abs(g) <= 2)) {
          this.stalled = true; this.note = 'Двигун заглох: вижміть зчеплення';
        }
      }
    }
    out += a * dt;
    // Накат / гальмо без приводу.
    const drag = (k < 0.5 || this.stalled ? coast : 0) * Math.sign(out);
    if (Math.abs(out) > 0) { const d = (brakeDec + Math.abs(drag)) * dt; out = Math.abs(out) <= d ? 0 : out - Math.sign(out) * d; }
    void sgn;
    // Обороти для HUD/звуку.
    if (this.stalled) this.rpm = 0;
    else if (k > 0.5) this.rpm = IDLE_RPM + (MAX_RPM - IDLE_RPM) * Math.min(1, Math.abs(out) / vmax);
    else this.rpm += ((ctl.gas ? 4200 : IDLE_RPM) - this.rpm) * Math.min(1, dt * 6);
    return out;
  }
}
