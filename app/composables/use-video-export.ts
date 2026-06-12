import { Output, Mp4OutputFormat, BufferTarget, CanvasSource } from "mediabunny";
import { canvasVideoEncodingConfig } from "#shared/editor/video-encoding";

type ExportOptions = {
  width: number;
  height: number;
  fps: number;
  duration: number;
  experimentId: string;
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
};

export function useVideoExport() {
  const state = reactive<ExportState>({
    exporting: false,
    progress: 0,
    currentFrame: 0,
    totalFrames: 0,
  });

  let aborted = false;

  async function exportVideo(
    shader: ShaderControls,
    options: ExportOptions,
  ): Promise<void> {
    const { width, height, fps, duration, experimentId } = options;
    const totalFrames = Math.ceil(fps * duration);
    const frameDuration = 1 / fps;

    // Capture the current time so the video starts from the current animation state
    const startTime = performance.now() / 1000;

    aborted = false;
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
      const output = new Output({
        format: new Mp4OutputFormat(),
        target: new BufferTarget(),
      });

      const videoSource = new CanvasSource(
        canvas,
        canvasVideoEncodingConfig(width, height, fps),
      );

      output.addVideoTrack(videoSource);
      await output.start();

      // Render frames
      for (let i = 0; i < totalFrames; i++) {
        if (aborted) break;

        const time = startTime + i * frameDuration;
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
          const blob = new Blob([buffer], { type: "video/mp4" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${experimentId}-${width}x${height}-${fps}fps.mp4`;
          a.click();
          URL.revokeObjectURL(url);
        }
      }
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
