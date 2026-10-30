"use strict";

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// макамы
const MAQAMS = {
  hijaz: {
    ar: "حجاز",
    cents: [0, 100, 400, 500, 700, 800, 1000],
    names: ["D", "E♭", "F♯", "G", "A", "B♭", "C"],
  },
  rast: {
    ar: "راست",
    cents: [0, 200, 350, 500, 700, 900, 1050],
    names: ["D", "E", "F½♯", "G", "A", "B", "C½♯"],
  },
  bayati: {
    ar: "بياتي",
    cents: [0, 150, 300, 500, 700, 800, 1000],
    names: ["D", "E½♭", "F", "G", "A", "B♭", "C"],
  },
  saba: {
    ar: "صبا",
    cents: [0, 150, 300, 400, 700, 800, 1000],
    names: ["D", "E½♭", "F", "G♭", "A", "B♭", "C"],
  },
};
const TONIC = 146.83;

function degFreq(deg, maqam = S.maqam) {
  const c = MAQAMS[maqam].cents;
  const oct = Math.floor(deg / 7),
    i = ((deg % 7) + 7) % 7;
  return TONIC * Math.pow(2, (c[i] + 1200 * oct) / 1200);
}
function degCents(deg, maqam = S.maqam) {
  const c = MAQAMS[maqam].cents;
  const oct = Math.floor(deg / 7),
    i = ((deg % 7) + 7) % 7;
  return c[i] + 1200 * oct;
}

const S = {
  maqam: "hijaz",
  ctx: null,
  N: {},
  playing: false,
  voices: { desert: null, caravan: null },
  presets: { desert: "awakening", caravan: "conversation" },
  params: {
    mix: 20,
    force: 20,
    movement: 20,
    dust: 20,
    horizon: 20,
    presence: 20,
    distance: 20,
    echo: 20,
    spirit: 20,
  },
  nextPulse: 0,
};

function G(v = 1) {
  const g = S.ctx.createGain();
  g.gain.value = v;
  return g;
}
function F(type, freq, Q = 0.7) {
  const f = S.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = Q;
  return f;
}
function P(pan = 0) {
  const p = S.ctx.createStereoPanner();
  p.pan.value = pan;
  return p;
}
function OSC(type, freq) {
  const o = S.ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.start();
  return o;
}
function LOOP(buffer) {
  const s = S.ctx.createBufferSource();
  s.buffer = buffer;
  s.loop = true;
  s.start(0, rand(0, buffer.duration - 0.1));
  return s;
}
function chain(...nodes) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}
function glide(param, value, time = 0.08) {
  const t = S.ctx.currentTime;
  param.cancelScheduledValues(t);
  param.setTargetAtTime(value, t, time);
}
function env(param, t, peak, attack, decay) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function noiseBuffer(ctx, sec, color = "white") {
  const len = Math.floor(ctx.sampleRate * sec);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (color === "brown") {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
  }
  return buf;
}

function crackleBuffer(ctx, sec) {
  const len = Math.floor(ctx.sampleRate * sec);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let amp = 0;
    for (let i = 0; i < len; i++) {
      if (Math.random() < 0.0006) amp = (Math.random() * 2 - 1) * rand(0.4, 1);
      d[i] = amp + (Math.random() * 2 - 1) * 0.004;
      amp *= 0.55;
    }
  }
  return buf;
}

function impulse(ctx, sec, decay) {
  const len = Math.floor(ctx.sampleRate * sec);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

function driveCurve(k) {
  const n = 2048,
    c = new Float32Array(n),
    norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}

const pluckCache = new Map();
function pluck(ctx, freq) {
  const q = Math.round(24 * Math.log2(freq / 440));
  const period = Math.max(
    2,
    Math.round(ctx.sampleRate / (440 * Math.pow(2, q / 24))),
  );
  if (!pluckCache.has(period)) {
    const len = Math.floor(ctx.sampleRate * 2.6);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    const ring = new Float32Array(period);
    let prev = 0;
    for (let i = 0; i < period; i++) {
      prev = prev * 0.5 + (Math.random() * 2 - 1) * 0.5;
      ring[i] = prev;
    }
    let idx = 0;
    for (let i = 0; i < len; i++) {
      const cur = ring[idx],
        nxt = ring[(idx + 1) % period];
      d[i] = cur * 0.9;
      ring[idx] = 0.4985 * (cur + nxt);
      idx = (idx + 1) % period;
    }
    pluckCache.set(period, buf);
  }
  return {
    buffer: pluckCache.get(period),
    rate: freq / (ctx.sampleRate / period),
  };
}

function initAudio(customCtx) {
  if (S.ctx) return;
  const ctx =
    customCtx || new (window.AudioContext || window.webkitAudioContext)();
  S.ctx = ctx;
  const N = S.N;

  N.white = noiseBuffer(ctx, 4);
  N.brown = noiseBuffer(ctx, 4, "brown");
  N.crackle = crackleBuffer(ctx, 5);

  N.limiter = ctx.createDynamicsCompressor();
  N.limiter.threshold.value = -14;
  N.limiter.knee.value = 8;
  N.limiter.ratio.value = 10;
  N.limiter.attack.value = 0.004;
  N.limiter.release.value = 0.3;
  N.limiter.connect(ctx.destination);

  N.master = G(0);
  N.master.connect(N.limiter);
  N.ui = G(0.6);
  N.ui.connect(N.limiter);

  N.sandBus = G(0.8);
  N.sandBus.connect(N.limiter);
  N.sandVerb = ctx.createConvolver();
  N.sandVerb.buffer = impulse(ctx, 4, 2.6);
  chain(N.sandBus, G(0.45), N.sandVerb, N.limiter);

  N.desertBus = G(1);
  N.caravanBus = G(1);
  N.desertBus.connect(N.master);
  N.caravanBus.connect(N.master);

  [
    ["desertScope", N.desertBus],
    ["caravanScope", N.caravanBus],
  ].forEach(([key, bus]) => {
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0.85;
    an.minDecibels = -95;
    an.maxDecibels = -25;
    bus.connect(an);
    N[key] = an;
  });

  buildDesert();
  buildCaravan();
  Object.keys(S.params).forEach(applyParam);
  if (!customCtx) setInterval(schedule, 40);
}

function buildDesert() {
  const ctx = S.ctx,
    N = S.N;

  N.dIn = G(1);
  N.dForce = G(1);
  N.dShelf = F("lowshelf", 140);
  N.dSum = G(1);

  N.dClean = G(1);
  N.dDrive = G(1);
  N.dShaper = ctx.createWaveShaper();
  N.dShaper.curve = driveCurve(3);
  N.dShaper.oversample = "4x";
  N.dDirty = G(0);
  chain(N.dIn, N.dForce, N.dShelf, N.dClean, N.dSum);
  chain(
    N.dShelf,
    N.dDrive,
    N.dShaper,
    F("bandpass", 1800, 0.6),
    N.dDirty,
    N.dSum,
  );

  N.dCrackleGain = G(0);
  chain(LOOP(N.crackle), F("highpass", 700), N.dCrackleGain, N.dSum);
  N.dSandGain = G(0);
  chain(LOOP(N.white), F("bandpass", 4200, 0.9), N.dSandGain, N.dSum);

  N.dSubGain = G(0);
  chain(OSC("sine", 36.71), N.dSubGain, N.dSum); // D1

  N.dTone = F("lowpass", 9000, 0.7);
  N.dPan = P(0);
  N.dLfo = OSC("sine", 0.1);
  N.dLfoPan = G(0);
  N.dLfoTone = G(0);
  N.dLfo.connect(N.dLfoPan).connect(N.dPan.pan);
  N.dLfo.connect(N.dLfoTone).connect(N.dTone.frequency);
  chain(N.dSum, N.dTone, N.dPan);

  N.dDry = G(1);
  N.dVerbSend = G(0);
  N.dVerbIn = ctx.createDelay(1);
  N.dVerbIn.delayTime.value = 0.09;
  N.dVerb = ctx.createConvolver();
  N.dVerb.buffer = impulse(ctx, 7, 2.4);
  chain(N.dPan, N.dDry, N.desertBus);
  chain(N.dPan, N.dVerbSend, N.dVerbIn, N.dVerb, N.desertBus);
}

function buildCaravan() {
  const ctx = S.ctx,
    N = S.N;

  N.cIn = G(1);

  N.cChorusDry = G(1);
  N.cChorusWet = G(0);
  N.cTrem = G(1);
  N.cTremLfo = OSC("sine", 4);
  N.cTremDepth = G(0);
  N.cTremLfo.connect(N.cTremDepth).connect(N.cTrem.gain);
  chain(N.cIn, N.cChorusDry, N.cTrem);
  N.cChoDepth = [];
  [
    [0.017, 0.7, -0.8],
    [0.023, 1.13, 0.8],
    [0.029, 0.43, 0],
  ].forEach(([base, rate, pan]) => {
    const d = ctx.createDelay(0.1);
    d.delayTime.value = base;
    const depth = G(0);
    OSC("sine", rate).connect(depth).connect(d.delayTime);
    chain(N.cIn, d, P(pan), N.cChorusWet);
    N.cChoDepth.push(depth);
  });
  N.cChorusWet.connect(N.cTrem);

  N.cBody = F("peaking", 260, 0.8);
  N.cAir = F("highshelf", 4500);
  N.cPres = G(1);
  N.cPanL = P(0);
  N.cPanR = P(0);
  N.cHaas = ctx.createDelay(0.1);
  N.cHaas.delayTime.value = 0;
  N.cWide = G(1);
  chain(N.cTrem, N.cBody, N.cAir, N.cPres);
  chain(N.cPres, G(0.5), N.cPanL, N.cWide);
  chain(N.cPres, N.cHaas, G(0.5), N.cPanR, N.cWide);

  N.cDist = F("lowpass", 18000, 0.6);
  N.cDistGain = G(1);
  chain(N.cWide, N.cDist, N.cDistGain);
  chain(N.cDistGain, G(1), N.caravanBus);
  N.cRoomSend = G(0.1);
  N.cRoom = ctx.createConvolver();
  N.cRoom.buffer = impulse(ctx, 2.8, 3);
  chain(N.cDistGain, N.cRoomSend, N.cRoom, N.caravanBus);

  N.cEcho = ctx.createDelay(2);
  N.cEcho.delayTime.value = 0.469;
  N.cEchoTone = F("lowpass", 2800, 0.5);
  N.cEchoFb = G(0);
  N.cEchoWet = G(0.3);
  chain(N.cDistGain, N.cEcho, N.cEchoTone, N.cEchoWet, N.caravanBus);
  N.cEchoTone.connect(N.cEchoFb).connect(N.cEcho);
}

function applyParam(name) {
  if (!S.ctx) return;
  const N = S.N,
    v = S.params[name] / 100;
  switch (name) {
    case "mix":
      glide(N.desertBus.gain, Math.cos((v * Math.PI) / 2));
      glide(N.caravanBus.gain, Math.sin((v * Math.PI) / 2));
      break;

    case "force":
      glide(N.dForce.gain, 0.45 + v * 0.9);
      glide(N.dShelf.gain, v * 12);
      glide(N.dSubGain.gain, v * v * 0.22);
      break;
    case "movement":
      glide(N.dLfo.frequency, 0.04 + v * 0.55, 0.3);
      glide(N.dLfoPan.gain, v * 0.95);
      glide(N.dLfoTone.gain, v * 6000);
      break;
    case "dust":
      glide(N.dClean.gain, 1 - v * 0.45);
      glide(N.dDrive.gain, 1 + v * 8);
      glide(N.dDirty.gain, v * 0.3);
      glide(N.dCrackleGain.gain, v * 0.35);
      glide(N.dSandGain.gain, v * 0.05);
      break;
    case "horizon":
      glide(N.dVerbSend.gain, v * 1.3);
      glide(N.dDry.gain, 1 - v * 0.4);
      break;

    case "presence":
      glide(N.cPres.gain, 0.7 + v * 0.6);
      glide(N.cBody.gain, v * 5);
      glide(N.cAir.gain, v * 4);
      glide(N.cPanL.pan, -v * 0.9);
      glide(N.cPanR.pan, v * 0.9);
      glide(N.cHaas.delayTime, v * 0.022);
      break;
    case "distance":
      glide(N.cDist.frequency, 18000 * Math.pow(350 / 18000, v), 0.1);
      glide(N.cDistGain.gain, 1 - v * 0.35);
      glide(N.cRoomSend.gain, 0.08 + v * 0.55);
      break;
    case "echo":
      glide(N.cEchoFb.gain, v * 0.82);
      glide(N.cEchoWet.gain, 0.3 + v * 0.15);
      break;
    case "spirit":
      glide(N.cChorusWet.gain, v * 0.9);
      glide(N.cChorusDry.gain, 1 - v * 0.3);
      N.cChoDepth.forEach((d) => glide(d.gain, 0.0005 + v * 0.008));
      glide(N.cTremLfo.frequency, 2 + v * 6);
      glide(N.cTremDepth.gain, v * 0.45);
      glide(N.cTrem.gain, 1 - v * 0.3);
      break;
  }
}

class Voice {
  constructor(dest, level = 1, fadeIn = 1.5) {
    this.ctx = S.ctx;
    this.level = level;
    this.fadeIn = fadeIn;
    this.out = this.ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    this.sources = [];
    this.next = 0;
    this.dead = false;
  }
  osc(type, freq) {
    const o = OSC(type, freq);
    this.sources.push(o);
    return o;
  }
  noise(buf = S.N.white) {
    const s = LOOP(buf);
    this.sources.push(s);
    return s;
  }
  start() {
    const t = this.ctx.currentTime;
    this.out.gain.setValueAtTime(0, t);
    this.out.gain.linearRampToValueAtTime(this.level, t + this.fadeIn);
    this.next = t + 0.1;
  }
  stop(fade = 1.2) {
    this.dead = true;
    const t = this.ctx.currentTime,
      g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0, t + fade);
    setTimeout(
      () => {
        this.sources.forEach((s) => {
          try {
            s.stop();
          } catch (e) {}
        });
        this.out.disconnect();
      },
      (fade + 0.3) * 1000,
    );
  }
  tick() {}
}

class Awakening extends Voice {
  constructor(dest) {
    super(dest, 0.6, 4);
    this.filter = F("lowpass", 180, 5);
    const breath = this.osc("sine", 0.11);
    breath.connect(G(110)).connect(this.filter.frequency);

    this.swell = G(0.75);
    this.osc("sine", 0.07).connect(G(0.25)).connect(this.swell.gain);

    const root = 73.42;
    [
      ["sawtooth", root, 0.35],
      ["sawtooth", root * 1.004, 0.35],
      ["triangle", root * 2.003, 0.25],
      ["sine", root / 2, 0.6],
      ["triangle", root * 1.5, 0.12],
    ].forEach(([type, f, lvl]) => {
      const o = this.osc(type, f);
      this.osc("sine", rand(0.15, 0.3))
        .connect(G(f * 0.003))
        .connect(o.frequency);
      o.connect(G(lvl)).connect(this.filter);
    });
    chain(this.filter, this.swell, this.out);
  }
  start() {
    super.start();
    const t = this.ctx.currentTime,
      f = this.filter.frequency;
    f.setValueAtTime(180, t);
    f.exponentialRampToValueAtTime(650, t + 16);
  }
}

class Scorch extends Voice {
  constructor(dest) {
    super(dest, 0.5, 1.5);
    this.band = F("bandpass", 6500, 1.4);
    this.osc("sine", 0.23).connect(G(2800)).connect(this.band.frequency);
    this.static = G(0.6);
    chain(
      this.noise(),
      F("highpass", 3500),
      this.band,
      this.static,
      G(0.75),
      this.out,
    );

    chain(this.noise(S.N.brown), F("lowpass", 260), G(0.25), this.out);

    this.whine = this.osc("sine", 2600);
    this.osc("sine", 6.5).connect(G(35)).connect(this.whine.frequency);
    this.whineGain = G(0.025);
    chain(this.whine, this.whineGain, this.out);
  }
  tick(until) {
    while (this.next < until) {
      const t = this.next;
      this.static.gain.setTargetAtTime(rand(0.25, 1), t, 0.01);
      if (Math.random() < 0.06) {
        this.whine.frequency.setTargetAtTime(rand(1400, 4200), t, 0.15);
        this.whineGain.gain.setTargetAtTime(
          Math.random() < 0.3 ? 0 : 0.025,
          t,
          0.05,
        );
      }
      this.next += rand(0.04, 0.16);
    }
  }
}

class Fury extends Voice {
  constructor(dest) {
    super(dest, 0.28, 2);
    const mix = G(0.5);
    [
      ["sawtooth", 41.2],
      ["square", 41.5],
      ["sawtooth", 61.8],
      ["sawtooth", 82.1],
    ].forEach(([type, f]) => this.osc(type, f).connect(mix));
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = driveCurve(6);
    shaper.oversample = "4x";

    this.growl = F("lowpass", 380, 9);
    const growlLfo = this.osc("sine", 4.5);
    growlLfo.connect(G(260)).connect(this.growl.frequency);
    this.osc("sine", 0.09).connect(G(3)).connect(growlLfo.frequency);
    chain(mix, G(2.5), shaper, this.growl, G(0.8), this.out);

    this.gust = G(0.3);
    this.stormBand = F("bandpass", 600, 0.6);
    chain(this.noise(), this.stormBand, this.gust, this.out);
    chain(this.noise(S.N.brown), F("lowpass", 180), G(0.6), this.out);
  }
  tick(until) {
    while (this.next < until) {
      const t = this.next;
      this.gust.gain.setTargetAtTime(rand(0.08, 0.6), t, rand(0.3, 0.9));
      this.stormBand.frequency.setTargetAtTime(rand(300, 1600), t, 0.6);
      this.next += rand(0.8, 2.2);
    }
  }
}

class Silence extends Voice {
  constructor(dest) {
    super(dest, 0.9, 2);
    this.out.connect(G(1.1)).connect(S.N.dVerbIn);
    chain(this.noise(S.N.brown), F("lowpass", 160), G(0.05), this.out);
  }
  start() {
    super.start();
    this.next = this.ctx.currentTime + 0.6;
  }
  tick(until) {
    while (this.next < until) {
      this.drop(this.next);
      this.next += rand(1.8, 5);
    }
  }
  drop(t) {
    const ctx = this.ctx,
      f = degFreq(randInt(-7, -1)) * pick([1, 2, 2, 4]);
    const p = P(rand(-0.6, 0.6));
    p.connect(this.out);

    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.7, t + 0.05);
    const g = G(0);
    env(g.gain, t, 0.35, 0.003, 0.4);
    o.connect(g).connect(p);
    o.start(t);
    o.stop(t + 0.5);

    if (Math.random() < 0.6) {
      const b = ctx.createOscillator();
      b.frequency.setValueAtTime(70, t);
      b.frequency.exponentialRampToValueAtTime(40, t + 0.6);
      const bg = G(0);
      env(bg.gain, t, 0.5, 0.005, 1.2);
      b.connect(bg).connect(this.out);
      b.start(t);
      b.stop(t + 1.4);
    }
  }
}

const VOWELS = [
  [800, 1200],
  [500, 1900],
  [300, 2300],
  [500, 900],
  [350, 700],
];
class Conversation extends Voice {
  constructor(dest) {
    super(dest, 0.7, 0.8);
    this.speakers = [
      { pitch: 115, pan: -0.55 },
      { pitch: 175, pan: 0.5 },
      { pitch: 140, pan: 0.05 },
    ];
    this.left = 0;
  }
  tick(until) {
    while (this.next < until) {
      if (this.left <= 0) {
        this.speaker = pick(this.speakers);
        this.left = randInt(3, 9);
        this.next += rand(0.35, 1.3);
        continue;
      }
      const dur = rand(0.07, 0.19);
      this.syllable(this.next, dur, this.speaker);
      this.left--;
      this.next += dur + rand(0.015, 0.07);
    }
  }
  syllable(t, dur, sp) {
    const ctx = this.ctx;
    const pan = P(sp.pan + rand(-0.1, 0.1));
    pan.connect(this.out);
    if (Math.random() < 0.55) this.click(t, pan);

    const [f1, f2] = pick(VOWELS);
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    const f0 = sp.pitch * rand(0.9, 1.15);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * rand(0.85, 1.12), t + dur);

    const g = G(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.03);
    g.gain.setTargetAtTime(0, t + dur * 0.6, dur * 0.25);
    o.connect(F("bandpass", f1, 7))
      .connect(G(2.6))
      .connect(g);
    o.connect(F("bandpass", f2, 9))
      .connect(G(1.4))
      .connect(g);
    g.connect(pan);
    o.start(t);
    o.stop(t + dur + 0.2);
  }
  click(t, dest) {
    const s = this.ctx.createBufferSource();
    s.buffer = S.N.white;
    const g = G(0);
    env(g.gain, t, 0.5, 0.001, 0.025);
    s.connect(F("bandpass", pick([1800, 2600, 3400, 5200]), 4))
      .connect(g)
      .connect(dest);
    s.start(t, rand(0, 3));
    s.stop(t + 0.05);
  }
}

const MELODY = (
  "4:2 5:1 4:1 3:2 2:2   3:1 4:1 5:2 4:4   2:1 3:1 4:1 3:1 2:2 1:2   0:6 -:2 " +
  "7:2 6:1 5:1 4:2 3:2   4:1 5:1 6:2 5:2 4:2   3:1 2:1 3:1 4:1 2:2 1:1 2:1   0:8"
)
  .trim()
  .split(/\s+/)
  .map((tok) => {
    const [n, d] = tok.split(":");
    return [n === "-" ? null : +n, +d];
  });

class Song extends Voice {
  constructor(dest) {
    super(dest, 1.5, 0.4);
    this.eighth = 60 / 96 / 2;
    this.step = 0;
    this.beat = 0;
    this.remain = 0;
    this.body = F("peaking", 230, 1.2);
    this.body.gain.value = 5;
    this.body.connect(this.out);
    this.drums = G(0.5);
    this.drums.connect(this.out);
    for (let k = -7; k <= 7; k++) pluck(this.ctx, degFreq(k));
  }
  start() {
    super.start();
    this.next = this.ctx.currentTime + 0.15;
  }
  tick(until) {
    while (this.next < until) {
      const t = this.next,
        e = this.eighth,
        pos = this.beat % 8;

      if (pos === 0 || pos === 4) this.doum(t);
      if (pos === 1 || pos === 3 || pos === 6) this.tek(t);
      if (pos === 0 && Math.floor(this.beat / 8) % 2 === 0)
        this.play(degFreq(-7), t, 0.55, 2.4);

      if (this.remain <= 0) {
        const [deg, d] = MELODY[this.step % MELODY.length];
        const f = deg === null ? null : degFreq(deg);
        this.step++;
        this.remain = d;
        if (f) {
          if (d >= 4) {
            for (let k = 0; k < d * 2; k++)
              this.play(
                f,
                t + (k * e) / 2 + (k ? rand(-0.005, 0.005) : 0),
                k ? 0.35 : 1,
                e / 2,
              );
          } else this.play(f, t, 1, d * e);
        }
      }
      this.remain--;
      this.beat++;
      this.next += e;
    }
  }
  play(freq, t, vel, len) {
    const { buffer, rate } = pluck(this.ctx, freq);
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.playbackRate.value = rate;
    const end = Math.min(t + len, t + 2.3);
    const g = G(0);
    g.gain.setValueAtTime(0.9 * vel, t);
    g.gain.setValueAtTime(0.9 * vel, end);
    g.gain.linearRampToValueAtTime(0, end + 0.08);
    chain(
      s,
      F("lowpass", 1200 + 3000 * vel, 0.8),
      g,
      P(rand(-0.15, 0.15)),
      this.body,
    );
    s.start(t);
    s.stop(end + 0.1);
  }
  doum(t) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.18);
    const g = G(0);
    env(g.gain, t, 0.7, 0.003, 0.35);
    o.connect(g).connect(this.drums);
    o.start(t);
    o.stop(t + 0.45);
  }
  tek(t) {
    const s = this.ctx.createBufferSource();
    s.buffer = S.N.white;
    const g = G(0);
    env(g.gain, t, 0.35, 0.001, 0.06);
    s.connect(F("bandpass", 3200, 1.5))
      .connect(g)
      .connect(this.drums);
    s.start(t, rand(0, 3));
    s.stop(t + 0.1);
  }
}

class Whisper extends Voice {
  constructor(dest) {
    super(dest, 2.2, 2);
    this.breathBand = F("bandpass", 5000, 2.2);
    this.breath = G(0.05);
    chain(
      this.noise(),
      F("highpass", 1800),
      this.breathBand,
      this.breath,
      this.out,
    );
    this.nextRustle = 0;
    this.nextWhistle = 0;
  }
  start() {
    super.start();
    const t = this.ctx.currentTime;
    this.nextRustle = t + 0.5;
    this.nextWhistle = t + 1.5;
  }
  tick(until) {
    const now = this.ctx.currentTime;
    this.nextRustle = Math.max(this.nextRustle, now);
    this.nextWhistle = Math.max(this.nextWhistle, now);
    while (this.next < until) {
      const t = this.next;
      this.breathBand.frequency.setTargetAtTime(rand(2500, 8000), t, 0.8);
      this.breath.gain.setTargetAtTime(rand(0.015, 0.14), t, rand(0.4, 1));
      this.next += rand(1, 2.6);
    }
    while (this.nextRustle < until) {
      this.rustle(this.nextRustle);
      this.nextRustle += rand(0.8, 3.5);
    }
    while (this.nextWhistle < until) {
      this.whistle(this.nextWhistle);
      this.nextWhistle += rand(2.5, 6);
    }
  }
  rustle(t) {
    const head = F("highpass", rand(2500, 5000));
    head.connect(P(rand(-0.8, 0.8))).connect(this.out);
    let tt = t;
    for (let i = 0, n = randInt(5, 16); i < n; i++) {
      const s = this.ctx.createBufferSource();
      s.buffer = S.N.white;
      const g = G(0);
      env(g.gain, tt, rand(0.05, 0.22), 0.004, rand(0.02, 0.06));
      s.connect(g).connect(head);
      s.start(tt, rand(0, 3));
      s.stop(tt + 0.1);
      tt += rand(0.015, 0.06);
    }
  }
  whistle(t) {
    const ctx = this.ctx,
      deg = randInt(7, 13),
      mul = pick([4, 8]),
      dur = rand(1.4, 2.4);
    const f = degFreq(deg) * mul,
      f2 = degFreq(deg + pick([-1, 1])) * mul;
    const g = G(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(rand(0.012, 0.03), t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0, t + dur);
    g.connect(P(rand(-0.7, 0.7))).connect(this.out);

    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rand(4, 6);
    lfo.connect(G(f * 0.006)).connect(o.frequency);
    o.connect(g);

    const n = ctx.createBufferSource();
    n.buffer = S.N.white;
    const bp = F("bandpass", f, 30);
    bp.frequency.setValueAtTime(f, t);
    bp.frequency.exponentialRampToValueAtTime(f2, t + dur);
    n.connect(bp).connect(G(2.5)).connect(g);

    [o, lfo].forEach((x) => {
      x.start(t);
      x.stop(t + dur + 0.05);
    });
    n.start(t, rand(0, 3));
    n.stop(t + dur + 0.05);
  }
}

class Chant extends Voice {
  constructor(dest) {
    super(dest, 1.4, 3.5);
    const voices = G(0.18);
    [146.83, 146.83, 146.83, 146.83, 146.83, 73.42, 73.42].forEach((f) => {
      const o = this.osc("sawtooth", f * Math.pow(2, rand(-10, 10) / 1200));
      this.osc("sine", rand(4.6, 5.8))
        .connect(G(f * 0.0045))
        .connect(o.frequency);
      const a = G(rand(0.6, 1));
      this.osc("sine", rand(0.05, 0.15)).connect(G(0.3)).connect(a.gain);
      chain(o, a, P(rand(-0.6, 0.6)), voices);
    });

    const f1 = F("bandpass", 550, 6),
      f2 = F("bandpass", 950, 8),
      f3 = F("bandpass", 2500, 10);
    const morph = this.osc("sine", 0.04);
    morph.connect(G(140)).connect(f1.frequency);
    morph.connect(G(180)).connect(f2.frequency);
    chain(voices, f1, G(3), this.out);
    chain(voices, f2, G(2), this.out);
    chain(voices, f3, G(0.9), this.out);
    chain(voices, F("lowpass", 400), G(0.4), this.out);
  }
}

const VOICES = {
  desert: {
    awakening: Awakening,
    scorch: Scorch,
    fury: Fury,
    silence: Silence,
  },
  caravan: {
    conversation: Conversation,
    song: Song,
    whisper: Whisper,
    chant: Chant,
  },
};

function setVoice(side, name) {
  S.presets[side] = name;
  if (!S.playing) return;
  const old = S.voices[side];
  if (old) old.stop(1.6);
  const Cls = VOICES[side][name];
  if (!Cls) {
    S.voices[side] = null;
    return;
  }
  const v = new Cls(side === "desert" ? S.N.dIn : S.N.cIn);
  v.start();
  S.voices[side] = v;
}

function heartbeat(t) {
  const lvl = Math.pow(S.params.force / 100, 1.6) * 0.9;
  if (lvl < 0.01) return;
  [
    [t, lvl],
    [t + 0.28, lvl * 0.6],
  ].forEach(([tt, l]) => {
    const o = S.ctx.createOscillator();
    o.frequency.setValueAtTime(78, tt);
    o.frequency.exponentialRampToValueAtTime(36, tt + 0.5);
    const g = G(0);
    env(g.gain, tt, l, 0.01, 1.0);
    o.connect(g).connect(S.N.dSum);
    o.start(tt);
    o.stop(tt + 1.2);
  });
}

function schedule(lookahead = 0.15) {
  if (!S.playing) return;
  const now = S.ctx.currentTime,
    until = now + lookahead;
  Object.values(S.voices).forEach((v) => {
    if (!v || v.dead) return;
    if (v.next < now) v.next = now + 0.02;
    v.tick(until);
  });
  if (S.nextPulse < now) S.nextPulse = now + 0.05;
  while (S.nextPulse < until) {
    heartbeat(S.nextPulse);
    S.nextPulse += 2.6;
  }
}

function play() {
  initAudio();
  S.ctx.resume();
  UI.play();
  if (S.playing) return;
  S.playing = true;
  const t = S.ctx.currentTime,
    m = S.N.master.gain;
  m.cancelScheduledValues(t);
  m.setValueAtTime(m.value, t);
  m.linearRampToValueAtTime(0.75, t + 0.8);
  S.nextPulse = t + 0.8;
  setVoice("desert", S.presets.desert);
  setVoice("caravan", S.presets.caravan);
  updateTransport();
}

function pause() {
  initAudio();
  UI.pause();
  if (!S.playing) return;
  S.playing = false;
  const t = S.ctx.currentTime,
    m = S.N.master.gain;
  m.cancelScheduledValues(t);
  m.setValueAtTime(m.value, t);
  m.linearRampToValueAtTime(0, t + 1);
  ["desert", "caravan"].forEach((side) => {
    if (S.voices[side]) S.voices[side].stop(1.1);
    S.voices[side] = null;
  });
  updateTransport();
}

function qanun(freq, t, vel = 1, pan = 0) {
  const { buffer, rate } = pluck(S.ctx, freq);
  const s = S.ctx.createBufferSource();
  s.buffer = buffer;
  s.playbackRate.value = rate;
  const g = G(0);
  g.gain.setValueAtTime(0.7 * vel, t);
  g.gain.setValueAtTime(0.7 * vel, t + 1.8);
  g.gain.linearRampToValueAtTime(0, t + 2.2);
  chain(s, F("lowpass", 2500 + 4000 * vel, 0.7), g, P(pan), S.N.sandBus);
  s.start(t);
  s.stop(t + 2.3);
}

function setMaqam(name) {
  S.maqam = name;
  const t = UI.ready();
  [0, 1, 2, 3, 4, 3, 2, 1, 0].forEach((deg, i) =>
    qanun(degFreq(deg + 7), t + i * 0.11, i === 0 ? 0.9 : 0.6, rand(-0.3, 0.3)),
  );
  Sand.redraw();
}

const UI = {
  ready() {
    initAudio();
    if (S.ctx.state !== "running") S.ctx.resume();
    return S.ctx.currentTime + 0.01;
  },
  swish(from, to, dur, peak, attack = 0.01) {
    const t = UI.ready();
    const s = S.ctx.createBufferSource();
    s.buffer = S.N.white;
    const bp = F("bandpass", from, 1.1);
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = G(0);
    env(g.gain, t, peak, attack, dur);
    chain(s, bp, g, S.N.ui);
    s.start(t, rand(0, 3));
    s.stop(t + attack + dur + 0.05);
  },
  thump(f, peak) {
    const t = UI.ready();
    const o = S.ctx.createOscillator();
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.4, t + 0.09);
    const g = G(0);
    env(g.gain, t, peak, 0.002, 0.1);
    o.connect(g).connect(S.N.ui);
    o.start(t);
    o.stop(t + 0.15);
  },
  sand(i = 0) {
    UI.swish(7000 - i * 900, 900 + i * 150, 0.22, 0.45);
    UI.thump(160 - i * 15, 0.35);
  },
  zill(i = 0) {
    const t = UI.ready();
    const base = [2093, 2349, 2637, 3136][i % 4];
    [
      [1, 0.16, 1.6],
      [1.51, 0.09, 1.1],
      [2.13, 0.06, 0.8],
      [2.76, 0.035, 0.5],
    ].forEach(([r, a, d]) => {
      [0, 2.7].forEach((det) => {
        const o = S.ctx.createOscillator();
        o.frequency.value = base * r + det;
        const g = G(0);
        env(g.gain, t, a * 0.7, 0.002, d);
        o.connect(g).connect(S.N.ui);
        o.start(t);
        o.stop(t + d + 0.1);
      });
    });
  },
  play() {
    UI.swish(500, 5000, 0.4, 0.3, 0.2);
    UI.zill(0);
  },
  pause() {
    UI.swish(5000, 400, 0.45, 0.3);
    UI.thump(110, 0.3);
  },
};

const Sand = {
  canvas: null,
  g: null,
  w: 0,
  h: 0,
  pad: 18,
  grain: null,
  strokes: [],
  cur: null,
  scrape: null,
  LOW: 0,
  HIGH: 14,

  init(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    this.resize();
    window.addEventListener("resize", () => this.resize());
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", (e) => this.up(e));
    canvas.addEventListener("pointercancel", (e) => this.up(e));
    let last = performance.now();
    const loop = (now) => {
      this.frame(now, Math.min(0.1, (now - last) / 1000));
      last = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  },

  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const gc = document.createElement("canvas");
    gc.width = this.canvas.width;
    gc.height = this.canvas.height;
    const gg = gc.getContext("2d");
    gg.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let i = 0; i < (this.w * this.h) / 9; i++) {
      gg.fillStyle =
        Math.random() < 0.5
          ? "rgba(120,100,70,0.10)"
          : "rgba(255,255,255,0.35)";
      gg.fillRect(Math.random() * this.w, Math.random() * this.h, 1, 1);
    }
    this.grain = gc;
  },

  yOf(deg) {
    const c = degCents(deg),
      top = degCents(this.HIGH);
    return this.h - this.pad - (c / top) * (this.h - 2 * this.pad);
  },
  nearestDeg(y) {
    let best = this.LOW,
      dist = Infinity;
    for (let d = this.LOW; d <= this.HIGH; d++) {
      const dd = Math.abs(this.yOf(d) - y);
      if (dd < dist) {
        dist = dd;
        best = d;
      }
    }
    return best;
  },
  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      t: performance.now() / 1000,
    };
  },
  pan(x) {
    return (x / this.w) * 1.6 - 0.8;
  },

  down(e) {
    UI.ready();
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.pos(e);
    const deg = this.nearestDeg(p.y);
    this.cur = {
      pts: [p],
      events: [{ t: 0, deg, vel: 0.8, x: p.x }],
      deg,
      life: 1,
      t0: p.t,
      lastNote: p.t,
    };
    this.note(deg, 0.8, p.x);
    const src = LOOP(S.N.white),
      bp = F("bandpass", 1500, 1.2),
      g = G(0);
    chain(src, bp, g, S.N.sandBus);
    this.scrape = { src, bp, g };
  },

  move(e) {
    if (!this.cur) return;
    const p = this.pos(e),
      c = this.cur,
      prev = c.pts[c.pts.length - 1];
    const dt = Math.max(0.001, p.t - prev.t);
    const speed = Math.hypot(p.x - prev.x, p.y - prev.y) / dt;
    c.pts.push(p);

    const now = S.ctx.currentTime;
    this.scrape.g.gain.setTargetAtTime(Math.min(0.5, speed / 2500), now, 0.03);
    this.scrape.bp.frequency.setTargetAtTime(
      600 + (1 - p.y / this.h) * 4000,
      now,
      0.05,
    );

    const deg = this.nearestDeg(p.y);
    if (deg !== c.deg && p.t - c.lastNote > 0.045) {
      const vel = Math.min(1, 0.35 + speed / 1500);
      c.deg = deg;
      c.lastNote = p.t;
      c.events.push({ t: p.t - c.t0, deg, vel, x: p.x });
      this.note(deg, vel, p.x);
    }
  },

  up() {
    if (!this.cur) return;
    const sc = this.scrape;
    if (sc) {
      sc.g.gain.setTargetAtTime(0, S.ctx.currentTime, 0.05);
      setTimeout(() => sc.src.stop(), 400);
    }
    this.scrape = null;
    const c = this.cur;
    this.cur = null;
    if (c.pts.length < 3) return;
    c.dur = Math.max(0.6, c.pts[c.pts.length - 1].t - c.t0) + 0.8;
    c.start = performance.now() / 1000;
    c.phase = 0;
    this.strokes.push(c);
    if (this.strokes.length > 4) this.strokes.shift();
  },

  note(deg, vel, x) {
    qanun(degFreq(deg), S.ctx.currentTime + 0.005, vel, this.pan(x));
  },

  frame(now, dt) {
    const g = this.g,
      nowS = now / 1000;
    const wind = (S.playing && S.presets.desert === "fury" ? 3 : 1) / 30;

    this.strokes.forEach((st) => {
      st.life -= dt * wind;
      if (!S.playing || st.life <= 0) return;
      const prev = st.phase;
      st.phase = (nowS - st.start) % st.dur;
      const wrapped = st.phase < prev;
      st.events.forEach((ev) => {
        const hit = wrapped
          ? ev.t > prev || ev.t <= st.phase
          : ev.t > prev && ev.t <= st.phase;
        if (hit)
          qanun(
            degFreq(ev.deg),
            S.ctx.currentTime + 0.01,
            ev.vel * st.life * 0.8,
            this.pan(ev.x),
          );
      });
    });
    this.strokes = this.strokes.filter((st) => st.life > 0);

    this.draw(nowS);
  },

  redraw() {},

  draw(nowS) {
    const g = this.g,
      w = this.w,
      h = this.h;
    g.clearRect(0, 0, w, h);
    if (this.grain) g.drawImage(this.grain, 0, 0, w, h);

    const m = MAQAMS[S.maqam];
    g.font = '11px "Arial Narrow", Arial, sans-serif';
    g.textBaseline = "middle";
    for (let d = this.LOW; d <= this.HIGH; d++) {
      const y = this.yOf(d),
        i = ((d % 7) + 7) % 7;
      const quarter = m.cents[i] % 100 !== 0;
      g.fillStyle = quarter ? "rgba(201,84,65,0.75)" : "rgba(109,109,109,0.35)";
      for (let x = 46; x < w - 10; x += 8) g.fillRect(x, y - 0.75, 2, 1.5);
      g.fillStyle = quarter ? "#c95441" : "#8a8a8a";
      g.fillText(m.names[i], 10, y);
    }

    const all = this.cur ? [...this.strokes, this.cur] : this.strokes;
    all.forEach((st) => {
      const a = Math.max(0, st.life);
      [
        [1.5, 6, `rgba(120,100,70,${0.45 * a})`],
        [0, 4, `rgba(185,165,128,${0.9 * a})`],
        [-1, 1.5, `rgba(255,255,255,${0.7 * a})`],
      ].forEach(([off, lw, col]) => {
        g.strokeStyle = col;
        g.lineWidth = lw;
        g.lineCap = "round";
        g.lineJoin = "round";
        g.beginPath();
        st.pts.forEach((p, k) =>
          k ? g.lineTo(p.x + off, p.y + off) : g.moveTo(p.x + off, p.y + off),
        );
        g.stroke();
      });
      if (st.dur && S.playing) {
        const tt = st.t0 + st.phase;
        const p = st.pts.find((q) => q.t >= tt);
        if (p) {
          g.fillStyle = `rgba(201,84,65,${a})`;
          g.beginPath();
          g.arc(p.x, p.y, 4, 0, Math.PI * 2);
          g.fill();
        }
      }
    });
  },
};

function renderRuler() {
  const el = document.getElementById("maqamRuler");
  if (!el) return;
  const m = MAQAMS[S.maqam];
  document.getElementById("maqamAr").textContent = m.ar;
  el.innerHTML = "";
  [...m.cents, 1200].forEach((c, i) => {
    const dot = document.createElement("span");
    dot.className = "ruler-dot" + (c % 100 ? " is-quarter" : "");
    dot.style.left = (c / 1200) * 100 + "%";
    dot.title = m.names[i % 7];
    el.appendChild(dot);
  });
}

function paintSlider(sl) {
  const pct = ((sl.value - sl.min) / (sl.max - sl.min)) * 100;
  sl.style.setProperty("--fill", pct + "%");
}

function updateTransport() {
  document.body.classList.toggle("is-playing", S.playing);
  document.getElementById("playBtn").classList.toggle("is-active", S.playing);
  document.getElementById("pauseBtn").classList.toggle("is-active", !S.playing);
}

function initScopes() {
  const scopes = [...document.querySelectorAll(".scope")].map((c) => ({
    c,
    side: c.dataset.scope,
    prev: [],
  }));
  const bins = new Uint8Array(1024);

  function draw() {
    requestAnimationFrame(draw);
    scopes.forEach((sc) => {
      const { c } = sc;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth,
        h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const g = c.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      const an =
        S.ctx && (sc.side === "desert" ? S.N.desertScope : S.N.caravanScope);
      if (an && S.playing) an.getByteFrequencyData(bins);
      else bins.fill(0);

      const gap = 9,
        n = Math.floor(w / gap);
      g.fillStyle = S.playing ? "#c95441" : "#b9b6a8";
      for (let i = 0; i <= n; i++) {
        const bin = Math.floor(Math.pow(300, i / n));
        const v = bins[bin] / 255;
        const y = (sc.prev[i] || 0) * 0.7 + v * 0.3;
        sc.prev[i] = y;
        g.beginPath();
        g.arc(i * gap + 4, h - 3 - y * (h - 6), 1.8, 0, Math.PI * 2);
        g.fill();
      }
    });
  }
  draw();
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("input[data-param]").forEach((sl) => {
      const name = sl.dataset.param;
      S.params[name] = +sl.value;
      paintSlider(sl);
      sl.addEventListener("input", () => {
        S.params[name] = +sl.value;
        paintSlider(sl);
        applyParam(name);
      });
    });

    document.querySelectorAll(".panel").forEach((panel) => {
      const side = panel.dataset.side;
      const buttons = panel.querySelectorAll(".preset-btn");
      const active = panel.querySelector(".preset-btn.active");
      if (active) S.presets[side] = active.dataset.preset.toLowerCase();

      buttons.forEach((btn, i) => {
        btn.addEventListener("click", () => {
          side === "desert" ? UI.sand(i) : UI.zill(i);
          if (btn.classList.contains("active")) return;
          buttons.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          setVoice(side, btn.dataset.preset.toLowerCase());
        });
      });
    });

    const maqamBtns = document.querySelectorAll(".maqam-btn");
    maqamBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.classList.contains("active")) {
          setMaqam(btn.dataset.maqam);
          return;
        }
        maqamBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        setMaqam(btn.dataset.maqam);
        renderRuler();
      });
    });
    renderRuler();

    Sand.init(document.getElementById("sand"));

    document.getElementById("playBtn").addEventListener("click", play);
    document.getElementById("pauseBtn").addEventListener("click", pause);

    document.addEventListener("keydown", (e) => {
      if (e.code !== "Space" || e.target.tagName === "BUTTON") return;
      e.preventDefault();
      S.playing ? pause() : play();
    });

    initScopes();
  });
}
