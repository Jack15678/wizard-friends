// Original score: "Candlelit Predictions", 64 BPM, sixteen-bar ambient cycle.
export const BEAT = 60 / 64;
const chords = [
  [50, 53, 57, 64], [46, 53, 57, 60], [41, 48, 52, 57], [48, 55, 58, 62],
  [50, 57, 60, 65], [43, 50, 53, 57], [46, 53, 57, 62], [45, 52, 55, 62],
];
const melody = [74, 72, 69, 65, 69, 67, 65, 62];
function voice(ctx, bus, midi, when, duration, gain, kind = 'pad', pan = 0) {
  const osc = ctx.createOscillator(), envelope = ctx.createGain(), stereo = ctx.createStereoPanner();
  osc.type = kind === 'pluck' ? 'triangle' : 'sine';
  osc.frequency.value = 440 * 2 ** ((midi - 69) / 12);
  stereo.pan.value = pan;
  const attack = kind === 'pad' ? .9 : .018;
  envelope.gain.setValueAtTime(0, when);
  envelope.gain.linearRampToValueAtTime(gain, when + attack);
  envelope.gain.exponentialRampToValueAtTime(.0001, when + duration);
  envelope.gain.linearRampToValueAtTime(0, when + duration + .06);
  osc.connect(envelope); envelope.connect(stereo); stereo.connect(bus);
  osc.start(when); osc.stop(when + duration + .08);
  osc.onended = () => { osc.disconnect(); envelope.disconnect(); stereo.disconnect(); };
}
export function scheduleBar(ctx, bus, bar, when) {
  const chord = chords[bar % chords.length];
  chord.forEach((note, i) => voice(ctx, bus, note, when + i * .04, BEAT * 5.2, .026, 'pad', (i - 1.5) * .22));
  voice(ctx, bus, chord[0] - 12, when, BEAT * 4.1, .036);
  [0, 1.5, 2.5, 3.25].forEach((beat, i) => {
    const index = bar % 2 ? 3 - i : i;
    voice(ctx, bus, chord[index] + 12, when + beat * BEAT, 2.2, .045, 'pluck', i % 2 ? .25 : -.25);
  });
  if (bar % 2 === 0) {
    const note = melody[(bar / 2) % melody.length];
    voice(ctx, bus, note, when + BEAT * .5, BEAT * 2.8, .035, 'bell', -.12);
    voice(ctx, bus, note + 12, when + BEAT * .5, 1.6, .008, 'bell', .12);
  }
}

export class BackgroundMusic {
  constructor() {
    this.enabled = true; this.volume = .25; this.bar = 0;
    try {
      this.enabled = localStorage.getItem('wizard-music-enabled') !== 'false';
      const saved = localStorage.getItem('wizard-music-volume');
      if (saved !== null && Number.isFinite(Number(saved))) this.volume = Math.max(0, Math.min(1, Number(saved)));
    } catch {}
    this.panel = document.createElement('section');
    this.panel.id = 'music-panel'; this.panel.hidden = true;
    this.panel.setAttribute('aria-label', '背景音乐');
    this.panel.innerHTML = `<div class="music-heading"><span>烛光 · 预言</span><button id="music-close" aria-label="关闭音乐设置">×</button></div>
      <button id="music-mute" type="button"></button>
      <label for="music-volume">音量 <output id="music-volume-value"></output></label>
      <input id="music-volume" type="range" min="0" max="100" step="1" aria-label="背景音乐音量">`;
    document.body.append(this.panel);
    this.slider = this.panel.querySelector('#music-volume');
    this.slider.value = Math.round(this.volume * 100);
    this.panel.querySelector('#music-close').onclick = () => { this.panel.hidden = true; this.update(); this.button?.focus(); };
    this.panel.querySelector('#music-mute').onclick = () => {
      this.enabled = this.failed ? true : !this.enabled; this.persist(); this.sync(); this.update();
    };
    this.slider.oninput = () => {
      this.volume = Number(this.slider.value) / 100; this.persist(); this.setGain(); this.update();
    };
    const unlock = event => {
      if (!event.isTrusted) return;
      this.unlocked = true;
      if (this.enabled && this.ctx?.state !== 'running') this.sync();
    };
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { this.panel.hidden = true; this.update(); }
      else unlock(event);
    });
    document.addEventListener('visibilitychange', () => this.sync());
    window.addEventListener('pagehide', () => { clearInterval(this.timer); this.ctx?.suspend().catch(() => {}); });
    window.addEventListener('pageshow', () => { if (this.ctx) this.sync(); });
    this.update();
  }
  persist() {
    try {
      localStorage.setItem('wizard-music-enabled', String(this.enabled));
      localStorage.setItem('wizard-music-volume', String(this.volume));
    } catch {}
  }
  build() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('Audio unavailable');
    this.ctx = new Audio();
    this.bus = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 2400;
    const reverb = this.ctx.createConvolver();
    const impulse = this.ctx.createBuffer(2, Math.floor(this.ctx.sampleRate * 2.7), this.ctx.sampleRate);
    let seed = 713;
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[i] = (seed / 4294967296 * 2 - 1) * (1 - i / data.length) ** 3;
      }
    }
    reverb.buffer = impulse;
    const wet = this.ctx.createGain(); wet.gain.value = .2;
    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.value = -12; compressor.ratio.value = 3;
    this.master = this.ctx.createGain(); this.master.gain.value = 0;
    this.bus.connect(filter); filter.connect(this.master);
    filter.connect(reverb); reverb.connect(wet); wet.connect(this.master);
    this.master.connect(compressor); compressor.connect(this.ctx.destination);
    this.next = this.ctx.currentTime + .12;
    this.ctx.onstatechange = () => this.update();
  }
  setGain() {
    if (!this.master) return;
    this.master.gain.setTargetAtTime(this.enabled && !document.hidden ? this.volume * 4 : 0, this.ctx.currentTime, .12);
  }
  async sync() {
    clearTimeout(this.pauseTimer);
    if (!this.enabled || document.hidden) {
      clearInterval(this.timer); this.timer = null;
      this.setGain();
      if (this.ctx) this.pauseTimer = setTimeout(() => this.ctx.suspend().catch(() => {}), 350);
      this.update(); return;
    }
    // Never construct a context until an actual user gesture has occurred.
    if (!this.ctx && !this.unlocked) return;
    try {
      if (!this.ctx) this.build();
      await this.ctx.resume();
      if (!this.enabled || document.hidden) return;
      this.setGain();
      if (!this.timer) {
        const schedule = () => {
          if (this.ctx.state !== 'running') return;
          if (this.next < this.ctx.currentTime) this.next = this.ctx.currentTime + .08;
          while (this.next < this.ctx.currentTime + .3) {
            scheduleBar(this.ctx, this.bus, this.bar, this.next);
            this.bar = (this.bar + 1) % 16; this.next += BEAT * 4;
          }
        };
        schedule(); this.timer = setInterval(schedule, 100);
      }
      this.failed = false; this.update();
    } catch { this.failed = true; this.update(); }
  }
  update() {
    const status = this.failed ? 'unavailable' : !this.enabled ? 'muted' : this.ctx?.state === 'running' ? 'playing' : 'waiting';
    this.panel.dataset.status = status;
    this.panel.querySelector('#music-mute').textContent = this.failed ? '重试播放' : this.enabled ? '暂停音乐' : '播放音乐';
    this.panel.querySelector('#music-volume-value').textContent = `${Math.round(this.volume * 100)}%`;
    if (this.button) {
      this.button.textContent = !this.enabled ? '♫ 已静音' : '♫ 音乐';
      this.button.setAttribute('aria-expanded', String(!this.panel.hidden));
    }
  }
  mount(target) {
    this.button = document.createElement('button');
    this.button.id = 'music-toggle'; this.button.className = 'text-button';
    this.button.setAttribute('aria-controls', 'music-panel');
    this.button.onclick = () => { this.panel.hidden = !this.panel.hidden; this.update(); };
    target?.append(this.button); this.update();
  }
}
