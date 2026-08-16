#!/usr/bin/env node
// Seeds the "3D Playground" demo project (Scene / Orbit / Nested) through the
// dev API. Requires the dev server on :3000 and the /auth/dev route (dev only).
const B = process.env.SEED_BASE ?? "http://localhost:3000";

const login = await fetch(`${B}/auth/dev`, { redirect: "manual" });
const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const H = { "content-type": "application/json", cookie };

const DUR = 4;
const uni = (v = {}) => ({
  layerPositionX: 0, layerPositionY: 0, layerScale: 100, layerRotation: 0,
  layerAnchorX: 0.5, layerAnchorY: 0.5, layerOpacity: 100, layerBlendMode: 0, ...v,
});
const orbitTracks = (ids) => {
  const tracks = [];
  ids.forEach((id, i) => {
    const phase = (i / ids.length) * Math.PI * 2;
    const z = [], y = [];
    for (let k = 0; k <= 24; k++) {
      const t = (k / 24) * DUR, a = (k / 24) * Math.PI * 2 + phase;
      z.push({ time: t, value: Math.sin(a) * 0.3 });
      y.push({ time: t, value: Math.cos(a) * 22 });
    }
    tracks.push({ layerId: id, paramName: "layerPositionZ", enabled: true, keys: z });
    tracks.push({ layerId: id, paramName: "layerRotationY", enabled: true, keys: y });
  });
  return tracks;
};

const scene = {
  version: 1, lfos: [], assignments: [],
  layers: [
    { id: "cam", type: "camera", enabled: true, values: {
      tilt: 0, yaw: 0, roll: 0, zoom: 1, fov: 40, drive3d: true,
      focus: 0.4, focusRange: 0.12, aperture: 1.2, blurRadius: 12, dofSamples: 24,
      emission: 1.1, bloomThreshold: 0.85, bloomIntensity: 0.35, exposure: 0, aces: true,
      background: "#0b0b0f",
    }},
    { id: "sun", type: "light", enabled: true, values: { ...uni(), lightType: 0, lightColor: "#ffe9c4", intensity: 1.6, ambient: 0.18, azimuth: -50, elevation: 40 } },
    { id: "fill", type: "light", enabled: true, values: { ...uni({ layerPositionX: 0.35, layerPositionY: -0.1, layerPositionZ: 0.45 }), lightType: 1, lightColor: "#7aa2ff", intensity: 1.1, ambient: 0 } },
    { id: "sphere", type: "object3d", enabled: true, values: { ...uni({ layerPositionX: 0.22, layerPositionY: -0.06, layerPositionZ: 0.28 }), u_shape: 1, albedo: "#3b82f6", u_sizeX: 0.22, u_sizeY: 0.22, u_sizeZ: 0.22, specular: 0.8, shininess: 64, emissive: 0 } },
    { id: "cube", type: "object3d", enabled: true, values: { ...uni({ layerPositionX: -0.2, layerPositionY: -0.02, layerPositionZ: 0.1 }), u_shape: 0, albedo: "#e8590c", u_sizeX: 0.2, u_sizeY: 0.2, u_sizeZ: 0.2, specular: 0.5, shininess: 24, emissive: 0 } },
    { id: "card", type: "gradient", enabled: true, is3D: true, values: uni({ layerPositionZ: -0.25, layerAcceptsLight: 1 }) },
    { id: "base", type: "solid", enabled: true, values: { ...uni(), u_color: "#101014" } },
  ],
  tracks: [
    { layerId: "cam", paramName: "yaw", enabled: true, keys: [
      { time: 0, value: -16 }, { time: DUR / 2, value: 16, curve: [0.45, 0, 0.55, 1] }, { time: DUR, value: -16, curve: [0.45, 0, 0.55, 1] } ] },
    { layerId: "cam", paramName: "tilt", enabled: true, keys: [
      { time: 0, value: 6 }, { time: DUR / 2, value: -4 }, { time: DUR, value: 6 } ] },
    { layerId: "cube", paramName: "layerRotationY", enabled: true, keys: [
      { time: 0, value: 0 }, { time: DUR, value: 360 } ] },
  ],
  settings: { duration: DUR, fps: 60, width: 1920, height: 1080 },
};

const orbit = {
  version: 1, lfos: [], assignments: [],
  layers: [
    { id: "c1", type: "solid", enabled: true, is3D: true, values: { ...uni({ layerScale: 42, layerPositionX: -0.16 }), u_color: "#f35a0d" } },
    { id: "c2", type: "solid", enabled: true, is3D: true, values: { ...uni({ layerScale: 42 }), u_color: "#3b82f6" } },
    { id: "c3", type: "solid", enabled: true, is3D: true, values: { ...uni({ layerScale: 42, layerPositionX: 0.16 }), u_color: "#10b981" } },
    { id: "bg", type: "solid", enabled: true, values: { ...uni(), u_color: "#0b0b0f" } },
  ],
  tracks: orbitTracks(["c1", "c2", "c3"]),
  settings: { duration: DUR, fps: 60, width: 1920, height: 1080 },
};

const proj = await (await fetch(`${B}/api/projects`, { method: "POST", headers: H, body: JSON.stringify({ name: "3D Playground", data: scene }) })).json();
const pid = proj.id;
const sceneCompId = proj.compositions[0].id;
await fetch(`${B}/api/projects/${pid}/compositions/${sceneCompId}`, { method: "PATCH", headers: H, body: JSON.stringify({ name: "Scene" }) });
const orbitComp = await (await fetch(`${B}/api/projects/${pid}/compositions`, { method: "POST", headers: H, body: JSON.stringify({ name: "Orbit", data: orbit }) })).json();

const nested = {
  version: 1, lfos: [], assignments: [],
  layers: [
    { id: "pre", type: "composition", enabled: true, is3D: true, values: uni({ compRefId: orbitComp.id, layerScale: 62, layerRotationY: 24, layerPositionZ: 0.15 }) },
    { id: "noisebg", type: "noise", enabled: true, values: { ...uni({ layerOpacity: 30 }), scale: 3, octaves: 5, persistence: 0.5, speed: 0.3 } },
    { id: "base", type: "solid", enabled: true, values: { ...uni(), u_color: "#0b0b0f" } },
  ],
  tracks: [
    { layerId: "pre", paramName: "layerRotationY", enabled: true, keys: [
      { time: 0, value: 24 }, { time: DUR / 2, value: -24, curve: [0.45, 0, 0.55, 1] }, { time: DUR, value: 24, curve: [0.45, 0, 0.55, 1] } ] },
  ],
  settings: { duration: DUR, fps: 60, width: 1920, height: 1080 },
};
await fetch(`${B}/api/projects/${pid}/compositions`, { method: "POST", headers: H, body: JSON.stringify({ name: "Nested", data: nested }) });
console.log(`seeded project ${pid} (Scene ${sceneCompId})`);
