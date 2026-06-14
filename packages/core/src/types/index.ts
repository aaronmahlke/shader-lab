export type GradientStop = {
  color: string;
  position: number;
};

export type UniformType = "float" | "int" | "bool" | "color" | "vec2" | "gradient";

export type UniformValue = number | boolean | string | [number, number] | GradientStop[];

export type UniformDef = {
  name: string;
  type: UniformType;
  label: string;
  default: UniformValue;
  min?: number;
  max?: number;
  step?: number;
};

export type ControlGroup = {
  label: string;
  uniforms: UniformDef[];
};

export type Experiment = {
  id: string;
  name: string;
  description: string;
  vertexShader?: string;
  fragmentShader: string;
  groups: ControlGroup[];
};
