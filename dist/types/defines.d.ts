export declare const LN_SCALE_MIN = -12;
export declare const LN_SCALE_MAX = 9;
export declare const SPLAT_TEX_WIDTH_BITS = 11;
export declare const SPLAT_TEX_HEIGHT_BITS = 11;
export declare const SPLAT_TEX_WIDTH: number;
export declare const SPLAT_TEX_HEIGHT: number;
export declare const SPLAT_TEX_MIN_HEIGHT = 1;
export declare enum SplatFileType {
    PLY = "ply",
    SPZ = "spz"
}
export type ExtExtra = {
    sh1?: Uint32Array;
    sh2?: Uint32Array;
    sh3a?: Uint32Array;
    sh3b?: Uint32Array;
};
export type ExtResult = {
    numSplats: number;
    extArrays: [Uint32Array, Uint32Array];
    localCenters: Float32Array;
    extra: ExtExtra;
};
