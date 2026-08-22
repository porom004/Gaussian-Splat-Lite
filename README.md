<div align="center">

# Gaussian-Splat-Lite

<p align="center">
  <img src="./Gaussian-Splat-Lite.svg" alt="Gaussian Splat Lite" width="645">
</p>

</div>

`Gaussian-Splat-Lite` is a lightweight 3D Gaussian Splatting renderer for Three.js. It is based on the overall architecture of [SparkJS](https://github.com/sparkjsdev/spark), simplified and adapted to retain a stable, general-purpose Gaussian Splat rendering pipeline while removing LoD, paging, dynamic shader graphs, and broad format compatibility layers. It also fixes SparkJS precision issues with large GIS/ECEF world coordinates and provides faster depth sorting and raycasting implementations.

It works alongside standard Three.js scenes, cameras, meshes, and render loops, and supports unified generation, sorting, and blended rendering of multiple Splat objects.

## Features

- Native integration with the Three.js scene graph and rendering pipeline
- Multiple `SplatMesh` objects rendered with correct global sorting
- `.ply` and `.spz` file support
- URL, in-memory byte, and standard `ReadableStream` inputs
- Rust/WebAssembly file decoding, depth sorting, and raycasting
- 3DGS rendering and optional 2DGS support
- Spherical harmonics, depth of field, offscreen rendering, and environment-map rendering
- SDF-based color and opacity editing
- Camera-relative rendering for large GIS/ECEF world coordinates
- TypeScript declarations, ESM, and CommonJS builds

## Requirements

- A modern browser with WebGL2, WebAssembly, Web Workers, and ES modules
- Three.js `0.180.0` or newer
- Correct CORS headers when loading Splat files from another origin

## Installation

```sh
npm install gaussian-splat-lite three
```

## Quick start

```js
import * as THREE from "three";
import { GaussianSplatRenderer, SplatMesh } from "gaussian-splat-lite";

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
camera.position.set(0, 0, 3);

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// One GaussianSplatRenderer is normally enough for each Three.js renderer.
const splatRenderer = new GaussianSplatRenderer({ renderer });
scene.add(splatRenderer);

const splat = new SplatMesh({ url: "/assets/scene.spz" });
scene.add(splat);

// Wait before reading loaded data such as the count or bounding box.
await splat.initialized;
console.log(`Loaded ${splat.numSplats} splats`);

renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
```

`GaussianSplatRenderer` is itself a Three.js scene object. It collects visible `SplatMesh` objects, generates GPU data, sorts the combined collection, and draws it. Application code continues to use the standard `renderer.render(scene, camera)` call; it does not need to issue a separate draw call for each Splat.

Some PLY/SPZ data uses a `+Y`-down, `+Z`-forward convention. If a model appears upside down or faces the wrong direction, rotate the object without changing its decoded data:

```js
splat.quaternion.set(1, 0, 0, 0); // Rotate 180 degrees around X.
```

## Loading data

### From a URL

```js
const splat = new SplatMesh({
  url: "/assets/model.ply", // .spz is also supported.
  onProgress: (event) => {
    if (event.lengthComputable) {
      console.log(`${Math.round((event.loaded / event.total) * 100)}%`);
    }
  },
  onLoad: (mesh) => console.log(mesh.numSplats),
});

scene.add(splat);
await splat.initialized;
```

### From a File or ReadableStream

This form is suitable for file pickers, drag and drop, and large local files. The data is decoded locally by WebAssembly and is not automatically uploaded anywhere.

```js
import { SplatFileType, SplatMesh } from "gaussian-splat-lite";

const file = fileInput.files[0];
const fileType = file.name.toLowerCase().endsWith(".spz")
  ? SplatFileType.SPZ
  : SplatFileType.PLY;

const splat = new SplatMesh({
  fileName: file.name,
  fileType,
  stream: file.stream(),
  streamLength: file.size,
  onProgress: ({ loaded, total }) => console.log(loaded, total),
});

scene.add(splat);
await splat.initialized;
```

Complete in-memory file data can also be supplied:

```js
const bytes = new Uint8Array(await file.arrayBuffer());
const splat = new SplatMesh({
  fileBytes: bytes,
  fileType: SplatFileType.SPZ,
});
```

When the input URL does not have a recognizable extension, specify `fileType` explicitly or provide a `.ply` / `.spz` name through `fileName`.

### Using SplatLoader

`SplatLoader` follows the Three.js `Loader` API style. It first returns decoded `ExtSplats`; `parse()` then wraps that source in a `SplatMesh`.

```js
import { SplatLoader } from "gaussian-splat-lite";

const loader = new SplatLoader();
const decoded = await loader.loadAsync("/assets/model.spz", (event) => {
  console.log(event.loaded, event.total);
});

const splat = loader.parse(decoded);
scene.add(splat);
```

The callback form matches the normal Three.js Loader pattern:

```js
loader.load(
  "/assets/model.ply",
  (decoded) => scene.add(loader.parse(decoded)),
  (event) => console.log(event.loaded, event.total),
  (error) => console.error(error),
);
```

### Creating Splats in code

```js
import * as THREE from "three";
import { SplatMesh } from "gaussian-splat-lite";

const splat = new SplatMesh({
  maxSplats: 100,
  constructSplats: (data) => {
    data.pushSplat(
      new THREE.Vector3(0, 0, 0),       // center
      new THREE.Vector3(0.2, 0.1, 0.1), // scales
      new THREE.Quaternion(),            // rotation
      1,                                 // opacity
      new THREE.Color(0x4f8cff),         // color
    );
  },
});

scene.add(splat);
await splat.initialized;
```

## Core concepts and public API

| API | Purpose |
| --- | --- |
| `GaussianSplatRenderer` | Integrates with Three.js and generates, sorts, and draws every visible Splat |
| `SplatMesh` | A transformable, visible, and raycastable Gaussian Splat scene object |
| `SplatLoader` | A Three.js Loader-style PLY/SPZ decoder |
| `ExtSplats` | The built-in high-precision Splat source, with per-Splat read and write access |
| `SplatSource` | The TypeScript interface implemented by custom Splat sources |
| `SplatEdit` / `SplatEditSdf` | SDF-region RGBA editing objects |
| `SplatAccumulator` | A low-level generation buffer used by the renderer; normally internal |
| `SplatFileType` | File type enum containing `PLY` and `SPZ` |

## GaussianSplatRenderer

```ts
new GaussianSplatRenderer(options: GaussianSplatRendererOptions)
```

### Basic options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `renderer` | `THREE.WebGLRenderer` | Required | The Three.js WebGL renderer |
| `onDirty` | `() => void` | `undefined` | Called when loading, generation, or sorting requires another render |
| `premultipliedAlpha` | `boolean` | `true` | Uses premultiplied alpha while accumulating Splat RGB |
| `timer` | `THREE.Timer` | New internal timer | Shares time with another animation system; caller owns and updates a supplied timer |
| `autoUpdate` | `boolean` | `true` | Automatically checks the Splat collection each frame |
| `preUpdate` | `boolean` | `true` | Updates before drawing; WebXR presentation automatically uses an asynchronous post-render update |
| `accumExtSplats` | `boolean` | `false` | Uses extended encoding for intermediate data, trading more memory for precision |

### Quality and appearance options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `maxStdDev` | `number` | `Math.sqrt(8)` | Maximum standard deviations drawn from each Gaussian center; lower values improve speed but crop edges |
| `minPixelRadius` | `number` | `0` | Minimum screen-space Splat radius |
| `maxPixelRadius` | `number` | `512` | Maximum screen-space Splat radius |
| `minAlpha` | `number` | `0.5 / 255` | Fragments below this alpha are discarded |
| `enable2DGS` | `boolean` | `false` | Treats a Splat with exactly one zero scale axis as a 2D Gaussian |
| `preBlurAmount` | `number` | `0` | Adds to the covariance diagonal before opacity correction |
| `blurAmount` | `number` | `0.3` | Anti-aliasing blur amount with opacity correction |
| `focalDistance` | `number` | `0` | Distance to the depth-of-field focal plane |
| `apertureAngle` | `number` | `0` | Full aperture angle in radians; `0` disables depth of field |
| `clipXY` | `number` | `1.4` | Center-clipping factor relative to the X/Y frustum boundary; `1` clips immediately outside it |
| `focalAdjustment` | `number` | `2` | Projected Splat-size adjustment; larger values generally look sharper |

### Sorting, material, and offscreen options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `sortRadial` | `boolean` | `false` | Sorts by geometric distance when `true`, or by Z depth when `false` |
| `minSortIntervalMs` | `number` | `0` | Minimum interval between sort calls, in milliseconds |
| `transparent` | `boolean` | `true` | Places the Splat material in the Three.js transparent render pass |
| `depthTest` | `boolean` | `true` | Reads the depth buffer for occlusion with regular meshes |
| `depthWrite` | `boolean` | `false` | Writes depth; normally undesirable for transparent Splats |
| `extraUniforms` | `Record<string, unknown>` | `undefined` | Additional values merged into the default shader uniforms |
| `vertexShader` | `string` | Built in | Replaces the default Splat vertex shader |
| `fragmentShader` | `string` | Built in | Replaces the default Splat fragment shader |
| `target` | `TargetOptions` | `undefined` | Creates a dedicated offscreen render target |

The `target` structure is:

```ts
type TargetOptions = {
  width: number;
  height: number;
  doubleBuffer?: boolean; // false
  superXY?: number;       // 1-4, default 1
} & THREE.RenderTargetOptions;
```

`superXY` renders at a higher resolution and performs simple CPU averaging when `readTarget()` is called. Both `width * superXY` and `height * superXY` must be no greater than 8192.

### Common properties and methods

| API | Description |
| --- | --- |
| `update({ scene, camera })` | Manually generates and sorts Splats; returns `Promise<void>` |
| `clearSplats()` | Clears the current display buffer without removing scene objects |
| `render(scene, camera)` | Performs one Three.js render using this instance as the active Splat renderer |
| `renderTarget({ scene, camera })` | Renders to the target configured in the constructor |
| `readTarget()` | Reads the latest offscreen result as an RGBA `Uint8Array` |
| `renderReadTarget({ scene, camera })` | Renders and reads an offscreen result |
| `renderCubeMap(...)` | Renders a cube map from a world-space position |
| `readCubeTargets()` | Reads RGBA bytes from all six cube faces |
| `renderEnvMap(...)` | Renders and PMREM-prefilters an environment map |
| `recurseSetEnvMap(root, envMap)` | Assigns an environment map to descendant `MeshStandardMaterial` instances |
| `dispose()` | Releases materials, geometry, textures, targets, and the sorting worker |
| `premultipliedAlpha` | A read/write property that recompiles the material when changed |

For an on-demand render loop, connect `onDirty` to the application's render scheduler:

```js
let needsRender = true;

function requestRender() {
  needsRender = true;
}

controls.addEventListener("update", requestRender);

const splatRenderer = new GaussianSplatRenderer({
  renderer,
  onDirty: requestRender,
});
scene.add(splatRenderer);

renderer.setAnimationLoop((time) => {
  controls.update(time);
  if (!needsRender) return;

  // Clear the flag before rendering so a new onDirty call is preserved.
  needsRender = false;
  renderer.render(scene, camera);
});
```

## SplatMesh

`SplatMesh` extends `THREE.Object3D`, so it supports the standard `position`, `quaternion`, `scale`, `visible`, `layers`, and parent/child hierarchy APIs.

```ts
new SplatMesh(options?: SplatMeshOptions)
```

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | `string` | `undefined` | PLY/SPZ file URL |
| `fileBytes` | `Uint8Array \| ArrayBuffer` | `undefined` | Complete file data in memory |
| `fileType` | `SplatFileType` | Inferred from name | Explicitly selects `PLY` or `SPZ` |
| `fileName` | `string` | `undefined` | Supplies a name for inferring the format of byte or stream input |
| `stream` | `ReadableStream` | `undefined` | Chunked input stream |
| `streamLength` | `number` | `undefined` | Total stream length for progress reporting |
| `splats` | `SplatSource` | New `ExtSplats` | Uses an existing or custom source; takes precedence over `extSplats` |
| `extSplats` | `ExtSplats` | New instance | Reuses an existing built-in source |
| `maxSplats` | `number` | `0` | Initial capacity for programmatic construction; grows when necessary |
| `constructSplats` | `(splats) => void \| Promise<void>` | `undefined` | Populates `ExtSplats` during initialization |
| `onProgress` | `(event: ProgressEvent) => void` | `undefined` | Download or stream decoding progress callback |
| `onLoad` | `(mesh) => void \| Promise<void>` | `undefined` | Called after initialization completes |
| `editable` | `boolean` | `true` | Applies global and local SDF edits |
| `raycastable` | `boolean` | `true` | Participates in Three.js raycasting |
| `minRaycastOpacity` | `number` | `0.2` | Ignores lower-opacity Splats during raycasting |
| `onFrame` | `({ mesh, time, deltaTime }) => void` | `undefined` | Called before Splat generation for a frame |

Normally, choose exactly one of `url`, `fileBytes`, or `stream`. The `splats` option is intended for advanced custom sources and should not be mixed with file input.

### Common properties

| Property | Type / default | Description |
| --- | --- | --- |
| `initialized` | `Promise<SplatMesh>` | Resolves after asynchronous loading and construction |
| `isInitialized` | `boolean` | Whether initialization has completed |
| `numSplats` | `number` | Current Splat count |
| `recolor` | `THREE.Color(1, 1, 1)` | RGB multiplier applied to the entire object |
| `opacity` | `1` | Opacity multiplier applied to the entire object |
| `maxSh` | `3` | Maximum spherical-harmonic degree; use `0` for base color only |
| `edits` | `SplatEdit[] \| null` | Explicit edits applied only to this mesh |
| `splats` | `SplatSource \| undefined` | Current underlying source |
| `extSplats` | `ExtSplats \| undefined` | The built-in source, when one is in use |
| `needsUpdate` | `boolean` setter | Set to `true` to force Splat regeneration and depth re-sorting; `false` does nothing |

### Common methods

```ts
await mesh.initialized;

mesh.getBoundingBox();      // Centers only; faster.
mesh.getBoundingBox(false); // Includes rotated and scaled Splat bounds.

mesh.pushSplat(center, scales, quaternion, opacity, color);
mesh.forEachSplat((index, center, scales, quaternion, opacity, color) => {});

mesh.updateVersion();                 // Regenerate and re-sort.
mesh.updateVersion({ sort: false });  // Appearance only; reuse sorting.
mesh.updateMappingVersion();          // Count or mapping changed.
mesh.dispose();
```

`getBoundingBox()` can only be called after initialization. `pushSplat()` only affects a mesh backed by the built-in `ExtSplats` source.

### Raycasting

`SplatMesh` implements the Three.js `raycast()` protocol:

```js
const raycaster = new THREE.Raycaster();
raycaster.setFromCamera(pointer, camera);

const intersections = raycaster.intersectObject(splat);
if (intersections.length > 0) {
  console.log(intersections[0].point, intersections[0].distance);
}
```

Raycasting currently requires the built-in `ExtSplats` source and `raycastable: true`. During the earliest stage of module startup, raycasting temporarily returns no intersections until the main-thread WebAssembly instance is ready.

## ExtSplats

`ExtSplats` is the built-in mutable source. In addition to file input, it provides direct per-Splat access:

```js
const data = splat.extSplats;
const item = data.getSplat(0);

data.setSplat(
  0,
  item.center,
  item.scales.multiplyScalar(1.1),
  item.quaternion,
  item.opacity,
  item.color,
);

data.pushSplat(center, scales, quaternion, opacity, color);
data.forEachSplat((index, center, scales, quaternion, opacity, color) => {});
```

The constructor and `reinitialize()` accept the same `ExtSplatsOptions`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `url` | `string` | `undefined` | PLY/SPZ file URL |
| `fileBytes` | `Uint8Array \| ArrayBuffer` | `undefined` | In-memory file data |
| `fileType` | `SplatFileType` | Inferred from name | Explicit file format |
| `fileName` | `string` | `undefined` | Name used to infer byte or stream input format |
| `stream` | `ReadableStream` | `undefined` | Chunked input stream |
| `streamLength` | `number` | `undefined` | Total input-stream length |
| `maxSplats` | `number` | `0` | Initial capacity |
| `extArrays` | `[Uint32Array, Uint32Array]` | Empty arrays | Two pre-encoded Splat data arrays |
| `localCenters` | `Float32Array` | `undefined` | One-use center-coordinate fast path from a decoder |
| `numSplats` | `number` | Capacity | Number of valid Splats in `extArrays` |
| `construct` | `(splats) => void \| Promise<void>` | `undefined` | Populates the source during initialization |
| `onProgress` | `(event: ProgressEvent) => void` | `undefined` | Loading progress callback |
| `extra` | `Record<string, unknown>` | `{}` | Additional data such as SH arrays |

File input, `extArrays`, and `construct` serve different initialization paths and normally should not be mixed. Supplying `extArrays` directly is a low-level encoded-data API.

The main methods are:

| API | Description |
| --- | --- |
| `initialized` / `isInitialized` | Asynchronous initialization state |
| `getNumSplats()` / `getNumSh()` | Returns Splat count and available SH degree |
| `getSplat(index)` | Decodes and returns one Splat |
| `setSplat(index, ...)` | Adds or overwrites one Splat |
| `pushSplat(...)` | Appends one Splat |
| `forEachCenter(callback)` | Iterates centers only, suitable for spatial-index construction |
| `forEachSplat(callback)` | Iterates and fully decodes every Splat |
| `ensureSplats(count)` | Ensures underlying array capacity |
| `reinitialize(options)` | Reinitializes from a file, stream, array, or construction callback |
| `dispose()` | Releases textures and data references |

After modifying low-level arrays such as `extArrays` directly, set `data.needsUpdate = true`. Prefer `setSplat()` and `pushSplat()`, which manage capacity and update state automatically.

## Custom SplatSource

Advanced integrations can implement and supply a custom `SplatSource`. A source must provide both CPU center iteration and GPU texture access:

```ts
interface SplatSource {
  needsUpdate: boolean;

  dispose(): void;
  getNumSplats(): number;
  getNumSh(): number;
  getSplatTextures(): readonly [
    THREE.DataArrayTexture,
    THREE.DataArrayTexture,
  ];
  getShTextures(): SplatShTextures;
  forEachCenter(callback: (index, x, y, z) => void): void;
  forEachSplat(callback: (index, center, scales, quaternion, opacity, color) => void): void;
}

const mesh = new SplatMesh({ splats: customSource });
```

This is an extension point for the low-level encoding. Shader construction, arbitrary per-Splat modifiers, and dynamic shader nodes are deliberately outside this interface.

## SDF color and opacity editing

SDF edits affect RGBA only. They do not move Splat centers or invalidate an existing depth order. Available shapes are:

```ts
SplatEditSdfType.ALL
SplatEditSdfType.PLANE
SplatEditSdfType.SPHERE
SplatEditSdfType.BOX
SplatEditSdfType.ELLIPSOID
SplatEditSdfType.CYLINDER
SplatEditSdfType.CAPSULE
SplatEditSdfType.INFINITE_CONE
```

The following edit affects only `splat`:

```js
import * as THREE from "three";
import {
  SplatEdit,
  SplatEditRgbaBlendMode,
  SplatEditSdf,
  SplatEditSdfType,
} from "gaussian-splat-lite";

const edit = new SplatEdit({
  name: "Warm sphere",
  rgbaBlendMode: SplatEditRgbaBlendMode.MULTIPLY,
  softEdge: 0.1,
  sdfSmooth: 0,
});

const sphere = new SplatEditSdf({
  type: SplatEditSdfType.SPHERE,
  color: new THREE.Color(1, 0.5, 0.5),
  opacity: 0.4,
  radius: 1,
});

sphere.position.set(0, 0, 0);
edit.add(sphere);
splat.add(edit);
```

Adding a `SplatEdit` directly to the scene, rather than below a particular `SplatMesh`, makes it a global edit for every editable Splat mesh:

```js
scene.add(edit);
```

### SplatEdit options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | Generated | Object name |
| `rgbaBlendMode` | `SplatEditRgbaBlendMode` | `MULTIPLY` | Component-wise multiplication or `ADD_RGBA` addition |
| `sdfSmooth` | `number` | `0` | Smoothing amount when combining SDF shapes |
| `softEdge` | `number` | `0` | Region-edge feathering distance |
| `invert` | `boolean` | `false` | Inverts the entire edit region |
| `sdfs` | `SplatEditSdf[]` | `null` | Explicit shape list; SDFs can instead be child objects |

### SplatEdit methods

| API | Description |
| --- | --- |
| `addSdf(sdf)` | Adds an SDF to the explicit `sdfs` list without adding the same object twice |
| `removeSdf(sdf)` | Removes an SDF from the explicit `sdfs` list |

`addSdf()` and `removeSdf()` manage the explicit list. When `sdfs` is not `null`, the renderer uses that list instead of traversing the `SplatEdit` child hierarchy. Use `edit.add(sdf)` and `edit.remove(sdf)` when the SDFs should instead be regular `THREE.Object3D` children.

### SplatEditSdf options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | `SplatEditSdfType` | `SPHERE` | SDF shape |
| `invert` | `boolean` | `false` | Inverts the inside and outside of the shape |
| `opacity` | `number` | `1` | Alpha value used by the edit |
| `color` | `THREE.Color` | White | RGB value used by the edit |
| `radius` | `number` | `0` | Radius used by sphere, cylinder, capsule, and related shapes |

An SDF extends `THREE.Object3D`; its position, rotation, and scale define the edit region. Edits execute in creation order by default, and the order can be changed through `edit.ordering`.

## Large world coordinates / GIS / ECEF

The renderer keeps large translations separate from float32 local coordinates. Rendering subtracts the camera origin while values are still JavaScript double-precision numbers, and sorting stores one float64 world origin per `SplatMesh` alongside its float32 local centers. This happens automatically and does not move scene objects or change the world-coordinate behavior of `SplatMesh`, Raycaster, or SDF edits.

Source Splat centers should still remain local to their mesh wherever possible. Precision already lost by storing absolute ECEF coordinates in a float32 source cannot be recovered during rendering.

## Manual updates and animation

By default, the renderer automatically detects object-count, transform, appearance, and camera changes. Use `onFrame` for per-frame animation:

```js
const splat = new SplatMesh({
  url: "/assets/model.spz",
  onFrame: ({ mesh, time }) => {
    mesh.rotation.y = time * 0.2;
  },
});
```

When automatic updates are disabled, call `update()` after the scene or camera changes:

```js
const splatRenderer = new GaussianSplatRenderer({
  renderer,
  autoUpdate: false,
});

await splatRenderer.update({ scene, camera });
renderer.render(scene, camera);
```

## Offscreen rendering

```js
const captureRenderer = new GaussianSplatRenderer({
  renderer,
  target: {
    width: 1920,
    height: 1080,
    superXY: 2,
  },
});
scene.add(captureRenderer);

await captureRenderer.update({ scene, camera });
const rgba = await captureRenderer.renderReadTarget({ scene, camera });
// rgba is a 1920 * 1080 * 4 Uint8Array.
```

If the same scene also contains a `GaussianSplatRenderer` used for canvas display, control the instances with `layers` or `visible` as appropriate so that both are not rendered as ordinary scene objects during the same pass.

## Development

Building from source requires Node.js, a Rust toolchain installed through `rustup`, and the `wasm32-unknown-unknown` target. `build:wasm` installs `wasm-pack` through Cargo when it is not already available.

```sh
npm install
npm run build:wasm
npm run build
npm test
```

Start the local PLY/SPZ viewer with:

```sh
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:8080/`. Drag a `.ply` or `.spz` file onto the viewer, or use its file picker. Files are decoded locally and are not uploaded.

Other useful commands:

```sh
npm run build:watch
npm run lint
npm run format
```

The package build emits ESM and CommonJS bundles in `dist/`, together with TypeScript declarations and source maps.
