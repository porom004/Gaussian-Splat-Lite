import { SplatAccumulator } from './SplatAccumulator';
import * as THREE from "three";
/**
 * Re-expresses an affine transform so it consumes positions relative to
 * `origin` instead of absolute world positions.
 *
 * If `matrix` maps p to A * p + t, the rebased matrix maps (p - origin) to
 * A * (p - origin) + (A * origin + t), which is the same result without doing
 * a large-coordinate subtraction in float32 shader code.
 */
export declare function rebaseAffineTransform(matrix: THREE.Matrix4, origin: THREE.Vector3): THREE.Matrix4;
/**
 * Builds persistent sort centers relative to each mesh origin. Keeping the
 * Float64 world origin separate lets the worker form a fresh camera-to-mesh
 * offset for every sort without rebuilding the per-splat Float32 data.
 */
export declare function buildSortCenters(current: SplatAccumulator): {
    centers: Float32Array<ArrayBuffer>;
    rangeBases: Uint32Array<ArrayBuffer>;
    rangeCounts: Uint32Array<ArrayBuffer>;
    rangeOrigins: Float64Array<ArrayBuffer>;
};
