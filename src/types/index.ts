// ─── Geometry ────────────────────────────────────────────────
export interface Point {
  x: number; // meters
  y: number; // meters
}

export interface BoundingBox {
  minX: number; maxX: number;
  minY: number; maxY: number;
}

// ─── Sprinklers ──────────────────────────────────────────────
export type SprinklerType = 'Rotativ' | 'Spray fix' | 'Picurare' | 'Micro-jet' | 'Impact' | '';

export interface SprinklerModel {
  id:       string;
  brand:    string;
  model:    string;
  type:     SprinklerType;
  rmin:     number; // meters
  rmax:     number;
  pmin:     number; // bar
  pmax:     number;
  flow:     number; // m³/h
  maxAngle: number; // degrees
  usage:    string;
  notes?:   string;
}

export interface PlacedSprinkler {
  id:       number;
  x:        number; // canvas px
  y:        number;
  xm:       number; // meters
  ym:       number;
  radius:   number; // meters
  circIdx:  number;
  startA:   number; // degrees
  endA:     number;
  phase:    number; // 0-1 animation phase
}

// ─── Circuits ────────────────────────────────────────────────
export interface Circuit {
  id:         string;
  name:       string;
  color:      string; // hex #RRGGBB
  sprinkler:  string; // model name
  radius:     number;
  pressure:   number;
  flow:       number;
}

// ─── Pipes ───────────────────────────────────────────────────
export type PipeType = 'main' | 'branch' | 'manual';

export interface Pipe {
  from:     { x: number; y: number };
  to:       { x: number; y: number };
  type:     PipeType;
  circIdx:  number;
  lengthM:  number;
}

export interface ManualPipe {
  pts:      { x: number; y: number }[];
  type:     PipeType;
  circIdx:  number;
}

// ─── Project ─────────────────────────────────────────────────
export interface Project {
  id:          string;
  user_id:     string;
  name:        string;
  location:    string;
  created_at:  string;
  updated_at:  string;
  polygon:     Point[];       // meters
  circuits:    Circuit[];
  sprinklers?: PlacedSprinkler[];
  pipes?:      Pipe[];
  length_m:    number;
  width_m:     number;
  area_m2?:    number;
  notes?:      string;
  is_public:   boolean;
  share_token?: string;
}

// ─── DB row types (Supabase) ─────────────────────────────────
export interface DbProject {
  id:           string;
  user_id:      string;
  name:         string;
  location:     string | null;
  created_at:   string;
  updated_at:   string;
  polygon:      Point[];
  circuits:     Circuit[];
  sprinklers:   PlacedSprinkler[] | null;
  pipes:        Pipe[] | null;
  length_m:     number;
  width_m:      number;
  area_m2:      number | null;
  notes:        string | null;
  is_public:    boolean;
  share_token:  string | null;
}

export interface DbSprinklerModel {
  id:        string;
  brand:     string;
  model:     string;
  type:      SprinklerType;
  rmin:      number;
  rmax:      number;
  pmin:      number;
  pmax:      number;
  flow:      number;
  max_angle: number;
  usage:     string;
  notes:     string | null;
  created_by: string | null;
  is_public:  boolean;
}

// ─── UI State ────────────────────────────────────────────────
export type EditorMode = 'draw' | 'add' | 'move' | 'delete' | 'pipe';
export type PipeMode   = 'auto' | 'manual';
export type TabMode    = 'simulator' | 'pipes' | 'report';

export interface SimulatorState {
  mode:           EditorMode;
  pipeMode:       PipeMode;
  activeTab:      TabMode;
  selectedCirc:   number;
  currentRadius:  number;
  animRunning:    boolean;
  activeCircuits: Set<number>;
  speed:          number;
}
