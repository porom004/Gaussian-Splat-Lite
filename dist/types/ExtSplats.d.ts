import { SplatShTextures, SplatSource } from './SplatSource';
import { SplatFileType } from './defines';
import * as THREE from "three";
export type ExtSplatsOptions = {
    url?: string;
    fileBytes?: Uint8Array | ArrayBuffer;
    fileType?: SplatFileType;
    fileName?: string;
    stream?: ReadableStream;
    streamLength?: number;
    maxSplats?: number;
    extArrays?: [Uint32Array, Uint32Array];
    localCenters?: Float32Array;
    numSplats?: number;
    construct?: (splats: ExtSplats) => Promise<void> | void;
    onProgress?: (event: ProgressEvent) => void;
    extra?: Record<string, unknown>;
};
/** A higher precision splat source with two 16-byte texture records per splat. */
export declare class ExtSplats implements SplatSource {
    maxSplats: number;
    numSplats: number;
    extArrays: [Uint32Array, Uint32Array];
    extra: Record<string, unknown>;
    initialized: Promise<ExtSplats>;
    isInitialized: boolean;
    needsUpdate: boolean;
    private textures;
    private shTextures;
    private localCenters;
    constructor(options?: ExtSplatsOptions);
    reinitialize(options: ExtSplatsOptions): void;
    initialize(options: ExtSplatsOptions): void;
    private asyncInitialize;
    dispose(): void;
    private disposeTextures;
    getNumSplats(): number;
    getNumSh(): 0 | 1 | 2 | 3;
    ensureSplats(numSplats: number): [Uint32Array, Uint32Array];
    getSplat(index: number): {
        center: THREE.Vector3;
        scales: THREE.Vector3;
        quaternion: THREE.Quaternion;
        color: THREE.Color;
        opacity: number;
    };
    setSplat(index: number, center: THREE.Vector3, scales: THREE.Vector3, quaternion: THREE.Quaternion, opacity: number, color: THREE.Color): void;
    pushSplat(center: THREE.Vector3, scales: THREE.Vector3, quaternion: THREE.Quaternion, opacity: number, color: THREE.Color): void;
    forEachCenter(callback: (index: number, x: number, y: number, z: number) => void): void;
    forEachSplat(callback: (index: number, center: THREE.Vector3, scales: THREE.Vector3, quaternion: THREE.Quaternion, opacity: number, color: THREE.Color) => void): void;
    getSplatTextures(): readonly [THREE.DataArrayTexture, THREE.DataArrayTexture];
    private disposeMainTextures;
    getShTextures(): SplatShTextures;
    private ensureShTexture;
    static emptyTexture: THREE.DataArrayTexture;
}
