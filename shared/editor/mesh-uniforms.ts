import type { MeshPoint } from "../types/mesh";
import { MESH_MAX_POINTS } from "../types/mesh";
export type MeshPointField = "x" | "y" | "radius";

export type MeshModulationFn = (
  layerId: string,
  paramName: string,
  baseValue: number,
) => number;

export function meshParamName(index: number, field: MeshPointField): string {
  return `mesh.${index}.${field}`;
}

/** Grainy-dither ramp: dark basin, purple ridge, pink canopy, cream horizon, BR bloom. */
export const GRAINY_DITHER_MESH_POINTS: MeshPoint[] = [
  { x: 0.06, y: 0.92, color: "#08040f", radius: 1.05 },
  { x: 0.78, y: 0.82, color: "#c8e868", radius: 0.72 },
  { x: 0.9, y: 0.22, color: "#d05090", radius: 0.95 },
  { x: 0.52, y: 0.06, color: "#f2ead0", radius: 0.42 },
  { x: 0.18, y: 0.48, color: "#2a1868", radius: 1.15 },
  { x: 0.58, y: 0.4, color: "#6020a0", radius: 0.8 },
];

/** Default layout tuned for warm mesh + bloom highlight (reference-style). */
export const MESH_BLOOM_POINTS: MeshPoint[] = [
  { x: 0.08, y: 0.9, color: "#b86a4a", radius: 0.95 },
  { x: 0.92, y: 0.86, color: "#e8a070", radius: 0.88 },
  { x: 0.38, y: 0.52, color: "#a83868", radius: 1.15 },
  { x: 0.86, y: 0.14, color: "#f8f2ff", radius: 0.5 },
  { x: 0.1, y: 0.12, color: "#903060", radius: 0.92 },
  { x: 0.62, y: 0.42, color: "#d06890", radius: 0.78 },
];

export function cloneMeshPoints(points: MeshPoint[]): MeshPoint[] {
  return points.map((p) => ({ ...p }));
}

/** Flatten mesh layer values into shader uniforms (WebGL1-safe, no arrays). */
export function expandMeshUniforms(
  values: Record<string, unknown>,
  modFn: MeshModulationFn | null = null,
  layerId?: string,
): Record<string, unknown> {
  const points = (values.u_meshPoints as MeshPoint[] | undefined) ?? [];
  const softness = (values.softness as number) ?? 1.4;
  const gain = (values.gain as number) ?? 1.0;
  const count = Math.min(points.length, MESH_MAX_POINTS);

  const out: Record<string, unknown> = {
    u_pointCount: count,
    softness,
    gain,
  };

  for (let i = 0; i < MESH_MAX_POINTS; i++) {
    const p = points[i];
    let x = p?.x ?? 0;
    let y = p?.y ?? 0;
    let radius = p?.radius ?? 0.001;

    if (modFn && layerId && p) {
      x = modFn(layerId, meshParamName(i, "x"), x);
      y = modFn(layerId, meshParamName(i, "y"), y);
      radius = modFn(layerId, meshParamName(i, "radius"), radius);
    }

    out[`u_pos${i}`] = [x, y];
    out[`u_color${i}`] = p?.color ?? "#000000";
    out[`u_radius${i}`] = radius;
  }

  return out;
}
