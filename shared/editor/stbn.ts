/** NVIDIA STBN scalar atlas: 128×128 tiles, 8×8 grid, 64 frames. */
export const STBN_SLICE_SIZE = 128;
export const STBN_FRAME_COUNT = 64;
export const STBN_ATLAS_SIZE = STBN_SLICE_SIZE * 8;
export const STBN_ANIM_FPS = 24;

export const STBN_TEXTURE_PATH = "/textures/stbn-scalar-128x64.png";

export function stbnFrameIndex(time: number, speed: number): number {
  if (speed <= 0.001) return 0;
  return Math.floor(time * speed * STBN_ANIM_FPS) % STBN_FRAME_COUNT;
}
