export type MeshPoint = {
  /** 0–1, left → right (fragment UV space, origin bottom-left) */
  x: number;
  /** 0–1, bottom → top */
  y: number;
  color: string;
  /** Influence radius in aspect-corrected UV units (~0.3–1.2) */
  radius: number;
};

export const MESH_MAX_POINTS = 6;
