
export enum ReferenceType {
  A4_PAPER = 'A4_paper',
  DOOR_FRAME = 'Door'
}

export type Point = [number, number]; // [x, y] in percentages (0-100)

export interface Box {
  start: Point;
  end: Point;
}

export interface CalibrationData {
  reference_type: ReferenceType;
  real_world_cm: number;
}

export interface WallpaperMetadata {
  master_width_cm: number;
  master_height_cm: number;
  roll_width_cm: number;
  roll_length_cm: number;
}

export interface RegionGeometry {
  points: Point[]; // Corners of the box
  width_cm: number;
  height_cm: number;
  area_sq_m: number;
}

export interface VisualizerState {
  calibration: CalibrationData;
  wallpaper: WallpaperMetadata;
  regions: RegionGeometry[];
  total_rolls_estimated: number;
}

export interface ImageUpload {
  data: string;
  mimeType: string;
}
