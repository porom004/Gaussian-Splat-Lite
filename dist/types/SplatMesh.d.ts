import { ExtSplats } from './ExtSplats';
import { SplatEdit, SplatEdits } from './SplatEdit';
import { SplatSource } from './SplatSource';
import { SplatFileType } from './defines';
import * as THREE from "three";
export type { SplatSource } from './SplatSource';
export type SplatMeshOptions = {
    url?: string;
    fileBytes?: Uint8Array | ArrayBuffer;
    fileType?: SplatFileType;
    fileName?: string;
    stream?: ReadableStream;
    streamLength?: number;
    splats?: SplatSource;
    maxSplats?: number;
    constructSplats?: (splats: ExtSplats) => Promise<void> | void;
    onProgress?: (event: ProgressEvent) => void;
    onLoad?: (mesh: SplatMesh) => Promise<void> | void;
    editable?: boolean;
    raycastable?: boolean;
    minRaycastOpacity?: number;
    onFrame?: (context: {
        mesh: SplatMesh;
        time: number;
        deltaTime: number;
    }) => void;
    extSplats?: ExtSplats;
};
export type SplatMeshFrameContext = {
    time: number;
    deltaTime: number;
    camera: THREE.Camera;
    globalEdits: SplatEdit[];
};
/** A scene object backed by a fixed encoded splat source and RGBA SDF edits. */
export declare class SplatMesh extends THREE.Object3D {
    initialized: Promise<SplatMesh>;
    isInitialized: boolean;
    extSplats?: ExtSplats;
    splats?: SplatSource;
    numSplats: number;
    recolor: THREE.Color;
    opacity: number;
    maxSh: number;
    edits: SplatEdit[] | null;
    editable: boolean;
    raycastable: boolean;
    minRaycastOpacity: number;
    sdfEdits: SplatEdits | null;
    onFrame?: SplatMeshOptions["onFrame"];
    version: number;
    sortVersion: number;
    mappingVersion: number;
    private lastSource?;
    private lastNumSplats;
    private lastMaxSh;
    private lastMatrixWorld;
    private hasLastMatrixWorld;
    private lastRecolor;
    private viewOrigin;
    private lastViewOrigin;
    private sdfCoordinateOrigin;
    constructor(options?: SplatMeshOptions);
    private asyncInitialize;
    pushSplat(center: THREE.Vector3, scales: THREE.Vector3, quaternion: THREE.Quaternion, opacity: number, color: THREE.Color): void;
    forEachSplat(callback: (index: number, center: THREE.Vector3, scales: THREE.Vector3, quaternion: THREE.Quaternion, opacity: number, color: THREE.Color) => void): void;
    dispose(): void;
    getBoundingBox(centersOnly?: boolean): THREE.Box3;
    frameUpdate({ time, deltaTime, camera, globalEdits }: SplatMeshFrameContext): void;
    updateVersion({ sort }?: {
        sort?: boolean;
    }): void;
    updateMappingVersion(): void;
    set needsUpdate(value: boolean);
    raycast(raycaster: THREE.Raycaster, intersects: {
        distance: number;
        point: THREE.Vector3;
        object: THREE.Object3D;
    }[]): void;
    private static raycastBuffer;
    private appendRaycastBuffer;
}
