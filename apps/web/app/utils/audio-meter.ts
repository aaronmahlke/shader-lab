/**
 * Loudness / peak measurement (ITU-R BS.1770 / EBU R128 style) for agents:
 * integrated LUFS (gated), short-term LUFS over time (3 s windows, every
 * 0.5 s), sample peak and true peak (4× oversampled).
 */
export type Loudness = {
  integratedLufs: number;
  shortTerm: { time: number; lufs: number }[];
  maxShortTermLufs: number;
  samplePeakDb: number;
  truePeakDb: number;
};

const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/** K-weighting (pre-filter shelf + RLB high-pass) via biquads. */
async function kWeighted(buffer: AudioBuffer): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const src = new AudioBufferSourceNode(ctx, { buffer });
  const shelf = new BiquadFilterNode(ctx, { type: "highshelf", frequency: 1681.97, gain: 4.0 });
  // Web Audio's highpass Q is in dB: BS.1770's Q 0.5003 → 20·log10(0.5003) ≈ −6.02 dB.
  const hp = new BiquadFilterNode(ctx, { type: "highpass", frequency: 38.13, Q: 20 * Math.log10(0.5003) });
  src.connect(shelf).connect(hp).connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

/** Mean square per 400 ms block (75 % overlap), summed over channels. */
function blockPowers(k: AudioBuffer, blockSec: number, hopSec: number): { time: number; power: number }[] {
  const sr = k.sampleRate;
  const block = Math.round(blockSec * sr);
  const hop = Math.round(hopSec * sr);
  const chans = Array.from({ length: k.numberOfChannels }, (_, c) => k.getChannelData(c));
  const out: { time: number; power: number }[] = [];
  for (let s = 0; s + block <= k.length; s += hop) {
    let p = 0;
    for (const d of chans) {
      let sum = 0;
      for (let i = s; i < s + block; i++) sum += d[i]! * d[i]!;
      p += sum / block;
    }
    out.push({ time: (s + block) / sr, power: p });
  }
  return out;
}
const lufsOf = (power: number) => -0.691 + 10 * Math.log10(power + 1e-12);

/** Max |x| over 4× oversampled channels (48-tap windowed sinc per phase). */
function truePeak(buffer: AudioBuffer): number {
  const taps = 12; // per side
  const phases = [0.25, 0.5, 0.75].map((f) => {
    const k: number[] = [];
    for (let n = -taps + 1; n <= taps; n++) {
      const x = n - f;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 * (1 + Math.cos((Math.PI * x) / (taps + 1))); // Hann
      k.push(sinc * w);
    }
    return k;
  });
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]!);
      if (a > peak) peak = a;
      // Only look between samples where it could matter.
      if (a < peak * 0.7) continue;
      for (const k of phases) {
        let y = 0;
        for (let j = 0; j < k.length; j++) {
          const idx = i + (j - taps + 1);
          if (idx >= 0 && idx < d.length) y += d[idx]! * k[j]!;
        }
        if (Math.abs(y) > peak) peak = Math.abs(y);
      }
    }
  }
  return peak;
}

export async function measureLoudness(buffer: AudioBuffer): Promise<Loudness> {
  const k = await kWeighted(buffer);
  // Integrated: 400 ms blocks, absolute gate −70 LUFS, relative gate −10 LU.
  const blocks = blockPowers(k, 0.4, 0.1);
  const abs = blocks.filter((b) => lufsOf(b.power) > -70);
  const rel = abs.length ? lufsOf(abs.reduce((a, b) => a + b.power, 0) / abs.length) - 10 : -70;
  const gated = abs.filter((b) => lufsOf(b.power) > rel);
  const integratedLufs = gated.length ? lufsOf(gated.reduce((a, b) => a + b.power, 0) / gated.length) : -Infinity;
  // Short-term: 3 s windows every 0.5 s.
  const shortTerm = blockPowers(k, 3, 0.5).map((b) => ({ time: Math.round(b.time * 100) / 100, lufs: Math.round(lufsOf(b.power) * 10) / 10 }));
  // Peaks.
  let sp = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) sp = Math.max(sp, Math.abs(d[i]!));
  }
  // True peak: 4× windowed-sinc interpolation (BS.1770 annex 2 style).
  const tp = truePeak(buffer);
  return {
    integratedLufs: Math.round(integratedLufs * 10) / 10,
    shortTerm,
    maxShortTermLufs: shortTerm.length ? Math.max(...shortTerm.map((s) => s.lufs)) : -Infinity,
    samplePeakDb: Math.round(db(sp) * 10) / 10,
    truePeakDb: Math.round(db(Math.max(tp, sp)) * 10) / 10,
  };
}
