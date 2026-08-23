import * as THREE from "three";

import {
  get_raycast_buffer,
  get_raycast_buffer2,
  raycast_ext_buffers,
} from "gaussian-splat-rs";
import { ExtSplats } from "./ExtSplats";
import { SplatEdit, SplatEditSdf, SplatEdits } from "./SplatEdit";
import type { SplatSource } from "./SplatSource";
import type { SplatFileType } from "./defines";
import * as wasm from "./wasm";

export type { SplatSource } from "./SplatSource";

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
export class SplatMesh extends THREE.Object3D {
  initialized: Promise<SplatMesh>;
  isInitialized = false;

  extSplats?: ExtSplats;
  splats?: SplatSource;

  numSplats = 0;
  recolor = new THREE.Color(1, 1, 1);
  opacity = 1;
  maxSh = 3;

  edits: SplatEdit[] | null = null;
  editable: boolean;
  raycastable: boolean;
  minRaycastOpacity: number;
  sdfEdits: SplatEdits | null = null;

  onFrame?: SplatMeshOptions["onFrame"];

  version = 0;
  sortVersion = 0;
  mappingVersion = 0;

  private lastSource?: SplatSource;
  private lastNumSplats = -1;
  private lastMaxSh = -1;
  private lastMatrixWorld = new THREE.Matrix4();
  private hasLastMatrixWorld = false;
  private lastRecolor = new THREE.Vector4().setScalar(Number.NaN);
  private viewOrigin = new THREE.Vector3();
  private lastViewOrigin = new THREE.Vector3().setScalar(Number.NaN);
  private sdfCoordinateOrigin = new THREE.Vector3();

  constructor(options: SplatMeshOptions = {}) {
    super();

    if (options.splats) {
      this.splats = options.splats;
      if (options.splats instanceof ExtSplats) {
        this.extSplats = options.splats;
      }
    } else if (options.extSplats instanceof ExtSplats) {
      this.extSplats = options.extSplats;
      this.splats = this.extSplats;
    } else {
      this.extSplats = new ExtSplats({ maxSplats: options.maxSplats });
      this.splats = this.extSplats;
    }

    this.numSplats = this.splats.getNumSplats();
    this.editable = options.editable ?? true;
    this.raycastable = options.raycastable ?? true;
    this.minRaycastOpacity = options.minRaycastOpacity ?? 0.2;
    this.onFrame = options.onFrame;

    const needsAsyncInitialization =
      Boolean(
        options.url ||
          options.fileBytes ||
          options.stream ||
          options.constructSplats,
      ) || Boolean(this.extSplats && !this.extSplats.isInitialized);

    if (needsAsyncInitialization) {
      this.initialized = this.asyncInitialize(options).then(async () => {
        this.isInitialized = true;
        await options.onLoad?.(this);
        return this;
      });
    } else {
      this.isInitialized = true;
      const maybePromise = options.onLoad?.(this);
      this.initialized =
        maybePromise instanceof Promise
          ? maybePromise.then(() => this)
          : Promise.resolve(this);
    }
  }

  private async asyncInitialize(options: SplatMeshOptions) {
    if (this.extSplats) {
      if (
        options.url ||
        options.fileBytes ||
        options.stream ||
        options.constructSplats
      ) {
        this.extSplats.reinitialize({
          url: options.url,
          fileBytes: options.fileBytes,
          fileType: options.fileType,
          fileName: options.fileName,
          stream: options.stream,
          streamLength: options.streamLength,
          maxSplats: options.maxSplats,
          construct: options.constructSplats,
          onProgress: options.onProgress,
        });
      }
      await this.extSplats.initialized;
      this.splats = this.extSplats;
    }
    this.numSplats = this.splats?.getNumSplats() ?? 0;
    this.updateMappingVersion();
  }

  pushSplat(
    center: THREE.Vector3,
    scales: THREE.Vector3,
    quaternion: THREE.Quaternion,
    opacity: number,
    color: THREE.Color,
  ) {
    if (this.extSplats) {
      this.extSplats.pushSplat(center, scales, quaternion, opacity, color);
    }
    this.numSplats = this.splats?.getNumSplats() ?? this.numSplats;
  }

  forEachSplat(
    callback: (
      index: number,
      center: THREE.Vector3,
      scales: THREE.Vector3,
      quaternion: THREE.Quaternion,
      opacity: number,
      color: THREE.Color,
    ) => void,
  ) {
    this.splats?.forEachSplat(callback);
  }

  dispose() {
    this.sdfEdits?.dispose();
    this.sdfEdits = null;
    this.splats?.dispose();
    this.splats = undefined;
    this.extSplats = undefined;
  }

  getBoundingBox(centersOnly = true) {
    if (!this.isInitialized) {
      throw new Error(
        "Cannot get bounding box before SplatMesh is initialized",
      );
    }
    const minimum = new THREE.Vector3().setScalar(Number.POSITIVE_INFINITY);
    const maximum = new THREE.Vector3().setScalar(Number.NEGATIVE_INFINITY);
    const corner = new THREE.Vector3();

    if (centersOnly) {
      this.splats?.forEachCenter((_index, x, y, z) => {
        if (Number.isNaN(x)) return;
        corner.set(x, y, z);
        minimum.min(corner);
        maximum.max(corner);
      });
      return new THREE.Box3(minimum, maximum);
    }

    const signs = [-1, 1];
    this.splats?.forEachSplat((_index, center, scales, quaternion) => {
      for (const x of signs) {
        for (const y of signs) {
          for (const z of signs) {
            corner
              .set(x * scales.x, y * scales.y, z * scales.z)
              .applyQuaternion(quaternion)
              .add(center);
            minimum.min(corner);
            maximum.max(corner);
          }
        }
      }
    });
    return new THREE.Box3(minimum, maximum);
  }

  frameUpdate({ time, deltaTime, camera, globalEdits }: SplatMeshFrameContext) {
    this.onFrame?.({ mesh: this, time, deltaTime });

    const source = this.splats ?? this.extSplats;
    if (!source) {
      return;
    }
    this.splats = source;

    let updated = false;
    let sortUpdated = false;
    const count = source.getNumSplats();
    if (source !== this.lastSource) {
      this.lastSource = source;
      updated = true;
      sortUpdated = true;
    }
    if (count !== this.lastNumSplats) {
      this.lastNumSplats = count;
      this.numSplats = count;
      this.mappingVersion += 1;
      updated = true;
      sortUpdated = true;
    }
    if (source.needsUpdate) {
      updated = true;
      sortUpdated = true;
    }
    if (this.maxSh !== this.lastMaxSh) {
      this.lastMaxSh = this.maxSh;
      updated = true;
    }
    if (this.maxSh > 0 && source.getNumSh() > 0) {
      camera.getWorldPosition(this.viewOrigin);
      if (!this.viewOrigin.equals(this.lastViewOrigin)) {
        this.lastViewOrigin.copy(this.viewOrigin);
        // Directional SH changes appearance but never changes splat depth.
        updated = true;
      }
    }

    this.updateWorldMatrix(true, false);
    if (
      !this.hasLastMatrixWorld ||
      !this.lastMatrixWorld.equals(this.matrixWorld)
    ) {
      this.lastMatrixWorld.copy(this.matrixWorld);
      this.hasLastMatrixWorld = true;
      updated = true;
      sortUpdated = true;
    }

    const recolor = new THREE.Vector4(
      this.recolor.r,
      this.recolor.g,
      this.recolor.b,
      this.opacity,
    );
    if (!recolor.equals(this.lastRecolor)) {
      this.lastRecolor.copy(recolor);
      updated = true;
    }

    const edits = new Set<SplatEdit>();
    if (this.editable) {
      for (const edit of globalEdits) edits.add(edit);
      if (this.edits) {
        for (const edit of this.edits) edits.add(edit);
      } else {
        this.traverseVisible((node) => {
          if (node instanceof SplatEdit) edits.add(node);
        });
      }
    }
    const orderedEdits = Array.from(edits).sort(
      (left, right) => left.ordering - right.ordering,
    );
    const groups = orderedEdits.map((edit) => {
      if (edit.sdfs) return { edit, sdfs: edit.sdfs };
      const sdfs: SplatEditSdf[] = [];
      edit.traverseVisible((node) => {
        if (node instanceof SplatEditSdf) sdfs.push(node);
      });
      return { edit, sdfs };
    });

    if (groups.length > 0 && !this.sdfEdits) {
      this.sdfEdits = new SplatEdits({
        maxEdits: groups.length,
        maxSdfs: groups.reduce((total, group) => total + group.sdfs.length, 0),
      });
      updated = true;
    }
    const sdfCoordinateOrigin = this.sdfCoordinateOrigin.setFromMatrixPosition(
      this.matrixWorld,
    );
    if (this.sdfEdits?.update(groups, sdfCoordinateOrigin).updated) {
      // RGBA-only SDF changes preserve centers and their existing sort order.
      updated = true;
    }

    if (updated) {
      this.updateVersion({ sort: sortUpdated });
    }
  }

  updateVersion({ sort = true }: { sort?: boolean } = {}) {
    this.version += 1;
    if (sort) this.sortVersion += 1;
  }

  updateMappingVersion() {
    this.mappingVersion += 1;
    this.updateVersion();
  }

  set needsUpdate(value: boolean) {
    if (value) this.updateVersion();
  }

  raycast(
    raycaster: THREE.Raycaster,
    intersects: {
      distance: number;
      point: THREE.Vector3;
      object: THREE.Object3D;
    }[],
  ) {
    if (!wasm.isInitialized() || !this.raycastable || !this.extSplats) {
      return;
    }

    const { near, far, ray } = raycaster;
    const worldToMesh = this.matrixWorld.clone().invert();
    const origin = ray.origin.clone().applyMatrix4(worldToMesh);
    const direction = ray.direction
      .clone()
      .applyMatrix3(new THREE.Matrix3().setFromMatrix4(worldToMesh));
    const buffer = get_raycast_buffer();
    const buffer2 = get_raycast_buffer2();
    const capacity = buffer.length / 4;
    let intersectionCount = 0;

    const [first, second] = this.extSplats.extArrays;
    for (let base = 0; base < this.numSplats; base += capacity) {
      const count = Math.min(capacity, this.numSplats - base);
      buffer.set(first.subarray(base * 4, (base + count) * 4));
      buffer2.set(second.subarray(base * 4, (base + count) * 4));
      intersectionCount = this.appendRaycastBuffer(
        intersectionCount,
        raycast_ext_buffers(
          origin.x,
          origin.y,
          origin.z,
          direction.x,
          direction.y,
          direction.z,
          this.minRaycastOpacity,
          near,
          far,
          count,
        ),
      );
    }

    for (const distance of SplatMesh.raycastBuffer.subarray(
      0,
      intersectionCount,
    )) {
      intersects.push({
        distance,
        point: ray.direction.clone().multiplyScalar(distance).add(ray.origin),
        object: this,
      });
    }
  }

  private static raycastBuffer = new Float32Array(1024);

  private appendRaycastBuffer(count: number, additional: Float32Array) {
    const total = count + additional.length;
    if (total > SplatMesh.raycastBuffer.length) {
      let capacity = SplatMesh.raycastBuffer.length;
      while (capacity < total) capacity *= 2;
      const next = new Float32Array(capacity);
      next.set(SplatMesh.raycastBuffer.subarray(0, count));
      SplatMesh.raycastBuffer = next;
    }
    SplatMesh.raycastBuffer.set(additional, count);
    return total;
  }
}
