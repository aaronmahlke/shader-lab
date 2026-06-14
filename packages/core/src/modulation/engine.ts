import type { LFOSource, ModulationAssignment } from "../types/editor";
import type { ModulationFn } from "../compiler/compile-passes";
import { applyModulation } from "./modulation";
import { evaluateLfoWave, getLfoWaveShape } from "./lfo-wave";

export class ModulationEngine {
  private lfos: LFOSource[] = [];
  private assignments: ModulationAssignment[] = [];
  private lfoValues: Record<string, number> = {};

  setLfos(lfos: LFOSource[]): void {
    this.lfos = lfos;
  }

  setAssignments(assignments: ModulationAssignment[]): void {
    this.assignments = assignments;
  }

  sampleAt(clockSeconds: number): void {
    const values: Record<string, number> = {};

    for (const lfo of this.lfos) {
      const phaseOffset = lfo.phase / 360;
      const rawT = lfo.mode === "pingpong"
        ? (clockSeconds * lfo.rate + phaseOffset) % 2
        : (clockSeconds * lfo.rate + phaseOffset) % 1;
      const t = lfo.mode === "pingpong" && rawT > 1 ? 2 - rawT : rawT;
      const clampedT = Math.max(0, Math.min(1, t));
      values[lfo.id] = evaluateLfoWave(getLfoWaveShape(lfo), lfo.points, clampedT);
    }

    this.lfoValues = values;
  }

  getModulatedValue: ModulationFn = (layerId, paramName, baseValue) => {
    const assignment = this.assignments.find(
      (a) => a.layerId === layerId && a.paramName === paramName,
    );
    if (!assignment) return baseValue;

    const lfoValue = this.lfoValues[assignment.sourceId] ?? 0;
    return applyModulation(baseValue, paramName, lfoValue, assignment.depth);
  };

  getLfoValues(): Record<string, number> {
    return { ...this.lfoValues };
  }

  createModulationFn(clockSeconds: number): ModulationFn {
    this.sampleAt(clockSeconds);
    return this.getModulatedValue;
  }
}

export function createModulationFn(
  lfos: LFOSource[],
  assignments: ModulationAssignment[],
  clockSeconds: number,
): ModulationFn {
  const engine = new ModulationEngine();
  engine.setLfos(lfos);
  engine.setAssignments(assignments);
  return engine.createModulationFn(clockSeconds);
}
