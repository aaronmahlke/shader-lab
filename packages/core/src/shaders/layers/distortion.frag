#ifdef GL_ES
precision highp float;
#endif

uniform vec2 u_resolution;
uniform float u_time;
uniform sampler2D u_input;

// Shared parameters
uniform int waveType;     // 0=sine, 1=square, 2=triangle
uniform float freq;
uniform float amplitude;
uniform float direction;  // degrees (linear mode)

// Type-specific
uniform float sharpness;  // square: edge hardness (1=soft, 50=hard)
uniform float pulseWidth; // square: lobe width modulation
uniform float skew;       // triangle: lean (-1 to 1)

// Coordinate mode: 0=linear, 1=radial
uniform int coordMode;
uniform float centerX;
uniform float centerY;

#define PI 3.14159265359
#define TAU 6.28318530718

// --- Fast tanh approximation ---
float fastTanh(float x) {
  return clamp(x * (27.0 + x * x) / (27.0 + 9.0 * x * x), -1.0, 1.0);
}

// --- Wave functions ---

float waveSine(float x) {
  return sin(x);
}

float waveSquare(float x, float sharp, float width) {
  float m = 1.0 + sin(x * 0.5) * width;
  m = clamp(m, 0.3, 2.0);
  return fastTanh(sin(x * m) * sharp);
}

float waveTriangle(float x, float sk) {
  float t = fract(x / TAU + 0.25);
  float rise = 0.5 + sk * 0.49;
  rise = clamp(rise, 0.01, 0.99);

  if (t < rise) {
    return 2.0 * t / rise - 1.0;
  } else {
    return 1.0 - 2.0 * (t - rise) / (1.0 - rise);
  }
}

float computeWave(float x) {
  if (waveType == 0) {
    return waveSine(x);
  } else if (waveType == 1) {
    return waveSquare(x, sharpness, pulseWidth);
  } else {
    return waveTriangle(x, skew);
  }
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;

  // Centered, aspect-corrected space
  vec2 centered = uv * 2.0 - 1.0;
  centered.x *= aspect;

  // Compute wave axis and displacement direction based on coordinate mode
  float waveAxis;
  vec2 displaceDir;

  if (coordMode == 1) {
    // Radial mode: wave along distance from center, displace radially
    vec2 center = vec2(centerX * aspect, centerY);
    vec2 toCenter = centered - center;
    float dist = length(toCenter);
    waveAxis = dist;
    displaceDir = dist > 0.001 ? normalize(toCenter) : vec2(0.0, 1.0);
  } else {
    // Linear mode: wave along a direction vector
    float angle = radians(direction);
    vec2 dir = vec2(cos(angle), sin(angle));
    waveAxis = dot(centered, dir);
    displaceDir = dir;
  }

  // Compute wave value
  float wave = computeWave(waveAxis * freq);

  // Displacement vector in centered space
  vec2 displacement = displaceDir * wave * amplitude;

  // Displacement map: accumulate UV offsets (layer stack resolves color separately)
  vec4 inputSample = texture2D(u_input, uv);
  vec2 existing = inputSample.a > 0.5 ? inputSample.rg * 2.0 - 1.0 : vec2(0.0);
  vec2 uvOffset = vec2(displacement.x / (2.0 * aspect), displacement.y / 2.0);
  vec2 total = existing + uvOffset;
  gl_FragColor = vec4(total * 0.5 + 0.5, 1.0, 1.0);
}
