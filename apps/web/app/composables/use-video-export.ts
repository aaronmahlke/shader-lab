import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  CanvasSource,
  AudioBufferSource,
  EncodedVideoPacketSource,
  EncodedPacketSink,
  Input,
  BlobSource,
  ALL_FORMATS,
  getFirstEncodableAudioCodec,
} from "mediabunny";
import { negotiateCanvasEncoding, type ExportFormatPreference } from "#shared/editor/video-encoding";

type ExportOptions = {
  width: number;
  height: number;
  fps: number;
  duration: number;
  experimentId: string;
  format?: ExportFormatPreference;
  /** What this render is (comp id, project, visual fingerprint…): MP4 comment + result. */
  meta?: Record<string, unknown>;
  /** "download" (default) saves the file; "return" only hands back the result. */
  deliver?: "download" | "return";
  /**
   * A stored earlier render of the same picture (same visual fingerprint and
   * settings): its video packets are copied as is, only the audio is new.
   */
  reuseVideo?: { url: string } | null;
};

export type ExportResult = {
  blob: Blob;
  mimeType: string;
  extension: string;
  frames: number;
  /** Runs of ≥ 1 s where consecutive frames came out identical: [start s, end s]. */
  frozen: [number, number][];
  /** True when the video was copied from the stored render (audio-only change). */
  reusedVideo: boolean;
  meta: Record<string, unknown>;
};

type ShaderControls = {
  pause: () => void;
  resume: () => void;
  getCanvas: () => HTMLCanvasElement | null;
  configureRenderer: (width: number, height: number) => void;
  restoreRenderer: () => void;
  renderFrame: (time: number) => void | Promise<void>;
  /** The comp's sound mixed down (audio layers), or null when silent. */
  renderAudio?: (duration: number) => Promise<AudioBuffer | null>;
};

type ExportState = {
  exporting: boolean;
  progress: number;
  currentFrame: number;
  totalFrames: number;
  error: string | null;
};

/** 64×36 thumbnail hash of the canvas (cheap still-frame detector, exact bytes). */
function makeFrameHasher() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 36;
  const g = c.getContext("2d", { willReadFrequently: true });
  return (canvas: HTMLCanvasElement): number => {
    if (!g) return 0;
    g.drawImage(canvas, 0, 0, 64, 36);
    const d = g.getImageData(0, 0, 64, 36).data;
    let h = 0x811c9dc5;
    for (let i = 0; i < d.length; i++) {
      if ((i & 3) === 3) continue;
      h ^= d[i]!;
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };
}

/** PCM16 WAV of an AudioBuffer. */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  data.setUint32(4, 36 + len * ch * 2, true);
  str(8, "WAVEfmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, buffer.sampleRate, true);
  data.setUint32(28, buffer.sampleRate * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  str(36, "data");
  data.setUint32(40, len * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => buffer.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c]![i]!));
      data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([data.buffer], { type: "audio/wav" });
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function useVideoExport() {
  const state = reactive<ExportState>({
    exporting: false,
    progress: 0,
    currentFrame: 0,
    totalFrames: 0,
    error: null,
  });

  let aborted = false;

  async function exportVideo(shader: ShaderControls, options: ExportOptions): Promise<ExportResult | null> {
    const { width, height, fps, duration, experimentId, format = "auto", deliver = "download" } = options;
    const totalFrames = Math.ceil(fps * duration);
    const frameDuration = 1 / fps;
    const meta: Record<string, unknown> = {
      ...options.meta,
      kind: "video",
      width,
      height,
      fps,
      duration,
      frames: totalFrames,
      renderedAt: new Date().toISOString(),
    };

    // Export renders COMPOSITION time from 0: keyframe tracks and layer in/out
    // windows live on the timeline.
    aborted = false;
    state.error = null;
    state.exporting = true;
    state.progress = 0;
    state.currentFrame = 0;
    state.totalFrames = totalFrames;

    let reused = false;
    let configured = false;
    try {
      const encoding = await negotiateCanvasEncoding(width, height, fps, format);
      meta.container = encoding.container;
      const outputFormat = encoding.container === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat();
      const output = new Output({ format: outputFormat, target: new BufferTarget() });
      output.setMetadataTags({ comment: JSON.stringify(meta), title: String(meta.compName ?? experimentId) });

      // --- Video: copy the stored render's packets, or render frames ---
      const frozen: [number, number][] = [];
      let copyPackets: (() => Promise<void>) | null = null;
      if (options.reuseVideo) {
        try {
          const blob = await (await fetch(options.reuseVideo.url)).blob();
          const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
          const track = await input.getPrimaryVideoTrack();
          const config = await track?.getDecoderConfig();
          if (track && config) {
            const codec = track.codec;
            if (!codec) throw new Error("Unknown video codec");
            const source = new EncodedVideoPacketSource(codec);
            output.addVideoTrack(source, { frameRate: fps });
            copyPackets = async () => {
              const sink = new EncodedPacketSink(track);
              let first = true;
              for await (const packet of sink.packets()) {
                if (aborted) break;
                await source.add(packet, first ? { decoderConfig: config } : undefined);
                first = false;
              }
              source.close();
            };
            reused = true;
          }
        } catch (err) {
          console.warn("[export] can't reuse the stored video, rendering", err);
          reused = false;
        }
      }

      let videoSource: CanvasSource | null = null;
      let canvas: HTMLCanvasElement | null = null;
      if (!reused) {
        shader.pause();
        shader.configureRenderer(width, height);
        configured = true;
        canvas = shader.getCanvas();
        if (!canvas) throw new Error("No canvas to render");
        videoSource = new CanvasSource(canvas, encoding.config);
        output.addVideoTrack(videoSource);
      }

      // --- Audio: layers mixed offline, AAC (MP4) / Opus (WebM) ---
      const mix = shader.renderAudio ? await shader.renderAudio(duration) : null;
      let audioSource: AudioBufferSource | null = null;
      if (mix) {
        const preferred = outputFormat.getSupportedAudioCodecs().filter((c) => c === "aac" || c === "opus");
        const codec = await getFirstEncodableAudioCodec(preferred, {
          numberOfChannels: mix.numberOfChannels,
          sampleRate: mix.sampleRate,
          bitrate: 192_000,
        });
        if (codec) {
          audioSource = new AudioBufferSource({ codec, bitrate: 192_000 });
          output.addAudioTrack(audioSource);
        } else {
          console.warn("[export] no encodable audio codec; exporting without sound");
        }
      }
      await output.start();
      if (audioSource && mix) {
        await audioSource.add(mix);
        audioSource.close();
      }

      if (copyPackets) {
        await copyPackets();
        state.progress = 1;
        state.currentFrame = totalFrames;
      } else if (videoSource && canvas) {
        const hash = makeFrameHasher();
        let runStart = 0;
        let last = -1;
        for (let i = 0; i < totalFrames; i++) {
          if (aborted) break;
          const time = i * frameDuration;
          await Promise.resolve(shader.renderFrame(time));
          await videoSource.add(time, frameDuration);
          // Frozen-frame watch: identical thumbnails for ≥ 1 s get reported.
          const h = hash(canvas);
          if (h !== last) {
            if ((i - runStart) / fps >= 1) frozen.push([runStart / fps, i / fps]);
            runStart = i;
            last = h;
          }
          state.currentFrame = i + 1;
          state.progress = (i + 1) / totalFrames;
          // Yield to UI every few frames so progress updates render
          if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        if ((totalFrames - runStart) / fps >= 1) frozen.push([runStart / fps, totalFrames / fps]);
        videoSource.close();
      }
      await output.finalize();
      if (aborted) return null;

      const buffer = output.target.buffer;
      if (!buffer) throw new Error("Export produced no data");
      const blob = new Blob([buffer], { type: encoding.mimeType });
      const name = `${experimentId}-${width}x${height}-${fps}fps.${encoding.extension}`;
      if (deliver === "download") download(blob, name);
      meta.frozen = frozen;
      meta.reusedVideo = reused;
      return {
        blob,
        mimeType: encoding.mimeType,
        extension: encoding.extension,
        frames: totalFrames,
        frozen,
        reusedVideo: reused,
        meta,
      };
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Export failed.";
      return null;
    } finally {
      if (configured) {
        shader.restoreRenderer();
        shader.resume();
      }
      state.exporting = false;
      state.progress = 0;
      state.currentFrame = 0;
      state.totalFrames = 0;
    }
  }

  function abort() {
    aborted = true;
  }

  return {
    state,
    exportVideo,
    abort,
  };
}
