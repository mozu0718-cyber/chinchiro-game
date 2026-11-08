// 効果音。音源ファイルを使わず Web Audio で合成する。
export class Sfx {
  constructor() {
    this.ctx = null;
    this.lastHit = 0;
  }

  /** ユーザー操作の中で一度呼ぶ（ブラウザの自動再生制限のため） */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  #noiseBuffer() {
    if (this._noise) return this._noise;
    const len = this.ctx.sampleRate * 0.25;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  /** 衝突音。kind: 'bowl'（陶器のカチン）| 'die'（サイコロ同士）| 'table'（卓に落ちた） */
  hit(strength, kind) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastHit < 0.025) return; // 鳴らしすぎ防止
    this.lastHit = now;
    const vol = Math.min(1, 0.15 + strength * 0.9);

    if (kind === 'table') {
      this.#thud(now, vol);
      return;
    }
    // 高い音の減衰する倍音を重ねて「チン」という陶器の音にする
    const base = kind === 'bowl' ? 2400 + Math.random() * 500 : 3600 + Math.random() * 800;
    const partials = kind === 'bowl' ? [1, 2.32, 4.1] : [1, 1.9];
    partials.forEach((m, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.value = base * m;
      const decay = (kind === 'bowl' ? 0.28 : 0.08) / (i + 1);
      g.gain.setValueAtTime(vol * 0.25 / (i + 1), now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      o.connect(g).connect(this.master);
      o.start(now);
      o.stop(now + decay + 0.02);
    });
    // 当たった瞬間の「カッ」
    const n = this.ctx.createBufferSource();
    n.buffer = this.#noiseBuffer();
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 3000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol * 0.35, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    n.connect(f).connect(g).connect(this.master);
    n.start(now);
    n.stop(now + 0.05);
  }

  #thud(now, vol) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(220, now);
    o.frequency.exponentialRampToValueAtTime(90, now + 0.1);
    g.gain.setValueAtTime(vol * 0.5, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    o.connect(g).connect(this.master);
    o.start(now);
    o.stop(now + 0.2);
  }

  #tone(freq, start, dur, type = 'triangle', vol = 0.2) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(this.master);
    o.start(start);
    o.stop(start + dur + 0.02);
  }

  /** 役が確定したときのジングル。level: 'great' | 'good' | 'normal' | 'bad' */
  jingle(level) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.05;
    const seq = {
      great: [[523, 0], [659, 0.09], [784, 0.18], [1047, 0.27], [1319, 0.4], [1568, 0.5]],
      good: [[587, 0], [784, 0.1], [988, 0.2]],
      normal: [[660, 0], [880, 0.08]],
      bad: [[392, 0], [330, 0.15], [262, 0.32]],
    }[level];
    seq.forEach(([f, dt]) => this.#tone(f, t + dt, level === 'great' ? 0.5 : 0.3, level === 'bad' ? 'sawtooth' : 'triangle', level === 'bad' ? 0.08 : 0.18));
  }

  /** お金が動く音 */
  coin() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.#tone(1318, t, 0.12, 'square', 0.06);
    this.#tone(1760, t + 0.07, 0.25, 'square', 0.06);
  }
}
