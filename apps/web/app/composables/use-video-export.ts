import { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource } from "mediabunny";
import { negotiateCanvasEncoding, type ExportFormatPreference } from "#shared/editor/video-encoding";

type ExportOptions = {
  width: number;
  height: number;
  fps: number;
  duration: number;
  experimentId: string;
  format?: ExportFormatPreference;
};

type ShaderControls = {
  pause: () => void;
  resume: () => void;
  getCanvas: () => HTMLCanvasElement | null;
  configureRenderer: (width: number, height: number) => void;
  restoreRenderer: () => void;
  renderFrame: (time: number) => void | Promise<void>;
};

type ExportState = {
  exporting: boolean;
  progress: number;
  currentFrame: number;
  totalFrames: number;
  error: string | null;
};

export function useVideoExport() {
  const state = reactive<ExportState>({
    exporting: false,
    progress: 0,
    currentFrame: 0,
    totalFrames: 0,
    error: null,
  });

  let aborted = false;

  async function exportVideo(
    shader: ShaderControls,
    options: ExportOptions,
  ): Promise<void> {
    const { width, height, fps, duration, experimentId, format = "auto" } = options;
    const totalFrames = Math.ceil(fps * duration);
    const frameDuration = 1 / fps;

    // Export renders COMPOSITION time from 0: keyframe tracks and layer in/out
    // windows live on the timeline. The previous wall-clock start (performance.now)
    // evaluated tracks far past their last keyframe, freezing all keyframed
    // animation in exports while self-animating DOM content kept moving.

    aborted = false;
    state.error = null;
    state.exporting = true;
    state.progress = 0;
    state.currentFrame = 0;
    state.totalFrames = totalFrames;

    shader.pause();
    shader.configureRenderer(width, height);

    const canvas = shader.getCanvas();
    if (!canvas) {
      shader.restoreRenderer();
      shader.resume();
      state.exporting = false;
      return;
    }

    try {
      // Pick a codec the browser can actually encode at this size: H.264
      // levels cap out around 4K, so 4x-scale exports fall back to VP9/AV1.
      const encoding = await negotiateCanvasEncoding(width, height, fps, format);

      const output = new Output({
        format: encoding.container === "webm" ? new WebMOutputFormat() : new Mp4OutputFormat(),
        target: new BufferTarget(),
      });

      const videoSource = new CanvasSource(canvas, encoding.config);

      output.addVideoTrack(videoSource);
      await output.start();

      // Render frames
      for (let i = 0; i < totalFrames; i++) {
        if (aborted) break;

        const time = i * frameDuration;
        await Promise.resolve(shader.renderFrame(time));

        await videoSource.add(i * frameDuration, frameDuration);

        state.currentFrame = i + 1;
        state.progress = (i + 1) / totalFrames;

        // Yield to UI every few frames so progress updates render
        if (i % 4 === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      videoSource.close();
      await output.finalize();

      if (!aborted) {
        const buffer = output.target.buffer;
        if (buffer) {
          const blob = new Blob([buffer], { type: encoding.mimeType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${experimentId}-${width}x${height}-${fps}fps.${encoding.extension}`;
          a.click();
          URL.revokeObjectURL(url);
        }
      }
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Export failed.";
    } finally {
      shader.restoreRenderer();
      shader.resume();
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
