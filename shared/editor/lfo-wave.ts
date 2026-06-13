import type { LFOSource, LFOWaveShape, WavePoint } from "../types/editor";
import { LFO_PRESETS } from "./lfo-presets";

function schlickBias(t: number, b: number): number {
  t = Math.max(0, Math.min(1, t));
  b = Math.max(0.001, Math.min(0.999, b));
  return t / ((1 / b - 2) * (1 - t) + 1);
}

function curveToB(curve: number): number {
  return 1 / (1 + Math.exp(curve * 3));
}

function effectiveCurve(p1y: number, p2y: number, curve: number): number {
  return p2y >= p1y ? curve : -curve;
}

export function evaluateSineWave(t: number): number {
  return 0.5 + 0.5 * Math.sin(2 * Math.PI * t);
}

export function evaluateWavePoints(points: WavePoint[], t: number): number {
  if (points.length === 0) return 0.5;
  if (points.length === 1) return points[0]!.y;

  t = Math.max(0, Math.min(1, t));

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]!;
    const p2 = points[i + 1]!;

    if (t >= p1.x && (t <= p2.x || i === points.length - 2)) {
      const segLen = p2.x - p1.x;
      if (segLen < 0.0001) return p2.y;

      const segT = (t - p1.x) / segLen;
      const eff = effectiveCurve(p1.y, p2.y, p1.curve);
      const b = curveToB(eff);
      const curvedT = schlickBias(segT, b);
      return p1.y + (p2.y - p1.y) * curvedT;
    }
  }

  return points[points.length - 1]!.y;
}

export function evaluateLfoWave(shape: LFOWaveShape, points: WavePoint[], t: number): number {
  if (shape === "sine") return evaluateSineWave(t);
  return evaluateWavePoints(points, t);
}

export function getLfoWaveShape(lfo: LFOSource): LFOWaveShape {
  return lfo.waveShape ?? "sine";
}

export function inferLfoWaveShape(points: WavePoint[]): LFOWaveShape {
  const matchesSine = JSON.stringify(points) === JSON.stringify(LFO_PRESETS.sine.points);
  return matchesSine ? "sine" : "custom";
}

export function normalizeLfo(lfo: LFOSource): LFOSource {
  if (lfo.waveShape) return lfo;
  return { ...lfo, waveShape: inferLfoWaveShape(lfo.points) };
}
