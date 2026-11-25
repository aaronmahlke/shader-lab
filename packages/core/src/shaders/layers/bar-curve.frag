#ifdef GL_ES
precision highp float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform sampler2D u_input;
uniform bool u_hasInput;

uniform float peakX;
uniform float amplitude;
uniform float lift;
uniform float curveExp;
uniform float slatWidth;
uniform float barHeight;
uniform int bgMode;       // 0 = passthrough, 1 = black
uniform float cornerFade;
uniform float cornerWidth;
uniform bool intro;
uniform float introDuration;
uniform float introStagger;
uniform float introSlide;

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;

  // No input below: nothing to shift.
  if (!u_hasInput) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float cellWidth = max(slatWidth, 0.001);
  float numBarsF = floor(1.0 / cellWidth);
  float barIndex = floor(uv.x / cellWidth);
  float cellStart = barIndex * cellWidth;
  float localX = (uv.x - cellStart) / cellWidth;

  float barCenter = cellStart + cellWidth * 0.5;
  float dist = abs(barCenter - peakX);
  float normalizedDist = dist / 0.5;
  float curve = pow(1.0 - clamp(normalizedDist, 0.0, 1.0), max(curveExp, 0.001));

  float shift = amplitude * curve + lift;

  // Per-bar staggered intro slide-up (ease-out cubic).
  float barDelay = barIndex * introStagger;
  float barT = clamp((u_time - barDelay) / max(introDuration, 0.001), 0.0, 1.0);
  float barIntro = !intro ? 1.0 : (1.0 - pow(1.0 - barT, 3.0));
  float slideOffset = (1.0 - barIntro) * introSlide;

  float barBottom = -0.5 + shift - slideOffset;
  float barTop = barBottom + barHeight;

  // Sample the input below, shifted vertically by this bar's offset (world-space).
  vec2 sampleUV = vec2(uv.x, clamp(uv.y - shift, 0.0, 1.0));
  vec3 color = texture2D(u_input, sampleUV).rgb;

  bool insideBar = uv.y >= barBottom && uv.y <= barTop;
  if (!insideBar) {
    if (bgMode == 1) {
      color = vec3(0.0);
    } else {
      // Passthrough: un-shifted input reads through the gaps.
      color = texture2D(u_input, uv).rgb;
    }
  } else {
    // Corner fade: darken the top-inner edge of each bar (peak-facing side).
    float t = clamp((uv.y - barBottom) / max(barHeight, 0.001), 0.0, 1.0);
    float topT = smoothstep(cornerWidth, 1.0, t);
    float fadeIntensity = smoothstep(0.0, 0.3, normalizedDist);
    float corner = 0.0;
    if (barCenter < peakX) {
      corner = smoothstep(cornerWidth, 1.0, localX) * topT * fadeIntensity;
    } else if (barCenter > peakX) {
      corner = smoothstep(cornerWidth, 1.0, 1.0 - localX) * topT * fadeIntensity;
    }
    color *= 1.0 - corner * cornerFade;
    // In black mode, bars fade in from black (hero-faithful). In passthrough,
    // the slide-up motion alone is the intro — fading input to black looks wrong.
    if (bgMode == 1) color *= barIntro;
  }

  gl_FragColor = vec4(color, 1.0);
}
