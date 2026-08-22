"use strict";
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const THREE = require("three");
const Pass_js = require("three/addons/postprocessing/Pass.js");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const THREE__namespace = /* @__PURE__ */ _interopNamespaceDefault(THREE);
function rebaseAffineTransform(matrix, origin) {
  const elements = matrix.elements;
  const x = origin.x;
  const y = origin.y;
  const z = origin.z;
  const tx = elements[0] * x + elements[4] * y + elements[8] * z + elements[12];
  const ty = elements[1] * x + elements[5] * y + elements[9] * z + elements[13];
  const tz = elements[2] * x + elements[6] * y + elements[10] * z + elements[14];
  elements[12] = tx;
  elements[13] = ty;
  elements[14] = tz;
  return matrix;
}
function buildSortCenters(current) {
  const centers = new Float32Array(current.numSplats * 3);
  const rangeBases = new Uint32Array(current.mapping.length);
  const rangeCounts = new Uint32Array(current.mapping.length);
  const rangeOrigins = new Float64Array(current.mapping.length * 3);
  centers.fill(Number.NaN);
  const objectToWorld = new THREE__namespace.Matrix4();
  current.mapping.forEach(({ node, base, count }, rangeIndex) => {
    rangeBases[rangeIndex] = base;
    rangeCounts[rangeIndex] = count;
    const source = node.splats;
    if (!source) return;
    objectToWorld.copy(node.matrixWorld);
    const elements = objectToWorld.elements;
    const originTarget = rangeIndex * 3;
    rangeOrigins[originTarget] = elements[12];
    rangeOrigins[originTarget + 1] = elements[13];
    rangeOrigins[originTarget + 2] = elements[14];
    source.forEachCenter((index, x, y, z) => {
      if (index >= count || Number.isNaN(x)) {
        return;
      }
      const target = (base + index) * 3;
      centers[target] = elements[0] * x + elements[4] * y + elements[8] * z;
      centers[target + 1] = elements[1] * x + elements[5] * y + elements[9] * z;
      centers[target + 2] = elements[2] * x + elements[6] * y + elements[10] * z;
    });
  });
  return { centers, rangeBases, rangeCounts, rangeOrigins };
}
var SplatEditSdfType = /* @__PURE__ */ ((SplatEditSdfType2) => {
  SplatEditSdfType2["ALL"] = "all";
  SplatEditSdfType2["PLANE"] = "plane";
  SplatEditSdfType2["SPHERE"] = "sphere";
  SplatEditSdfType2["BOX"] = "box";
  SplatEditSdfType2["ELLIPSOID"] = "ellipsoid";
  SplatEditSdfType2["CYLINDER"] = "cylinder";
  SplatEditSdfType2["CAPSULE"] = "capsule";
  SplatEditSdfType2["INFINITE_CONE"] = "infinite_cone";
  return SplatEditSdfType2;
})(SplatEditSdfType || {});
var SplatEditRgbaBlendMode = /* @__PURE__ */ ((SplatEditRgbaBlendMode2) => {
  SplatEditRgbaBlendMode2["MULTIPLY"] = "multiply";
  SplatEditRgbaBlendMode2["ADD_RGBA"] = "add_rgba";
  return SplatEditRgbaBlendMode2;
})(SplatEditRgbaBlendMode || {});
class SplatEditSdf extends THREE__namespace.Object3D {
  constructor(options = {}) {
    super();
    this.type = options.type ?? "sphere";
    this.invert = options.invert ?? false;
    this.opacity = options.opacity ?? 1;
    this.color = options.color ?? new THREE__namespace.Color(1, 1, 1);
    this.radius = options.radius ?? 0;
  }
}
const _SplatEdit = class _SplatEdit extends THREE__namespace.Object3D {
  constructor(options = {}) {
    super();
    this.rgbaBlendMode = options.rgbaBlendMode ?? "multiply";
    this.sdfSmooth = options.sdfSmooth ?? 0;
    this.softEdge = options.softEdge ?? 0;
    this.invert = options.invert ?? false;
    this.sdfs = options.sdfs ?? null;
    this.ordering = _SplatEdit.nextOrdering++;
    this.name = options.name ?? `Edit ${this.ordering}`;
  }
  addSdf(sdf) {
    this.sdfs ?? (this.sdfs = []);
    if (!this.sdfs.includes(sdf)) {
      this.sdfs.push(sdf);
    }
  }
  removeSdf(sdf) {
    if (this.sdfs) {
      this.sdfs = this.sdfs.filter((candidate) => candidate !== sdf);
    }
  }
};
_SplatEdit.nextOrdering = 1;
let SplatEdit = _SplatEdit;
const SDF_TEXELS = 5;
const MIN_CAPACITY = 16;
const scratchFloat = new Float32Array(1);
const scratchUint = new Uint32Array(scratchFloat.buffer);
const _SplatEdits = class _SplatEdits {
  constructor({ maxSdfs = 0, maxEdits = 0 } = {}) {
    this.numSdfs = 0;
    this.numEdits = 0;
    this.maxSdfs = Math.max(MIN_CAPACITY, maxSdfs);
    this.sdfData = new Uint32Array(this.maxSdfs * SDF_TEXELS * 4);
    this.sdfFloatData = new Float32Array(this.sdfData.buffer);
    this.sdfTexture = makeUintTexture(this.sdfData, SDF_TEXELS, this.maxSdfs);
    this.maxEdits = Math.max(MIN_CAPACITY, maxEdits);
    this.editData = new Uint32Array(this.maxEdits * 4);
    this.editFloatData = new Float32Array(this.editData.buffer);
    this.editTexture = makeUintTexture(this.editData, 1, this.maxEdits);
  }
  dispose() {
    this.sdfTexture.dispose();
    this.editTexture.dispose();
  }
  update(groups, coordinateOrigin) {
    const sdfCount = groups.reduce(
      (total, group) => total + group.sdfs.length,
      0
    );
    let updated = this.ensureCapacity(sdfCount, groups.length);
    if (this.numSdfs !== sdfCount || this.numEdits !== groups.length) {
      this.numSdfs = sdfCount;
      this.numEdits = groups.length;
      updated = true;
    }
    const center = new THREE__namespace.Vector3();
    const quaternion = new THREE__namespace.Quaternion();
    const inverseScale = new THREE__namespace.Vector3();
    const sizes = new THREE__namespace.Vector4();
    const worldToSdf = new THREE__namespace.Matrix4();
    let sdfIndex = 0;
    let sdfUpdated = false;
    let editUpdated = false;
    groups.forEach(({ edit, sdfs }, editIndex) => {
      editUpdated = this.encodeEdit(editIndex, edit, sdfIndex, sdfs.length) || editUpdated;
      for (const sdf of sdfs) {
        sizes.set(sdf.scale.x, sdf.scale.y, sdf.scale.z, sdf.radius);
        const originalScale = sdf.scale.clone();
        try {
          sdf.scale.setScalar(1);
          sdf.updateWorldMatrix(true, false);
          worldToSdf.copy(sdf.matrixWorld).invert();
          if (coordinateOrigin) {
            rebaseAffineTransform(worldToSdf, coordinateOrigin);
          }
          worldToSdf.decompose(center, quaternion, inverseScale);
        } finally {
          sdf.scale.copy(originalScale);
          sdf.updateWorldMatrix(true, false);
        }
        sdfUpdated = this.encodeSdf(
          sdfIndex,
          sdf,
          center,
          quaternion,
          inverseScale,
          sizes
        ) || sdfUpdated;
        sdfIndex += 1;
      }
    });
    if (sdfUpdated) {
      this.sdfTexture.needsUpdate = true;
    }
    if (editUpdated) {
      this.editTexture.needsUpdate = true;
    }
    return { updated: updated || sdfUpdated || editUpdated };
  }
  ensureCapacity(sdfs, edits) {
    let updated = false;
    if (sdfs > this.maxSdfs) {
      this.maxSdfs = Math.max(sdfs, this.maxSdfs * 2);
      this.sdfTexture.dispose();
      this.sdfData = new Uint32Array(this.maxSdfs * SDF_TEXELS * 4);
      this.sdfFloatData = new Float32Array(this.sdfData.buffer);
      this.sdfTexture = makeUintTexture(this.sdfData, SDF_TEXELS, this.maxSdfs);
      updated = true;
    }
    if (edits > this.maxEdits) {
      this.maxEdits = Math.max(edits, this.maxEdits * 2);
      this.editTexture.dispose();
      this.editData = new Uint32Array(this.maxEdits * 4);
      this.editFloatData = new Float32Array(this.editData.buffer);
      this.editTexture = makeUintTexture(this.editData, 1, this.maxEdits);
      updated = true;
    }
    return updated;
  }
  encodeEdit(index, edit, sdfFirst, sdfCount) {
    if (sdfFirst > 65535 || sdfCount > 65535) {
      throw new Error("An SDF edit supports at most 65535 shapes");
    }
    const base = index * 4;
    const blend = edit.rgbaBlendMode === "multiply" ? 0 : 1;
    const flags = blend | (edit.invert ? 1 << 8 : 0);
    let updated = this.setEditUint(base, flags);
    updated = this.setEditUint(base + 1, sdfFirst | sdfCount << 16) || updated;
    updated = this.setEditFloat(base + 2, edit.softEdge) || updated;
    updated = this.setEditFloat(base + 3, edit.sdfSmooth) || updated;
    return updated;
  }
  encodeSdf(index, sdf, center, quaternion, scale, sizes) {
    const base = index * SDF_TEXELS * 4;
    const flags = sdfTypeToNumber(sdf.type) | (sdf.invert ? 1 << 8 : 0);
    let updated = this.setSdfFloat(base, center.x);
    updated = this.setSdfFloat(base + 1, center.y) || updated;
    updated = this.setSdfFloat(base + 2, center.z) || updated;
    updated = this.setSdfUint(base + 3, flags) || updated;
    updated = this.setSdfFloat(base + 4, quaternion.x) || updated;
    updated = this.setSdfFloat(base + 5, quaternion.y) || updated;
    updated = this.setSdfFloat(base + 6, quaternion.z) || updated;
    updated = this.setSdfFloat(base + 7, quaternion.w) || updated;
    updated = this.setSdfFloat(base + 8, scale.x) || updated;
    updated = this.setSdfFloat(base + 9, scale.y) || updated;
    updated = this.setSdfFloat(base + 10, scale.z) || updated;
    updated = this.setSdfUint(base + 11, 0) || updated;
    updated = this.setSdfFloat(base + 12, sizes.x) || updated;
    updated = this.setSdfFloat(base + 13, sizes.y) || updated;
    updated = this.setSdfFloat(base + 14, sizes.z) || updated;
    updated = this.setSdfFloat(base + 15, sizes.w) || updated;
    updated = this.setSdfFloat(base + 16, sdf.color.r) || updated;
    updated = this.setSdfFloat(base + 17, sdf.color.g) || updated;
    updated = this.setSdfFloat(base + 18, sdf.color.b) || updated;
    updated = this.setSdfFloat(base + 19, sdf.opacity) || updated;
    return updated;
  }
  setSdfUint(offset, value) {
    const updated = this.sdfData[offset] !== value;
    this.sdfData[offset] = value;
    return updated;
  }
  setSdfFloat(offset, value) {
    scratchFloat[0] = value;
    return this.setSdfUint(offset, scratchUint[0]);
  }
  setEditUint(offset, value) {
    const updated = this.editData[offset] !== value;
    this.editData[offset] = value;
    return updated;
  }
  setEditFloat(offset, value) {
    scratchFloat[0] = value;
    return this.setEditUint(offset, scratchUint[0]);
  }
};
_SplatEdits.emptyTexture = makeUintTexture(new Uint32Array(4), 1, 1);
let SplatEdits = _SplatEdits;
function sdfTypeToNumber(type) {
  switch (type) {
    case "all":
      return 0;
    case "plane":
      return 1;
    case "sphere":
      return 2;
    case "box":
      return 3;
    case "ellipsoid":
      return 4;
    case "cylinder":
      return 5;
    case "capsule":
      return 6;
    case "infinite_cone":
      return 7;
  }
}
function makeUintTexture(data, width, height) {
  const texture = new THREE__namespace.DataTexture(
    data,
    width,
    height,
    THREE__namespace.RGBAIntegerFormat,
    THREE__namespace.UnsignedIntType
  );
  texture.internalFormat = "RGBA32UI";
  texture.magFilter = THREE__namespace.NearestFilter;
  texture.minFilter = THREE__namespace.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
function get_raycast_buffer() {
  const ret = wasm.get_raycast_buffer();
  return ret;
}
function get_raycast_buffer2() {
  const ret = wasm.get_raycast_buffer2();
  return ret;
}
function raycast_ext_buffers(origin_x, origin_y, origin_z, dir_x, dir_y, dir_z, min_opacity, near, far, count) {
  const ret = wasm.raycast_ext_buffers(origin_x, origin_y, origin_z, dir_x, dir_y, dir_z, min_opacity, near, far, count);
  return ret;
}
function __wbg_get_imports() {
  const import0 = {
    __proto__: null,
    __wbg___wbindgen_debug_string_dd5d2d07ce9e6c57: function(arg0, arg1) {
      const ret = debugString(arg1);
      const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      const len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg___wbindgen_throw_81fc77679af83bc6: function(arg0, arg1) {
      throw new Error(getStringFromWasm0(arg0, arg1));
    },
    __wbg_error_a6fa202b58aa1cd3: function(arg0, arg1) {
      let deferred0_0;
      let deferred0_1;
      try {
        deferred0_0 = arg0;
        deferred0_1 = arg1;
        console.error(getStringFromWasm0(arg0, arg1));
      } finally {
        wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
      }
    },
    __wbg_fill_37e42d54fe1a5d54: function(arg0, arg1, arg2, arg3) {
      const ret = arg0.fill(arg1, arg2 >>> 0, arg3 >>> 0);
      return ret;
    },
    __wbg_length_0c32cb8543c8e4c8: function(arg0) {
      const ret = arg0.length;
      return ret;
    },
    __wbg_length_1e701798fdcaa3b4: function(arg0) {
      const ret = arg0.length;
      return ret;
    },
    __wbg_length_526c0f6e4ebae15d: function(arg0) {
      const ret = arg0.length;
      return ret;
    },
    __wbg_length_fd4646b401926788: function(arg0) {
      const ret = arg0.length;
      return ret;
    },
    __wbg_new_227d7c05414eb861: function() {
      const ret = new Error();
      return ret;
    },
    __wbg_new_4f9fafbb3909af72: function() {
      const ret = new Object();
      return ret;
    },
    __wbg_new_with_length_26bffbe236bf73f9: function(arg0) {
      const ret = new Float32Array(arg0 >>> 0);
      return ret;
    },
    __wbg_new_with_length_41a22191b9bdfd66: function(arg0) {
      const ret = new Uint32Array(arg0 >>> 0);
      return ret;
    },
    __wbg_prototypesetcall_021fd89d67217368: function(arg0, arg1, arg2) {
      Float64Array.prototype.set.call(getArrayF64FromWasm0(arg0, arg1), arg2);
    },
    __wbg_prototypesetcall_3e05eb9545565046: function(arg0, arg1, arg2) {
      Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
    },
    __wbg_prototypesetcall_66c8e1fb820946be: function(arg0, arg1, arg2) {
      Float32Array.prototype.set.call(getArrayF32FromWasm0(arg0, arg1), arg2);
    },
    __wbg_prototypesetcall_e42275e601e14eeb: function(arg0, arg1, arg2) {
      Uint32Array.prototype.set.call(getArrayU32FromWasm0(arg0, arg1), arg2);
    },
    __wbg_set_448126769bf7c181: function(arg0, arg1, arg2) {
      arg0.set(getArrayU32FromWasm0(arg1, arg2));
    },
    __wbg_set_8ee2d34facb8466e: function() {
      return handleError(function(arg0, arg1, arg2) {
        const ret = Reflect.set(arg0, arg1, arg2);
        return ret;
      }, arguments);
    },
    __wbg_set_a98c8da6557e63de: function(arg0, arg1, arg2) {
      arg0.set(getArrayF32FromWasm0(arg1, arg2));
    },
    __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
      const ret = arg1.stack;
      const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      const len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg_subarray_0f98d3fb634508ad: function(arg0, arg1, arg2) {
      const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
      return ret;
    },
    __wbg_subarray_4342405c1ffc86d6: function(arg0, arg1, arg2) {
      const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
      return ret;
    },
    __wbg_subarray_d51e89458b3fdbf6: function(arg0, arg1, arg2) {
      const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
      return ret;
    },
    __wbindgen_cast_0000000000000001: function(arg0) {
      const ret = arg0;
      return ret;
    },
    __wbindgen_cast_0000000000000002: function(arg0, arg1) {
      const ret = getArrayF32FromWasm0(arg0, arg1);
      return ret;
    },
    __wbindgen_cast_0000000000000003: function(arg0, arg1) {
      const ret = getArrayU32FromWasm0(arg0, arg1);
      return ret;
    },
    __wbindgen_cast_0000000000000004: function(arg0, arg1) {
      const ret = getStringFromWasm0(arg0, arg1);
      return ret;
    },
    __wbindgen_init_externref_table: function() {
      const table = wasm.__wbindgen_externrefs;
      const offset = table.grow(4);
      table.set(0, void 0);
      table.set(offset + 0, void 0);
      table.set(offset + 1, null);
      table.set(offset + 2, true);
      table.set(offset + 3, false);
    }
  };
  return {
    __proto__: null,
    "./gaussian_splat_rs_bg.js": import0
  };
}
typeof FinalizationRegistry === "undefined" ? {} : new FinalizationRegistry((ptr) => wasm.__wbg_chunkdecoder_free(ptr >>> 0, 1));
function addToExternrefTable0(obj) {
  const idx = wasm.__externref_table_alloc();
  wasm.__wbindgen_externrefs.set(idx, obj);
  return idx;
}
function debugString(val) {
  const type = typeof val;
  if (type == "number" || type == "boolean" || val == null) {
    return `${val}`;
  }
  if (type == "string") {
    return `"${val}"`;
  }
  if (type == "symbol") {
    const description = val.description;
    if (description == null) {
      return "Symbol";
    } else {
      return `Symbol(${description})`;
    }
  }
  if (type == "function") {
    const name = val.name;
    if (typeof name == "string" && name.length > 0) {
      return `Function(${name})`;
    } else {
      return "Function";
    }
  }
  if (Array.isArray(val)) {
    const length = val.length;
    let debug = "[";
    if (length > 0) {
      debug += debugString(val[0]);
    }
    for (let i = 1; i < length; i++) {
      debug += ", " + debugString(val[i]);
    }
    debug += "]";
    return debug;
  }
  const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
  let className;
  if (builtInMatches && builtInMatches.length > 1) {
    className = builtInMatches[1];
  } else {
    return toString.call(val);
  }
  if (className == "Object") {
    try {
      return "Object(" + JSON.stringify(val) + ")";
    } catch (_) {
      return "Object";
    }
  }
  if (val instanceof Error) {
    return `${val.name}: ${val.message}
${val.stack}`;
  }
  return className;
}
function getArrayF32FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}
function getArrayF64FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}
function getArrayU32FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}
function getArrayU8FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}
let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
  if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || cachedDataViewMemory0.buffer.detached === void 0 && cachedDataViewMemory0.buffer !== wasm.memory.buffer) {
    cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
  }
  return cachedDataViewMemory0;
}
let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
  if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
    cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
  }
  return cachedFloat32ArrayMemory0;
}
let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
  if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
    cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
  }
  return cachedFloat64ArrayMemory0;
}
function getStringFromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return decodeText(ptr, len);
}
let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
  if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
    cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
  }
  return cachedUint32ArrayMemory0;
}
let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
  if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8ArrayMemory0;
}
function handleError(f, args) {
  try {
    return f.apply(this, args);
  } catch (e) {
    const idx = addToExternrefTable0(e);
    wasm.__wbindgen_exn_store(idx);
  }
}
function passStringToWasm0(arg, malloc, realloc) {
  if (realloc === void 0) {
    const buf = cachedTextEncoder.encode(arg);
    const ptr2 = malloc(buf.length, 1) >>> 0;
    getUint8ArrayMemory0().subarray(ptr2, ptr2 + buf.length).set(buf);
    WASM_VECTOR_LEN = buf.length;
    return ptr2;
  }
  let len = arg.length;
  let ptr = malloc(len, 1) >>> 0;
  const mem = getUint8ArrayMemory0();
  let offset = 0;
  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset);
    if (code > 127) break;
    mem[ptr + offset] = code;
  }
  if (offset !== len) {
    if (offset !== 0) {
      arg = arg.slice(offset);
    }
    ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
    const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
    const ret = cachedTextEncoder.encodeInto(arg, view);
    offset += ret.written;
    ptr = realloc(ptr, len, offset, 1) >>> 0;
  }
  WASM_VECTOR_LEN = offset;
  return ptr;
}
let cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
  numBytesDecoded += len;
  if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
    cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
    cachedTextDecoder.decode();
    numBytesDecoded = len;
  }
  return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}
const cachedTextEncoder = new TextEncoder();
if (!("encodeInto" in cachedTextEncoder)) {
  cachedTextEncoder.encodeInto = function(arg, view) {
    const buf = cachedTextEncoder.encode(arg);
    view.set(buf);
    return {
      read: arg.length,
      written: buf.length
    };
  };
}
let WASM_VECTOR_LEN = 0;
let wasm;
function __wbg_finalize_init(instance, module2) {
  wasm = instance.exports;
  cachedDataViewMemory0 = null;
  cachedFloat32ArrayMemory0 = null;
  cachedFloat64ArrayMemory0 = null;
  cachedUint32ArrayMemory0 = null;
  cachedUint8ArrayMemory0 = null;
  wasm.__wbindgen_start();
  return wasm;
}
async function __wbg_load(module2, imports) {
  if (typeof Response === "function" && module2 instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === "function") {
      try {
        return await WebAssembly.instantiateStreaming(module2, imports);
      } catch (e) {
        const validResponse = module2.ok && expectedResponseType(module2.type);
        if (validResponse && module2.headers.get("Content-Type") !== "application/wasm") {
          console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
        } else {
          throw e;
        }
      }
    }
    const bytes = await module2.arrayBuffer();
    return await WebAssembly.instantiate(bytes, imports);
  } else {
    const instance = await WebAssembly.instantiate(module2, imports);
    if (instance instanceof WebAssembly.Instance) {
      return { instance, module: module2 };
    } else {
      return instance;
    }
  }
  function expectedResponseType(type) {
    switch (type) {
      case "basic":
      case "cors":
      case "default":
        return true;
    }
    return false;
  }
}
async function __wbg_init(module_or_path) {
  if (wasm !== void 0) return wasm;
  if (module_or_path !== void 0) {
    if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
      ({ module_or_path } = module_or_path);
    } else {
      console.warn("using deprecated parameters for the initialization function; pass a single object instead");
    }
  }
  const imports = __wbg_get_imports();
  if (typeof module_or_path === "string" || typeof Request === "function" && module_or_path instanceof Request || typeof URL === "function" && module_or_path instanceof URL) {
    module_or_path = fetch(module_or_path);
  }
  const { instance, module: module2 } = await __wbg_load(await module_or_path, imports);
  return __wbg_finalize_init(instance);
}
const LN_SCALE_MIN = -12;
const LN_SCALE_MAX = 9;
const SPLAT_TEX_WIDTH_BITS = 11;
const SPLAT_TEX_HEIGHT_BITS = 11;
const SPLAT_TEX_WIDTH = 1 << SPLAT_TEX_WIDTH_BITS;
const SPLAT_TEX_HEIGHT = 1 << SPLAT_TEX_HEIGHT_BITS;
const SPLAT_TEX_MIN_HEIGHT = 1;
var SplatFileType = /* @__PURE__ */ ((SplatFileType2) => {
  SplatFileType2["PLY"] = "ply";
  SplatFileType2["SPZ"] = "spz";
  return SplatFileType2;
})(SplatFileType || {});
const defines = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  LN_SCALE_MAX,
  LN_SCALE_MIN,
  SPLAT_TEX_HEIGHT,
  SPLAT_TEX_HEIGHT_BITS,
  SPLAT_TEX_MIN_HEIGHT,
  SPLAT_TEX_WIDTH,
  SPLAT_TEX_WIDTH_BITS,
  SplatFileType
}, Symbol.toStringTag, { value: "Module" }));
const threeRevision = Number.parseInt(THREE__namespace.REVISION);
const threeMrtArray = threeRevision >= 179;
const f32buffer = new Float32Array(1);
const u32buffer = new Uint32Array(f32buffer.buffer);
const supportsFloat16Array = "Float16Array" in globalThis;
const f16buffer = supportsFloat16Array ? new globalThis["Float16Array"](1) : null;
const u16buffer = new Uint16Array(f16buffer == null ? void 0 : f16buffer.buffer);
function floatBitsToUint(f) {
  f32buffer[0] = f;
  return u32buffer[0];
}
function uintBitsToFloat(u) {
  u32buffer[0] = u;
  return f32buffer[0];
}
const toHalf = supportsFloat16Array ? toHalfNative : toHalfJS;
const fromHalf = supportsFloat16Array ? fromHalfNative : fromHalfJS;
function toHalfNative(f) {
  f16buffer[0] = f;
  return u16buffer[0];
}
function toHalfJS(f) {
  f32buffer[0] = f;
  const bits = u32buffer[0];
  const sign = bits >> 31 & 1;
  const exp = bits >> 23 & 255;
  const frac = bits & 8388607;
  const halfSign = sign << 15;
  if (exp === 255) {
    if (frac !== 0) {
      return halfSign | 32767;
    }
    return halfSign | 31744;
  }
  const newExp = exp - 127 + 15;
  if (newExp >= 31) {
    return halfSign | 31744;
  }
  if (newExp <= 0) {
    if (newExp < -10) {
      return halfSign;
    }
    const subFrac = (frac | 8388608) >> 1 - newExp + 13;
    return halfSign | subFrac;
  }
  const halfFrac = frac >> 13;
  return halfSign | newExp << 10 | halfFrac;
}
function fromHalfNative(u) {
  u16buffer[0] = u;
  return f16buffer[0];
}
function fromHalfJS(h) {
  const sign = h >> 15 & 1;
  const exp = h >> 10 & 31;
  const frac = h & 1023;
  let f32bits;
  if (exp === 0) {
    if (frac === 0) {
      f32bits = sign << 31;
    } else {
      let mant = frac;
      let e = -14;
      while ((mant & 1024) === 0) {
        mant <<= 1;
        e--;
      }
      mant &= 1023;
      const newExp = e + 127;
      const newFrac = mant << 13;
      f32bits = sign << 31 | newExp << 23 | newFrac;
    }
  } else if (exp === 31) {
    if (frac === 0) {
      f32bits = sign << 31 | 2139095040;
    } else {
      f32bits = sign << 31 | 2143289344;
    }
  } else {
    const newExp = exp - 15 + 127;
    const newFrac = frac << 13;
    f32bits = sign << 31 | newExp << 23 | newFrac;
  }
  u32buffer[0] = f32bits;
  return f32buffer[0];
}
function getTransferable(ctx) {
  const buffers = [];
  const seen = /* @__PURE__ */ new Set();
  function traverse(obj) {
    if (obj && typeof obj === "object" && !seen.has(obj)) {
      seen.add(obj);
      if (obj instanceof ArrayBuffer) {
        buffers.push(obj);
      } else if (ArrayBuffer.isView(obj)) {
        buffers.push(obj.buffer);
      } else if (Array.isArray(obj)) {
        obj.forEach(traverse);
      } else {
        Object.values(obj).forEach(traverse);
      }
    }
  }
  traverse(ctx);
  return buffers;
}
function encodeExtSplat(extArrays, index, x, y, z, scaleX, scaleY, scaleZ, quatX, quatY, quatZ, quatW, opacity, r, g, b) {
  const i4 = index * 4;
  const [extA, extB] = extArrays;
  extA[i4] = floatBitsToUint(x);
  extA[i4 + 1] = floatBitsToUint(y);
  extA[i4 + 2] = floatBitsToUint(z);
  extA[i4 + 3] = toHalf(opacity);
  extB[i4] = toHalf(r) | toHalf(g) << 16;
  extB[i4 + 1] = toHalf(b) | toHalf(Math.log(scaleX)) << 16;
  extB[i4 + 2] = toHalf(Math.log(scaleY)) | toHalf(Math.log(scaleZ)) << 16;
  extB[i4 + 3] = encodeQuatOctXy1010R12(quatX, quatY, quatZ, quatW);
}
function decodeExtSplat(extArrays, index) {
  const result = packedFields;
  const i4 = index * 4;
  const [extA, extB] = extArrays;
  result.center.x = uintBitsToFloat(extA[i4]);
  result.center.y = uintBitsToFloat(extA[i4 + 1]);
  result.center.z = uintBitsToFloat(extA[i4 + 2]);
  result.opacity = fromHalf(extA[i4 + 3] & 65535);
  result.color.r = fromHalf(extB[i4] & 65535);
  result.color.g = fromHalf(extB[i4] >>> 16);
  result.color.b = fromHalf(extB[i4 + 1] & 65535);
  result.scales.x = Math.exp(fromHalf(extB[i4 + 1] >>> 16));
  result.scales.y = Math.exp(fromHalf(extB[i4 + 2] & 65535));
  result.scales.z = Math.exp(fromHalf(extB[i4 + 2] >>> 16));
  decodeQuatOctXy1010R12(extB[i4 + 3], result.quaternion);
  return result;
}
const packedCenter = new THREE__namespace.Vector3();
const packedScales = new THREE__namespace.Vector3();
const packedQuaternion = new THREE__namespace.Quaternion();
const packedColor = new THREE__namespace.Color();
const packedFields = {
  center: packedCenter,
  scales: packedScales,
  quaternion: packedQuaternion,
  color: packedColor,
  opacity: 0
};
function getTextureSize(numSplats) {
  const width = SPLAT_TEX_WIDTH;
  const height = Math.max(
    SPLAT_TEX_MIN_HEIGHT,
    Math.min(SPLAT_TEX_HEIGHT, Math.ceil(numSplats / width))
  );
  const depth = Math.ceil(numSplats / (width * height));
  const maxSplats = width * height * depth;
  return { width, height, depth, maxSplats };
}
const IDENT_VERTEX_SHADER = `
precision highp float;

in vec3 position;

void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
function encodeQuatOctXy1010R12(qx, qy, qz, qw) {
  const qlen = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
  const qnx = (qw < 0 ? -qx : qx) / qlen;
  const qny = (qw < 0 ? -qy : qy) / qlen;
  const qnz = (qw < 0 ? -qz : qz) / qlen;
  const qnw = (qw < 0 ? -qw : qw) / qlen;
  const theta = 2 * Math.acos(qnw);
  const xyz_norm = Math.sqrt(qnx * qnx + qny * qny + qnz * qnz);
  const axisX2 = xyz_norm < 1e-6 ? 1 : qnx / xyz_norm;
  const axisY2 = xyz_norm < 1e-6 ? 0 : qny / xyz_norm;
  const axisZ2 = xyz_norm < 1e-6 ? 0 : qnz / xyz_norm;
  const sum = Math.abs(axisX2) + Math.abs(axisY2) + Math.abs(axisZ2);
  let p_x = axisX2 / sum;
  let p_y = axisY2 / sum;
  if (axisZ2 < 0) {
    const tmp = p_x;
    p_x = (1 - Math.abs(p_y)) * (p_x >= 0 ? 1 : -1);
    p_y = (1 - Math.abs(tmp)) * (p_y >= 0 ? 1 : -1);
  }
  const u_f = p_x * 0.5 + 0.5;
  const v_f = p_y * 0.5 + 0.5;
  const quantU = Math.round(u_f * 1023);
  const quantV = Math.round(v_f * 1023);
  const angleInt = Math.round(theta * (4095 / Math.PI));
  return angleInt << 20 | quantV << 10 | quantU;
}
function decodeQuatOctXy1010R12(encoded, out) {
  const quantU = encoded & 1023;
  const quantV = encoded >>> 10 & 1023;
  const angleInt = encoded >>> 20 & 4095;
  const u_f = quantU / 1023;
  const v_f = quantV / 1023;
  let f_x = (u_f - 0.5) * 2;
  let f_y = (v_f - 0.5) * 2;
  const f_z = 1 - (Math.abs(f_x) + Math.abs(f_y));
  const t = Math.max(-f_z, 0);
  f_x += f_x >= 0 ? -t : t;
  f_y += f_y >= 0 ? -t : t;
  const axisLen = Math.sqrt(f_x * f_x + f_y * f_y + f_z * f_z);
  const axisX2 = axisLen < 1e-6 ? 0 : f_x / axisLen;
  const axisY2 = axisLen < 1e-6 ? 0 : f_y / axisLen;
  const axisZ2 = axisLen < 1e-6 ? 0 : f_z / axisLen;
  const theta = angleInt / 4095 * Math.PI;
  const halfTheta = theta * 0.5;
  const s = Math.sin(halfTheta);
  const w = Math.cos(halfTheta);
  out.set(axisX2 * s, axisY2 * s, axisZ2 * s, w);
  return out;
}
function uploadU32DataTextureRows(renderer, texture, width, rows, data) {
  const gl = renderer.getContext();
  const props = renderer.properties.get(texture);
  const glTexture = props == null ? void 0 : props.__webglTexture;
  if (!glTexture) {
    throw new Error("texture not found");
  }
  const currentFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
  const currentPremultiply = gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL);
  renderer.state.activeTexture(gl.TEXTURE0);
  renderer.state.bindTexture(gl.TEXTURE_2D, glTexture);
  gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    0,
    0,
    width,
    rows,
    gl.RGBA_INTEGER,
    gl.UNSIGNED_INT,
    data
  );
  renderer.state.unbindTexture();
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, currentFlipY);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, currentPremultiply);
}
function resolveTimer(timer) {
  return {
    timer: timer ?? new THREE__namespace.Timer(),
    // A caller-supplied timer may be shared with other systems, so only update
    // the timer that Gaussian Splat Lite creates and owns itself.
    ownsTimer: timer === void 0
  };
}
const utils = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  IDENT_VERTEX_SHADER,
  decodeExtSplat,
  decodeQuatOctXy1010R12,
  encodeExtSplat,
  encodeQuatOctXy1010R12,
  floatBitsToUint,
  fromHalf,
  getTextureSize,
  getTransferable,
  resolveTimer,
  threeMrtArray,
  threeRevision,
  toHalf,
  uintBitsToFloat,
  uploadU32DataTextureRows
}, Symbol.toStringTag, { value: "Module" }));
function b64ToUint6(nChr) {
  return nChr > 64 && nChr < 91 ? nChr - 65 : nChr > 96 && nChr < 123 ? nChr - 71 : nChr > 47 && nChr < 58 ? nChr + 4 : nChr === 43 ? 62 : nChr === 47 ? 63 : 0;
}
function base64ToUint8(sBase64, nBlocksSize) {
  const sB64Enc = sBase64.replace(/[^A-Za-z0-9+/]/g, "");
  const nInLen = sB64Enc.length;
  const nOutLen = nBlocksSize ? Math.ceil((nInLen * 3 + 1 >> 2) / nBlocksSize) * nBlocksSize : nInLen * 3 + 1 >> 2;
  const taBytes = new Uint8Array(nOutLen);
  let nMod3;
  let nMod4;
  let nUint24 = 0;
  let nOutIdx = 0;
  for (let nInIdx = 0; nInIdx < nInLen; nInIdx++) {
    nMod4 = nInIdx & 3;
    nUint24 |= b64ToUint6(sB64Enc.charCodeAt(nInIdx)) << 6 * (3 - nMod4);
    if (nMod4 === 3 || nInLen - nInIdx === 1) {
      nMod3 = 0;
      while (nMod3 < 3 && nOutIdx < nOutLen) {
        taBytes[nOutIdx] = nUint24 >>> (16 >>> nMod3 & 24) & 255;
        nMod3++;
        nOutIdx++;
      }
      nUint24 = 0;
    }
  }
  return taBytes;
}
function toUint8(b64) {
  if (typeof Uint8Array.fromBase64 === "function") return Uint8Array.fromBase64(b64);
  let bin = atob(b64);
  let len = bin.length;
  let bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}
const decode64 = typeof atob === "function" ? toUint8 : base64ToUint8;
const wasmBytes = decode64("AGFzbQEAAAABjAM3YAN/f38Bf2ACf38Bf2ACf38AYAF/AGABfwF/YAN/f38AYAV/f39/fwBgBH9/f38AYAAAYAR/f39/AX9gBn9/f39/fwBgAX0BfWAAAW9gAW8Bf2ADf39vAGAFf39/f38Bf2AAA39/f2ADb39/AW9gAn9/AW9gBn9/f39/fwF/YANvf38AYAF/AW9gAn9vAGAHf39/f39/fwF/YAV/f35/fwBgBX9/fH9/AGAFf399f38AYAACf39gA29vbwF/YARvfX9/AW9gAXwBb2AJf39/f39/f39/AGAHf39/f39/fwBgBH9/fn4AYAR+fn9/AX5gAn9/AX5gBX9/f39/AX1gBH9/f38BfWAAAX9gAn9+AX9gAX8BfWADfX19AX1gBn9/f35/fwBgBn9/f3x/fwBgBn9/f31/fwBgBG9vb28AYAR/f39/A39/f2ABfwN/f39gAn9vAn9/YAp9fX19fX19fX1/AW9gBH9+f38AYAR/fX9/AGAEf3x/fwBgCX98fHx9fX1/bwF/YAF8AX8Crw0cGS4vZ2F1c3NpYW5fc3BsYXRfcnNfYmcuanMaX193YmdfbmV3XzRmOWZhZmJiMzkwOWFmNzIADBkuL2dhdXNzaWFuX3NwbGF0X3JzX2JnLmpzGl9fd2JnX3NldF84ZWUyZDM0ZmFjYjg0NjZlABwZLi9nYXVzc2lhbl9zcGxhdF9yc19iZy5qcx9fX3diZ19zdWJhcnJheV9kNTFlODk0NThiM2ZkYmY2ABEZLi9nYXVzc2lhbl9zcGxhdF9yc19iZy5qcx1fX3diZ19sZW5ndGhfMWU3MDE3OThmZGNhYTNiNAANGS4vZ2F1c3NpYW5fc3BsYXRfcnNfYmcuanMaX193Ymdfc2V0XzQ0ODEyNjc2OWJmN2MxODEAFBkuL2dhdXNzaWFuX3NwbGF0X3JzX2JnLmpzJ19fd2JnX3Byb3RvdHlwZXNldGNhbGxfZTQyMjc1ZTYwMWUxNGVlYgAOGS4vZ2F1c3NpYW5fc3BsYXRfcnNfYmcuanMfX193Ymdfc3ViYXJyYXlfNDM0MjQwNWMxZmZjODZkNgARGS4vZ2F1c3NpYW5fc3BsYXRfcnNfYmcuanMdX193YmdfbGVuZ3RoX2ZkNDY0NmI0MDE5MjY3ODgADRkuL2dhdXNzaWFuX3NwbGF0X3JzX2JnLmpzGl9fd2JnX3NldF9hOThjOGRhNjU1N2U2M2RlABQZLi9nYXVzc2lhbl9zcGxhdF9yc19iZy5qcyZfX3diZ19uZXdfd2l0aF9sZW5ndGhfNDFhMjIxOTFiOWJkZmQ2NgAVGS4vZ2F1c3NpYW5fc3BsYXRfcnNfYmcuanMmX193YmdfbmV3X3dpdGhfbGVuZ3RoXzI2YmZmYmUyMzZiZjczZjkAFRkuL2dhdXNzaWFuX3NwbGF0X3JzX2JnLmpzG19fd2JnX2ZpbGxfMzdlNDJkNTRmZTFhNWQ1NAAdGS4vZ2F1c3NpYW5fc3BsYXRfcnNfYmcuanMdX193YmdfbGVuZ3RoXzBjMzJjYjg1NDNjOGU0YzgADRkuL2dhdXNzaWFuX3NwbGF0X3JzX2JnLmpzH19fd2JnX3N1YmFycmF5XzBmOThkM2ZiNjM0NTA4YWQAERkuL2dhdXNzaWFuX3NwbGF0X3JzX2JnLmpzJ19fd2JnX3Byb3RvdHlwZXNldGNhbGxfM2UwNWViOTU0NTU2NTA0NgAOGS4vZ2F1c3NpYW5fc3BsYXRfcnNfYmcuanMdX193YmdfbGVuZ3RoXzUyNmMwZjZlNGViYWUxNWQADRkuL2dhdXNzaWFuX3NwbGF0X3JzX2JnLmpzJ19fd2JnX3Byb3RvdHlwZXNldGNhbGxfNjZjOGUxZmI4MjA5NDZiZQAOGS4vZ2F1c3NpYW5fc3BsYXRfcnNfYmcuanMnX193YmdfcHJvdG90eXBlc2V0Y2FsbF8wMjFmZDg5ZDY3MjE3MzY4AA4ZLi9nYXVzc2lhbl9zcGxhdF9yc19iZy5qcxpfX3diZ19uZXdfMjI3ZDdjMDU0MTRlYjg2MQAMGS4vZ2F1c3NpYW5fc3BsYXRfcnNfYmcuanMcX193Ymdfc3RhY2tfM2IwZDk3NGJiZjMxZTQ0ZgAWGS4vZ2F1c3NpYW5fc3BsYXRfcnNfYmcuanMcX193YmdfZXJyb3JfYTZmYTIwMmI1OGFhMWNkMwACGS4vZ2F1c3NpYW5fc3BsYXRfcnNfYmcuanMnX193YmdfX193YmluZGdlbl90aHJvd184MWZjNzc2NzlhZjgzYmM2AAIZLi9nYXVzc2lhbl9zcGxhdF9yc19iZy5qcy5fX3diZ19fX3diaW5kZ2VuX2RlYnVnX3N0cmluZ19k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QQFrIQILIARBADYCACAAIAJBAWoiATYCqAELAkACQAJAAkACQAJAAkACQAJAIAgEQEEAIQJBACEBA0AgASAAKAKcASIETw0EIAEgACgCqAEiBE8NBSAAKAKkASACaiAAKAKYASABai0AALNDAAB/Q5VDAAAAv5JDjLjwP5RDAAAAP5I4AgAgAUEBaiIEIAAoApwBIgdPDQYgBCAAKAKoASIHTw0HIAAoAqQBIAJqQQRqIAAoApgBIAFqQQFqLQAAs0MAAH9DlUMAAAC/kkOMuPA/lEMAAAA/kjgCACABQQJqIgQgACgCnAEiB08NCCAEIAAoAqgBIgdPDQIgACgCpAEgAmpBCGogACgCmAEgAWpBAmotAACzQwAAf0OVQwAAAL+SQ4y48D+UQwAAAD+SOAIAIAJBDGohAiAJIAFBA2oiAUcNAAsgACgCqAEhAQsgACAAKAK4ASADIAAoAqQBIAEQTCAAKAKcASICIAlJDRIgAEEANgKcASACIAlrIQEgCEUNASACIAlGDQggAUUNByAAKAKYASICIAIgCWogAfwKAAAMBwsgBCAHQajowAAQyQIACyACIAlHDQUMBgsgASAEQdjnwAAQyQIACyABIARB6OfAABDJAgALIAQgB0H458AAEMkCAAsgBCAHQYjowAAQyQIACyAEIAdBmOjAABDJAgALIAAgATYCnAELIAAgACgCuAEgA2oiAjYCuAEgAiAAKAKwAUcNBkEDDAQLIAAoApwBIgIgACgCsAEgACgCuAFrIglJBEAgAiIJQYCABEkNAQtBgIAEIAkgCUGAgARPGyIIIAAoAqgBIgFLBEAgCCABIgJrIgMgACgCoAEgAWtLBEAgECABIANBBEEEEPgBIAAoAqgBIQILIAAoAqQBIgcgAkECdGohBCADQQJPBEAgCCABQX9zakECdCIGBEAgBEEAIAb8CwALIAcgAiAIaiABa0ECdGpBBGshBCACIANqQQFrIQILIARBADYCACAAIAJBAWo2AqgBCwJAIAkEQEEAIQFBACECAkACQANAIAEgACgCnAEiBE8NASABIAAoAqgBIgRPDQIgACgCpAEgAmogACgCmAEgAWotAACzQwAAf0OVOAIAIAJBBGohAiABQQFqIgEgCEcNAAsgACgCpAEhDCAAKAKoASECIAAgACgCuAEgCBCqAUEAIQFBDCEDIAgh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AzEAjglCMIaEIAMxAI8JQjiGhCAihAshJCAEIAVqIQQgBkUNACAkQoACfCEkCyAoQoCAfIMgB61C/wGDQgiGhCEiICQhIwJAIAqtIixCIINCAFINAEIBICJCCIgiKKdB+AFxQQN2QQpqrYYiI0IDiCAoQgeDfiAjfCIjQv//////9wBYDQBCACEiQQEhDwwaCwJAAkACQAJAAkBBgAIQIyIVBEBBgAIQIyIKRQ0BQSwQIyIWRQ0CQSwQIyIYRQ0DQYAIECMiGkUNL0GACBAjIhNFDS9BgAgQIyIQRQ0vQYAIECMiEkUNL0GACBAjIgtFDS9BgAgQIyIHRQ0vQYAIECMiBkUNL0GACBAjIgVFDS8gA0GABmoQcyADQQE2ApAIIANBADoAjAggA0EAOgCKCCADQQA6AIgIIANBNDsBhAggA0EANgKACCADIAU2AvwHIANCgICAgIAgNwL0ByADIAY2AvAHIANCgICAgIAgNwPoByADQoCAgIDAADcD4AcgA0EjOwHcByADQQA2AtgHIAMgBzYC1AcgA0KAgICAgCA3AswHIAMgCzYCyAcgA0KAgICAgCA3A8AHIANCgICAgMAANwO4ByADQR87AbQHIANBADYCsAcgAyASNgKsByADQoCAgICAIDcCpAcgAyAQNgKgByADQoCAgICAIDcDmAcgA0KAgICAwAA3A5AHIANBADoAjAcgA0HkADsBiAcgA0EANgKEByADIBM2AoAHIANCgICAgIAgNwP4BiADIBo2AvQGIANBgAI2AvAGIANCBDcD6AYgA0IANwPgBiADIBg2AtwGIANCgICAgLABNwLUBiADIBY2AtAGIANCgICAgLABNwPIBiADIAo2AsQGIANCgICAgIAgNwK8BiADIBU2ArgGIANCgICAgIAgNwOwBiADQoCAgIAQNwOoBiAD/QwAAAAAAAAAAAAAAAAAAAAA/QsDmAYgAyAiICyEIig3A5AGIAMgJDcDiAYgAyAMNgKEBiADIAE2AoAGIBxBADYCECAc/QwAAAAAAAAAAAAAAAAAAAAA/QsCACADICM+AqgIIANBATYC1AggA/0MAAAAAAEAAAAEAAAACAAAAP0LA9gIIAMgBK03A+gIIANBADYC8AggA0KAgICAEDcCrAggA0IANwK0CCADQgE3ArwIIANCgICAgMAANwLECCADQgA3AswI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3MIAKAIAIAJqIgIgACABa2pBCGoiATYCACAEIAFBAXI2AgQgACACakEoNgIEQcDcwgBBgICAATYCAAwDC0G03MIAIAA2AgBBrNzCAEGs3MIAKAIAIAVqIgE2AgAgACABQQFyNgIEDAELQbDcwgAgADYCAEGo3MIAQajcwgAoAgAgBWoiATYCACAAIAFBAXI2AgQgACABaiABNgIACyACQQhqDwtBACEAQazcwgAoAgAiASAFTQ0AQazcwgAgASAFayIBNgIAQbTcwgBBtNzCACgCACIAIAVqIgI2AgAgAiABQQFyNgIEIAAgBUEDcjYCBAwBCyAADwsgAEEIagvhFwIZfwJ8IwBBsARrIgMkACADQgA3A5gBIANCADcDkAEgA0IANwOIASADQgA3A4ABIANCADcDeCADQgA3A3AgA0IANwNoIANCADcDYCADQgA3A1ggA0IANwNQIANCADcDSCADQgA3A0AgA0IANwM4IANCADcDMCADQgA3AyggA0IANwMgIANCADcDGCADQgA3AxAgA0IANwMIIANCADcDACADQgA3A7gCIANCADcDsAIgA0IANwOoAiADQgA3A6ACIANCADcDmAIgA0IANwOQAiADQgA3A4gCIANCADcDgAIgA0IANwP4ASADQgA3A/ABIANCADcD6AEgA0IANwPgASADQgA3A9gBIANCADcD0AEgA0IANwPIASADQgA3A8ABIANCADcDuAEgA0IANwOwASADQgA3A6gBIANCADcDoAEgA0IANwPYAyADQgA3A9ADIANCADcDyAMgA0IANwPAAyADQgA3A7gDIANCADcDsAMgA0IANwOoAyADQgA3A6ADIANCADcDmAMgA0IANwOQAyADQgA3A4gDIANCADcDgAMgA0IANwP4AiADQgA3A/ACIANCADcD6AIgA0IANwPgAiADQgA3A9gCIANCADcD0AIgA0IANwPIAiADQgA3A8ACIANB4ANqQQBB0AD8CwBBwNTCACgCACIJIQYgAkEDa0EYbSIFQQAgBUEAShsiCyEFIAtBAnRB0NTCAGohBwNAIAMgBEEDdGogBUEASAR8RAAAAAAAAAAABSAHKAIAtws5AwAgBCAGSSIKBEAgB0EEaiEHIAVBAWohBSAEIApqIgQgBk0NAQsLQQAhBQNAQQAhBCADQcACaiAFQQN0aiAcIAAgBEED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gMIAQQEgASgCBCgCDBEAACEADAELQQEhACABKAIAIgNBorLCAEEVIAEoAgQiBigCDCIEEQAADQACQCABLQAKQYABcUUEQCADQamCwgBBASAEEQAADQIgBSABEI0BRQ0BDAILIANB7afBAEECIAQRAAANASACQQE6AA8gAiAGNgIEIAIgAzYCACACQfinwQA2AhQgAiABKQIINwIYIAIgAkEPajYCCCACIAI2AhAgBSACQRBqEI0BDQEgAigCEEHrp8EAQQIgAigCFCgCDBEAAA0BCyABKAIAQbqAwgBBASABKAIEKAIMEQAAIQALIAJBIGokACAAQQFxC88LAQV/IwBBMGsiAiQAAkACQAJAAkACQAJAIAAtAAAiA0EDa0EAIANBA0sbQQFrDgMBAgMAC0EBIQMgASgCACIEQZiDwQBBCSABKAIEIgYoAgwiBREAAA0EAkAgAS0ACkGAAXFFBEAgBEGpgsIAQQEgBREAAA0GIAAgARAsRQ0BDAYLIARB7afBAEECIAURAAANBSACQQE6ACggAiAGNgIIIAIgBDYCBCACQfinwQA2AhggAiABKQIINwIcIAIgAkEoajYCDCACIAJBBGo2AhQgACACQRRqECwNBSACKAIUQeunwQBBAiACKAIYKAIMEQAADQULIAEoAgBBuoDCAEEBIAEoAgQoAgwRAAAhAwwECyABKAIAQaGDwQBBEiABKAIEKAIMEQAAIQMMAwtBASEDIAEoAgAiBEGzg8EAQQ4gASgCBCIGKAIMIgURAAANAiAAQQFqIQACQAJAIAEtAApBgAFxRQRAIARBqYLCAEEBIAURAAANBSACIAA2AgQgASgCAEHPg8EAQRYgASgCBCgCDBEAACEAIAJBADoAGSACIAA6ABggAiABNgIUIAJBFGpB5YPBAEEDIAJBBGpBHRCwASEAIAItABgiBEEBcSACLQAZIgVBAUdyRQRAIAAoAgAiAC0ACkGAAXENAiAAKAIAQcGCwgBBAiAAKAIEKAIMEQAARQ0DDAYLIAUNBSAEQQFxRQ0CDAULIARB7afBAEECIAURAAANBCACIAY2AgggAiAENgIEIAJBAToAEyACQfinwQA2AhggAiABKQIINwIcIAIgAkETajYCDCACIAJBBGoiAzYCFCACIAA2AiQgA0HPg8EAQRYQbCEAIAJBADoALSACIAA6ACwg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DAELQQAhBUEAEKADIQBBABCgAyEBIARBABChAzYCyAEgBCABNgLEASAEIAA2AsABIARCADcCzAEgBP0MAAAAAAAAAAAAAAAAAAAAAP0LArABIARCgICAgMAANwKoASAEQgQ3AqABIARCADcCmAEgBEKAgICAwAA3ApABIARBADYCiAEgBEEANgKAASAEQQA2AnggBEEANgJwIARBADoA1AECfyAHQQJHBEAgBCAHQQFxIARB8ABqELoBQQIhBSAEKAIEIQYgBCgCAAwBCyAEQdgBaiAEQfQAakHkAPwKAABBAAshCUF/IQAgC0F/RwRAIAMEfiADECMiAEUNAyADBEAgACACIAP8CgAACyAArQVCAQsgA61CIIaEIQ0gAyEACyAEQQxqIgogBEHYAWpB5AD8CgAAQZgBECMiAUUNAiABIAU2AgAgAUEEaiAKQeQA/AoAACABIAc6AJQBIAEgBjYCkAEgASAJNgKMASABQX82AoABIAEgDTcCeCABIAA2AnQgAUEANgJwIAFCgICAgBA3AmggC0EASgRAIAJBBGsoAgAiAEF4cSIFQQRBCCAAQQNxIgAbIANqSQ0FIABBACAFIANBJ2pLGw0GIAIQRgtBHBAjIgBFDQMgAEHk3cAANgIYIABBATYCFCAAQcjdwAA2AhAgACABNgIMQQAhASAAQQA2AgggAEKBgICAEDcCACAAQQhqIQULIAggATYCCCAIIAVBACABGzYCBCAIQQAgBSABGzYCACAEQcACaiQADAULQQEgAxCMAwALEMkDAAsQyQMAC0HQtMIAQS5BgLXCABCTAwALQZC1wgBBLkHAtcIAEJMDAAsgCCgCACAIKAIEIAgoAgggCEEQaiQAC2IBA38jAEEgayICJAAgAkEIaiIDEIsDQSgQIyIBRQRAEMkDAAsgAUGcgMAANgIAIAEgAykCADcCBCABIAP9AAII/QsCDCABIAApAgA3AhwgASAAKAIINgIkIAJBIGokACABC2IBA38jAEEgayICJAAgAkEIaiIDEIsDQSgQIyIBRQRAEMkDAAsgAUGM1MEANgIAIAEgAykCADcCBCABIAP9AAII/QsCDCABIAApAgA3AhwgASAAKAIINgIkIAJBIGokACABC1UBA38jAEEgayICJAAgAkEIaiIDEIsDQSAQIyIBRQRAEMkDAAsgAUHw08EANgIA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BEAgACgCBCIAIAAoAgwRAwALCx4AIABBhPLAADYCBCAAIAFBACABLQAAQQJJGzYCAAseACAAQYTywAA2AgQgACABQQAgAS0AAEECRxs2AgALHgAgAEH0gcEANgIEIAAgAUEAIAEoAgBBAkkbNgIACx8AIABFBEBBpO3BAEEyEOsDAAsgACACIAEoAhARAQALGwEBbyAAJQEgASACEAIhAxCtASIAIAMmASAACx8AQeDcwgAtAABFBEBB4NzCAEEBOgAACyAAQQE2AgALDwAgAARAEMkDAAsQugMACyYAIABBHGpBACAB/QACAP0M199/RxauT5AvYkXpMWynGP0j/WMbCyYAIABBHGpBACAB/QACAP0MAZkEuR8VU5ZT5zJEhRtEDf0j/WMbCyYAIABBHGpBACAB/QACAP0MXPbpX9wC9rnxwXBs8mHBJP0j/WMbCxwAIAEgAC0AAEECdCIAKAKc0UIgACgChNFCEGoLJgAgAEEcakEAIAH9AAIA/QxJ7R43EpEtH4A1m042lWsT/SP9YxsLHAAgASgCACAAKAIAIAAoAgQgASgCBCgCDBEAAAsSACAAIAFBAXRBAXIgAhDaAgALFQAgACgCACIAQYQITwRAIAAQqwILCxgAIAEoAgAgASgCBCAAKAIAIAAoAgQQcQsXAQFvIAAgARAaIQIQrQEiACACJgEgAAsXAQFvIAAgARAbIQIQrQEiACACJgEgAAsWACAAQfDWwAA2AgQgACABQRxqNgIACxYAIABBrNfAADYCBCAAIAFBHGo2AgALFgAgAEHo18AANgIEIAAgAUEcajYCAAsZACABKAIAQeKJwgBBBSABKAIEKAIMEQAACxYAIABBwNXBADYCBCAAIAFBHGo2AgALFgAgAEH81cEANgIEIAAgAUEcajYCAAsWACAAQbjWwQA2AgQgACABQRxqNgIACxkAIAEoAgBB0InCAEESIAEoAgQoAgwRAAALFQEBbyAAEAkhARCtASIAIAEmASAACxUBAW8gABAKIQEQrQEiACABJgEgAAsXAgFvAX8gABAYIQEQrQEiAiABJgEgAguzCAEBfyMAQTBrIgUkACAFIAM2AgQgBSACNgIAIAUgATYCCAJAAkACQAJAAkACQCABIAJPBEAgASADSQ0GIAIgA0sNASACRSABIAJNcg0DIAAgAmosAABBv39KDQMgACACQQFrIgNqLAAAQb9/TARAIAJBAmsiAyACQQNrIAAgA2osAABBv39KGyEDCwNAAkAgASACRwRAIAAgAmosAABBv39MDQEMBQsgASABQeCuwQAQyQIACyACQQFqIgIgAUkNAAsgASECDAILIAUgBUEIaq1CgICAgDCENwMgIAUgBa1CgICAgDCENwMYQfWGwAAgBUEYaiAEENoCAAsgBSAFQQRqrUKAgICAMIQ3AyAgBSAFrUKAgICAMIQ3AxhBl4bAACAFQRhqIAQQ2gIACyAFIAM2AgwgBSACNgIQAkAgAiADSSABIAJJcg0AAkAgASADRg0AIAMEQCAAIANqLAAAQb9/TA0CCyABIAJGDQAgACACaiwAAEG/f0wNAQsgAiADRg0CIAUCfyAAIANqIgEsAAAiAEEATgRAIABB/wFxDAELIAEtAAFBP3EiAyAAQR9xIgJBBnRyIABBX00NABogAS0AAkE/cSADQQZ0ciIDIAJBDHRyIABBcEkNABogAkESdEGAgPAAcSABLQADQT9xIANBBnRycgs2AhQgBSAFQQxqrUKAgICA0AaENwMoIAUgBUEUaq1CgICAgOAGhDcDICAFIAWtQoCAgIAwhDcDGEHezcAAIAVBGGogBBDaAgALIAAgASADIAIgBBCjAwALIANFIAEgA01yDQIgACADaiwAAEG/f0oNAiAAIANBAWsiAmosAABBv39MBEAgA0ECayICIANBA2sgACACaiwAAEG/f0obIQILAkADQAJAIAEgA0cEQCAAIANqLAAAQb9/TA0BDAMLIAEgAUHgrsEAEMkCAAsgA0EBaiIDIAFJDQALIAEhAwsgBSACNgIMIAUgAzYCECABIANJIAIgA0tyDQECQCABIAJGDQAgAgRAIAAgAmosAABBv39MDQMLIAEgA0YNACAAIANqLAAAQb9/TA0CCyACIANGDQAgBQJ/IAAgAmoiASwAACIAQQBOBEAgAEH/AXEMAQsgAS0AAUE/cSIDIABBH3EiAkEGdHIgAEFfTQ0AGiABLQACQT9xIANBBnRyIgMgAkEMdHIgAEFwSQ0AGiACQRJ0QYCA8ABxIAEtAANBP3EgA0EGdHJyCzYCFCAFIAVBDGqtQoCAgIDQBoQ3AyggBSAFQRRqrUKAgICA4AaENwMgIAUgBUEEaq1CgICAgDCENwMYQbDOwAAgBUEYaiAEENoCAAsgBBC5AwALIAAgASACIAMgBBCjAwALIAUgBUEIaq1CgICAgDCENwMgIAUgBUEEaq1CgICAgDCENwMYQbKHwAAgBUEYaiAEENoCAAsUACAAKAIAIAEgACgCBCgCEBEBAAsUACAAKAIAIAEgACgCBCgCDBEBAAsRACAAJQEgASUBIAIlARABGgsTACAAQaTYwAA2AgQgACABNgIACxMAIABB4NjAADYCBCAAIAE2AgALEwAgAEGc2cAANgIEIAAgATYCAAsQACABIAAoAgAgACgCBBBqCxAAIAAoAgQgACgCCCABEFcLEAAgACgCACAAKAIEIAEQVwsTACAAQZz2wAA2AgQgACABNgIACxMAIABBhPLAADYCBCAAIAE2AgALEAAgASAAKAIEIAAoAggQagsTACAAQayAwQA2AgQgACABNgIACxMAIABBzIHBADYCBCAAIAE2AgALEwAgAEEoNgIEIABBgOzBADYCAAsTACAAQfTWwQA2AgQgACABNgIACxMAIABBsNfBADYCBCAAIAE2AgALEwAgAEHs18EANgIEIAAgATYCAAsTACAAQZS5wgA2AgQgACABNgIACxYAQYjdwgAgADYCAEGE3cIAQQE6AAALEQEBfxCtASIBIAAlASYBIAELDwBB8K7BAEErIAAQkwMACxIAQdyHwQBBI0Hwh8EAENoCAAsPAEHlssEAQTMgABDaAgALEABB/rLBAEHzACAAENoCAAsPACAAQYz8wAAgASACEHELDwAgAEGAiMEAIAEgAhBxCw8AIABB7IrBACABIAIQcQsPACAAQciJwQAgASACEHELDwAgAEGwi8EAIAEgAhBxCw8AIABB+KfBACABIAIQcQsPACAAQcyIwgAgASACEHELDwAgAEHgs8IAIAEgAhBxCwwAIAAlASABIAIQBAsMACAAIAEgAiUBEAULbAIBfwFvQcDYwgAtAABBAUcEQBB3C0Gc2MIAKAIABEBBsNrAABDpAgALQZzYwgBBfzYCAEGk2MIAKAIAQYCAEEEAQajYwgAtAAAbEJYDIQBBnNjCAEGc2MIAKAIAQQFqNgIAIAAlASAAEKsCC2wCAX8Bb0HA2MIALQAAQQFHBEAQdwtBnNjCACgCAARAQbDawAAQ6QIAC0Gc2MIAQX82AgBBsNjCACgCAEGAgBBBAEG02MIALQAAGxCW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aiEeA0ACQCASKAIIIgBFBEAgA0EANgJ8IAMgA0HgAGo2AnggA0F/NgKAASADQQI2AsABIANB+ABqIANBgAFqIANBwAFqQQAgA0EAIAMQWCADKAJ4IgAgACgCDEEBajYCDEUNAQwPCyASKAIEIgkgAEEsbGohHwNAIANBADYCfCADIANB4ABqNgJ4AkACQAJAAkACQAJAIAkoAiBBf0cEQCADQYABaiAJKAIkIiAgCSgCKCIhEGQgAygCgAFBAUYEQEECIQUMBgsgA0GAAWogAygChAEiCCADKAKIASIAQc6AwgBBBhA3IAMoAoABRQ0CIAMoArwBIg1BAWshEyADKAK4ASEUIAMoArQBIRUgAygCsAEhESADKAKkASIHQX9HDQEgAygCnAEiASATaiICIBVPDQQgAygCkAEiByANIAcgDUsbIQwgB0EBayEGIAMoApgBIQQgAykDiAEhIgNAAkACQCAiIAIgEWoxAACIQgGDUEUEQCABIBFqIQsgByEFDAELIAEgDWohAQwBCwJAAkADQCAFIgIgDEcEQCACQQFqIQUgAiAUai0AACACIAtqLQAARg0BDAILCyAGIQIDQCACQX9GDQggBiANTw0CIAIgC2ohCiACIBRqIAJBAWshAi0AACAKLQAARg0ACyABIARqIQEMAgsgASAHayACakEBaiEBDAELIAIgDUG0/8EAEMkCAAsgASATaiICIBVJDQALDAQLIANBfzYCgAEMBQsgAygCnAEiASATaiICIBVPDQIgAygCkAEiD0EBayEGIA0gAygCmAEiDGshBCADKQOIASEiA0ACfwJAICIgAiARajEAAIinQQFxRQRAIAEgDWohAQwBCyAHIA8gByAPSxsiBSANIAUgDUsbIQogASARaiELAkADQCAFIgIgCkYEQCAGIQIDQCAHIAJBAWpPDQggAiANTw0DIAIgC2ohCiACIBRqIAJBAWshAi0AACAKLQAARg0ACyABIAxqIQEgBAwECyACQQFqIQUgAiAUai0AACACIAtqLQAARg0ACyABIA9rIAJqQQFqIQEMAQsgAiANQbT/wQAQyQIAC0EACyEHIBUgASATaiICSw0ACwwCCwNAIANBwAFqIANBgAFqEEggAygCwAEiAUEBRg0ACwJAIAFBAWsOAhgCAAsgAygCxAEhAQsCQCABQQZqIgJFDQACQCAA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Zm9yIHNwbGF0IMAAFnNsaWNlIGluZGV4IHN0YXJ0cyBhdCDADSBidXQgZW5kcyBhdCDAABVieXRlIHJhbmdlIHN0YXJ0cyBhdCDADSBidXQgZW5kcyBhdCDAACBpbmRleCBvdXQgb2YgYm91bmRzOiB0aGUgbGVuIGlzIMASIGJ1dCB0aGUgaW5kZXggaXMgwAARc3RhcnQgYnl0ZSBpbmRleCDAJyBpcyBvdXQgb2YgYm91bmRzIGZvciBzdHJpbmcgb2YgbGVuZ3RoIMAAD2VuZCBieXRlIGluZGV4IMAnIGlzIG91dCBvZiBib3VuZHMgZm9yIHN0cmluZyBvZiBsZW5ndGggwAAScmFuZ2Ugc3RhcnQgaW5kZXggwCIgb3V0IG9mIHJhbmdlIGZvciBzbGljZSBvZiBsZW5ndGggwAAQcmFuZ2UgZW5kIGluZGV4IMAiIG91dCBvZiByYW5nZSBmb3Igc2xpY2Ugb2YgbGVuZ3RoIMAALUNvdWxkIG5vdCBjcmVhdGUgbGF5b3V0IGZvciB1OCBhcnJheSBvZiBzaXplIMAAHVNvcnQgcmFuZ2Ugb3JpZ2luIGJ1ZmZlciBoYXMgwBIgdmFsdWVzLCBleHBlY3RlZCDAACdTb3J0IHJhbmdlIGJhc2UvY291bnQgbGVuZ3RoIG1pc21hdGNoOiDABCAhPSDAAB9JbmNvbXBsZXRlIFNQWiBzdHJlYW06IHN0YWdlID0gwA4sIHNoX2RlZ3JlZSA9IMAAGkludmFsaWQgdjQgdG9jQnl0ZU9mZnNldDogwAMgPCDAAB5Tb3J0IGNlbnRlciBidWZmZXIgdG9vIHNtYWxsOiDAAyA8IMAAIFNvcnQgb3JkZXJpbmcgYnVmZmVyIHRvbyBzbWFsbDogwAMgPCDAACNGYWlsZWQgdG8gcGFyc2UvZGVjb2RlIGJsb2NrIGJvZHk6IMAALVNwZWNpZmllZCB3aW5kb3dfc2l6ZSBpcyB0b28gYmlnOyBSZXF1ZXN0ZWQ6IMAHLCBNYXg6IMAAL0RvIG5vdCBzdXBwb3J0IG9mZnNldHMgYmlnZ2VyIHRoYW4gMTw8MzI7IGdvdDogwAAeU291cmNlIG5lZWRzIHRvIGhhdmUgYXQgbGVhc3QgwA0gYnl0ZXMsIGdvdDogwAAnRXJyb3Igd2hpbGUgcmVhZGluZyB0aGUgYmxvY2sgY29udGVudDogwAAQYXNzZXJ0aW9uIGBsZWZ0IMAXIHJpZ2h0YCBmYWlsZWQKICBsZWZ0OiDACQogcmlnaHQ6IMAAEGFzc2VydGlvbiBgbGVmdCDAECByaWdodGAgZmFpbGVkOiDACQogIGxlZnQ6IMAJCiByaWdodDogwAAYVW5zdXBwb3J0ZWQgUExZIGZvcm1hdDogwAASQ2FudCBoYXZlIHdlaWdodDogwBsgYmlnZ2VyIHRoYW4gbWF4X251bV9iaXRzOiDAACFVbnN1cHBvcnRlZCBTUFogZnJhY3Rpb25hbCBiaXRzOiDAACZMZWZ0b3ZlciBtdXN0IGJlIHBvd2VyIG9mIHR3byBidXQgaXM6IMAAJUludmFsaWQgbnVtYmVyIG9mIGZfcmVzdCBwcm9wZXJ0aWVzOiDAAEtpbnRlcm5hbCBlcnJvcjogZW50ZXJlZCB1bnJlYWNoYWJsZSBjb2RlOiBJbGxlZ2FsIGxpdGVyYWwgbGVuZ3RoIGNvZGUgd2FzOiDAAElpbnRlcm5hbCBlcnJvcjogZW50ZXJlZCB1bnJlYWNoYWJsZSBjb2RlOiBJbGxlZ2FsIG1hdGNoIGxlbmd0aCBjb2RlIHdhczogwAAvQmxvY2tzaXplIHdhcyBiaWdnZXIgdGhhbiB0aGUgYWJzb2x1dGUgbWF4aW11bSDADiAoMTI4a2IpLiBJczogwAAnRXJyb3Igd2hpbGUgcmVhZGluZyB3aW5kb3cgZGVzY3JpcHRvcjogwAAmRXJyb3Igd2hpbGUgcmVhZGluZyBmcmFtZSBkZXNjcmlwdG9yOiDAACJTZXF1ZW5jZSB3YW50cyB0byBjb3B5IHVwIHRvIGJ5dGUgwBsuIEJ5dGVzIGluIGxpdGVyYWxzYnVmZmVyOiDAADtEZWNvZGVyIGVuY291bnRlcmVkIGVycm9yIHdoaWxlIGRyYWluaW5nIHRoZSBkZWNvZGVidWZmZXI6IMAACG9mZnNldDogwBUgYmlnZ2VyIHRoYW4gYnVmZmVyOiDAAB5GYWlsZWQgdG8gcGFyc2UgYmxvY2sgaGVhZGVyOiDAACJFcnJvciB3aGlsZSByZWFkaW5nIG1hZ2ljIG51bWJlcjogwAAgVW5zdXBwb3J0ZWQgbGVnYWN5IFNQWiB2ZXJzaW9uOiDAABlVbnN1cHBvcnRlZCBQTFkgdmVyc2lvbjogwAAaVW5zdXBwb3J0ZWQgTkdTUCB2ZXJzaW9uOiDAABlCaXRzdHJlYW0gd2FzIHJlYWQgdGlsbDogwBQsIHNob3VsZCBoYXZlIGJlZW46IMAAIERpZCBub3QgZGVjb2RlIGVub3VnaCBsaXRlcmFsczogwBQsIFNob3VsZCBoYXZlIGJlZW46IMAAGldyb25nIG51bWJlciBvZiBsaXRlcmFsczogwBQsIFNob3VsZCBoYXZlIGJlZW46IMAAIm1heF9iaXRzIGRlcml2ZWQgZnJvbSB3ZWlnaHRzIGlzOiDAFyBzaG91bGQgYmUgbG93ZXIgdGhhbjogwAAtd2luZG93X3NpemUgYmlnZ2VyIHRoYW4gYWxsb3dlZCBtYXhpbXVtLiBJczogwBgsIFNob3VsZCBiZSBsb3dlciB0aGFuOiDAAC53aW5kb3dfc2l6ZSBzbWFsbGVyIHRoYW4gYWxsb3dlZCBtaW5pbXVtLiBJczogwBosIFNob3VsZCBiZSBncmVhdGVyIHRoYW46IMAAGUZhaWxlZCB0byByZWFkIGNoZWNrc3VtOiDAACp2NCBwb2ludCBjb3VudCBleGNlZWRzIHN1cHBvcnRlZCBtYXhpbXVtOiDAACJ0cmFpbGluZyBieXRlcyBpbiB2NCBaU1REIHN0cmVhbTogwAAuRGVjb2RlciBlbmNvdW50ZXJlZCBlcnJvciB3aGlsZSBpbml0aWFsaXppbmc6IMAACVNlcV9zdW06IMAxIGlzIGRpZmZlcmVudCBmcm9tIHRoZSBkaWZmZXJlbmNlIGluIGJ1ZmZlcnNpemU6IMAAIkVycm9yIGdldHRpbmcgYmxvY2sgY29udGVudCBzaXplOiDAAChFcnJvciB3aGlsZSByZWFkaW5nIGZyYW1lIGNvbnRlbnQgc2l6ZTogwAATRm91bmQgRlNFIGFjY19sb2c6IMArIGJpZ2dlciB0aGFuIGFsbG93ZWQgbWF4aW11bSBpbiB0aGlzIGNhc2U6IMAAH1Vuc3VwcG9ydGVkIFBMWSBwcm9wZXJ0eSB0eXBlOiDAABpFcnJvciBnZXR0aW5nIGJsb2NrIHR5cGU6IMAAE0ludmFsaWQgZmlsZSB0eXBlOiDAABdJbnZhbGlkIHByb3BlcnR5IGxpbmU6IMAAHVVuc3VwcG9ydGVkIFBMWSBoZWFkZXIgbGluZTogwAANcmFua19pZHhbMF06IMAMIHNob3VsZCBiZTogwAA2Tm90IGVub3VnaCBieXRlcyBpbiBzdHJlYW0gdG8gZGVjb21wcmVzcyB3ZWlnaHRzLiBJczogwA0sIFNob3VsZCBiZTogwAA3ZnJhbWVfY29udGVudF9zaXplIGRvZXMgbm90IGhhdmUgdGhlIHJpZ2h0IGxlbmd0aC4gSXM6IMANLCBTaG91bGQgYmU6IMAAIU5vdCBlbm91Z2ggYnl0ZXMgaW4gZGljdF9pZC4gSXM6IMANLCBTaG91bGQgYmU6IMAAI0Vycm9yIHdoaWxlIHJlYWRpbmcgZGljdGlvbmFyeSBpZDogwAAXdjQgWlNURCB3aW5kb3cgZmFpbGVkOiDAABV2NCBaU1REIGluaXQgZmFpbGVkOiDAABt2NCBaU1REIGRlY29tcHJlc3MgZmFpbGVkOiDAABd2NCBaU1REIGhlYWRlciBmYWlsZWQ6IMAAFkRlY29tcHJlc3Npb24gZmFpbGVkOiDAADxOb3QgZW5vdWdoIGJ5dGUgdG8gcGFyc2UgdGhlIGxpdGVyYWxzIHNlY3Rpb24gaGVhZGVyLiBIYXZlOiDACCwgTmVlZDogwAAeRXJyb3Igd2hpbGUgcmVhZGluZyBieXRlcyBmb3IgwAI6IMAADVRoZSBjb3VudGVyICjAHSkgZXhjZWVkZWQgdGhlIGV4cGVjdGVkIHN1bTogwCouIFRoaXMgbWVhbnMgYW4gZXJyb3Igb3IgY29ycnVwdGVkIGRhdGEgCiDAAAtDYW4ndCByZWFkIMARIGJpdHMsIG9ubHkgaGF2ZSDACiBiaXRzIGxlZnQAPE1hbGZvcm1lZCBzZWN0aW9uIGhlYWRlci4gU2F5cyBsaXRlcmFscyB3b3VsZCBiZSB0aGlzIGxvbmc6IMAUIGJ1dCB0aGVyZSBhcmUgb25seSDACyBieXRlcyBsZWZ0ADJDYW50IHNlcnZlIHRoaXMgcmVxdWVzdC4gVGhlIHJlYWRlciBpcyBsaW1pdGVkIHRvIMARIGJpdHMsIHJlcXVlc3RlZCDABSBiaXRzAGdhdXNzaWFuLXNwbGF0LWxpYi9zcmMvc3B6LnJzAGdhdXNzaWFuLXNwbGF0LWxpYi9zcmMvcGx5LnJzAC9ydXN0L2RlcHMvcnVzdGMtZGVtYW5nbGUtMC4xLjI3L3NyYy9sZWdhY3kucnMAL3J1c3RjLzg4ZDllMTJhZTE3OGZhYjBmYjVjYzA1MGE5NGRhODU2ODVkNDQ5ZWEvbGlicmFyeS9jb3JlL3NyYy9zbGljZS9pbmRleC5ycwAvcnVzdC9kZXBzL2hhc2hicm93bi0wLjE3LjEvc3JjL3Jhdy5ycwBnYXVzc2lhbi1zcGxhdC1ycy9zcmMvc29ydC5ycwAvcnVzdGMvODhkOWUxMmFlMTc4ZmFiMGZiNWNjMDUwYTk0ZGE4NTY4NWQ0NDllYS9saWJyYXJ5L2FsbG9jL3NyYy9mbXQucnMAL3RtcC9nc2wtY2FyZ28vcmVnaXN0cnkvc3JjL2luZGV4LmNyYXRlcy5pby0xOTQ5Y2Y4YzZiNWI1NTdmL2FueWhvdy0xLjAuOTgvc3JjL2ZtdC5ycwBnYXVzc2lhbi1zcGxhdC1ycy9zcmMvZXh0X3NwbGF0cy5ycwAvcnVzdGMvODhkOWUxMmFlMTc4ZmFiMGZiNWNjMDUwYTk0ZGE4NTY4NWQ0NDllYS9saWJyYXJ5L3N0ZC9zcmMvc3lzL3N5bmMvbXV0ZXgvbm9fdGhyZWFkcy5ycwAvcnVzdGMvODhkOWUxMmFlMTc4ZmFiMGZiNWNjMDUwYTk0ZGE4NTY4NWQ0NDllYS9saWJyYXJ5L3N0ZC9zcmMvc3lzL3RocmVhZF9sb2NhbC9ub190aHJlYWRzLnJzAC9ydXN0Yy84OGQ5ZTEyYWUxNzhmYWIwZmI1Y2MwNTBhOTRkYTg1Njg1ZDQ0OWVhL2xpYnJhcnkvc3RkL3NyYy9zeXMvc3luYy9yd2xvY2svbm9fdGhyZWFkcy5ycwAvcnVzdGMvODhkOWUxMmFlMTc4ZmFiMGZiNWNjMDUwYTk0ZGE4NTY4NWQ0NDllYS9saWJyYXJ5L3N0ZC9zcmMvc3lzL3N5bmMvb25jZS9ub190aHJlYWRzLnJzAC9ydXN0Yy84OGQ5ZTEyYWUxNzhmYWIwZmI1Y2MwNTBhOTRkYTg1Njg1ZDQ0OWVhL2xpYnJhcnkvYWxsb2Mvc3JjL3N0ci5ycwAvdG1wL2dzbC1jYXJnby9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2YvYW55aG93LTEuMC45OC9zcmMvZXJyb3IucnMAL3RtcC9nc2wtY2FyZ28vcmVnaXN0cnkvc3JjL2luZGV4LmNyYXRlcy5pby0xOTQ5Y2Y4YzZiNWI1NTdmL3J1enN0ZC0wLjcuMy9zcmMvZGVjb2RpbmcvcmluZ2J1ZmZlci5ycwAvdG1wL2dzbC1jYXJnby9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2YvcnV6c3RkLTAuNy4zL3NyYy9kZWNvZGluZy9kZWNvZGVidWZmZXIucnMAL3RtcC9nc2wtY2FyZ28vcmVnaXN0cnkvc3JjL2luZGV4LmNyYXRlcy5pby0xOTQ5Y2Y4YzZiNWI1NTdmL21pbml6X294aWRlLTAuOC45L3NyYy9pbmZsYXRlL291dHB1dF9idWZmZXIucnMAL3RtcC9nc2wtY2FyZ28vcmVnaXN0cnkvc3JjL2luZGV4LmNyYXRlcy5pby0xOTQ5Y2Y4YzZiNWI1NTdmL3J1enN0ZC0wLjcuMy9zcmMvZGVjb2RpbmcvbGl0ZXJhbHNfc2VjdGlvbl9kZWNvZGVyLnJzAC90bXAvZ3NsLWNhcmdvL3JlZ2lzdHJ5L3NyYy9pbmRleC5jcmF0ZXMuaW8tMTk0OWNmOGM2YjViNTU3Zi9ydXpzdGQtMC43LjMvc3JjL2RlY29kaW5nL3NlcXVlbmNlX3NlY3Rpb25fZGVjb2Rlci5ycwAvdG1wL2dzbC1jYXJnby9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2YvcnV6c3RkLTAuNy4zL3NyYy9kZWNvZGluZy9ibG9ja19kZWNvZGVyLnJzAC90bXAvZ3NsLWNhcmdvL3JlZ2lzdHJ5L3NyYy9pbmRleC5jcmF0ZXMuaW8tMTk0OWNmOGM2YjViNTU3Zi9ydXpzdGQtMC43LjMvc3JjL2ZzZS9mc2VfZGVjb2Rlci5ycwAvdG1wL2dzbC1jYXJnby9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2YvcnV6c3RkLTAuNy4zL3NyYy9odWZmMC9odWZmMF9kZWNvZGVyLnJzAGdhdXNzaWFuLXNwbGF0LWxpYi9zcmMvZGVjb2Rlci5ycwAvdG1wL2dzbC1jYXJnby9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2YvcnV6c3RkLTAuNy4zL3NyYy9kZWNvZGluZy9iaXRfcmVhZGVyLnJzAC9ydXN0Yy84OGQ5ZTEyYWUxNzhmYWIwZmI1Y2MwNTBhOTRkYTg1Njg1ZDQ0OWVhL2xpYnJhcnkvc3RkL3NyYy9pby9zdGRpby5ycwAvcnVzdGMvODhkOWUxMmFlMTc4ZmFiMGZiNWNjMDUwYTk0ZGE4NTY4NWQ0NDllYS9saWJyYXJ5L2NvcmUvc3JjL3N0ci9wYXR0ZXJuLnJzAC90bXAvZ3NsLWNhcmdvL3JlZ2lzdHJ5L3NyYy9pbmRleC5jcmF0ZXMuaW8tMTk0OWNmOGM2YjViNTU3Zi9ydXpzdGQtMC43LjMvc3JjL2RlY29kaW5nL3NlcXVlbmNlX2V4ZWN1dGlvbi5ycwAvcnVzdGMvODhkOWUxMmFlMTc4ZmFiMGZiNWNjMDUwYTk0ZGE4NTY4NWQ0NDllYS9saWJyYXJ5L2NvcmUvc3JjL29wcy9mdW5jdGlvbi5ycwAvdG1wL2dzbC1jYXJnby9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2YvcnV6c3RkLTAuNy4zL3NyYy9ibG9ja3MvbGl0ZXJhbHNfc2VjdGlvbi5ycwAvcnVzdGMvODhkOWUxMmFlMTc4ZmFiMGZiNWNjMDUwYTk0ZGE4NTY4NWQ0NDllYS9saWJyYXJ5L3N0ZC9zcmMvdGhyZWFkL2xvY2FsLnJzAC9ydXN0Yy84OGQ5ZTEyYWUxNzhmYWIwZmI1Y2MwNTBhOTRkYTg1Njg1ZDQ0OWVhL2xpYnJhcnkvc3RkL3NyYy9zeW5jL2xhenlfbG9jay5ycwAvcnVzdGMvODhkOWUxMmFlMTc4ZmFiMGZiNWNjMDUwYTk0ZGE4NTY4NWQ0NDllYS9saWJyYXJ5L3N0ZC9zcmMvc3luYy9yZWVudHJhbnRfbG9jay5ycwAvcnVzdGMvODhkOWUxMmFlMTc4ZmFiMGZiNWNjMDUwYTk0ZGE4NTY4NWQ0NDllYS9saWJyYXJ5L2FsbG9jL3NyYy9zdHJpbmcucnMAL3J1c3RjLzg4ZDllMTJhZTE3OGZhYjBmYjVjYzA1MGE5NGRhODU2ODVkNDQ5ZWEvbGlicmFyeS9zdGQvc3JjL3Bhbmlja2luZy5ycwAvcnVzdGMvODhkOWUxMmFlMTc4ZmFiMGZiNWNjMDUwYTk0ZGE4NTY4NWQ0NDllYS9saWJyYXJ5L2NvcmUvc3JjL2lvL2JvcnJvd2VkX2J1Zi5ycwAvdG1wL2dzbC1jYXJnby9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2Yvd2FzbS1iaW5kZ2VuLTAuMi4xMTcvc3JjL2V4dGVybnJlZi5ycwAvcnVzdGMvODhkOWUxMmFlMTc4ZmFiMGZiNWNjMDUwYTk0ZGE4NTY4NWQ0NDllYS9saWJyYXJ5L2FsbG9jL3NyYy9jb2xsZWN0aW9ucy9idHJlZS9uYXZpZ2F0ZS5ycwAvdG1wL2dzbC1jYXJnby9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2YvcnV6c3RkLTAuNy4zL3NyYy9kZWNvZGluZy9iaXRfcmVhZGVyX3JldmVyc2UucnMAL3RtcC9nc2wtY2FyZ28vcmVnaXN0cnkvc3JjL2luZGV4LmNyYXRlcy5pby0xOTQ5Y2Y4YzZiNWI1NTdmL21pbml6X294aWRlLTAuOC45L3NyYy9pbmZsYXRlL2NvcmUucnMAZ2F1c3NpYW4tc3BsYXQtbGliL3NyYy9zcGxhdF9lbmNvZGUucnMAL3J1c3RjLzg4ZDllMTJhZTE3OGZhYjBmYjVjYzA1MGE5NGRhODU2ODVkNDQ5ZWEvbGlicmFyeS9zdGQvc3JjL3N5bmMvb25jZS5ycwAvcnVzdGMvODhkOWUxMmFlMTc4ZmFiMGZiNWNjMDUwYTk0ZGE4NTY4NWQ0NDllYS9saWJyYXJ5L3N0ZC9zcmMvYmFja3RyYWNlLnJzAC9ydXN0Yy84OGQ5ZTEyYWUxNzhmYWIwZmI1Y2MwNTBhOTRkYTg1Njg1ZDQ0OWVhL2xpYnJhcnkvY29yZS9zcmMvZm10L21vZC5ycwAvcnVzdGMvODhkOWUxMmFlMTc4ZmFiMGZiNWNjMDUwYTk0ZGE4NTY4NWQ0NDllYS9saWJyYXJ5L2NvcmUvc3JjL2JzdHIvbW9kLnJzAC9ydXN0Yy84OGQ5ZTEyYWUxNzhmYWIwZmI1Y2MwNTBhOTRkYTg1Njg1ZDQ0OWVhL2xpYnJhcnkvY29yZS9zcmMvc3RyL21vZC5ycwAvcnVzdGMvODhkOWUxMmFlMTc4ZmFiMGZiNWNjMDUwYTk0ZGE4NTY4NWQ0NDllYS9saWJyYXJ5L3N0ZC9zcmMvaW8vbW9kLnJzAC9ydXN0Yy84OGQ5ZTEyYWUxNzhmYWIwZmI1Y2MwNTBhOTRkYTg1Njg1ZDQ0OWVhL2xpYnJhcnkvc3RkL3NyYy8uLi8uLi9iYWNrdHJhY2Uvc3JjL3N5bWJvbGl6ZS9tb2QucnMAL3J1c3RjLzg4ZDllMTJhZTE3OGZhYjBmYjVjYzA1MGE5NGRhODU2ODVkNDQ5ZWEvbGlicmFyeS9hbGxvYy9zcmMvcmF3X3ZlYy9tb2QucnMAL3J1c3RjLzg4ZDllMTJhZTE3OGZhYjBmYjVjYzA1MGE5NGRhODU2ODVkNDQ5ZWEvbGlicmFyeS9zdGQvc3JjL3RocmVhZC9pZC5ycwAvcnVzdC9kZXBzL2RsbWFsbG9jLTAuMi4xMy9zcmMvZGxtYWxsb2MucnMAZ2F1c3NpYW4tc3BsYXQtcnMvc3JjL2xpYi5ycwAvcnVzdC9kZXBzL3J1c3RjLWRlbWFuZ2xlLTAuMS4yNy9zcmMvbGliLnJzAC90bXAvZ3NsLWNhcmdvL3JlZ2lzdHJ5L3NyYy9pbmRleC5jcmF0ZXMuaW8tMTk0OWNmOGM2YjViNTU3Zi9jb25zb2xlX2Vycm9yX3BhbmljX2hvb2stMC4xLjcvc3JjL2xpYi5ycwAvdG1wL2dzbC1jYXJnby9yZWdpc3RyeS9zcmMvaW5kZXguY3JhdGVzLmlvLTE5NDljZjhjNmI1YjU1N2YvanMtc3lzLTAuMy45NC9zcmMvbGliLnJzAC9ydXN0Yy84OGQ5ZTEyYWUxNzhmYWIwZmI1Y2MwNTBhOTRkYTg1Njg1ZDQ0OWVhL2xpYnJhcnkvY29yZS9zcmMvdW5pY29kZS91bmljb2RlX2RhdGEucnMAL3J1c3QvZGVwcy9ydXN0Yy1kZW1hbmdsZS0wLjEuMjcvc3JjL3YwLnJzAA92NCBwb2ludCBjb3VudCDAFCBpcyBpbXBsYXVzaWJsZSBmb3IgwAwgaW5wdXQgYnl0ZXMAIEludmFsaWQgZnJhbWVfY29udGVudF9zaXplLiBJczogwCMsIFNob3VsZCBiZSBvbmUgb2YgMSwgMiwgNCwgOCBieXRlcwAac291cmNlIG11c3QgaGF2ZSBhdCBsZWFzdCDAHCBieXRlcyB0byBwYXJzZSBoZWFkZXI7IGdvdCDABiBieXRlcwAoTmVlZCA2IGJ5dGVzIHRvIGRlY29kZSBqdW1wIGhlYWRlciwgZ290IMAGIGJ5dGVzAC5Ta2lwcGFibGVGcmFtZSBlbmNvdW50ZXJlZCB3aXRoIE1hZ2ljTnVtYmVyIDB4wAwgYW5kIGxlbmd0aCDABiBieXRlcwAOTmVlZCBhdCBsZWFzdCDAISBieXRlcyB0byBkZWNvZGUgbGl0ZXJhbHMuIEhhdmU6IMAGIGJ5dGVzABp2NCBaU1REIHdpbmRvdyB0b28gbGFyZ2U6IMAGIGJ5dGVzAEZQYWRkaW5nIGF0IHRoZSBlbmQgb2YgdGhlIHNlcXVlbmNlX3NlY3Rpb24gd2FzIG1vcmUgdGhhbiBhIGJ5dGUgbG9uZzogwCkgYml0cy4gUHJvYmFibHkgY2F1c2VkIGJ5IGRhdGEgY29ycnVwdGlvbgAcSGVhZGVyIHNheXMgdGhlcmUgc2hvdWxkIGJlIMAqIGJ5dGVzIGZvciB0aGUgd2VpZ2h0cyBidXQgdGhlcmUgYXJlIG9ubHkgwBQgYnl0ZXMgaW4gdGhlIHN0cmVhbQAeSW52YWxpZCBCbG9ja3R5cGUgbnVtYmVyLiBJczogwDMgU2hvdWxkIGJlIG9uZSBvZjogMCwgMSwgMiwgMyAoMyBpcyByZXNlcnZlZCB0aG91Z2gABU5lZWQgwCogYnl0ZXMgZnJvbSB0aGUgZGljdGlvbmFyeSBidXQgaXQgaXMgb25seSDACyBieXRlcyBsb25nADlpbnRlcm5hbCBlcnJvcjogZW50ZXJlZCB1bnJlYWNoYWJsZSBjb2RlOiBzdHI6OmZyb21fdXRmOCjABCkgPSDAIiB3YXMgZXhwZWN0ZWQgdG8gaGF2ZSAxIGNoYXIsIGJ1dCDAESBjaGFycyB3ZXJlIGZvdW5kACNNb3JlIHRoYW4gMjU1IHdlaWdodHMgZGVjb2RlZCAoZ290IMAnIHdlaWdodHMpLiBTdHJlYW0gaXMgcHJvYmFibHkgY29ycnVwdGVkADFUaGVyZSBhcmUgdG9vIG1hbnkgc3ltYm9scyBpbiB0aGlzIGRpc3RyaWJ1dGlvbjogwAouIE1heDogMjU2ACFJbGxlZ2FsIGxpdGVyYWxzc2VjdGlvbnR5cGUuIElzOiDAGCwgbXVzdCBiZSBpbjogMCwgMSwgMiwgMwAlSW52YWxpZCBGcmFtZV9Db250ZW50X1NpemVfRmxhZzsgSXM6IMAeLCBTaG91bGQgYmUgb25lIG9mOiAwLCAxLCAyLCAzABFzdGFydCBieXRlIGluZGV4IMAmIGlzIG5vdCBhIGNoYXIgYm91bmRhcnk7IGl0IGlzIGluc2lkZSDACCAoYnl0ZXMgwAsgb2Ygc3RyaW5nKQAPZW5kIGJ5dGUgaW5kZXggwCYgaXMgbm90IGEgY2hhciBib3VuZGFyeTsgaXQgaXMgaW5zaWRlIMAIIChieXRlcyDACyBvZiBzdHJpbmcpAA5TUFogU0ggZGVncmVlIMA2IGlzIG5vdCBzdXBwb3J0ZWQgYnkgR2F1c3NpYW4gU3BsYXQgTGl0ZSAoaGFuZGxlcyAwLTMpACdGcmFtZSBoZWFkZXIgc3BlY2lmaWVkIGRpY3Rpb25hcnkgaWQgMHjANyB0aGF0IHdhc250IHByb3ZpZGVkIGJ5IGFkZF9kaWN0KCkgb3IgcmVzZXRfd2l0aF9kaWN0KCkACEpzVmFsdWUowAEpABJTSCBlbGVtZW50IGNvdW50ICjAGykgbXVzdCBtYXRjaCB2ZXJ0ZXggY291bnQgKMABKQAbRlNFIHRhYmxlIHVzZWQgbW9yZSBieXRlczogwEUgdGhhbiB3ZXJlIG1lYW50IHRvIGJlIHVzZWQgZm9yIHRoZSB3aG9sZSBzdHJlYW0gb2YgaHVmZm1hbiB3ZWlnaHRzICjAASkAJmNvcHlfZnJvbV9zbGljZTogc291cmNlIHNsaWNlIGxlbmd0aCAowCspIGRvZXMgbm90IG1hdGNoIGRlc3RpbmF0aW9uIHNsaWNlIGxlbmd0aCAowAEpAMALIChvcyBlcnJvciDAASkAASLAASIAQnVnIGluIHRoaXMgbGlicmFyeb8WEABnAAAAhgEAABYAAAC/FhAAZwAAAJsBAAAJAAAAYXNzZXJ0aW9uIGZhaWxlZDogYnl0ZXNfdXNl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EBAAHQAAAP0AAAAoAAAA5RAQAB0AAAD4AAAAKAAAAOUQEAAdAAAA9wAAACoAAADlEBAAHQAAAPYAAAAsAAAA5RAQAB0AAAD1AAAAKAAAAOUQEAAdAAAA9AAAADAAAADlEBAAHQAAAPMAAAAuAAAA5RAQAB0AAADOAAAAIgAAAOUQEAAdAAAA3gAAACYAAADlEBAAHQAAAOQAAAAmAAAA5RAQAB0AAADqAAAAJgAAAOUQEAAdAAAA2AAAACMAAADlEBAAHQAAANMAAAAkAAAA5RAQAB0AAADQAAAAIgAAAOUQEAAdAAAAywAAACUAAADlEBAAHQAAALkAAAANAAAA5RAQAB0AAAB9AAAAHQAAAOUQEAAdAAAApwAAACoAAADlEBAAHQAAAKYAAAAsAAAA5RAQAB0AAAClAAAAKAAAAOUQEAAdAAAApAAAADAAAADlEBAAHQAAAKMAAAAuAAAA5RAQAB0AAACNAAAAIgAAAOUQEAAdAAAAkgAAACIAAADlEBAAHQAAAIsAAAAlAAAA5RAQAB0AAAB5AAAADQAAAOUQEAAdAAAAJQEAAB0AAADlEBAAHQAAAEMBAAAyAAAA5RAQAB0AAABCAQAANAAAAOUQEAAdAAAAQQEAADAAAADlEBAAHQAAAEABAAA4AAAA5RAQAB0AAAA/AQAANgAAAOUQEAAdAAAAVQEAAC8AAADlEBAAHQAAAFABAAAvAAAA5RAQAB0AAABOAQAAKwAAAOUQEAAdAAAAYgEAAC8AAADlEBAAHQAAABUBAAANAAAAxxAQAB0AAAAdAQAADQAAAMcQEAAdAAAAMAEAACkAAADHEBAAHQAAADEBAAApAAAAxxAQAB0AAAAyAQAAKQAAAMcQEAAdAAAAMgEAAE8AAADHEBAAHQAAADEBAABPAAAAxxAQAB0AAAAwAQAATwAAAMcQEAAdAAAAOAEAACkAAADHEBAAHQAAADoBAAApAAAAxxAQAB0AAAA8AQAAKQAAAMcQEAAdAAAAPQEAADkAAADHEBAAHQAAADsBAAA5AAAAxxAQAB0AAAA5AQAAOQAAAMcQEAAdAAAAWAEAADYAAADHEBAAHQAAAFgBAAAlAAAAxxAQAB0AAAB0AQAAOwAAAMcQEAAdAAAAdAEAACUAAADHEBAAHQAAAHYBAAApAAAAxxAQAB0AAAB1AQAAJQAAAMcQEAAd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AAAABAAAACQBAAAlAQAAJgEAQdCLwQALihoBAAAACgEAAGEgRGlzcGxheSBpbXBsZW1lbnRhdGlvbiByZXR1cm5lZCBhbiBlcnJvciB1bmV4cGVjdGVkbHkAMBsQAEsAAAB/CwAADgAAAAACBgQHAQEBFAEAASYCMgIDATcIGwQGCwABPAJlDjsCMQIPARwCAQELBSIF7QEIAgICFgEHAQEDBAIJAgICBAgBBAIBBQIZAgMBBgQCAhYBBwECAQIBAgIBAQUEAgIDAwEHBAEBBxEKAwEJAQMBFgEHAQIBBQIKAQMBAwIBDwQCDAcHAQMBCAICAhYBBwECAQUCCQICAgMHAwQCAQUCEgoCAQYDAwEEAwIBAQECAwIDAwMMBAUDAwEEAgEGAQ4VBQ0BAwEXARACCQEDAQQHAgEDAQICBAIKBxYBAwEXAQoBBQIJAQMBBAcCBQMBBAIKAQMMDQEDATMBAwEGBBACGgEDARIDGAEJAQECBwMBBAYBAQEIBgoCAww6BB0lAgEBAQUBGAEBARcCBQEBAQcBCgIEIEgBJAQnASQBDwENJcYBAQUBAgABBAIHAQEBBAIpAQQCIQEEAgcBAQEEAg8BOQEEAkMCIAMaBlYCBgIAA1kHFgkYCRQMDQEDAQIMXgIKBgoGGgZZBysFRgofAQwEDAQBAyoCBQssBBoGCwM+AkEBHQILBgoGDgIuAgwUTQGmCDwDDwM+BSsCCwgrBQACBgImAgYCCAEBAQEBAQEfAjUBDwEOAgYBEwIDAQkBZQEMAhsBDQMiDiEPjAQAFgsVAAIABS0BAQUBAjgHAg4YCQcBBwEHAQcBBwEHAQcBBwF+IhoBWQzWGlABVgJnBSsBXgFWCTABAAM3CQAUuAjdFDwDCgY4CEYIDAZ0Cx4DTgELBCEBNwkOAgoCZxgcCgYCBgIGCQcBBwE8BH4CCgYADBcEMQQAAmomBwwFBRoBBQEBAQIBAgEAICoGMwETAQQEBQGHAgEBvgMGAgYCBgIDAwcBBwoFAgwBGgETAQIBDwIOInsFAwQtA1gBDQMBLy6CHQMxDxwEJAkeBSsFHgElBA4qngIKBiQEJAQoCDQLDAEPAQcBAgELAQ8BBwECAzQMAAkWCggYBgEqAQlFBgIBASwBAgMBAhcBSAgJMBMBAgUhAxsFGyY4BBQCMgECBQgBAwEdAgMECgcJB0Ag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AAAoAQAAKQEAACoBAABlbnRpdHkgbm90IGZvdW5kcGVybWlzc2lvbiBkZW5pZWRjb25uZWN0aW9uIHJlZnVzZWRjb25uZWN0aW9uIHJlc2V0aG9zdCB1bnJlYWNoYWJsZW5ldHdvcmsgdW5yZWFjaGFibGVjb25uZWN0aW9uIGFib3J0ZWRub3QgY29ubmVjdGVkYWRkcmVzcyBpbiB1c2VhZGRyZXNzIG5vdCBhdmFpbGFibGVuZXR3b3JrIGRvd25icm9rZW4gcGlwZWVudGl0eSBhbHJlYWR5IGV4aXN0c29wZXJhdGlvbiB3b3VsZCBibG9ja25vdCBhIGRpcmVjdG9yeWlzIGEgZGlyZWN0b3J5ZGlyZWN0b3J5IG5vdCBlbXB0eXJlYWQtb25seSBmaWxlc3lzdGVtIG9yIHN0b3JhZ2UgbWVkaXVtZmlsZXN5c3RlbSBsb29wIG9yIGluZGlyZWN0aW9uIGxpbWl0IChlLmcuIHN5bWxpbmsgbG9vcClzdGFsZSBuZXR3b3JrIGZpbGUgaGFuZGxlaW52YWxpZCBpbnB1dCBwYXJhbWV0ZXJpbnZhbGlkIGRhdGF0aW1lZCBvdXR3cml0ZSB6ZXJvbm8gc3RvcmFnZSBzcGFjZXNlZWsgb24gdW5zZWVrYWJsZSBmaWxlcXVvdGEgZXhjZWVkZWRmaWxlIHRvbyBsYXJnZXJlc291cmNlIGJ1c3lleGVjdXRhYmxlIGZpbGUgYnVzeWRlYWRsb2NrY3Jvc3MtZGV2aWNlIGxpbmsgb3IgcmVuYW1ldG9vIG1hbnkgbGlua3NpbnZhbGlkIGZpbGVuYW1lYXJndW1lbnQgbGlzdCB0b28gbG9uZ29wZXJhdGlvbiBpbnRlcnJ1cHRlZHVuc3VwcG9ydGVkdW5leHBlY3RlZCBlbmQgb2YgZmlsZW91dCBvZiBtZW1vcnlpbiBwcm9ncmVzc3RvbyBtYW55IG9wZW4gZmlsZXNvdGhlciBlcnJvcnVuY2F0ZWdvcml6ZWQgZXJyb3LAGBAATwAAAIEGAAAVAAAAwBgQAE8AAACvBgAAFQAAAMAYEABPAAAAsAYAABUAAADAGBAATwAAAHYFAAAoAAAAwBgQAE8AAAB2BQAAEgAAAAofEABLAAAA5QEAABQAAABjYWxsZWQgYE9wdGlvbjo6dW53cmFwKClgIG9uIGEgYE5vbmVgIHZhbHVlPT0wMDAxMDIwMzA0MDUwNjA3MDgwOTEwMTExMjEzMTQxNTE2MTcxODE5MjAyMTIyMjMyNDI1MjYyNzI4MjkzMDMxMzIzMzM0MzUzNjM3MzgzOTQwNDE0MjQzNDQ0NTQ2NDc0ODQ5NTA1MTUyNTM1NDU1NTY1NzU4NTk2MDYxNjI2MzY0NjU2NjY3Njg2OTcwNzE3MjczNzQ3NTc2Nzc3ODc5ODA4MTgyODM4NDg1ODY4Nzg4ODk5MDkxOTI5Mzk0OTU5Njk3OTg5OQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAEGnssEACzMCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDAwMDAwMDAwMDAwMDAwMDBAQEBAQAQeWywQALkxJhdHRlbXB0IHRvIGRpdmlkZSBieSB6ZXJvYXR0ZW1wdCB0byBjYWxjdWxhdGUgdGhlIHJlbWFpbmRlciB3aXRoIGEgZGl2aXNvciBvZiB6ZXJvAMAAFgAgANgABgAgAAABLgEBADIBBAEBADkBDgEBAEoBLAEBAHgBAACH/3kBBAEBAIEBAADSAIIBAgEBAIYBAADOAIcBAAABAIkBAQDNAIsBAAABAI4BAABPAI8BAADKAJABAADLAJEBAAABAJMBAADNAJQBAADPAJYBAADTAJcBAADRAJgBAAABAJwBAADTAJ0BAADVAJ8BAADWAKABBAEBAKYBAADaAKcBAAABAKkBAADaAKwBAAABAK4BAADaAK8BAAABALEBAQDZALMBAgEBALcBAADbALgBAAABALwBAAABAMQBAAACAMUBAAABAMcBAAACAMgBAAABAMoBAAACAMsBEAEBAN4BEAEBAPEBAAACAPIBAgEBAPYBAACf//cBAADI//gBJgEBACACAAB+/yICEAEBADoCAAArKjsCAAABAD0CAABd/z4CAAAoKkECAAABAEMCAAA9/0QCAABFAEUCAABHAEYCCAEBAHADAgEBAHYDAAABAH8DAAB0AIYDAAAmAIgDAgAlAIwDAABAAI4DAQA/AJEDEAAgAKMDCAAgAM8DAAAIANgDFgEBAPQDAADE//cDAAABAPkDAAD5//oDAAABAP0DAgB+/wAEDwBQABAEHwAgAGAEIAEBAIoENAEBAMAEAAAPAMEEDAEBANAEXgEBADEFJQAwAKAQJQBgHMcQAABgHM0QAABgHKATTwDQl/ATBQAIAIkcAAABAJAcKgBA9L0cAgBA9AAelAEBAJ4eAABB4qAeXgEBAAgfBwD4/xgfBQD4/ygfBwD4/zgfBwD4/0gfBQD4/1kfBgH4/2gfBwD4/4gfBwD4/5gfBwD4/6gfBwD4/7gfAQD4/7ofAQC2/7wfAAD3/8gfAwCq/8wfAAD3/9gfAQD4/9ofAQCc/+gfAQD4/+ofAQCQ/+wfAAD5//gfAQCA//ofAQCC//wfAAD3/yYhAACj4iohAABB3yshAAC63zIhAAAcAGAhDwAQAIMhAAABALYkGQAaAAAsLwAwAGAsAAABAGIsAAAJ1mMsAAAa8WQsAAAZ1mcsBAEBAG0sAADk1W4sAAAD1m8sAADh1XAsAADi1XIsAAABAHUsAAABAH4sAQDB1YAsYgEBAOssAgEBAPIsAAABAECmLAEBAICmGgEBACKnDAEBADKnPAEBAHmnAgEBAH2nAAD8dX6nCAEBAIunAAABAI2nAADYWpCnAgEBAJanEgEBAKqnAAC8WqunAACxWqynAAC1Wq2nAAC/Wq6nAAC8WrCnAADuWrGnAADWWrKnAADrWrOnAACgA7SnDgEBAMSnAADQ/8WnAAC9WsanAADIdcenAgEBAMunAACZWsynDgEBANynAAC/WfWnAAABACH/GQAgADABaQAHAwAAAAQnACgAsAQjACgAcAUKACcAfAUOACcAjAUGACcAlAUBACcAgAwyAEAAUA0VACAAoBgfACAAQG4fACAAoG4YABsAAOkhACIAuFkQAKwAAADAXRAAAQAAAMhdEAAMAAAAAgAAAAAAAAB4AwAAMAUgAA4HYAFJEiADnRagKBYfoC0qJKA3dCtgPfQs4D2NpCA+LKagRKTXIEVu+qBL0P1gTDcHoU6aI+FbkC9hhVY0QYb7Q6GGR0bhhgBhIYcAaEGHOWqBh0BtoYfWjIGK8K/hjCOxgY38smGOALyhjwDMwY+0zgGRptZhkczXYZmM2qGZAN/hmZDigZrQ5MGdceyBngDwQaLZ9kGrWPphrgAA4rHgpoK0HriitK7O4rTh6yK1Xu5itQD4orUe+sK1AADjtUsTA7Z6NCO2/v9jtv7/lLawAgAAXRNgARIX4CC9HyAhfCwgLwUwYDMVoOA0+KRgNgymoDYe++A2AP7gQv0BYUOAByFHAQrhRyQNoUirDiFKLxghSzsZ4VrzHmFbMDShYx5hIWXwaqFlQG0hZk9v4Wbwr2FnnbyhaADPYWln0eFpANphagDgoWuu4iFt6+Qhb9DooW/782FxAQDucfABP3IAAwAAgwQgAJEFYABdE6AAEhcgHwwgYB/vLGArKjDgK2+moCwCqCAtHvsgLgD+YDae/6A2/QEhNwEKYTckDSE4qw6hOS8YITrzHiFLQDShUx5h4VTwamFVT2/hVZ28YVYAz2FXZdGhVwDaIVgA4KFZruIhW+zk4VzQ6GFdIADuXvABf19PAwAAHAZgAF8RoAC0F+AACyAgAWQxoAEA/mACoLyhAnPRoQMAAO4DABAuBAAQXwQABgAAkAhgAA4YYAELIOAB//4gAr0QIQMwNKEDoLwhBHPRYQQBAK4EgAD/BMUBAACIHyAA/R8xAQBAAbgBtgGzAawBqAGhAZIBkAGMAYgBhAKSApACUwNdA5MDhQQMBAYFuwZOAAAAAAAAAAD/AAAA/P//DwKoqqqqqqqq////////BwD//QAAAPz//wAAAAAAAAKAAAAA/////w+Fqv///////wAAAAD/////AAAAAPz///8AAAAAAP///+//AAAA/P//AAABAADw/////w8AAMD///////f/A///wEMAAAAA//8AAAAAAAD//wAAAID//3//wP///wAAAPwAAAAAAAAA+AAA///////3/P//9wMAAPBU1aqqqqqqqqqqqqqqqqqqqqqqqqqqqlX/AP8A/wDfQD8A/wD/AP8//////2IV2j8AAAAAAAAAPyAAAAAAAIo8AMQIAACAEDIAAID/+//7G/9/46qqqi8Zuf///////QcKpaoKAABeBwAAAAAABCAE///P/////wH/AD8A/wD/ANwAzwD/ANwAqqqqqhpQCAD/////vyAAAP/7/3/gBwAAAMDf//8AAAADAAAAHwAAAKqqqjoAAAAAfwD4AAAAAAD3CwAAAAAAAP8FAAAAAAAAqqqqqqqq+pOqqqqqqqr/lUBSVbWqqimqqlC6qqqCoKr/////qqqqqgAAAACoqquqVauqqqqqqtQpMSROKi1R5vz//w8AAMDrAEGVxcEACwE/AEGkxcEACwMQDjkAQbTFwQALASkAQcTFwQALAS0AQdHFwQALAwgTPgBB4cXBAAsNRSwANTEzIgAAAAAJOgBB+8XBAAsEAwAQOwBBi8bBAAsBFABBl8bBAAsFHAAAAEAAQavGwQALAUkAQbrGwQALJSMRGDY3MjAHJCsAHQwgAAAvADk5OQAXF0cXJRoZJgAFSAAeD00AQejGwQALFQo9AAYAAB8AAAAAAAAAIQAQGxcnKABBiMfBAAsHEDQCFkYIPABBmMfBAAsCEEoAQajHwQAL+w1DKjgLREESDQFCThVLTAQuALYASgCmAKIAnwCWAJQAjgCGAIMAQAFCAUYBUwEMAQgCkgKMAoYCggOkA5IDFASyBKsAAAAAAAD///////8/AP8/AAAA////AQAAAPz//wcBVFVVVVVVVfVaVRUAACAAAAAAAP//////AwAAAP///1/8AQAA8P///wP///8D//8AAAAAAAD//1VVVVVVVf7/AAAAAAAARYCw598fAAAAe1VVVVVVVQVsVVVVVVVVAGqQpKpKVVXSVVUoRVVVfV9VVVVVVVVVVVWrKlVVVVVVVQAAAABVVVVVAAAAAFRVVFWqVFVVVVVVK9bO27HV0q4RAA8ADwAfAA8AAAAAAAAADz8AAAD///8DAwAA0GTePwBVVVVVBSgEACAAAAD//wAAAD8AqgD/AABA1/7/+w8AAAAA//8/AAAA//9/fwAAAAD/9zcAAAAAAHpVAAAAAAAAvyAAAAAAAABVVVVVVVVVqoQ4Jz5QPQ/AAAAAAJ3qJcAAgBxVVVWQ5gAC///////nAP///wMAAPAAAAAAAAD/9wD/AD8A/wD/LCwFIywsLCwsLCwsLCwFACwsBSwsLCwsLCwsLCwsLCwsLCgsLCwsLBERQhErHRgXLCwsICQVFg8NIiwsLAseJywsLCwJCC0sLCwsLCwsLCwsLCwsJRxDLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLDksLCwsLCwsLCwsLCwxPywsLCwsLCwsLCwsLCwsQUAsFA4QBCwsLCwyLCwsLCwsLCwsLCwsLDUsLB8sLCwsLCwsLCwsLCw2LiwsLCwsLCwsLCwsLDMsCS8sKiEsLCwsLCwsLCw0EwMSCjAsLCwsLCwsLCwsNCYRGywsLCwsLCwsLCwsLDoBGjcMBxk4KTsGAj49PEQuLkFueSAgICBPc2NvZGVtZXNzYWdlS2luZAAAvR4QAEwAAADnAAAAKQAAAL0eEABMAAAA1wAAACUAAABjYW5ub3QgcGFyc2UgaW50ZWdlciBmcm9tIGVtcHR5IHN0cmluZ2ludmFsaWQgZGlnaXQgZm91bmQgaW4gc3RyaW5nbnVtYmVyIHRvbyBsYXJnZSB0byBmaXQgaW4gdGFyZ2V0IHR5cGVudW1iZXIgdG9vIHNtYWxsIHRvIGZpdCBpbiB0YXJnZXQgdHlwZW51bWJlciB3b3VsZCBiZSB6ZXJvIGZvciBub24temVybyB0eXBlbnVtYmVyIGlzIG5vdCBhIHBvd2VyIG9mIHR3b0N1c3RvbWVycm9yMDEyMzQ1Njc4OUFCQ0RFRnEeEABLAAAAhQsAACYAAABxHhAASwAAAI4LAAAaAAAATm90Rm91bmRQZXJtaXNzaW9uRGVuaWVkQ29ubmVjdGlvblJlZnVzZWRDb25uZWN0aW9uUmVzZXRIb3N0VW5yZWFjaGFibGVOZXR3b3JrVW5yZWFjaGFibGVDb25uZWN0aW9uQWJvcnRlZE5vdENvbm5lY3RlZEFkZHJJblVzZUFkZHJOb3RBdmFpbGFibGVOZXR3b3JrRG93bkJyb2tlblBpcGVBbHJlYWR5RXhpc3RzV291bGRCbG9ja05vdEFEaXJlY3RvcnlJc0FEaXJlY3RvcnlEaXJlY3RvcnlOb3RFbXB0eVJlYWRPbmx5RmlsZXN5c3RlbUZpbGVzeXN0ZW1Mb29wU3RhbGVOZXR3b3JrRmlsZUhhbmRsZUludmFsaWRJbnB1dEludmFsaWREYXRhVGltZWRPdXRXcml0ZVplcm9TdG9yYWdlRnVsbE5vdFNlZWthYmxlUXVvdGFFeGNlZWRlZEZpbGVUb29MYXJnZVJlc291cmNlQnVzeUV4ZWN1dGFibGVGaWxlQnVzeURlYWRsb2NrQ3Jvc3Nlc0RldmljZXNUb29NYW55TGlua3NJbnZhbGlkRmlsZW5hbWVBcmd1bWVudExpc3RUb29Mb25nSW50ZXJydXB0ZWRVbnN1cHBvcnRlZFVuZXhwZWN0ZWRFb2ZPdXRPZk1lbW9yeUluUHJvZ3Jlc3NUb29NYW55T3BlbkZpbGVzT3RoZXJVbmNhdGVnb3JpemVkUmVmQ2VsbCBhbHJlYWR5IGJvcnJvd2VkAAArAQAALAEAAC0BAAAuAQAALwEAADABAABxAAAAMQEAADIBAAAzAQAANAEAAHYAAAB3AAAAcQAAAGsAAAA1AQAANgEAADcBAAB7AAAAcAAAAHEAAABBdHRlbXB0ZWQgdG8gaW5pdGlhbGl6ZSB0aHJlYWQtbG9jYWwgd2hpbGUgaXQgaXMgYmVpbmcgZHJvcHBlZAAA5xIQAF4AAABrAAAADQAAAAAAAAD//////////5hqEABBsNXBAAu1GjgBAAAMAAAABAAAAH0AAAA4AQAADAAAAAQAAAB+AAAAfQAAALBqEAB/AAAAgAAAAIEAAAB/AAAAggAAAAAAAAAIAAAABAAAADkBAAAAAAAACAAAAAQAAACDAAAAOQEAAOxqEAB/AAAAhAAAAIEAAAB/AAAAggAAAAAAAAABAAAAAQAAADoBAAAAAAAAAQAAAAEAAAA7AQAAOgEAAChrEADfAAAAPAEAAOEAAADfAAAA4gAAAD0BAAAoAAAABAAAAIkAAAA9AQAAKAAAAAQAAACKAAAAiQAAAGRrEACLAAAAjAAAAI0AAACOAAAAjwAAAJAAAAAkAAAABAAAAIkAAACQAAAAJAAAAAQAAACKAAAAiQAAAKBrEACLAAAAkQAAAI0AAACOAAAAjwAAAD4BAAAgAAAABAAAAIkAAAA+AQAAIAAAAAQAAACKAAAAiQAAANxrEACLAAAAPwEAAI0AAACOAAAAjwAAAEntHjcSkS0fgDWbTjaVaxPlEBAAHQAAANcEAAAoAAAA5RAQAB0AAADpBAAAKAAAAOUQEAAdAAAA4AQAACgAAAB2NCBhdHRyaWJ1dGUgc2l6ZSBvdmVyZmxvd3BseXNweuUQEAAdAAAAIwQAABwAAADlEBAAHQAAACQEAAAcAAAA5RAQAB0AAAAlBAAAHAAAAOUQEAAdAAAAJgQAABsAAADlEBAAHQAAACcEAAAbAAAA5RAQAB0AAAAoBAAAGwAAAOUQEAAdAAAAKQQAABkAAADlEBAAHQAAACoEAAAZAAAA5RAQAB0AAAArBAAAGQAAAOUQEAAdAAAALAQAAB0AAADlEBAAHQAAAC0EAAAaAAAA5RAQAB0AAAAuBAAAGgAAAOUQEAAdAAAALwQAABoAAADlEBAAHQAAADAEAAAaAAAATWlzc2luZyBjaHVuayBlbGVtZW50IGZvciBTdXBlclNwbGF0IFBMWW1pbl94TWlzc2luZyBtaW5feCBwcm9wZXJ0eW1pbl95TWlzc2luZyBtaW5feSBwcm9wZXJ0eW1pbl96TWlzc2luZyBtaW5feiBwcm9wZXJ0eW1heF94TWlzc2luZyBtYXhfeCBwcm9wZXJ0eW1heF95TWlzc2luZyBtYXhfeSBwcm9wZXJ0eW1heF96TWlzc2luZyBtYXhfeiBwcm9wZXJ0eW1pbl9zY2FsZV94TWlzc2luZyBtaW5fc2NhbGVfeCBwcm9wZXJ0eW1pbl9zY2FsZV95TWlzc2luZyBtaW5fc2NhbGVfeSBwcm9wZXJ0eW1pbl9zY2FsZV96TWlzc2luZyBtaW5fc2NhbGVfeiBwcm9wZXJ0eW1heF9zY2FsZV94TWlzc2luZyBtYXhfc2NhbGVfeCBwcm9wZXJ0eW1heF9zY2FsZV95TWlzc2luZyBtYXhfc2NhbGVfeSBwcm9wZXJ0eW1heF9zY2FsZV96TWlzc2luZyBtYXhfc2NhbGVfeiBwcm9wZXJ0eW1pbl9ybWluX2dtaW5fYm1heF9ybWF4X2dtYXhfYnBhY2tlZF9wb3NpdGlvbk1pc3NpbmcgcGFja2VkX3Bvc2l0aW9uIHByb3BlcnR5cGFja2VkX3JvdGF0aW9uTWlzc2luZyBwYWNrZWRfcm90YXRpb24gcHJvcGVydHlwYWNrZWRfc2NhbGVNaXNzaW5nIHBhY2tlZF9zY2FsZSBwcm9wZXJ0eXBhY2tlZF9jb2xvck1pc3NpbmcgcGFja2VkX2NvbG9yIHByb3BlcnR5AADlEBAAHQAAADcDAAAfAAAA5RAQAB0AAABMBAAAHwAAAOUQEAAdAAAAUgQAAD0AAADlEBAAHQAAAFIEAAAhAAAA5RAQAB0AAABYBAAAPQAAAOUQEAAdAAAAWAQAACEAAADlEBAAHQAAAF4EAAA9AAAA5RAQAB0AAABeBAAAIQAAAHhNaXNzaW5nIHggcHJvcGVydHl5TWlzc2luZyB5IHByb3BlcnR5ek1pc3NpbmcgeiBwcm9wZXJ0eXNjYWxlXzBNaXNzaW5nIHNjYWxlXzAgcHJvcGVydHlz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mABYANgAOAC4AHgA+AAEAIQARADEACQApABkAOQAFACUAFQA1AA0ALQAdAD0AAwAjABMAMwALACsAGwA7AAcAJwAXADcADwAvAB8APwAAgCCAEIAwgAiAKIAYgDiABIAkgBSANIAMgCyAHIA8gAKAIoASgDKACoAqgBqAOoAGgCaAFoA2gA6ALoAegD6AAYAhgBGAMYAJgCmAGYA5gAWAJYAVgDWADYAtgB2APYADgCOAE4AzgAuAK4AbgDuAB4AngBeAN4APgC+AH4A/gABAIEAQQDBACEAoQBhAOEAEQCRAFEA0QAxALEAcQDxAAkAiQBJAMkAKQCpAGkA6QAZAJkAWQDZADkAuQB5APkABQCFAEUAxQAlAKUAZQDlABUAlQBVANUANQC1AHUA9QANAI0ATQDNAC0ArQBtAO0AHQCdAF0A3QA9AL0AfQD9AAMAgwBDAMMAIwCjAGMA4wATAJMAUwDTADMAswBzAPMACwCLAEsAywArAKsAawDrABsAmwBbANsAOwC7AHsA+wAHAIcARwDHACcApwBnAOcAFwCXAFcA1wA3ALcAdwD3AA8AjwBPAM8ALwCvAG8A7wAfAJ8AXwDfAD8AvwB/AP+AAICAgECAwIAggKCAYIDggBCAkIBQgNCAMICwgHCA8IAIgIiASIDIgCiAqIBogOiAGICYgFiA2IA4gLiAeID4gASAhIBEgMSAJICkgGSA5IAUgJSAVIDUgDSAtIB0gPSADICMgEyAzIAsgKyAbIDsgByAnIBcgNyAPIC8gHyA/IACgIKAQoDCgCKAooBigOKAEoCSgFKA0oAygLKAcoDygAqAioBKgMqAKoCqgGqA6oAagJqAWoDagDqAuoB6gPqABoCGgEaAxoAmgKaAZoDmgBaAloBWgNaANoC2gHaA9oAOgI6AToDOgC6AroBugO6AHoCegF6A3oA+gL6AfoD+gAGAgYBBgMGAIYChgGGA4YARgJGAUYDRgDGAsYBxgPGACYCJgEmAyYApgKmAaYDpgBmAmYBZgNmAOYC5gHmA+YAFgIWARYDFgCWApYBlgOWAFYCVgFWA1YA1gLWAdYD1gA2AjYBNgM2ALYCtgG2A7YAdgJ2AXYDdgD2AvYB9gP2AA4CDgEOAw4AjgKOAY4DjgBOAk4BTgNOAM4CzgHOA84ALgIuAS4DLgCuAq4BrgOuAG4CbgFuA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AGQAAAA0AgAACQAAAIgXEABkAAAAQQIAADEAAACIFxAAZAAAAEUCAAAgAAAAiBcQAGQAAAAwAgAARQAAAIgXEABkAAAAMQIAACEAAACIFxAAZAAAABECAAAWAAAAYXNzZXJ0aW9uIGZhaWxlZDogeCA+IDAAJxcQAGAAAACjAAAABQAAABAZEABsAAAAWgAAAAUAAAAQGRAAbAAAADYAAAAkAAAAEBkQAGwAAABAAAAANAAAANkVEAByAAAAeAAAACIAAADZFRAAcgAAAHwAAABNAAAAiBcQAGQAAAD5AAAAGgAAAGFzc2VydGlvbiBmYWlsZWQ6IG51bV9zdHJlYW1zID09IDEAANkVEAByAAAA5AAAAAkAAADZFRAAcgAAAKkAAAAZAAAA2RUQAHIAAACYAAAAGQAAAEwWEAByAAAAVQEAAA4AAABMFhAAcgAAAHUBAAAOAAAATBYQAHIAAABzAAAAHQAAAAQAAAADAAAAAgAAAAIAAAACAAAAAgAAAAIAAAACAAAAAgAAAAIAAAACAAAAAgAAAAIAAAABAAAAAQAAAAEAAAACAAAAAgAAAAIAAAACAAAAAgAAAAIAAAACAAAAAgAAAAIAAAADAAAAAgAAAAEAAAABAAAAAQAAAAEAAAABAAAA/////////////////////wEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAIAAAACAAAAAgAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAP//////////////////////////AQAAAAQAAAADAAAAAgAAAAIAAAACAAAAAgAAAAIAAAACAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAAEAAAABAAAAAQAAAP////////////////////////////////////9MFhAAcgAAANEBAAAcAAAATBYQAHIAAACuAQAAHAAAAFJhd1JMRUNvbXByZXNzZWRSZXNlcnZlcmRJbGxlZ2FsIG9mZnNldDogMCBmb3VuZAAAAADAAwAAAAQAAAAAAABmcmFtZV9jb250ZW50X3NpemUgd2FzIHplcm9Ub29NYW55Qml0c251bV9yZXF1ZXN0ZWRfYml0c2xpbWl0Tm90RW5vdWdoUmVtYWluaW5nQml0c3JlcXVlc3RlZHJlbWFpbmluZ0RlY29kZWJ1ZmZlckVycm9yTm90RW5vdWdoQnl0ZXNGb3JTZXF1ZW5jZXdhbnRlZGhhdmVaZXJvT2Zmc2V0VHJpZWQgdG8gdXNlIGFuIHVuaW5pdGlhbGl6ZWQgdGFibGUhTm90RW5vdWdoQnl0ZXNJbkRpY3Rpb25hcnlnb3RuZWVkT2Zmc2V0VG9vQmlnb2Zmc2V0YnVmX2xlbkJhZE1hZ2ljTnVtRlNFVGFibGVFcnJvckh1ZmZtYW5UYWJsZUVycm9yTWlzc2luZ0NvbXByZXNzZWRTaXplTWlzc2luZ051bVN0cmVhbXNHZXRCaXRzRXJyb3JIdWZmbWFuRGVjb2RlckVycm9yVW5pbml0aWFsaXplZEh1ZmZtYW5UYWJsZU1pc3NpbmdCeXRlc0Zvckp1bXBIZWFkZXJNaXNzaW5nQnl0ZXNGb3JMaXRlcmFsc25lZWRlZEV4dHJhUGFkZGluZ3NraXBwZWRfYml0c0JpdHN0cmVhbVJlYWRNaXNtYXRjaHJlYWRfdGlsZXhwZWN0ZWREZWNvZGVkTGl0ZXJhbENvdW50TWlzbWF0Y2hkZWNvZGVkRlNFRGVjb2RlckVycm9yVW5zdXBwb3J0ZWRPZmZzZXRvZmZzZXRfY29kZU5vdEVub3VnaEJ5dGVzRm9yTnVtU2VxdWVuY2VzRXh0cmFCaXRzYml0c19yZW1haW5pbmdNaXNzaW5nQ29tcHJlc3Npb25Nb2RlTWlzc2luZ0J5dGVGb3JSbGVMbFRhYmxlTWlzc2luZ0J5dGVGb3JSbGVPZlRhYmxlTWlzc2luZ0J5dGVGb3JSbGVNbFRhYmxlSWxsZWdhbExpdGVyYWxTZWN0aW9uVHlwZU5vdEVub3VnaEJ5dGVzZmFpbGVkIHRvIGZpbGwgd2hvbGUgYnVmZmVyuZAQABsAAAAlAAAAAgAAANSQEABBY2NMb2dJc1plcm9BY2NMb2dUb29CaWdtYXgAAAAAAAQAAAAEAAAAGwAAAAAAAAAEAAAABAAAAGIAAABQcm9iYWJpbGl0eUNvdW50ZXJNaXNtYXRjaGV4cGVjdGVkX3N1bXN5bWJvbF9wcm9iYWJpbGl0aWVzVG9vTWFueVN5bWJvbHMAAAIAVGFibGVJc1VuaW5pdGlhbGl6ZWRJbnZhbGlkRnJhbWVDb250ZW50U2l6ZUZsYWdXaW5kb3dUb29CaWdXaW5kb3dUb29TbWFsbEZyYW1lRGVzY3JpcHRvckVycm9yRGljdElkVG9vU21hbGxNaXNtYXRjaGVkRnJhbWVTaXplRnJhbWVTaXplSXNaZXJvSW52YWxpZEZyYW1lU2l6ZVNvdXJjZUlzRW1wdHlOb3RFbm91Z2hCeXRlc0ZvcldlaWdodHNnb3RfYnl0ZXNleHBlY3RlZF9ieXRlc1Rvb01hbnlXZWlnaHRzTWlzc2luZ1dlaWdodHNMZWZ0b3ZlcklzTm90QVBvd2VyT2YyTm90RW5vdWdoQnl0ZXNUb0RlY29tcHJlc3NXZWlnaHRzRlNFVGFibGVVc2VkVG9vTWFueUJ5dGVzdXNlZGF2YWlsYWJsZV9ieXRlc05vdEVub3VnaEJ5dGVzSW5Tb3VyY2VXZWlnaHRCaWdnZXJUaGFuTWF4TnVtQml0c01heEJpdHNUb29IaWdoAAAAAABABgAAAABEZWNvZGVyIG11c3QgaW5pdGlhbGl6ZWQgb3IgcmVzZXQgYmVmb3JlIHVzaW5nIGl0RmFpbGVkIHRvIHNraXAgYnl0ZXMgZm9yIHRoZSBsZW5ndGggZ2l2ZW4gaW4gdGhlIGZyYW1lIGhlYWRlclRhcmdldCBtdXN0IGhhdmUgYXQgbGVhc3QgYXMgbWFueSBieXRlcyBhcyB0aGUgY29udGVudHNpemUgb2YgdGhlIGZyYW1lIHJlcG9ydHNBY2Nsb2cgbXVzdCBiZSBhdCBsZWFzdCAxU291cmNlIG5lZWRzIHRvIGhhdmUgYXQgbGVhc3Qgb25lIGJ5dGVDYW4ndCBidWlsZCBodWZmbWFuIHRhYmxlIHdpdGhvdXQgYW55IHdlaWdodHMLN6Qw7C9CYWQgbWFnaWNfbnVtIGF0IHN0YXJ0IG9mIHRoZSBkaWN0aW9uYXJ5OyBHb3Q6IMMgAIBtBAAMLCBFeHBlY3RlZDogwyAAgGsEAABFcnJvciB3aGlsZSByZWFkaW5nIHRoZSBibG9jayBoZWFkZXJSZXNlcnZlZCBibG9jayBvY2N1cmVkLiBUaGlzIGlzIGNvbnNpZGVyZWQgY29ycnVwdGlvbiBieSB0aGUgZG9jdW1lbnRhdGlvbmNvbXByZXNzZWQgc2l6ZSB3YXMgbm9uZSBldmVuIHRob3VnaCBpdCBtdXN0IGJlIHNldCB0byBzb21ldGhpbmcgZm9yIGNvbXByZXNzZWQgbGl0ZXJhbHNudW1fc3RyZWFtcyB3YXMgbm9uZSBldmVuIHRob3VnaCBpdCBtdXN0IGJlIHNldCB0byBzb21ldGhpbmcgKDEgb3IgNCkgZm9yIGNvbXByZXNzZWQgbGl0ZXJhbHNUcmllZCB0byByZXVzZSBodWZmbWFuIHRhYmxlIGJ1dCBpdCB3YXMgbmV2ZXIgaW5pdGlhbGl6ZWRSZWFkIGFuIG9mZnNldCA9PSAwLiBUaGF0IGlzIGFuIGlsbGVnYWwgdmFsdWUgZm9yIG9mZnNldHNCeXRlc3RyZWFtIGRpZCBub3QgY29udGFpbiBlbm91Z2ggYnl0ZXMgdG8gZGVjb2RlIG51bV9zZXF1ZW5jZXNjb21wcmVzc2lvbiBtb2RlcyBhcmUgbm9uZSBidXQgdGhleSBtdXN0IGJlIHNldCB0byBzb21ldGhpbmdOZWVkIGEgYnl0ZSB0byByZWFkIGZvciBSTEUgbGwgdGFibGVOZWVkIGEgYnl0ZSB0byByZWFkIGZvciBSTEUgb2YgdGFibGVOZWVkIGEgYnl0ZSB0byByZWFkIGZvciBSTEUgbWwgdGFibGVNYWdpY051bWJlclJlYWRFcnJvckJhZE1hZ2ljTnVtYmVyRnJhbWVEZXNjcmlwdG9yUmVhZEVycm9ySW52YWxpZEZyYW1lRGVzY3JpcHRvcldpbmRvd0Rlc2NyaXB0b3JSZWFkRXJyb3JEaWN0aW9uYXJ5SWRSZWFkRXJyb3JGcmFtZUNvbnRlbnRTaXplUmVhZEVycm9yU2tpcEZyYW1lbWFnaWNfbnVtYmVybGVuZ3RobmVlZF9hdF9sZWFzdENhbid0IGRlY29kZSBuZXh0IGJsb2NrIGlmIGZhaWxlZCBhbG9uZyB0aGUgd2F5LiBSZXN1bHRzIHdpbGwgYmUgbm9uc2Vuc2VDYW4ndCBkZWNvZGUgbmV4dCBibG9jayBib2R5LCB3aGlsZSBleHBlY3RpbmcgdG8gZGVjb2RlIHRoZSBoZWFkZXIgb2YgdGhlIHByZXZpb3VzIGJsb2NrLiBSZXN1bHRzIHdpbGwgYmUgbm9uc2Vuc2VCbG9ja0NvbnRlbnRSZWFkRXJyb3JNYWxmb3JtZWRTZWN0aW9uSGVhZGVyZXhwZWN0ZWRfbGVucmVtYWluaW5nX2J5dGVzRGVjb21wcmVzc0xpdGVyYWxzRXJyb3JMaXRlcmFsc1NlY3Rpb25QYXJzZUVycm9yU2VxdWVuY2VzSGVhZGVyUGFyc2VFcnJvckRlY29kZVNlcXVlbmNlRXJyb3JFeGVjdXRlU2VxdWVuY2VzRXJyb3IA1x0QAEwAAADiAAAAFAAAAG9uZS10aW1lIGluaXRpYWxpemF0aW9uIG1heSBub3QgYmUgcGVyZm9ybWVkIHJlY3Vyc2l2ZWx5AAAAAAQAAAAEAAAARwEAANcdEABMAAAA4gAAADEAAABvcGVyYXRpb24gbm90IHN1cHBvcnRlZCBvbiB0aGlzIHBsYXRmb3JtoJkQACgAAAAkAAAAAAAAAAIAAADImRAAGQEAAAwAAAAEAAAASAEAAEkBAABKAQAAAAAAAAgAAAAEAAAASwEAAEwBAABNAQAATgEAAE8BAAAQAAAABAAAAFABAABRAQAAUgEAAFMBAABc9ulf3AL2ufHBcGzyYcEk199/RxauT5AvYkXpMWynGGFzc2VydGlvbiBmYWlsZWQ6IHBzaXplID49IHNpemUgKyBtaW5fb3ZlcmhlYWQAAKMgEAAqAAAAsQQAAAkAAABhc3NlcnRpb24gZmFpbGVkOiBwc2l6ZSA8PSBzaXplICsgbWF4X292ZXJoZWFkAACjIBAAKgAAALcEAAANAAAAcndsb2NrIG92ZXJmbG93ZWQgcmVhZCBsb2Nrc0YTEABdAAAAFQAAACwAAABjYW5ub3QgcmVjdXJzaXZlbHkgYWNxdWlyZSBtdXRleIoSEABcAAAAEwAAAAkAAABsb2NrIGNvdW50IG92ZXJmbG93IGluIHJlZW50cmFudCBtdXRleAAA2RoQAFYAAAAjAQAALQAAAAEAAAAAAAAA0yAAAGgBAAAgICAgICAgICAgICAgYXQgCsMgAABoBAACOiAA0yAAAGgBAAMgLSAAICAgICAgPHVua25vd24+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").buffer;
const WASM_MODULE = WebAssembly.compile(wasmBytes);
let initialized = false;
__wbg_init({ module_or_path: WASM_MODULE }).then(() => {
  initialized = true;
});
function isInitialized() {
  return initialized;
}
const jsContent = '(function() {\n  "use strict";\n  class ChunkDecoder {\n    static __wrap(ptr) {\n      ptr = ptr >>> 0;\n      const obj = Object.create(ChunkDecoder.prototype);\n      obj.__wbg_ptr = ptr;\n      ChunkDecoderFinalization.register(obj, obj.__wbg_ptr, obj);\n      return obj;\n    }\n    __destroy_into_raw() {\n      const ptr = this.__wbg_ptr;\n      this.__wbg_ptr = 0;\n      ChunkDecoderFinalization.unregister(this);\n      return ptr;\n    }\n    free() {\n      const ptr = this.__destroy_into_raw();\n      wasm.__wbg_chunkdecoder_free(ptr, 0);\n    }\n    /**\n     * @returns {any}\n     */\n    finish() {\n      const ptr = this.__destroy_into_raw();\n      const ret = wasm.chunkdecoder_finish(ptr);\n      if (ret[2]) {\n        throw takeFromExternrefTable0(ret[1]);\n      }\n      return takeFromExternrefTable0(ret[0]);\n    }\n    /**\n     * @param {Uint8Array} bytes\n     */\n    push(bytes) {\n      const ret = wasm.chunkdecoder_push(this.__wbg_ptr, bytes);\n      if (ret[1]) {\n        throw takeFromExternrefTable0(ret[0]);\n      }\n    }\n  }\n  if (Symbol.dispose) ChunkDecoder.prototype[Symbol.dispose] = ChunkDecoder.prototype.free;\n  function decode_to_extsplats(file_type, path_name) {\n    var ptr0 = isLikeNone(file_type) ? 0 : passStringToWasm0(file_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n    var len0 = WASM_VECTOR_LEN;\n    var ptr1 = isLikeNone(path_name) ? 0 : passStringToWasm0(path_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n    var len1 = WASM_VECTOR_LEN;\n    const ret = wasm.decode_to_extsplats(ptr0, len0, ptr1, len1);\n    if (ret[2]) {\n      throw takeFromExternrefTable0(ret[1]);\n    }\n    return ChunkDecoder.__wrap(ret[0]);\n  }\n  function set_sort_centers(centers, range_bases, range_counts, range_origins) {\n    wasm.set_sort_centers(centers, range_bases, range_counts, range_origins);\n  }\n  function sort32_centers(num_splats, camera_x, camera_y, camera_z, direction_x, direction_y, direction_z, radial, ordering) {\n    const ret = wasm.sort32_centers(num_splats, camera_x, camera_y, camera_z, direction_x, direction_y, direction_z, radial, ordering);\n    return ret >>> 0;\n  }\n  function __wbg_get_imports() {\n    const import0 = {\n      __proto__: null,\n      __wbg___wbindgen_debug_string_dd5d2d07ce9e6c57: function(arg0, arg1) {\n        const ret = debugString(arg1);\n        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n        const len1 = WASM_VECTOR_LEN;\n        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);\n        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);\n      },\n      __wbg___wbindgen_throw_81fc77679af83bc6: function(arg0, arg1) {\n        throw new Error(getStringFromWasm0(arg0, arg1));\n      },\n      __wbg_error_a6fa202b58aa1cd3: function(arg0, arg1) {\n        let deferred0_0;\n        let deferred0_1;\n        try {\n          deferred0_0 = arg0;\n          deferred0_1 = arg1;\n          console.error(getStringFromWasm0(arg0, arg1));\n        } finally {\n          wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);\n        }\n      },\n      __wbg_fill_37e42d54fe1a5d54: function(arg0, arg1, arg2, arg3) {\n        const ret = arg0.fill(arg1, arg2 >>> 0, arg3 >>> 0);\n        return ret;\n      },\n      __wbg_length_0c32cb8543c8e4c8: function(arg0) {\n        const ret = arg0.length;\n        return ret;\n      },\n      __wbg_length_1e701798fdcaa3b4: function(arg0) {\n        const ret = arg0.length;\n        return ret;\n      },\n      __wbg_length_526c0f6e4ebae15d: function(arg0) {\n        const ret = arg0.length;\n        return ret;\n      },\n      __wbg_length_fd4646b401926788: function(arg0) {\n        const ret = arg0.length;\n        return ret;\n      },\n      __wbg_new_227d7c05414eb861: function() {\n        const ret = new Error();\n        return ret;\n      },\n      __wbg_new_4f9fafbb3909af72: function() {\n        const ret = new Object();\n        return ret;\n      },\n      __wbg_new_with_length_26bffbe236bf73f9: function(arg0) {\n        const ret = new Float32Array(arg0 >>> 0);\n        return ret;\n      },\n      __wbg_new_with_length_41a22191b9bdfd66: function(arg0) {\n        const ret = new Uint32Array(arg0 >>> 0);\n        return ret;\n      },\n      __wbg_prototypesetcall_021fd89d67217368: function(arg0, arg1, arg2) {\n        Float64Array.prototype.set.call(getArrayF64FromWasm0(arg0, arg1), arg2);\n      },\n      __wbg_prototypesetcall_3e05eb9545565046: function(arg0, arg1, arg2) {\n        Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);\n      },\n      __wbg_prototypesetcall_66c8e1fb820946be: function(arg0, arg1, arg2) {\n        Float32Array.prototype.set.call(getArrayF32FromWasm0(arg0, arg1), arg2);\n      },\n      __wbg_prototypesetcall_e42275e601e14eeb: function(arg0, arg1, arg2) {\n        Uint32Array.prototype.set.call(getArrayU32FromWasm0(arg0, arg1), arg2);\n      },\n      __wbg_set_448126769bf7c181: function(arg0, arg1, arg2) {\n        arg0.set(getArrayU32FromWasm0(arg1, arg2));\n      },\n      __wbg_set_8ee2d34facb8466e: function() {\n        return handleError(function(arg0, arg1, arg2) {\n          const ret = Reflect.set(arg0, arg1, arg2);\n          return ret;\n        }, arguments);\n      },\n      __wbg_set_a98c8da6557e63de: function(arg0, arg1, arg2) {\n        arg0.set(getArrayF32FromWasm0(arg1, arg2));\n      },\n      __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {\n        const ret = arg1.stack;\n        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);\n        const len1 = WASM_VECTOR_LEN;\n        getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);\n        getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);\n      },\n      __wbg_subarray_0f98d3fb634508ad: function(arg0, arg1, arg2) {\n        const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);\n        return ret;\n      },\n      __wbg_subarray_4342405c1ffc86d6: function(arg0, arg1, arg2) {\n        const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);\n        return ret;\n      },\n      __wbg_subarray_d51e89458b3fdbf6: function(arg0, arg1, arg2) {\n        const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);\n        return ret;\n      },\n      __wbindgen_cast_0000000000000001: function(arg0) {\n        const ret = arg0;\n        return ret;\n      },\n      __wbindgen_cast_0000000000000002: function(arg0, arg1) {\n        const ret = getArrayF32FromWasm0(arg0, arg1);\n        return ret;\n      },\n      __wbindgen_cast_0000000000000003: function(arg0, arg1) {\n        const ret = getArrayU32FromWasm0(arg0, arg1);\n        return ret;\n      },\n      __wbindgen_cast_0000000000000004: function(arg0, arg1) {\n        const ret = getStringFromWasm0(arg0, arg1);\n        return ret;\n      },\n      __wbindgen_init_externref_table: function() {\n        const table = wasm.__wbindgen_externrefs;\n        const offset = table.grow(4);\n        table.set(0, void 0);\n        table.set(offset + 0, void 0);\n        table.set(offset + 1, null);\n        table.set(offset + 2, true);\n        table.set(offset + 3, false);\n      }\n    };\n    return {\n      __proto__: null,\n      "./gaussian_splat_rs_bg.js": import0\n    };\n  }\n  const ChunkDecoderFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {\n  }, unregister: () => {\n  } } : new FinalizationRegistry((ptr) => wasm.__wbg_chunkdecoder_free(ptr >>> 0, 1));\n  function addToExternrefTable0(obj) {\n    const idx = wasm.__externref_table_alloc();\n    wasm.__wbindgen_externrefs.set(idx, obj);\n    return idx;\n  }\n  function debugString(val) {\n    const type = typeof val;\n    if (type == "number" || type == "boolean" || val == null) {\n      return `${val}`;\n    }\n    if (type == "string") {\n      return `"${val}"`;\n    }\n    if (type == "symbol") {\n      const description = val.description;\n      if (description == null) {\n        return "Symbol";\n      } else {\n        return `Symbol(${description})`;\n      }\n    }\n    if (type == "function") {\n      const name = val.name;\n      if (typeof name == "string" && name.length > 0) {\n        return `Function(${name})`;\n      } else {\n        return "Function";\n      }\n    }\n    if (Array.isArray(val)) {\n      const length = val.length;\n      let debug = "[";\n      if (length > 0) {\n        debug += debugString(val[0]);\n      }\n      for (let i = 1; i < length; i++) {\n        debug += ", " + debugString(val[i]);\n      }\n      debug += "]";\n      return debug;\n    }\n    const builtInMatches = /\\[object ([^\\]]+)\\]/.exec(toString.call(val));\n    let className;\n    if (builtInMatches && builtInMatches.length > 1) {\n      className = builtInMatches[1];\n    } else {\n      return toString.call(val);\n    }\n    if (className == "Object") {\n      try {\n        return "Object(" + JSON.stringify(val) + ")";\n      } catch (_) {\n        return "Object";\n      }\n    }\n    if (val instanceof Error) {\n      return `${val.name}: ${val.message}\n${val.stack}`;\n    }\n    return className;\n  }\n  function getArrayF32FromWasm0(ptr, len) {\n    ptr = ptr >>> 0;\n    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);\n  }\n  function getArrayF64FromWasm0(ptr, len) {\n    ptr = ptr >>> 0;\n    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);\n  }\n  function getArrayU32FromWasm0(ptr, len) {\n    ptr = ptr >>> 0;\n    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);\n  }\n  function getArrayU8FromWasm0(ptr, len) {\n    ptr = ptr >>> 0;\n    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);\n  }\n  let cachedDataViewMemory0 = null;\n  function getDataViewMemory0() {\n    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || cachedDataViewMemory0.buffer.detached === void 0 && cachedDataViewMemory0.buffer !== wasm.memory.buffer) {\n      cachedDataViewMemory0 = new DataView(wasm.memory.buffer);\n    }\n    return cachedDataViewMemory0;\n  }\n  let cachedFloat32ArrayMemory0 = null;\n  function getFloat32ArrayMemory0() {\n    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {\n      cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);\n    }\n    return cachedFloat32ArrayMemory0;\n  }\n  let cachedFloat64ArrayMemory0 = null;\n  function getFloat64ArrayMemory0() {\n    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {\n      cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);\n    }\n    return cachedFloat64ArrayMemory0;\n  }\n  function getStringFromWasm0(ptr, len) {\n    ptr = ptr >>> 0;\n    return decodeText(ptr, len);\n  }\n  let cachedUint32ArrayMemory0 = null;\n  function getUint32ArrayMemory0() {\n    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {\n      cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);\n    }\n    return cachedUint32ArrayMemory0;\n  }\n  let cachedUint8ArrayMemory0 = null;\n  function getUint8ArrayMemory0() {\n    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {\n      cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);\n    }\n    return cachedUint8ArrayMemory0;\n  }\n  function handleError(f, args) {\n    try {\n      return f.apply(this, args);\n    } catch (e) {\n      const idx = addToExternrefTable0(e);\n      wasm.__wbindgen_exn_store(idx);\n    }\n  }\n  function isLikeNone(x) {\n    return x === void 0 || x === null;\n  }\n  function passStringToWasm0(arg, malloc, realloc) {\n    if (realloc === void 0) {\n      const buf = cachedTextEncoder.encode(arg);\n      const ptr2 = malloc(buf.length, 1) >>> 0;\n      getUint8ArrayMemory0().subarray(ptr2, ptr2 + buf.length).set(buf);\n      WASM_VECTOR_LEN = buf.length;\n      return ptr2;\n    }\n    let len = arg.length;\n    let ptr = malloc(len, 1) >>> 0;\n    const mem = getUint8ArrayMemory0();\n    let offset = 0;\n    for (; offset < len; offset++) {\n      const code = arg.charCodeAt(offset);\n      if (code > 127) break;\n      mem[ptr + offset] = code;\n    }\n    if (offset !== len) {\n      if (offset !== 0) {\n        arg = arg.slice(offset);\n      }\n      ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;\n      const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);\n      const ret = cachedTextEncoder.encodeInto(arg, view);\n      offset += ret.written;\n      ptr = realloc(ptr, len, offset, 1) >>> 0;\n    }\n    WASM_VECTOR_LEN = offset;\n    return ptr;\n  }\n  function takeFromExternrefTable0(idx) {\n    const value = wasm.__wbindgen_externrefs.get(idx);\n    wasm.__externref_table_dealloc(idx);\n    return value;\n  }\n  let cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });\n  cachedTextDecoder.decode();\n  const MAX_SAFARI_DECODE_BYTES = 2146435072;\n  let numBytesDecoded = 0;\n  function decodeText(ptr, len) {\n    numBytesDecoded += len;\n    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {\n      cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });\n      cachedTextDecoder.decode();\n      numBytesDecoded = len;\n    }\n    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));\n  }\n  const cachedTextEncoder = new TextEncoder();\n  if (!("encodeInto" in cachedTextEncoder)) {\n    cachedTextEncoder.encodeInto = function(arg, view) {\n      const buf = cachedTextEncoder.encode(arg);\n      view.set(buf);\n      return {\n        read: arg.length,\n        written: buf.length\n      };\n    };\n  }\n  let WASM_VECTOR_LEN = 0;\n  let wasm;\n  function __wbg_finalize_init(instance, module) {\n    wasm = instance.exports;\n    cachedDataViewMemory0 = null;\n    cachedFloat32ArrayMemory0 = null;\n    cachedFloat64ArrayMemory0 = null;\n    cachedUint32ArrayMemory0 = null;\n    cachedUint8ArrayMemory0 = null;\n    wasm.__wbindgen_start();\n    return wasm;\n  }\n  async function __wbg_load(module, imports) {\n    if (typeof Response === "function" && module instanceof Response) {\n      if (typeof WebAssembly.instantiateStreaming === "function") {\n        try {\n          return await WebAssembly.instantiateStreaming(module, imports);\n        } catch (e) {\n          const validResponse = module.ok && expectedResponseType(module.type);\n          if (validResponse && module.headers.get("Content-Type") !== "application/wasm") {\n            console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\\n", e);\n          } else {\n            throw e;\n          }\n        }\n      }\n      const bytes = await module.arrayBuffer();\n      return await WebAssembly.instantiate(bytes, imports);\n    } else {\n      const instance = await WebAssembly.instantiate(module, imports);\n      if (instance instanceof WebAssembly.Instance) {\n        return { instance, module };\n      } else {\n        return instance;\n      }\n    }\n    function expectedResponseType(type) {\n      switch (type) {\n        case "basic":\n        case "cors":\n        case "default":\n          return true;\n      }\n      return false;\n    }\n  }\n  async function __wbg_init(module_or_path) {\n    if (wasm !== void 0) return wasm;\n    if (module_or_path !== void 0) {\n      if (Object.getPrototypeOf(module_or_path) === Object.prototype) {\n        ({ module_or_path } = module_or_path);\n      } else {\n        console.warn("using deprecated parameters for the initialization function; pass a single object instead");\n      }\n    }\n    const imports = __wbg_get_imports();\n    if (typeof module_or_path === "string" || typeof Request === "function" && module_or_path instanceof Request || typeof URL === "function" && module_or_path instanceof URL) {\n      module_or_path = fetch(module_or_path);\n    }\n    const { instance } = await __wbg_load(await module_or_path, imports);\n    return __wbg_finalize_init(instance);\n  }\n  const rpcHandlers = {\n    setSortCenters,\n    sortCenters32,\n    loadExtSplats,\n    nextChunk\n  };\n  function setSortCenters({\n    centers,\n    rangeBases,\n    rangeCounts,\n    rangeOrigins\n  }) {\n    set_sort_centers(centers, rangeBases, rangeCounts, rangeOrigins);\n    return { numSplats: Math.floor(centers.length / 3) };\n  }\n  function sortCenters32({\n    numSplats,\n    cameraPosition,\n    direction,\n    radial,\n    ordering\n  }) {\n    const activeSplats = sort32_centers(\n      numSplats,\n      cameraPosition[0],\n      cameraPosition[1],\n      cameraPosition[2],\n      direction[0],\n      direction[1],\n      direction[2],\n      radial,\n      ordering\n    );\n    return { activeSplats, ordering };\n  }\n  async function onMessage(event) {\n    const {\n      id,\n      name,\n      args\n    } = event.data;\n    try {\n      const handler = rpcHandlers[name];\n      if (!handler) {\n        throw new Error(`Unknown worker RPC: ${name}`);\n      }\n      const sendStatus = (data) => {\n        self.postMessage(\n          { id, status: data },\n          { transfer: getTransferable(data) }\n        );\n      };\n      const result = await handler(args, { sendStatus });\n      self.postMessage({ id, result }, { transfer: getTransferable(result) });\n    } catch (error) {\n      console.warn(`Worker error: ${error}`);\n      self.postMessage({ id, error }, { transfer: getTransferable(error) });\n    }\n  }\n  async function decodeBytesUrl({\n    decoder,\n    fileBytes,\n    url,\n    requestHeader,\n    withCredentials,\n    chunked,\n    chunkedLength,\n    sendStatus\n  }) {\n    let readStream;\n    let streamLength = 0;\n    if (fileBytes) {\n      readStream = new ReadableStream({\n        start(controller) {\n          controller.enqueue(fileBytes);\n          controller.close();\n        }\n      });\n      streamLength = fileBytes.length;\n    } else if (url) {\n      const request = new Request(url, {\n        headers: requestHeader ? new Headers(requestHeader) : void 0,\n        credentials: withCredentials ? "include" : "same-origin"\n      });\n      const response = await fetch(request);\n      if (!response.ok || !response.body) {\n        throw new Error(\n          `Failed to fetch "${url}": ${response.status} ${response.statusText}`\n        );\n      }\n      readStream = response.body;\n      const contentLength = Number.parseInt(\n        response.headers.get("Content-Length") || "0"\n      );\n      streamLength = Number.isNaN(contentLength) ? 0 : contentLength;\n    } else if (chunked) {\n      readStream = new ReadableStream(\n        {\n          async pull(controller) {\n            const readNextChunk = new Promise((resolve) => {\n              nextChunkWaiter = resolve;\n            });\n            sendStatus({ nextChunk: true });\n            const chunk = await readNextChunk;\n            if (chunk.length === 0) {\n              controller.close();\n            } else {\n              controller.enqueue(chunk);\n            }\n          }\n        },\n        { highWaterMark: 0 }\n      );\n      streamLength = chunkedLength ?? 0;\n    } else {\n      throw new Error("No url or fileBytes provided");\n    }\n    const reader = readStream.getReader();\n    let loaded = 0;\n    try {\n      while (true) {\n        const { done, value } = await reader.read();\n        if (done) {\n          break;\n        }\n        loaded += value.length;\n        sendStatus({ loaded, total: streamLength });\n        decoder.push(value);\n      }\n      if (chunked && streamLength === 0) {\n        sendStatus({ loaded, total: loaded });\n      }\n      return decoder.finish();\n    } catch (error) {\n      try {\n        await reader.cancel(error);\n      } catch {\n      }\n      throw error;\n    } finally {\n      reader.releaseLock();\n    }\n  }\n  function toExtResult(decoded) {\n    return {\n      numSplats: decoded.numSplats,\n      extArrays: [decoded.ext0, decoded.ext1],\n      localCenters: decoded.localCenters,\n      extra: {\n        sh1: decoded.sh1,\n        sh2: decoded.sh2,\n        sh3a: decoded.sh3a,\n        sh3b: decoded.sh3b\n      }\n    };\n  }\n  async function loadExtSplats({\n    url,\n    requestHeader,\n    withCredentials,\n    fileBytes,\n    fileType,\n    pathName,\n    chunked,\n    chunkedLength\n  }, { sendStatus }) {\n    const decoder = decode_to_extsplats(fileType, pathName ?? url);\n    const decoded = await decodeBytesUrl({\n      decoder,\n      fileBytes,\n      url,\n      requestHeader,\n      withCredentials,\n      chunked,\n      chunkedLength,\n      sendStatus\n    });\n    return toExtResult(decoded);\n  }\n  let nextChunkWaiter = (_chunk) => {\n  };\n  async function nextChunk({ chunk }) {\n    nextChunkWaiter(chunk);\n  }\n  function getTransferable(ctx) {\n    const buffers = [];\n    const seen = /* @__PURE__ */ new Set();\n    function traverse(obj) {\n      if (obj && typeof obj === "object" && !seen.has(obj)) {\n        seen.add(obj);\n        if (obj instanceof ArrayBuffer) {\n          buffers.push(obj);\n        } else if (ArrayBuffer.isView(obj)) {\n          buffers.push(obj.buffer);\n        } else if (Array.isArray(obj)) {\n          obj.forEach(traverse);\n        } else {\n          Object.values(obj).forEach(traverse);\n        }\n      }\n    }\n    traverse(ctx);\n    return buffers;\n  }\n  async function initialize() {\n    let resolveWaitForModule;\n    const waitForModule = new Promise((resolve) => {\n      resolveWaitForModule = resolve;\n    });\n    const pending = [];\n    const bufferMessage = (event) => {\n      if (event.data.name === "init-wasm") {\n        resolveWaitForModule(event.data.module);\n        return;\n      }\n      pending.push(event);\n    };\n    self.addEventListener("message", bufferMessage);\n    await __wbg_init({ module_or_path: await waitForModule });\n    self.removeEventListener("message", bufferMessage);\n    self.addEventListener("message", onMessage);\n    for (const event of pending) {\n      onMessage(event);\n    }\n    pending.length = 0;\n  }\n  initialize().catch(console.error);\n})();\n//# sourceMappingURL=worker-BZ-R79Wz.js.map\n';
const blob = typeof self !== "undefined" && self.Blob && new Blob([jsContent], { type: "text/javascript;charset=utf-8" });
function WorkerWrapper(options) {
  let objURL;
  try {
    objURL = blob && (self.URL || self.webkitURL).createObjectURL(blob);
    if (!objURL) throw "";
    const worker = new Worker(objURL, {
      name: options == null ? void 0 : options.name
    });
    worker.addEventListener("error", () => {
      (self.URL || self.webkitURL).revokeObjectURL(objURL);
    });
    return worker;
  } catch (e) {
    return new Worker(
      "data:text/javascript;charset=utf-8," + encodeURIComponent(jsContent),
      {
        name: options == null ? void 0 : options.name
      }
    );
  } finally {
    objURL && (self.URL || self.webkitURL).revokeObjectURL(objURL);
  }
}
const _SplatWorker = class _SplatWorker {
  constructor() {
    this.messages = {};
    this.worker = new WorkerWrapper();
    this.worker.onmessage = (event) => this.onMessage(event);
    WASM_MODULE.then((module2) => {
      this.worker.postMessage({ name: "init-wasm", module: module2 });
    });
  }
  onMessage(event) {
    var _a;
    const { id, result, error, status } = event.data;
    const promise = this.messages[id];
    if (promise) {
      if (error !== void 0) {
        delete this.messages[id];
        promise.reject(error);
      } else if (status !== void 0) {
        (_a = promise.onStatus) == null ? void 0 : _a.call(promise, status);
      } else {
        delete this.messages[id];
        promise.resolve(result);
      }
    }
  }
  async call(name, args, options = {}) {
    const id = ++_SplatWorker.currentId;
    const promise = new Promise((resolve, reject) => {
      this.messages[id] = {
        resolve: (value) => resolve(value),
        reject,
        onStatus: options.onStatus
      };
    });
    this.worker.postMessage(
      { id, name, args },
      { transfer: getTransferable(args) }
    );
    return promise;
  }
  dispose() {
    this.worker.terminate();
    const messages = Object.values(this.messages);
    this.messages = {};
    for (const message of messages) {
      message.reject(new Error("Worker terminate"));
    }
  }
};
_SplatWorker.currentId = 0;
let SplatWorker = _SplatWorker;
class SplatWorkerPool {
  constructor(maxWorkers = 4) {
    this.numWorkers = 0;
    this.freelist = [];
    this.queue = [];
    this.maxWorkers = maxWorkers;
  }
  async withWorker(callback) {
    const worker = await this.allocWorker();
    try {
      return await callback(worker);
    } finally {
      this.freeWorker(worker);
    }
  }
  async allocWorker() {
    const worker = this.freelist.pop();
    if (worker) {
      return worker;
    }
    if (this.numWorkers < this.maxWorkers) {
      const worker2 = new SplatWorker();
      this.numWorkers += 1;
      return worker2;
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }
  freeWorker(worker) {
    if (this.numWorkers > this.maxWorkers) {
      worker.dispose();
      this.numWorkers -= 1;
      return;
    }
    const waiter = this.queue.shift();
    if (waiter) {
      waiter(worker);
      return;
    }
    this.freelist.push(worker);
  }
}
const workerPool = new SplatWorkerPool();
class SplatLoader extends THREE.Loader {
  load(url, onLoad, onProgress, onError) {
    return this.loadInternal({ url, onLoad, onProgress, onError });
  }
  async loadAsync(url, onProgress) {
    return new Promise((resolve, reject) => {
      this.load(url, resolve, onProgress, reject);
    });
  }
  parse(extSplats) {
    return new SplatMesh({ extSplats });
  }
  loadInternal({
    extSplats,
    url,
    fileBytes,
    fileType,
    fileName,
    stream,
    streamLength,
    onLoad,
    onProgress,
    onError
  }) {
    const byteArray = fileBytes instanceof ArrayBuffer ? new Uint8Array(fileBytes) : fileBytes;
    const resolvedURL = byteArray ? void 0 : this.manager.resolveURL((this.path ?? "") + (url ?? ""));
    let readStream = stream == null ? void 0 : stream.getReader();
    this.manager.itemStart(resolvedURL ?? "");
    workerPool.withWorker(async (worker) => {
      const onStatus = async (data) => {
        const { loaded, total } = data;
        if (loaded !== void 0 && onProgress) {
          onProgress(
            new ProgressEvent("progress", {
              lengthComputable: total !== 0,
              loaded,
              total: total ?? 0
            })
          );
        }
        if (data.nextChunk) {
          let chunk;
          if (!readStream) {
            chunk = new Uint8Array(0);
          } else {
            const { done, value } = await readStream.read();
            if (done) {
              readStream.releaseLock();
              readStream = void 0;
              chunk = new Uint8Array(0);
            } else {
              chunk = value;
            }
          }
          worker.call("nextChunk", { chunk });
        }
      };
      const basedUrl = resolvedURL ? new URL(resolvedURL, window.location.href).toString() : void 0;
      const decoded = await worker.call(
        "loadExtSplats",
        {
          url: basedUrl,
          requestHeader: this.requestHeader,
          withCredentials: this.withCredentials,
          fileBytes: byteArray == null ? void 0 : byteArray.slice(),
          fileType,
          pathName: resolvedURL || fileName,
          chunked: stream !== void 0,
          chunkedLength: streamLength
        },
        { onStatus }
      );
      const result = extSplats ?? new ExtSplats();
      result.initialize(decoded);
      onLoad == null ? void 0 : onLoad(result);
    }).catch(async (error) => {
      if (readStream) {
        try {
          await readStream.cancel(error);
        } catch {
        }
        readStream.releaseLock();
        readStream = void 0;
      }
      this.manager.itemError(resolvedURL ?? "");
      onError == null ? void 0 : onError(error);
    }).finally(() => {
      this.manager.itemEnd(resolvedURL ?? "");
    });
  }
  async loadInternalAsync({
    extSplats,
    url,
    fileBytes,
    fileType,
    fileName,
    stream,
    streamLength,
    onProgress
  }) {
    return new Promise((resolve, reject) => {
      this.loadInternal({
        extSplats,
        url,
        fileBytes,
        fileType,
        fileName,
        stream,
        streamLength,
        onLoad: resolve,
        onProgress,
        onError: reject
      });
    });
  }
}
const _ExtSplats = class _ExtSplats {
  constructor(options = {}) {
    this.maxSplats = 0;
    this.numSplats = 0;
    this.extArrays = [
      new Uint32Array(0),
      new Uint32Array(0)
    ];
    this.extra = {};
    this.isInitialized = false;
    this.needsUpdate = true;
    this.shTextures = {};
    this.localCenters = null;
    this.textures = [_ExtSplats.emptyTexture, _ExtSplats.emptyTexture];
    this.initialized = Promise.resolve(this);
    this.reinitialize(options);
  }
  reinitialize(options) {
    this.isInitialized = false;
    this.disposeTextures();
    this.extra = {};
    this.localCenters = null;
    this.maxSplats = options.maxSplats ?? 0;
    this.needsUpdate = true;
    if (options.url || options.fileBytes || options.stream || options.construct) {
      this.initialized = this.asyncInitialize(options).then(() => {
        this.isInitialized = true;
        return this;
      });
    } else {
      this.initialize(options);
      this.isInitialized = true;
      this.initialized = Promise.resolve(this);
    }
  }
  initialize(options) {
    this.disposeTextures();
    this.extra = options.extra ?? {};
    if (options.extArrays) {
      this.extArrays = options.extArrays;
      this.maxSplats = Math.floor(
        Math.min(this.extArrays[0].length, this.extArrays[1].length) / 4
      );
      this.maxSplats = Math.floor(this.maxSplats / SPLAT_TEX_WIDTH) * SPLAT_TEX_WIDTH;
      this.numSplats = Math.min(
        this.maxSplats,
        options.numSplats ?? this.maxSplats
      );
    } else {
      this.maxSplats = options.maxSplats ?? 0;
      this.numSplats = 0;
      this.extArrays = [new Uint32Array(0), new Uint32Array(0)];
    }
    this.localCenters = options.localCenters && options.localCenters.length >= this.numSplats * 3 ? options.localCenters : null;
    this.needsUpdate = true;
  }
  async asyncInitialize(options) {
    var _a;
    const loader = new SplatLoader();
    if (options.fileBytes || options.url || options.stream) {
      await loader.loadInternalAsync({
        extSplats: this,
        url: options.url,
        fileBytes: options.fileBytes,
        fileType: options.fileType,
        fileName: options.fileName,
        stream: options.stream,
        streamLength: options.streamLength,
        onProgress: options.onProgress
      });
    }
    const maybePromise = (_a = options.construct) == null ? void 0 : _a.call(options, this);
    if (maybePromise instanceof Promise) {
      await maybePromise;
    }
  }
  dispose() {
    this.disposeTextures();
    this.extArrays = [new Uint32Array(0), new Uint32Array(0)];
    this.localCenters = null;
    this.extra = {};
  }
  disposeTextures() {
    for (const texture of this.textures ?? []) {
      if (texture !== _ExtSplats.emptyTexture) {
        texture.dispose();
      }
    }
    this.textures = [_ExtSplats.emptyTexture, _ExtSplats.emptyTexture];
    for (const texture of Object.values(this.shTextures ?? {})) {
      texture == null ? void 0 : texture.dispose();
    }
    this.shTextures = {};
  }
  getNumSplats() {
    return this.numSplats;
  }
  getNumSh() {
    return !this.extra.sh1 ? 0 : !this.extra.sh2 ? 1 : !this.extra.sh3a || !this.extra.sh3b ? 2 : 3;
  }
  ensureSplats(numSplats) {
    this.localCenters = null;
    const currentCapacity = this.extArrays[0].length / 4;
    const targetSize = numSplats <= this.maxSplats ? this.maxSplats : Math.max(numSplats, 2 * this.maxSplats);
    if (targetSize > currentCapacity) {
      this.maxSplats = getTextureSize(Math.max(1, targetSize)).maxSplats;
      const first = new Uint32Array(this.maxSplats * 4);
      const second = new Uint32Array(this.maxSplats * 4);
      first.set(this.extArrays[0]);
      second.set(this.extArrays[1]);
      this.extArrays = [first, second];
      this.needsUpdate = true;
    }
    return this.extArrays;
  }
  getSplat(index) {
    if (index < 0 || index >= this.numSplats) {
      throw new Error("Invalid splat index");
    }
    return decodeExtSplat(this.extArrays, index);
  }
  setSplat(index, center, scales, quaternion, opacity, color) {
    const arrays = this.ensureSplats(index + 1);
    encodeExtSplat(
      arrays,
      index,
      center.x,
      center.y,
      center.z,
      scales.x,
      scales.y,
      scales.z,
      quaternion.x,
      quaternion.y,
      quaternion.z,
      quaternion.w,
      opacity,
      color.r,
      color.g,
      color.b
    );
    this.numSplats = Math.max(this.numSplats, index + 1);
    this.needsUpdate = true;
  }
  pushSplat(center, scales, quaternion, opacity, color) {
    this.setSplat(this.numSplats, center, scales, quaternion, opacity, color);
  }
  forEachCenter(callback) {
    const localCenters = this.localCenters;
    if (localCenters && localCenters.length >= this.numSplats * 3) {
      this.localCenters = null;
      for (let index = 0; index < this.numSplats; index += 1) {
        const i3 = index * 3;
        callback(
          index,
          localCenters[i3],
          localCenters[i3 + 1],
          localCenters[i3 + 2]
        );
      }
      return;
    }
    this.localCenters = null;
    const [extA, extB] = this.extArrays;
    const centerView = new Float32Array(
      extA.buffer,
      extA.byteOffset,
      extA.length
    );
    for (let index = 0; index < this.numSplats; index += 1) {
      const i4 = index * 4;
      const scaleX = extB[i4 + 1] >>> 16;
      const scaleY = extB[i4 + 2] & 65535;
      const scaleZ = extB[i4 + 2] >>> 16;
      if (scaleX === 64512 && scaleY === 64512 && scaleZ === 64512) {
        callback(index, Number.NaN, Number.NaN, Number.NaN);
        continue;
      }
      callback(index, centerView[i4], centerView[i4 + 1], centerView[i4 + 2]);
    }
  }
  forEachSplat(callback) {
    for (let index = 0; index < this.numSplats; index += 1) {
      const splat = decodeExtSplat(this.extArrays, index);
      callback(
        index,
        splat.center,
        splat.scales,
        splat.quaternion,
        splat.opacity,
        splat.color
      );
    }
  }
  getSplatTextures() {
    if (this.maxSplats === 0 || this.extArrays[0].length === 0) {
      return [_ExtSplats.emptyTexture, _ExtSplats.emptyTexture];
    }
    const { width, height, depth } = getTextureSize(this.maxSplats);
    const incompatible = this.textures[0] === _ExtSplats.emptyTexture || this.textures[0].image.width !== width || this.textures[0].image.height !== height || this.textures[0].image.depth !== depth || this.textures[0].image.data.buffer !== this.extArrays[0].buffer;
    if (incompatible) {
      this.disposeMainTextures();
      this.textures = [
        newUintArrayTexture(this.extArrays[0], width, height, depth),
        newUintArrayTexture(this.extArrays[1], width, height, depth)
      ];
    } else if (this.needsUpdate) {
      this.textures[0].needsUpdate = true;
      this.textures[1].needsUpdate = true;
    }
    return this.textures;
  }
  disposeMainTextures() {
    for (const texture of this.textures) {
      if (texture !== _ExtSplats.emptyTexture) {
        texture.dispose();
      }
    }
    this.textures = [_ExtSplats.emptyTexture, _ExtSplats.emptyTexture];
  }
  getShTextures() {
    this.shTextures.sh1 = this.ensureShTexture("sh1", this.shTextures.sh1);
    this.shTextures.sh2 = this.ensureShTexture("sh2", this.shTextures.sh2);
    this.shTextures.sh3a = this.ensureShTexture("sh3a", this.shTextures.sh3a);
    this.shTextures.sh3b = this.ensureShTexture("sh3b", this.shTextures.sh3b);
    return this.shTextures;
  }
  ensureShTexture(key, current) {
    let texture = current;
    const data = this.extra[key];
    if (!data) {
      texture == null ? void 0 : texture.dispose();
      return void 0;
    }
    const { width, height, depth, maxSplats } = getTextureSize(
      Math.max(1, data.length / 4)
    );
    let padded = data;
    if (data.length < maxSplats * 4) {
      padded = new Uint32Array(maxSplats * 4);
      padded.set(data);
      this.extra[key] = padded;
    }
    const incompatible = texture && (texture.image.width !== width || texture.image.height !== height || texture.image.depth !== depth || texture.image.data.buffer !== padded.buffer);
    if (incompatible) {
      texture == null ? void 0 : texture.dispose();
      texture = void 0;
    }
    if (!texture) {
      texture = newUintArrayTexture(padded, width, height, depth);
    } else if (this.needsUpdate) {
      texture.needsUpdate = true;
    }
    return texture;
  }
};
_ExtSplats.emptyTexture = newUintArrayTexture(null, 1, 1, 1);
let ExtSplats = _ExtSplats;
function newUintArrayTexture(data, width, height, depth) {
  const texture = new THREE__namespace.DataArrayTexture(
    data,
    width,
    height,
    depth
  );
  texture.format = THREE__namespace.RGBAIntegerFormat;
  texture.type = THREE__namespace.UnsignedIntType;
  texture.internalFormat = "RGBA32UI";
  texture.magFilter = THREE__namespace.NearestFilter;
  texture.minFilter = THREE__namespace.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
const _SplatMesh = class _SplatMesh extends THREE__namespace.Object3D {
  constructor(options = {}) {
    var _a;
    super();
    this.isInitialized = false;
    this.numSplats = 0;
    this.recolor = new THREE__namespace.Color(1, 1, 1);
    this.opacity = 1;
    this.maxSh = 3;
    this.edits = null;
    this.sdfEdits = null;
    this.version = 0;
    this.sortVersion = 0;
    this.mappingVersion = 0;
    this.lastNumSplats = -1;
    this.lastMaxSh = -1;
    this.lastMatrixWorld = new THREE__namespace.Matrix4();
    this.hasLastMatrixWorld = false;
    this.lastRecolor = new THREE__namespace.Vector4().setScalar(Number.NaN);
    this.viewOrigin = new THREE__namespace.Vector3();
    this.lastViewOrigin = new THREE__namespace.Vector3().setScalar(Number.NaN);
    this.sdfCoordinateOrigin = new THREE__namespace.Vector3();
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
    const needsAsyncInitialization = Boolean(
      options.url || options.fileBytes || options.stream || options.constructSplats
    ) || Boolean(this.extSplats && !this.extSplats.isInitialized);
    if (needsAsyncInitialization) {
      this.initialized = this.asyncInitialize(options).then(async () => {
        var _a2;
        this.isInitialized = true;
        await ((_a2 = options.onLoad) == null ? void 0 : _a2.call(options, this));
        return this;
      });
    } else {
      this.isInitialized = true;
      const maybePromise = (_a = options.onLoad) == null ? void 0 : _a.call(options, this);
      this.initialized = maybePromise instanceof Promise ? maybePromise.then(() => this) : Promise.resolve(this);
    }
  }
  async asyncInitialize(options) {
    var _a;
    if (this.extSplats) {
      if (options.url || options.fileBytes || options.stream || options.constructSplats) {
        this.extSplats.reinitialize({
          url: options.url,
          fileBytes: options.fileBytes,
          fileType: options.fileType,
          fileName: options.fileName,
          stream: options.stream,
          streamLength: options.streamLength,
          maxSplats: options.maxSplats,
          construct: options.constructSplats,
          onProgress: options.onProgress
        });
      }
      await this.extSplats.initialized;
      this.splats = this.extSplats;
    }
    this.numSplats = ((_a = this.splats) == null ? void 0 : _a.getNumSplats()) ?? 0;
    this.updateMappingVersion();
  }
  pushSplat(center, scales, quaternion, opacity, color) {
    var _a;
    if (this.extSplats) {
      this.extSplats.pushSplat(center, scales, quaternion, opacity, color);
    }
    this.numSplats = ((_a = this.splats) == null ? void 0 : _a.getNumSplats()) ?? this.numSplats;
  }
  forEachSplat(callback) {
    var _a;
    (_a = this.splats) == null ? void 0 : _a.forEachSplat(callback);
  }
  dispose() {
    var _a, _b;
    (_a = this.sdfEdits) == null ? void 0 : _a.dispose();
    this.sdfEdits = null;
    (_b = this.splats) == null ? void 0 : _b.dispose();
    this.splats = void 0;
    this.extSplats = void 0;
  }
  getBoundingBox(centersOnly = true) {
    var _a;
    if (!this.isInitialized) {
      throw new Error(
        "Cannot get bounding box before SplatMesh is initialized"
      );
    }
    const minimum = new THREE__namespace.Vector3().setScalar(Number.POSITIVE_INFINITY);
    const maximum = new THREE__namespace.Vector3().setScalar(Number.NEGATIVE_INFINITY);
    const corner = new THREE__namespace.Vector3();
    const signs = [-1, 1];
    (_a = this.splats) == null ? void 0 : _a.forEachSplat((_index, center, scales, quaternion) => {
      if (centersOnly) {
        minimum.min(center);
        maximum.max(center);
        return;
      }
      for (const x of signs) {
        for (const y of signs) {
          for (const z of signs) {
            corner.set(x * scales.x, y * scales.y, z * scales.z).applyQuaternion(quaternion).add(center);
            minimum.min(corner);
            maximum.max(corner);
          }
        }
      }
    });
    return new THREE__namespace.Box3(minimum, maximum);
  }
  frameUpdate({ time, deltaTime, camera, globalEdits }) {
    var _a, _b;
    (_a = this.onFrame) == null ? void 0 : _a.call(this, { mesh: this, time, deltaTime });
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
        updated = true;
      }
    }
    this.updateWorldMatrix(true, false);
    if (!this.hasLastMatrixWorld || !this.lastMatrixWorld.equals(this.matrixWorld)) {
      this.lastMatrixWorld.copy(this.matrixWorld);
      this.hasLastMatrixWorld = true;
      updated = true;
      sortUpdated = true;
    }
    const recolor = new THREE__namespace.Vector4(
      this.recolor.r,
      this.recolor.g,
      this.recolor.b,
      this.opacity
    );
    if (!recolor.equals(this.lastRecolor)) {
      this.lastRecolor.copy(recolor);
      updated = true;
    }
    const edits = /* @__PURE__ */ new Set();
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
      (left, right) => left.ordering - right.ordering
    );
    const groups = orderedEdits.map((edit) => {
      if (edit.sdfs) return { edit, sdfs: edit.sdfs };
      const sdfs = [];
      edit.traverseVisible((node) => {
        if (node instanceof SplatEditSdf) sdfs.push(node);
      });
      return { edit, sdfs };
    });
    if (groups.length > 0 && !this.sdfEdits) {
      this.sdfEdits = new SplatEdits({
        maxEdits: groups.length,
        maxSdfs: groups.reduce((total, group) => total + group.sdfs.length, 0)
      });
      updated = true;
    }
    const sdfCoordinateOrigin = this.sdfCoordinateOrigin.setFromMatrixPosition(
      this.matrixWorld
    );
    if ((_b = this.sdfEdits) == null ? void 0 : _b.update(groups, sdfCoordinateOrigin).updated) {
      updated = true;
    }
    if (updated) {
      this.updateVersion({ sort: sortUpdated });
    }
  }
  updateVersion({ sort = true } = {}) {
    this.version += 1;
    if (sort) this.sortVersion += 1;
  }
  updateMappingVersion() {
    this.mappingVersion += 1;
    this.updateVersion();
  }
  set needsUpdate(value) {
    if (value) this.updateVersion();
  }
  raycast(raycaster, intersects) {
    if (!isInitialized() || !this.raycastable || !this.extSplats) {
      return;
    }
    const { near, far, ray } = raycaster;
    const worldToMesh = this.matrixWorld.clone().invert();
    const origin = ray.origin.clone().applyMatrix4(worldToMesh);
    const direction = ray.direction.clone().applyMatrix3(new THREE__namespace.Matrix3().setFromMatrix4(worldToMesh));
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
          count
        )
      );
    }
    for (const distance of _SplatMesh.raycastBuffer.subarray(
      0,
      intersectionCount
    )) {
      intersects.push({
        distance,
        point: ray.direction.clone().multiplyScalar(distance).add(ray.origin),
        object: this
      });
    }
  }
  appendRaycastBuffer(count, additional) {
    const total = count + additional.length;
    if (total > _SplatMesh.raycastBuffer.length) {
      let capacity = _SplatMesh.raycastBuffer.length;
      while (capacity < total) capacity *= 2;
      const next = new Float32Array(capacity);
      next.set(_SplatMesh.raycastBuffer.subarray(0, count));
      _SplatMesh.raycastBuffer = next;
    }
    _SplatMesh.raycastBuffer.set(additional, count);
    return total;
  }
};
_SplatMesh.raycastBuffer = new Float32Array(1024);
let SplatMesh = _SplatMesh;
var splatDefines_default = "const float LN_SCALE_MIN = -12.0;\nconst float LN_SCALE_MAX = 9.0;\n\nconst uint SPLAT_TEX_WIDTH_BITS = 11u;\nconst uint SPLAT_TEX_HEIGHT_BITS = 11u;\nconst uint SPLAT_TEX_LAYER_BITS = SPLAT_TEX_WIDTH_BITS + SPLAT_TEX_HEIGHT_BITS;\n\nconst uint SPLAT_TEX_WIDTH = 1u << SPLAT_TEX_WIDTH_BITS;\nconst uint SPLAT_TEX_HEIGHT = 1u << SPLAT_TEX_HEIGHT_BITS;\n\nconst uint SPLAT_TEX_WIDTH_MASK = SPLAT_TEX_WIDTH - 1u;\nconst uint SPLAT_TEX_HEIGHT_MASK = SPLAT_TEX_HEIGHT - 1u;\n\nconst float PI = 3.1415926535897932384626433832795;\n\nconst float INFINITY = 1.0 / 0.0;\n\nfloat sqr(float x) {\n    return x * x;\n}\n\nvec3 srgbToLinear(vec3 rgb) {\n    return pow(rgb, vec3(2.2));\n}\n\nuint encodeQuatOctXy88R8(vec4 q) {\n    \n    if (q.w < 0.0) {\n        q = -q;\n    }\n    \n    float theta = 2.0 * acos(q.w);\n    float halfTheta = theta * 0.5;\n    float s = sin(halfTheta);\n    \n    vec3 axis = (abs(s) < 1e-6) ? vec3(1.0, 0.0, 0.0) : q.xyz / s;\n    \n    \n    \n    float sum = abs(axis.x) + abs(axis.y) + abs(axis.z);\n    vec2 p = vec2(axis.x, axis.y) / sum;\n    \n    if (axis.z < 0.0) {\n        float oldPx = p.x;\n        p.x = (1.0 - abs(p.y)) * (p.x >= 0.0 ? 1.0 : -1.0);\n        p.y = (1.0 - abs(oldPx)) * (p.y >= 0.0 ? 1.0 : -1.0);\n    }\n    \n    float u_f = p.x * 0.5 + 0.5;\n    float v_f = p.y * 0.5 + 0.5;\n    \n    uint quantU = uint(clamp(round(u_f * 255.0), 0.0, 255.0));\n    uint quantV = uint(clamp(round(v_f * 255.0), 0.0, 255.0));\n    \n    \n    \n    uint angleInt = uint(clamp(round((theta / 3.14159265359) * 255.0), 0.0, 255.0));\n    \n    \n    return (angleInt << 16u) | (quantV << 8u) | quantU;\n}\n\nvec4 decodeQuatOctXy88R8(uint encoded) {\n    \n    uint quantU = encoded & uint(0xFFu);               \n    uint quantV = (encoded >> 8u) & uint(0xFFu);         \n    uint angleInt = encoded >> 16u;                      \n\n    \n    float u_f = float(quantU) / 255.0;\n    float v_f = float(quantV) / 255.0;\n    vec2 f = vec2(u_f * 2.0 - 1.0, v_f * 2.0 - 1.0);\n\n    vec3 axis = vec3(f.xy, 1.0 - abs(f.x) - abs(f.y));\n    float t = max(-axis.z, 0.0);\n    axis.x += (axis.x >= 0.0) ? -t : t;\n    axis.y += (axis.y >= 0.0) ? -t : t;\n    axis = normalize(axis);\n    \n    \n    float theta = (float(angleInt) / 255.0) * 3.14159265359;\n    float halfTheta = theta * 0.5;\n    float s = sin(halfTheta);\n    float w = cos(halfTheta);\n    \n    return vec4(axis * s, w);\n}\n\nuint encodeQuatOctXy1010R12(vec4 q) {\n    \n    if (q.w < 0.0) {\n        q = -q;\n    }\n    \n    float halfTheta = acos(q.w);\n    float theta = 2.0 * halfTheta;\n    float s = sin(halfTheta);\n    \n    vec3 axis = (abs(s) < 1e-6) ? vec3(1.0, 0.0, 0.0) : q.xyz / s;\n    \n    \n    \n    float sum = abs(axis.x) + abs(axis.y) + abs(axis.z);\n    vec2 p = vec2(axis.x, axis.y) / sum;\n    \n    if (axis.z < 0.0) {\n        float oldPx = p.x;\n        p.x = (1.0 - abs(p.y)) * (p.x >= 0.0 ? 1.0 : -1.0);\n        p.y = (1.0 - abs(oldPx)) * (p.y >= 0.0 ? 1.0 : -1.0);\n    }\n    \n    float u_f = p.x * 0.5 + 0.5;\n    float v_f = p.y * 0.5 + 0.5;\n    \n    uint quantU = uint(clamp(round(u_f * 1023.0), 0.0, 1023.0));\n    uint quantV = uint(clamp(round(v_f * 1023.0), 0.0, 1023.0));\n    \n    \n    \n    uint angleInt = uint(clamp(round((theta / PI) * 4095.0), 0.0, 4095.0));\n    \n    \n    return (angleInt << 20u) | (quantV << 10u) | quantU;\n}\n\nvec4 decodeQuatOctXy1010R12(uint encoded) {\n    \n    uint quantU = encoded & uint(0x3FFu);               \n    uint quantV = (encoded >> 10u) & uint(0x3FFu);         \n    uint angleInt = encoded >> 20u;                      \n\n    \n    float u_f = float(quantU) / 1023.0;\n    float v_f = float(quantV) / 1023.0;\n    vec2 f = vec2(u_f * 2.0 - 1.0, v_f * 2.0 - 1.0);\n\n    vec3 axis = vec3(f.xy, 1.0 - abs(f.x) - abs(f.y));\n    float t = max(-axis.z, 0.0);\n    axis.x += (axis.x >= 0.0) ? -t : t;\n    axis.y += (axis.y >= 0.0) ? -t : t;\n    axis = normalize(axis);\n    \n    \n    float theta = (float(angleInt) / 4095.0) * PI;\n    float halfTheta = theta * 0.5;\n    float s = sin(halfTheta);\n    float w = cos(halfTheta);\n    \n    return vec4(axis * s, w);\n}\n\nuvec4 packSplatEncoding(\n    vec3 center, vec3 scales, vec4 quaternion, vec4 rgba, vec4 rgbMinMaxLnScaleMinMax\n) {\n    float rgbMin = rgbMinMaxLnScaleMinMax.x;\n    float rgbMax = rgbMinMaxLnScaleMinMax.y;\n    vec3 encRgb = (rgba.rgb - vec3(rgbMin)) / (rgbMax - rgbMin);\n    uvec4 uRgba = uvec4(round(clamp(vec4(encRgb, rgba.a) * 255.0, 0.0, 255.0)));\n\n    uint uQuat = encodeQuatOctXy88R8(quaternion);\n    uvec3 uQuat3 = uvec3(uQuat & 0xffu, (uQuat >> 8u) & 0xffu, (uQuat >> 16u) & 0xffu);\n\n    \n    float lnScaleMin = rgbMinMaxLnScaleMinMax.z;\n    float lnScaleMax = rgbMinMaxLnScaleMinMax.w;\n    float lnScaleScale = 254.0 / (lnScaleMax - lnScaleMin);\n    uvec3 uScales = uvec3(\n        (scales.x == 0.0) ? 0u : uint(round(clamp((log(scales.x) - lnScaleMin) * lnScaleScale, 0.0, 254.0))) + 1u,\n        (scales.y == 0.0) ? 0u : uint(round(clamp((log(scales.y) - lnScaleMin) * lnScaleScale, 0.0, 254.0))) + 1u,\n        (scales.z == 0.0) ? 0u : uint(round(clamp((log(scales.z) - lnScaleMin) * lnScaleScale, 0.0, 254.0))) + 1u\n    );\n\n    \n    uint word0 = uRgba.r | (uRgba.g << 8u) | (uRgba.b << 16u) | (uRgba.a << 24u);\n    uint word1 = packHalf2x16(center.xy);\n    uint word2 = packHalf2x16(vec2(center.z, 0.0)) | (uQuat3.x << 16u) | (uQuat3.y << 24u);\n    uint word3 = uScales.x | (uScales.y << 8u) | (uScales.z << 16u) | (uQuat3.z << 24u);\n    return uvec4(word0, word1, word2, word3);\n}\n\nvoid unpackSplatEncoding(uvec4 packedData, out vec3 center, out vec3 scales, out vec4 quaternion, out vec4 rgba, vec4 rgbMinMaxLnScaleMinMax) {\n    uint word0 = packedData.x, word1 = packedData.y, word2 = packedData.z, word3 = packedData.w;\n\n    uvec4 uRgba = uvec4(word0 & 0xffu, (word0 >> 8u) & 0xffu, (word0 >> 16u) & 0xffu, (word0 >> 24u) & 0xffu);\n    float rgbMin = rgbMinMaxLnScaleMinMax.x;\n    float rgbMax = rgbMinMaxLnScaleMinMax.y;\n    rgba = (vec4(uRgba) / 255.0);\n    rgba.rgb = rgba.rgb * (rgbMax - rgbMin) + rgbMin;\n\n    center = vec4(\n        unpackHalf2x16(word1),\n        unpackHalf2x16(word2 & 0xffffu)\n    ).xyz;\n\n    uvec3 uScales = uvec3(word3 & 0xffu, (word3 >> 8u) & 0xffu, (word3 >> 16u) & 0xffu);\n    float lnScaleMin = rgbMinMaxLnScaleMinMax.z;\n    float lnScaleMax = rgbMinMaxLnScaleMinMax.w;\n    float lnScaleScale = (lnScaleMax - lnScaleMin) / 254.0;\n    scales = vec3(\n        (uScales.x == 0u) ? 0.0 : exp(lnScaleMin + float(uScales.x - 1u) * lnScaleScale),\n        (uScales.y == 0u) ? 0.0 : exp(lnScaleMin + float(uScales.y - 1u) * lnScaleScale),\n        (uScales.z == 0u) ? 0.0 : exp(lnScaleMin + float(uScales.z - 1u) * lnScaleScale)\n    );\n\n    uint uQuat = ((word2 >> 16u) & 0xFFFFu) | ((word3 >> 8u) & 0xFF0000u);\n    quaternion = decodeQuatOctXy88R8(uQuat);\n}\n\nvoid packSplatExt(\n    out uvec4 packedData, out uvec4 packedData2,\n    vec3 center, vec3 scales, vec4 quaternion, vec4 rgba\n) {\n    packedData.x = floatBitsToUint(center.x);\n    packedData.y = floatBitsToUint(center.y);\n    packedData.z = floatBitsToUint(center.z);\n    packedData.w = packHalf2x16(vec2(rgba.a, 0.0));\n\n    packedData2.x = packHalf2x16(rgba.rg);\n    packedData2.y = packHalf2x16(vec2(rgba.b, log(scales.x)));\n    packedData2.z = packHalf2x16(log(scales.yz));\n    packedData2.w = encodeQuatOctXy1010R12(quaternion);\n}\n\nfloat unpackSplatExtAlpha(uvec4 packedData) {\n    return unpackHalf2x16(packedData.w).x;\n}\n\nvoid unpackSplatExt(\n    uvec4 packedData, uvec4 packedData2,\n    out vec3 center, out vec3 scales, out vec4 quaternion, out vec4 rgba\n) {\n    center.x = uintBitsToFloat(packedData.x);\n    center.y = uintBitsToFloat(packedData.y);\n    center.z = uintBitsToFloat(packedData.z);\n    rgba.a = unpackHalf2x16(packedData.w).x;\n\n    rgba.rg = unpackHalf2x16(packedData2.x);\n    vec2 split = unpackHalf2x16(packedData2.y);\n    rgba.b = split.x;\n    scales.x = exp(split.y);\n    scales.yz = exp(unpackHalf2x16(packedData2.z));\n    quaternion = decodeQuatOctXy1010R12(packedData2.w);\n}\n\nvec3 decodeExtRgb(uint encoded) {\n    uint biasedBase = (encoded >> 27u) & 0x1fu;\n    float divisor = exp2(float(int(biasedBase) - 15)) / 255.0;\n\n    vec3 rgb = vec3(uvec3(encoded & 0xffu, (encoded >> 8u) & 0xffu, (encoded >> 16u) & 0xffu));\n    rgb *= divisor;\n\n    return vec3(\n        ((encoded & 0x1000000u) != 0u) ? -rgb.r : rgb.r,\n        ((encoded & 0x2000000u) != 0u) ? -rgb.g : rgb.g,\n        ((encoded & 0x4000000u) != 0u) ? -rgb.b : rgb.b\n    );\n}\n\nvec3 quatVec(vec4 q, vec3 v) {\n    \n    vec3 t = 2.0 * cross(q.xyz, v);\n    return v + q.w * t + cross(q.xyz, t);\n}\n\nvec4 quatQuat(vec4 q1, vec4 q2) {\n    return vec4(\n        q1.w * q2.x + q1.x * q2.w + q1.y * q2.z - q1.z * q2.y,\n        q1.w * q2.y - q1.x * q2.z + q1.y * q2.w + q1.z * q2.x,\n        q1.w * q2.z + q1.x * q2.y - q1.y * q2.x + q1.z * q2.w,\n        q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z\n    );\n}\n\nmat3 scaleQuaternionToMatrix(vec3 s, vec4 q) {\n    \n    return mat3(\n        s.x * (1.0 - 2.0 * (q.y * q.y + q.z * q.z)),\n        s.x * (2.0 * (q.x * q.y + q.w * q.z)),\n        s.x * (2.0 * (q.x * q.z - q.w * q.y)),\n        s.y * (2.0 * (q.x * q.y - q.w * q.z)),\n        s.y * (1.0 - 2.0 * (q.x * q.x + q.z * q.z)),\n        s.y * (2.0 * (q.y * q.z + q.w * q.x)),\n        s.z * (2.0 * (q.x * q.z + q.w * q.y)),\n        s.z * (2.0 * (q.y * q.z - q.w * q.x)),\n        s.z * (1.0 - 2.0 * (q.x * q.x + q.y * q.y))\n    );\n}\n\nivec3 splatTexCoord(int index) {\n    uint x = uint(index) & SPLAT_TEX_WIDTH_MASK;\n    uint y = (uint(index) >> SPLAT_TEX_WIDTH_BITS) & SPLAT_TEX_HEIGHT_MASK;\n    uint z = uint(index) >> SPLAT_TEX_LAYER_BITS;\n    return ivec3(x, y, z);\n}";
var splatFragment_default = "precision highp float;\nprecision highp int;\n\n#include <splatDefines>\n\nuniform float near;\nuniform float far;\nuniform bool encodeLinear;\nuniform float time;\nuniform bool debugFlag;\nuniform float minAlpha;\n\nout vec4 fragColor;\n\nin vec4 vRgba;\nin vec2 vSplatUv;\nin vec3 vNdc;\nflat in uint vSplatIndex;\nflat in float adjustedStdDev;\nflat in float vSplatShape;\n\n#include <logdepthbuf_pars_fragment>\n\nvoid main() {\n    vec4 rgba = vRgba;\n\n    float z2 = dot(vSplatUv, vSplatUv);\n    if (z2 > (adjustedStdDev * adjustedStdDev)) {\n        discard;\n    }\n\n    float splatShape = vSplatShape;\n    if (splatShape <= 1.0) {\n        rgba.a *= exp(-0.5 * z2);\n    } else {\n        float a = exp((splatShape*splatShape - 1.0) / 2.718281828459045);\n        float alpha = 1.0 - pow(1.0 - exp(-0.5 * z2), a);\n        rgba.a *= alpha;\n    }\n\n    if (rgba.a < minAlpha) {\n        discard;\n    }\n    if (encodeLinear) {\n        rgba.rgb = srgbToLinear(rgba.rgb);\n    }\n\n    #ifdef PREMULTIPLIED_ALPHA\n        fragColor = vec4(rgba.rgb * rgba.a, rgba.a);\n    #else\n        fragColor = rgba;\n    #endif\n\n    #include <logdepthbuf_fragment>\n}";
var splatVertex_default = "precision highp float;\nprecision highp int;\nprecision highp sampler2DArray;\nprecision highp usampler2DArray;\n\n#include <splatDefines>\n\nout vec4 vRgba;\nout vec2 vSplatUv;\nout vec3 vNdc;\nflat out uint vSplatIndex;\nflat out float adjustedStdDev;\nflat out float vSplatShape;\n\nuniform vec2 renderSize;\nuniform vec4 renderToViewQuat;\nuniform vec3 renderToViewPos;\n\nuniform float renderToViewScale;\nuniform float maxStdDev;\nuniform float minPixelRadius;\nuniform float maxPixelRadius;\nuniform bool enableExtSplats;\nuniform float time;\nuniform float deltaTime;\nuniform bool debugFlag;\nuniform float minAlpha;\nuniform bool enable2DGS;\nuniform float blurAmount;\nuniform float preBlurAmount;\nuniform float focalDistance;\nuniform float apertureAngle;\nuniform float clipXY;\nuniform float focalAdjustment;\n\nuniform usampler2D ordering;\nuniform usampler2DArray extSplats;\nuniform usampler2DArray extSplats2;\nuniform sampler2DArray splatShape;\n\nbool isPerspectiveMatrix( mat4 m ) {\n    return m[ 2 ][ 3 ] == -1.0;\n}\n\n#include <logdepthbuf_pars_vertex>\n\nvoid main() {\n    \n    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);\n\n    ivec2 orderingCoord = ivec2((gl_InstanceID >> 2) & 4095, gl_InstanceID >> 14);\n    uint splatIndex = texelFetch(ordering, orderingCoord, 0)[gl_InstanceID & 3];\n    if (splatIndex == 0xffffffffu) {\n        \n        return;\n    }\n\n    ivec3 texCoord = splatTexCoord(int(splatIndex));\n    vec3 center, scales;\n    vec4 quaternion, rgba;\n    float opacity;\n    mat3 cov3D;\n    bvec3 zeroScales = bvec3(false);\n\n    if (enableExtSplats) {\n        uvec4 ext1 = texelFetch(extSplats, texCoord, 0);\n        opacity = unpackSplatExtAlpha(ext1);\n        if ((opacity == 0.0) || (opacity < minAlpha)) {\n            return;\n        }\n        uvec4 ext2 = texelFetch(extSplats2, texCoord, 0);\n\n        unpackSplatExt(ext1, ext2, center, scales, quaternion, rgba);\n        zeroScales = equal(scales, vec3(0.0));\n        if (all(zeroScales)) {\n            return;\n        }\n    } else {\n        uvec4 packedData = texelFetch(extSplats, texCoord, 0);\n        unpackSplatEncoding(packedData, center, scales, quaternion, rgba, vec4(0.0, 1.0, LN_SCALE_MIN, LN_SCALE_MAX));\n        zeroScales = equal(scales, vec3(0.0));\n        if (all(zeroScales)) {\n            return;\n        }\n\n        rgba.a *= 2.0;\n        opacity = rgba.a;\n        if ((opacity == 0.0) || (opacity < minAlpha)) {\n            return;\n        }\n    }\n\n    rgba.rgb = max(rgba.rgb, vec3(0.0));\n\n    \n    \n    float shape = 1.0 + texelFetch(splatShape, texCoord, 0).r;\n    if (shape > 1.0) {\n        \n        shape = min(shape * 4.0 - 3.0, 5.0);\n    }\n    vSplatShape = shape;\n\n    \n    adjustedStdDev = maxStdDev + 0.7 * max(shape - 1.0, 0.0);\n\n    scales *= renderToViewScale;\n    \n    vec3 viewCenter = renderToViewScale * quatVec(renderToViewQuat, center) + renderToViewPos;\n\n    \n    if (viewCenter.z >= 0.0) {\n        return;\n    }\n\n    \n    vec4 clipCenter = projectionMatrix * vec4(viewCenter, 1.0);\n\n    \n    if (abs(clipCenter.z) >= clipCenter.w) {\n        return;\n    }\n\n    \n    float clip = clipXY * clipCenter.w;\n    if (abs(clipCenter.x) > clip || abs(clipCenter.y) > clip) {\n        return;\n    }\n\n    vRgba = vec4(rgba.rgb, opacity);\n    vSplatUv = position.xy * adjustedStdDev;\n\n    \n    vSplatIndex = splatIndex;\n\n    \n    vec4 viewQuaternion = quatQuat(renderToViewQuat, quaternion);\n\n    if (enable2DGS && any(zeroScales)) {\n        vec3 offset;\n        if (zeroScales.z) {\n            offset = vec3(vSplatUv.xy * scales.xy, 0.0);\n        } else if (zeroScales.y) {\n            offset = vec3(vSplatUv.x * scales.x, 0.0, vSplatUv.y * scales.z);\n        } else {\n            offset = vec3(0.0, vSplatUv.xy * scales.yz);\n        }\n\n        vec3 viewPos = viewCenter + quatVec(viewQuaternion, offset);\n        gl_Position = projectionMatrix * vec4(viewPos, 1.0);\n        vNdc = gl_Position.xyz / gl_Position.w;\n\n        #include <logdepthbuf_vertex>\n        return;\n    }\n\n    \n    mat3 RS = scaleQuaternionToMatrix(scales, viewQuaternion);\n    cov3D = RS * transpose(RS);\n\n    \n    vec2 scaledRenderSize = renderSize * focalAdjustment;\n    vec2 focal = 0.5 * scaledRenderSize * vec2(projectionMatrix[0][0], projectionMatrix[1][1]);\n\n    mat3 J;\n    if (isOrthographic) {\n        J = mat3(\n            focal.x, 0.0, 0.0,\n            0.0, focal.y, 0.0,\n            0.0, 0.0, 0.0\n        );\n    } else {\n        float invZ = 1.0 / viewCenter.z;\n        vec2 J1 = focal * invZ;\n        vec2 J2 = -(J1 * viewCenter.xy) * invZ;\n        J = mat3(\n            J1.x, 0.0, J2.x,\n            0.0, J1.y, J2.y,\n            0.0, 0.0, 0.0\n        );\n    }\n\n    \n    \n    mat3 cov2D = transpose(J) * cov3D * J;\n    float a = cov2D[0][0];\n    float d = cov2D[1][1];\n    float b = cov2D[0][1];\n\n    \n    a += preBlurAmount;\n    d += preBlurAmount;\n\n    float fullBlurAmount = blurAmount;\n    if ((focalDistance > 0.0) && (apertureAngle > 0.0)) {\n        float focusRadius = maxPixelRadius;\n        if (viewCenter.z < 0.0) {\n            float focusBlur = abs((-viewCenter.z - focalDistance) / viewCenter.z);\n            float apertureRadius = focal.x * tan(0.5 * apertureAngle);\n            focusRadius = focusBlur * apertureRadius;\n        }\n        fullBlurAmount = clamp(sqr(focusRadius), blurAmount, sqr(maxPixelRadius));\n    }\n\n    \n    float detOrig = a * d - b * b;\n    a += fullBlurAmount;\n    d += fullBlurAmount;\n    float det = a * d - b * b;\n\n    \n    float blurAdjust = sqrt(max(0.0, detOrig / det));\n    opacity *= blurAdjust;\n    if (opacity < minAlpha) {\n        return;\n    }\n    vRgba.a = opacity;\n\n    \n    float eigenAvg = 0.5 * (a + d);\n    float eigenDelta = sqrt(max(0.0, eigenAvg * eigenAvg - det));\n    float eigen1 = eigenAvg + eigenDelta;\n    float eigen2 = eigenAvg - eigenDelta;\n\n    vec2 eigenVec1 = (abs(b) > 0.001) ? normalize(vec2(b, eigen1 - a))\n        : ((a >= d) ? vec2(1.0, 0.0) : vec2(0.0, 1.0));\n    vec2 eigenVec2 = vec2(eigenVec1.y, -eigenVec1.x);\n\n    float scale1 = min(maxPixelRadius, adjustedStdDev * sqrt(eigen1));\n    float scale2 = min(maxPixelRadius, adjustedStdDev * sqrt(eigen2));\n    if (scale1 < minPixelRadius && scale2 < minPixelRadius) {\n        return;\n    }\n\n    \n    vec2 pixelOffset = position.x * eigenVec1 * scale1 + position.y * eigenVec2 * scale2;\n    vec2 ndcOffset = (2.0 / scaledRenderSize) * pixelOffset;\n\n    \n    vec3 ndcCenter = clipCenter.xyz / clipCenter.w;\n    vec3 ndc = vec3(ndcCenter.xy + ndcOffset, ndcCenter.z);\n\n    vNdc = ndc;\n    gl_Position = vec4(ndc.xy * clipCenter.w, clipCenter.zw);\n\n    #include <logdepthbuf_vertex>\n}";
let shaders = null;
function getShaders() {
  if (!shaders) {
    THREE__namespace.ShaderChunk.splatDefines = splatDefines_default;
    shaders = {
      splatVertex: splatVertex_default,
      splatFragment: splatFragment_default
    };
  }
  return shaders;
}
var splatGenerate_default = "precision highp float;\nprecision highp int;\nprecision highp usampler2D;\nprecision highp usampler2DArray;\n\n#include <splatDefines>\n\nuniform uint targetLayer;\nuniform int targetBase;\nuniform int targetCount;\n\nuniform usampler2DArray sourceSplats;\nuniform usampler2DArray sourceSplats2;\n\nuniform int numSh;\nuniform usampler2DArray sh1Texture;\nuniform usampler2DArray sh2Texture;\nuniform usampler2DArray sh3TextureA;\nuniform usampler2DArray sh3TextureB;\n\nuniform mat3 objectBasis;\nuniform vec3 objectOffset;\nuniform vec3 objectScale;\nuniform vec4 objectQuaternion;\nuniform vec4 recolor;\n\nuniform int numSdfs;\nuniform int numEdits;\nuniform usampler2D sdfTexture;\nuniform usampler2D editTexture;\n\n#ifdef OUTPUT_EXT\nlayout(location = 0) out uvec4 target;\nlayout(location = 1) out uvec4 target2;\nlayout(location = 2) out vec4 targetShape;\n#else\nlayout(location = 0) out uvec4 target;\nlayout(location = 1) out vec4 targetShape;\n#endif\n\nvec3 evaluateExtSH1(uvec4 data, vec3 direction) {\n    return decodeExtRgb(data.x) * (-0.4886025 * direction.y)\n        + decodeExtRgb(data.y) * (0.4886025 * direction.z)\n        + decodeExtRgb(data.z) * (-0.4886025 * direction.x);\n}\n\nvec3 evaluateExtSH12(uvec4 first, uvec4 second, vec3 direction) {\n    vec3 result = evaluateExtSH1(first, direction);\n    result += decodeExtRgb(first.w) * (1.0925484 * direction.x * direction.y);\n    result += decodeExtRgb(second.x) * (-1.0925484 * direction.y * direction.z);\n    result += decodeExtRgb(second.y) * (0.3153915 * (2.0 * direction.z * direction.z - direction.x * direction.x - direction.y * direction.y));\n    result += decodeExtRgb(second.z) * (-1.0925484 * direction.x * direction.z);\n    result += decodeExtRgb(second.w) * (0.5462742 * (direction.x * direction.x - direction.y * direction.y));\n    return result;\n}\n\nvec3 evaluateExtSH3(uvec4 first, uvec4 second, vec3 direction) {\n    float xx = direction.x * direction.x;\n    float yy = direction.y * direction.y;\n    float zz = direction.z * direction.z;\n    return decodeExtRgb(first.x) * (-0.5900436 * direction.y * (3.0 * xx - yy))\n        + decodeExtRgb(first.y) * (2.8906114 * direction.x * direction.y * direction.z)\n        + decodeExtRgb(first.z) * (-0.4570458 * direction.y * (4.0 * zz - xx - yy))\n        + decodeExtRgb(first.w) * (0.3731763 * direction.z * (2.0 * zz - 3.0 * xx - 3.0 * yy))\n        + decodeExtRgb(second.x) * (-0.4570458 * direction.x * (4.0 * zz - xx - yy))\n        + decodeExtRgb(second.y) * (1.4453057 * direction.z * (xx - yy))\n        + decodeExtRgb(second.z) * (-0.5900436 * direction.x * (xx - 3.0 * yy));\n}\n\nvec3 evaluateSH(ivec3 coord, vec3 direction) {\n    vec3 result = vec3(0.0);\n    if (numSh == 1) {\n        result = evaluateExtSH1(texelFetch(sh1Texture, coord, 0), direction);\n    } else if (numSh >= 2) {\n        result = evaluateExtSH12(\n            texelFetch(sh1Texture, coord, 0),\n            texelFetch(sh2Texture, coord, 0),\n            direction\n        );\n        if (numSh >= 3) {\n            result += evaluateExtSH3(\n                texelFetch(sh3TextureA, coord, 0),\n                texelFetch(sh3TextureB, coord, 0),\n                direction\n            );\n        }\n    }\n    return result;\n}\n\nvoid unpackSdf(\n    int index,\n    out uint flags,\n    out vec3 center,\n    out vec4 quaternion,\n    out vec3 scale,\n    out vec4 sizes,\n    out vec4 sdfRgba\n) {\n    uvec4 data = texelFetch(sdfTexture, ivec2(0, index), 0);\n    center = vec3(uintBitsToFloat(data.x), uintBitsToFloat(data.y), uintBitsToFloat(data.z));\n    flags = data.w;\n    data = texelFetch(sdfTexture, ivec2(1, index), 0);\n    quaternion = vec4(uintBitsToFloat(data.x), uintBitsToFloat(data.y), uintBitsToFloat(data.z), uintBitsToFloat(data.w));\n    data = texelFetch(sdfTexture, ivec2(2, index), 0);\n    scale = vec3(uintBitsToFloat(data.x), uintBitsToFloat(data.y), uintBitsToFloat(data.z));\n    data = texelFetch(sdfTexture, ivec2(3, index), 0);\n    sizes = vec4(uintBitsToFloat(data.x), uintBitsToFloat(data.y), uintBitsToFloat(data.z), uintBitsToFloat(data.w));\n    data = texelFetch(sdfTexture, ivec2(4, index), 0);\n    sdfRgba = vec4(uintBitsToFloat(data.x), uintBitsToFloat(data.y), uintBitsToFloat(data.z), uintBitsToFloat(data.w));\n}\n\nfloat sdfDistance(uint type, vec3 position, vec4 sizes) {\n    switch (type) {\n        case 0u: return -INFINITY;\n        case 1u: return position.z;\n        case 2u: return length(position) - sizes.w;\n        case 3u: {\n            vec3 q = abs(position) - sizes.xyz + sizes.w;\n            return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - sizes.w;\n        }\n        case 4u: {\n            float k0 = length(position / sizes.xyz);\n            float k1 = length(position / dot(sizes.xyz, sizes.xyz));\n            return k0 * (k0 - 1.0) / k1;\n        }\n        case 5u: {\n            vec2 d = abs(vec2(length(position.xz), position.y)) - sizes.wy;\n            return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));\n        }\n        case 6u: {\n            position.y -= clamp(position.y, -0.5 * sizes.y, 0.5 * sizes.y);\n            return length(position) - sizes.w;\n        }\n        case 7u: {\n            float angle = 0.25 * PI * sizes.w;\n            vec2 c = vec2(sin(angle), cos(angle));\n            vec2 q = vec2(length(position.xy), -position.z);\n            float distance = length(q - c * max(dot(q, c), 0.0));\n            return distance * (((q.x * c.y - q.y * c.x) < 0.0) ? -1.0 : 1.0);\n        }\n    }\n    return INFINITY;\n}\n\nfloat evaluateSdfs(\n    int sdfFirst,\n    int sdfCount,\n    vec3 position,\n    float smoothAmount,\n    out vec4 resultRgba\n) {\n    float distanceAccum = smoothAmount == 0.0 ? INFINITY : 0.0;\n    float maxExponent = -INFINITY;\n    resultRgba = vec4(0.0);\n    int sdfLast = min(sdfFirst + sdfCount, numSdfs);\n\n    for (int index = sdfFirst; index < sdfLast; ++index) {\n        uint flags;\n        vec3 center;\n        vec4 quaternion;\n        vec3 scale;\n        vec4 sizes;\n        vec4 value;\n        unpackSdf(index, flags, center, quaternion, scale, sizes, value);\n        vec3 sdfPosition = quatVec(quaternion, position * scale) + center;\n        float distance = sdfDistance(flags & 0xffu, sdfPosition, sizes);\n        if ((flags & 0x100u) != 0u) distance = -distance;\n\n        if (smoothAmount == 0.0) {\n            if (distance < distanceAccum) {\n                distanceAccum = distance;\n                resultRgba = value;\n            }\n        } else {\n            float exponent = -distance / smoothAmount;\n            if (exponent > maxExponent) {\n                float rescale = exp(maxExponent - exponent);\n                distanceAccum *= rescale;\n                resultRgba *= rescale;\n                maxExponent = exponent;\n            }\n            float weight = exp(exponent - maxExponent);\n            distanceAccum += weight;\n            resultRgba += weight * value;\n        }\n    }\n\n    if (smoothAmount == 0.0 || distanceAccum == 0.0) {\n        return distanceAccum == 0.0 ? INFINITY : distanceAccum;\n    }\n    resultRgba /= distanceAccum;\n    return (-log(distanceAccum) - maxExponent) * smoothAmount;\n}\n\nvoid applySdfEdits(vec3 position, inout vec4 rgba) {\n    for (int editIndex = 0; editIndex < numEdits; ++editIndex) {\n        uvec4 edit = texelFetch(editTexture, ivec2(0, editIndex), 0);\n        uint blendMode = edit.x & 0xffu;\n        bool invert = (edit.x & 0x100u) != 0u;\n        int sdfFirst = int(edit.y & 0xffffu);\n        int sdfCount = int(edit.y >> 16u);\n        float softEdge = uintBitsToFloat(edit.z);\n        float smoothAmount = uintBitsToFloat(edit.w);\n\n        vec4 sdfRgba;\n        float distance = evaluateSdfs(sdfFirst, sdfCount, position, smoothAmount, sdfRgba);\n        if (invert) distance = -distance;\n        float amount = softEdge == 0.0\n            ? (distance < 0.0 ? 1.0 : 0.0)\n            : clamp(-distance / softEdge + 0.5, 0.0, 1.0);\n        vec4 target = blendMode == 0u ? rgba * sdfRgba : rgba + sdfRgba;\n        rgba = mix(rgba, target, amount);\n    }\n}\n\nvoid produceSplat(int index) {\n    ivec3 coord = splatTexCoord(index);\n    vec3 center;\n    vec3 scales;\n    vec4 quaternion;\n    vec4 rgba;\n    unpackSplatExt(\n        texelFetch(sourceSplats, coord, 0),\n        texelFetch(sourceSplats2, coord, 0),\n        center,\n        scales,\n        quaternion,\n        rgba\n    );\n    if (all(equal(scales, vec3(0.0)))) return;\n\n    float sourceAlpha = rgba.a;\n    rgba.a = min(sourceAlpha, 1.0);\n\n    \n    \n    \n    center = objectBasis * center;\n    if (numSh > 0) {\n        vec3 worldViewDirection = center + objectOffset;\n        vec4 inverseObjectQuaternion = vec4(-objectQuaternion.xyz, objectQuaternion.w);\n        vec3 sourceViewDirection = normalize(quatVec(inverseObjectQuaternion, worldViewDirection));\n        rgba.rgb += evaluateSH(coord, sourceViewDirection);\n    }\n    scales *= objectScale;\n    quaternion = quatQuat(objectQuaternion, quaternion);\n\n    vec3 editPosition = center;\n    center += objectOffset;\n\n    applySdfEdits(editPosition, rgba);\n    vec3 relativeCenter = center;\n    \n    \n    \n    rgba *= vec4(recolor.rgb, clamp(recolor.a, 0.0, 1.0));\n\n#ifdef OUTPUT_EXT\n    packSplatExt(target, target2, relativeCenter, scales, quaternion, rgba);\n#else\n    vec4 packedRgba = vec4(rgba.rgb, rgba.a * 0.5);\n    target = packSplatEncoding(relativeCenter, scales, quaternion, packedRgba, vec4(0.0, 1.0, LN_SCALE_MIN, LN_SCALE_MAX));\n#endif\n\n    targetShape = vec4(clamp(sourceAlpha - 1.0, 0.0, 1.0), 0.0, 0.0, 1.0);\n}\n\nvoid main() {\n    int targetIndex = int(targetLayer << SPLAT_TEX_LAYER_BITS)\n        + int(uint(gl_FragCoord.y) << SPLAT_TEX_WIDTH_BITS)\n        + int(gl_FragCoord.x);\n    int index = targetIndex - targetBase;\n\n    target = uvec4(0u);\n#ifdef OUTPUT_EXT\n    target2 = uvec4(0u);\n#endif\n    targetShape = vec4(0.0, 0.0, 0.0, 1.0);\n    if (index >= 0 && index < targetCount) {\n        produceSplat(index);\n    }\n}";
const rotationMatrix = new THREE__namespace.Matrix4();
const axisX = new THREE__namespace.Vector3();
const axisY = new THREE__namespace.Vector3();
const axisZ = new THREE__namespace.Vector3();
const sourceAxis = new THREE__namespace.Vector3();
function decomposeSplatTransform(matrix, scale, rotation) {
  const source = matrix.elements;
  const sx = Math.hypot(source[0], source[1], source[2]);
  const sy = Math.hypot(source[4], source[5], source[6]);
  const sz = Math.hypot(source[8], source[9], source[10]);
  scale.set(sx, sy, sz);
  axisX.set(source[0], source[1], source[2]);
  axisY.set(source[4], source[5], source[6]);
  axisZ.set(source[8], source[9], source[10]);
  if (sx > 0) axisX.multiplyScalar(1 / sx);
  if (sy > 0) axisY.multiplyScalar(1 / sy);
  if (sz > 0) axisZ.multiplyScalar(1 / sz);
  const nonZeroAxes = Number(sx > 0) + Number(sy > 0) + Number(sz > 0);
  if (nonZeroAxes === 0) {
    rotation.identity();
    return;
  }
  if (nonZeroAxes === 1) {
    const localAxis = sx > 0 ? 0 : sy > 0 ? 1 : 2;
    sourceAxis.set(
      localAxis === 0 ? 1 : 0,
      localAxis === 1 ? 1 : 0,
      localAxis === 2 ? 1 : 0
    );
    rotation.setFromUnitVectors(
      sourceAxis,
      localAxis === 0 ? axisX : localAxis === 1 ? axisY : axisZ
    ).normalize();
    return;
  }
  if (sx === 0) axisX.copy(axisY).cross(axisZ).normalize();
  if (sy === 0) axisY.copy(axisZ).cross(axisX).normalize();
  if (sz === 0) axisZ.copy(axisX).cross(axisY).normalize();
  if (matrix.determinant() < 0) axisX.negate();
  rotationMatrix.makeBasis(axisX, axisY, axisZ);
  rotation.setFromRotationMatrix(rotationMatrix).normalize();
}
const _SplatAccumulator = class _SplatAccumulator {
  constructor({ extSplats = true } = {}) {
    this.time = 0;
    this.deltaTime = 0;
    this.viewOrigin = new THREE__namespace.Vector3();
    this.viewDirection = new THREE__namespace.Vector3();
    this.maxSplats = 0;
    this.numSplats = 0;
    this.target = null;
    this.mapping = [];
    this.version = -1;
    this.mappingVersion = -1;
    this.transformScale = new THREE__namespace.Vector3();
    this.transformQuaternion = new THREE__namespace.Quaternion();
    if (!threeMrtArray) {
      throw new Error("Gaussian Splat Lite requires THREE.js r179 or above");
    }
    this.extSplats = extSplats;
  }
  dispose() {
    var _a;
    (_a = this.target) == null ? void 0 : _a.dispose();
    this.target = null;
  }
  getTextures() {
    var _a;
    return ((_a = this.target) == null ? void 0 : _a.textures) ?? _SplatAccumulator.emptyTextures;
  }
  getSplatShapeTexture() {
    var _a;
    return ((_a = this.target) == null ? void 0 : _a.textures[this.extSplats ? 2 : 1]) ?? _SplatAccumulator.emptySplatShape;
  }
  generateMapping(splatCounts) {
    let maxSplats = 0;
    const mapping = splatCounts.map((count) => {
      const base = maxSplats;
      maxSplats += Math.ceil(count / SPLAT_TEX_WIDTH) * SPLAT_TEX_WIDTH;
      return { base, count };
    });
    return { maxSplats, mapping };
  }
  ensureGenerate({ maxSplats }) {
    if (this.target && Math.max(1, maxSplats) <= this.maxSplats) {
      return false;
    }
    this.dispose();
    const textureSize = getTextureSize(Math.max(1, maxSplats));
    const { width, height, depth } = textureSize;
    this.maxSplats = textureSize.maxSplats;
    this.target = new THREE__namespace.WebGLArrayRenderTarget(width, height, depth, {
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      magFilter: THREE__namespace.NearestFilter,
      minFilter: THREE__namespace.NearestFilter,
      format: THREE__namespace.RGBAIntegerFormat,
      type: THREE__namespace.UnsignedIntType
    });
    this.target.scissorTest = true;
    const shape = this.target.texture.clone();
    shape.format = THREE__namespace.RedFormat;
    shape.type = THREE__namespace.UnsignedByteType;
    shape.internalFormat = "R8";
    if (this.extSplats) {
      const second = this.target.texture.clone();
      this.target.textures = [this.target.texture, second, shape];
    } else {
      this.target.textures = [this.target.texture, shape];
    }
    return true;
  }
  getMaterial() {
    const key = this.extSplats ? "ext" : "packed";
    let material = _SplatAccumulator.materials.get(key);
    if (!material) {
      getShaders();
      const defines2 = {};
      if (this.extSplats) defines2.OUTPUT_EXT = "1";
      material = new THREE__namespace.RawShaderMaterial({
        glslVersion: THREE__namespace.GLSL3,
        vertexShader: IDENT_VERTEX_SHADER,
        fragmentShader: splatGenerate_default,
        uniforms: makeGenerateUniforms(),
        defines: defines2,
        depthTest: false,
        depthWrite: false
      });
      _SplatAccumulator.materials.set(key, material);
    }
    return material;
  }
  prepareMaterial(mesh) {
    const source = mesh.splats;
    if (!source) {
      throw new Error("SplatMesh has no source");
    }
    const material = this.getMaterial();
    const uniforms = material.uniforms;
    const [sourceSplats, sourceSplats2] = source.getSplatTextures();
    const sh = source.getShTextures();
    source.needsUpdate = false;
    uniforms.sourceSplats.value = sourceSplats;
    uniforms.sourceSplats2.value = sourceSplats2;
    uniforms.numSh.value = Math.min(mesh.maxSh, source.getNumSh());
    uniforms.sh1Texture.value = sh.sh1 ?? _SplatAccumulator.emptyTexture;
    uniforms.sh2Texture.value = sh.sh2 ?? _SplatAccumulator.emptyTexture;
    uniforms.sh3TextureA.value = sh.sh3a ?? _SplatAccumulator.emptyTexture;
    uniforms.sh3TextureB.value = sh.sh3b ?? _SplatAccumulator.emptyTexture;
    decomposeSplatTransform(
      mesh.matrixWorld,
      this.transformScale,
      this.transformQuaternion
    );
    uniforms.objectBasis.value.setFromMatrix4(mesh.matrixWorld);
    uniforms.objectOffset.value.setFromMatrixPosition(mesh.matrixWorld);
    uniforms.objectOffset.value.sub(this.viewOrigin);
    uniforms.objectScale.value.copy(this.transformScale);
    uniforms.objectQuaternion.value.copy(this.transformQuaternion);
    uniforms.recolor.value.set(
      mesh.recolor.r,
      mesh.recolor.g,
      mesh.recolor.b,
      mesh.opacity
    );
    const edits = mesh.sdfEdits;
    uniforms.numSdfs.value = (edits == null ? void 0 : edits.numSdfs) ?? 0;
    uniforms.numEdits.value = (edits == null ? void 0 : edits.numEdits) ?? 0;
    uniforms.sdfTexture.value = (edits == null ? void 0 : edits.sdfTexture) ?? SplatEdits.emptyTexture;
    uniforms.editTexture.value = (edits == null ? void 0 : edits.editTexture) ?? SplatEdits.emptyTexture;
    _SplatAccumulator.fullScreenQuad.material = material;
    return material;
  }
  generate({
    mesh,
    base,
    count,
    renderer
  }) {
    if (!this.target) throw new Error("Accumulator target is not initialized");
    if (base + count > this.maxSplats) {
      throw new Error("Splat generation range exceeds accumulator capacity");
    }
    const material = this.prepareMaterial(mesh);
    const uniforms = material.uniforms;
    const renderState = this.saveRenderState(renderer);
    const nextBase = Math.ceil((base + count) / SPLAT_TEX_WIDTH) * SPLAT_TEX_WIDTH;
    const layerSize = SPLAT_TEX_WIDTH * SPLAT_TEX_HEIGHT;
    uniforms.targetBase.value = base;
    uniforms.targetCount.value = count;
    while (base < nextBase) {
      const layer = Math.floor(base / layerSize);
      uniforms.targetLayer.value = layer;
      const layerBase = layer * layerSize;
      const yStart = Math.floor((base - layerBase) / SPLAT_TEX_WIDTH);
      const yEnd = Math.min(
        SPLAT_TEX_HEIGHT,
        Math.ceil((nextBase - layerBase) / SPLAT_TEX_WIDTH)
      );
      this.target.scissor.set(0, yStart, SPLAT_TEX_WIDTH, yEnd - yStart);
      renderer.setRenderTarget(this.target, layer);
      renderer.xr.enabled = false;
      renderer.autoClear = false;
      _SplatAccumulator.fullScreenQuad.render(renderer);
      base += SPLAT_TEX_WIDTH * (yEnd - yStart);
    }
    this.resetRenderState(renderer, renderState);
  }
  prepareGenerate({
    renderer,
    scene,
    timer,
    camera,
    previous
  }) {
    camera.getWorldPosition(this.viewOrigin);
    camera.getWorldDirection(this.viewDirection);
    this.time = timer.getElapsed();
    this.deltaTime = timer.getDelta();
    const allMeshes = [];
    scene.traverse((node) => {
      if (node instanceof SplatMesh && camera.layers.test(node.layers)) {
        allMeshes.push(node);
      }
    });
    const globalEdits = /* @__PURE__ */ new Set();
    scene.traverseVisible((node) => {
      if (!(node instanceof SplatEdit)) return;
      let ancestor = node.parent;
      while (ancestor && !(ancestor instanceof SplatMesh)) {
        ancestor = ancestor.parent;
      }
      if (!ancestor) globalEdits.add(node);
    });
    for (const mesh of allMeshes) {
      try {
        mesh.frameUpdate({
          time: this.time,
          deltaTime: this.deltaTime,
          camera,
          globalEdits: Array.from(globalEdits)
        });
      } catch (error) {
        console.error("SplatMesh frame update failed", error);
      }
    }
    const visibleMeshes = [];
    scene.traverseVisible((node) => {
      if (node instanceof SplatMesh && camera.layers.test(node.layers)) {
        visibleMeshes.push(node);
      }
    });
    const { maxSplats, mapping: ranges } = this.generateMapping(
      visibleMeshes.map((mesh) => mesh.numSplats)
    );
    this.mapping = [];
    this.numSplats = 0;
    ranges.forEach(({ base, count }, index) => {
      const node = visibleMeshes[index];
      if (!node.splats || count <= 0) return;
      this.mapping.push({
        node,
        version: node.version,
        sortVersion: node.sortVersion,
        mappingVersion: node.mappingVersion,
        base,
        count
      });
      this.numSplats = Math.max(this.numSplats, base + count);
    });
    const { splatsUpdated, mappingUpdated, sortUpdated } = previous.checkVersions(this.mapping);
    this.version = previous.version + (splatsUpdated ? 1 : 0);
    this.mappingVersion = previous.mappingVersion + (mappingUpdated ? 1 : 0);
    return {
      version: this.version,
      sortUpdated,
      generate: () => {
        this.ensureGenerate({ maxSplats });
        for (const { node, base, count } of this.mapping) {
          this.generate({ mesh: node, base, count, renderer });
        }
      }
    };
  }
  checkVersions(other) {
    if (this.mapping.length !== other.length) {
      return { splatsUpdated: true, mappingUpdated: true, sortUpdated: true };
    }
    const mappingUpdated = this.mapping.some((item, index) => {
      const previous = other[index];
      return item.node !== previous.node || item.base !== previous.base || item.count !== previous.count || item.mappingVersion !== previous.mappingVersion;
    });
    if (mappingUpdated) {
      return { splatsUpdated: true, mappingUpdated: true, sortUpdated: true };
    }
    return {
      splatsUpdated: this.mapping.some(
        (item, index) => item.version !== other[index].version
      ),
      mappingUpdated: false,
      sortUpdated: this.mapping.some(
        (item, index) => item.sortVersion !== other[index].sortVersion
      )
    };
  }
  saveRenderState(renderer) {
    return {
      target: renderer.getRenderTarget(),
      activeCubeFace: renderer.getActiveCubeFace(),
      activeMipmapLevel: renderer.getActiveMipmapLevel(),
      xrEnabled: renderer.xr.enabled,
      autoClear: renderer.autoClear
    };
  }
  resetRenderState(renderer, state) {
    renderer.setRenderTarget(
      state.target,
      state.activeCubeFace,
      state.activeMipmapLevel
    );
    renderer.xr.enabled = state.xrEnabled;
    renderer.autoClear = state.autoClear;
  }
};
_SplatAccumulator.emptyTexture = (() => {
  const { width, height, depth, maxSplats } = getTextureSize(1);
  const texture = new THREE__namespace.DataArrayTexture(
    new Uint32Array(maxSplats * 4),
    width,
    height,
    depth
  );
  texture.format = THREE__namespace.RGBAIntegerFormat;
  texture.type = THREE__namespace.UnsignedIntType;
  texture.internalFormat = "RGBA32UI";
  texture.needsUpdate = true;
  return texture;
})();
_SplatAccumulator.emptySplatShape = (() => {
  const { width, height, depth, maxSplats } = getTextureSize(1);
  const texture = new THREE__namespace.DataArrayTexture(
    new Uint8Array(maxSplats),
    width,
    height,
    depth
  );
  texture.format = THREE__namespace.RedFormat;
  texture.type = THREE__namespace.UnsignedByteType;
  texture.internalFormat = "R8";
  texture.needsUpdate = true;
  return texture;
})();
_SplatAccumulator.emptyTextures = [
  _SplatAccumulator.emptyTexture,
  _SplatAccumulator.emptyTexture
];
_SplatAccumulator.materials = /* @__PURE__ */ new Map();
_SplatAccumulator.fullScreenQuad = new Pass_js.FullScreenQuad(
  new THREE__namespace.RawShaderMaterial({ visible: false })
);
let SplatAccumulator = _SplatAccumulator;
function makeGenerateUniforms() {
  return {
    targetLayer: { value: 0 },
    targetBase: { value: 0 },
    targetCount: { value: 0 },
    sourceSplats: { value: SplatAccumulator.emptyTexture },
    sourceSplats2: { value: SplatAccumulator.emptyTexture },
    numSh: { value: 0 },
    sh1Texture: { value: SplatAccumulator.emptyTexture },
    sh2Texture: { value: SplatAccumulator.emptyTexture },
    sh3TextureA: { value: SplatAccumulator.emptyTexture },
    sh3TextureB: { value: SplatAccumulator.emptyTexture },
    objectBasis: { value: new THREE__namespace.Matrix3() },
    objectOffset: { value: new THREE__namespace.Vector3() },
    objectScale: { value: new THREE__namespace.Vector3(1, 1, 1) },
    objectQuaternion: { value: new THREE__namespace.Quaternion() },
    recolor: { value: new THREE__namespace.Vector4(1, 1, 1, 1) },
    numSdfs: { value: 0 },
    numEdits: { value: 0 },
    sdfTexture: { value: SplatEdits.emptyTexture },
    editTexture: { value: SplatEdits.emptyTexture }
  };
}
class SplatGeometry extends THREE__namespace.InstancedBufferGeometry {
  constructor() {
    super();
    this.setAttribute("position", new THREE__namespace.BufferAttribute(QUAD_VERTICES, 3));
    this.setIndex(new THREE__namespace.BufferAttribute(QUAD_INDICES, 1));
  }
}
const QUAD_VERTICES = new Float32Array([
  -1,
  -1,
  0,
  1,
  -1,
  0,
  1,
  1,
  0,
  -1,
  1,
  0
]);
const QUAD_INDICES = new Uint16Array([0, 1, 2, 0, 2, 3]);
const renderToViewScaleTmp = new THREE__namespace.Vector3();
function getCameraWorldScale(camera) {
  const scale = camera.getWorldScale(renderToViewScaleTmp);
  return (scale.x + scale.y + scale.z) / 3;
}
const _GaussianSplatRenderer = class _GaussianSplatRenderer extends THREE__namespace.Mesh {
  constructor(options) {
    if (!options) {
      throw new Error("GaussianSplatRenderer options are required");
    }
    if (!options.renderer) {
      throw new Error("renderer is required in GaussianSplatRenderer options");
    }
    const uniforms = _GaussianSplatRenderer.makeUniforms();
    Object.assign(uniforms, options.extraUniforms ?? {});
    const shaders2 = getShaders();
    const premultipliedAlpha = options.premultipliedAlpha ?? true;
    const geometry = new SplatGeometry();
    const material = new THREE__namespace.ShaderMaterial({
      glslVersion: THREE__namespace.GLSL3,
      vertexShader: options.vertexShader ?? shaders2.splatVertex,
      fragmentShader: options.fragmentShader ?? shaders2.splatFragment,
      uniforms,
      premultipliedAlpha,
      transparent: options.transparent ?? true,
      depthTest: options.depthTest ?? true,
      depthWrite: options.depthWrite ?? false,
      side: THREE__namespace.DoubleSide,
      allowOverride: false
    });
    super(geometry, material);
    this.renderSize = new THREE__namespace.Vector2();
    this.lastFrame = -1;
    this.updateTimeoutId = -1;
    this.orderingTexture = null;
    this.maxSplats = 0;
    this.activeSplats = 0;
    this.accumulators = [];
    this.sorting = false;
    this.sortDirty = false;
    this.lastSortTime = 0;
    this.sortWorker = null;
    this.sortedCenter = new THREE__namespace.Vector3().setScalar(Number.NEGATIVE_INFINITY);
    this.sortedDir = new THREE__namespace.Vector3().setScalar(0);
    this.sortCentersRevision = 0;
    this.uploadedSortCentersRevision = -1;
    this.updateRunning = false;
    this.updatePromise = Promise.resolve();
    this.queuedUpdate = null;
    this.disposed = false;
    this.superXY = 1;
    this.material = material;
    this.uniforms = uniforms;
    this.frustumCulled = false;
    this.renderer = options.renderer;
    this.onDirty = options.onDirty;
    this.dirty = true;
    this.autoUpdate = options.autoUpdate ?? true;
    this.preUpdate = options.preUpdate ?? true;
    this.maxStdDev = options.maxStdDev ?? Math.sqrt(8);
    this.minPixelRadius = options.minPixelRadius ?? 0;
    this.maxPixelRadius = options.maxPixelRadius ?? 512;
    this.accumExtSplats = options.accumExtSplats ?? false;
    this.minAlpha = options.minAlpha ?? 0.5 * (1 / 255);
    this.enable2DGS = options.enable2DGS ?? false;
    this.preBlurAmount = options.preBlurAmount ?? 0;
    this.blurAmount = options.blurAmount ?? 0.3;
    this.focalDistance = options.focalDistance ?? 0;
    this.apertureAngle = options.apertureAngle ?? 0;
    this.clipXY = options.clipXY ?? 1.4;
    this.focalAdjustment = options.focalAdjustment ?? 2;
    this.sortRadial = options.sortRadial ?? false;
    this.minSortIntervalMs = options.minSortIntervalMs ?? 0;
    const { timer, ownsTimer } = resolveTimer(options.timer);
    this.timer = timer;
    this.ownsTimer = ownsTimer;
    const accumulatorOptions = {
      extSplats: this.accumExtSplats
    };
    this.display = new SplatAccumulator(accumulatorOptions);
    this.current = this.display;
    this.accumulators.push(new SplatAccumulator(accumulatorOptions));
    const provokingVertexExt = this.renderer.getContext().getExtension("WEBGL_provoking_vertex");
    if (provokingVertexExt) {
      provokingVertexExt.provokingVertexWEBGL(
        provokingVertexExt.FIRST_VERTEX_CONVENTION_WEBGL
      );
    }
    if (options.target) {
      const {
        width,
        height,
        doubleBuffer,
        superXY: origSuperXY,
        ...origTargetOptions
      } = options.target;
      const superXY = Math.max(1, Math.min(4, origSuperXY ?? 1));
      if (width * superXY > 8192 || height * superXY > 8192) {
        throw new Error("Target size too large");
      }
      this.superXY = superXY;
      const superWidth = width * superXY;
      const superHeight = height * superXY;
      const targetOptions = {
        format: THREE__namespace.RGBAFormat,
        type: THREE__namespace.UnsignedByteType,
        colorSpace: THREE__namespace.SRGBColorSpace,
        ...origTargetOptions
      };
      this.target = new THREE__namespace.WebGLRenderTarget(
        superWidth,
        superHeight,
        targetOptions
      );
      if (doubleBuffer) {
        this.backTarget = new THREE__namespace.WebGLRenderTarget(
          superWidth,
          superHeight,
          targetOptions
        );
      }
    }
  }
  static makeUniforms() {
    const uniforms = {
      // // number of active splats to render
      // numSplats: { value: 0 },
      // Size of render viewport in pixels
      renderSize: { value: new THREE__namespace.Vector2() },
      // Near and far plane distances
      near: { value: 0.1 },
      far: { value: 1e3 },
      // SplatAccumulator to view transformation quaternion
      renderToViewQuat: { value: new THREE__namespace.Quaternion() },
      // SplatAccumulator to view transformation translation
      renderToViewPos: { value: new THREE__namespace.Vector3() },
      // SplatAccumulator to view transformation uniform scale
      renderToViewScale: { value: 1 },
      // Maximum distance (in stddevs) from Gsplat center to render
      maxStdDev: { value: 1 },
      // Minimum pixel radius for splat rendering
      minPixelRadius: { value: 0 },
      // Maximum pixel radius for splat rendering
      maxPixelRadius: { value: 512 },
      // Minimum alpha value for splat rendering
      minAlpha: { value: 0.5 * (1 / 255) },
      // Enable interpreting 0-thickness Gsplats as 2DGS
      enable2DGS: { value: false },
      // Add to projected 2D splat covariance diagonal (thickens and brightens)
      preBlurAmount: { value: 0 },
      // Add to 2D splat covariance diagonal and adjust opacity (anti-aliasing)
      blurAmount: { value: 0.3 },
      // Depth-of-field distance to focal plane
      focalDistance: { value: 0 },
      // Full-width angle of aperture opening (in radians)
      apertureAngle: { value: 0 },
      // Clip Gsplats that are clipXY times beyond the +-1 frustum bounds
      clipXY: { value: 1.4 },
      // Debug renderSize scale factor
      focalAdjustment: { value: 2 },
      // Whether to encode Gsplat with linear RGB (for environment mapping)
      encodeLinear: { value: false },
      // Back-to-front sort ordering of splat indices
      ordering: { type: "t", value: _GaussianSplatRenderer.emptyOrdering },
      enableExtSplats: { value: false },
      // Gsplat collection to render
      extSplats: { type: "t", value: SplatAccumulator.emptyTexture },
      extSplats2: { type: "t", value: SplatAccumulator.emptyTexture },
      // Per-splat special shape amount, encoded in an R8 texture
      splatShape: { type: "t", value: SplatAccumulator.emptySplatShape },
      // Time in seconds for time-based effects
      time: { value: 0 },
      // Delta time in seconds since last frame
      deltaTime: { value: 0 },
      // Debug flag that alternates each frame
      debugFlag: { value: false }
    };
    return uniforms;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.queuedUpdate = null;
    if (this.target) {
      this.target.dispose();
      this.target = void 0;
    }
    if (this.backTarget) {
      this.backTarget.dispose();
      this.backTarget = void 0;
    }
    if (this.orderingTexture) {
      this.orderingTexture.dispose();
      this.orderingTexture = null;
    }
    const accumulators = /* @__PURE__ */ new Set();
    accumulators.add(this.display);
    accumulators.add(this.current);
    for (const accumulator of this.accumulators) {
      accumulators.add(accumulator);
    }
    for (const accumulator of accumulators) {
      accumulator.dispose();
    }
    if (this.sortWorker) {
      this.sortWorker.dispose();
      this.sortWorker = null;
    }
    this.geometry.dispose();
    this.material.dispose();
  }
  setDirty() {
    var _a;
    if (!this.dirty) {
      this.dirty = true;
      (_a = this.onDirty) == null ? void 0 : _a.call(this);
    }
  }
  onBeforeRender(renderer, scene, camera) {
    var _a;
    const gaussianSplatRenderer = _GaussianSplatRenderer.gaussianSplatOverride ?? this;
    const frame = renderer.info.render.frame;
    const isNewFrame = frame !== gaussianSplatRenderer.lastFrame;
    gaussianSplatRenderer.lastFrame = frame;
    const currentRenderTarget = renderer.getRenderTarget();
    const isXRRenderTarget = checkIsXRRenderTarget(currentRenderTarget);
    if (currentRenderTarget) {
      gaussianSplatRenderer.renderSize.set(
        currentRenderTarget.width,
        currentRenderTarget.height
      );
      if (isXRRenderTarget && gaussianSplatRenderer.renderSize.x === 1 && gaussianSplatRenderer.renderSize.y === 1) {
        const baseLayer = (_a = renderer.xr.getSession()) == null ? void 0 : _a.renderState.baseLayer;
        if (baseLayer) {
          gaussianSplatRenderer.renderSize.x = baseLayer.framebufferWidth;
          gaussianSplatRenderer.renderSize.y = baseLayer.framebufferHeight;
        }
      }
    } else {
      renderer.getDrawingBufferSize(gaussianSplatRenderer.renderSize);
    }
    this.uniforms.renderSize.value.copy(gaussianSplatRenderer.renderSize);
    if (gaussianSplatRenderer.autoUpdate && isNewFrame) {
      const preUpdate = gaussianSplatRenderer.preUpdate && !renderer.xr.isPresenting;
      let useCamera = camera;
      if (renderer.xr.isPresenting) {
        const xrCamera = renderer.xr.getCamera();
        useCamera = xrCamera.cameras[0] ?? xrCamera;
      }
      if (preUpdate) {
        gaussianSplatRenderer.updateInternal({
          scene,
          camera: useCamera,
          autoUpdate: true
        });
      } else if (gaussianSplatRenderer.updateTimeoutId === -1) {
        gaussianSplatRenderer.updateTimeoutId = setTimeout(() => {
          gaussianSplatRenderer.updateTimeoutId = -1;
          gaussianSplatRenderer.updateInternal({
            scene,
            camera: useCamera,
            autoUpdate: true
          });
        }, 1);
      }
    }
    const typedCamera = camera;
    this.uniforms.near.value = typedCamera.near;
    this.uniforms.far.value = typedCamera.far;
    const geometry = this.geometry;
    geometry.instanceCount = gaussianSplatRenderer.activeSplats;
    const display = gaussianSplatRenderer.display;
    const accumToWorld = new THREE__namespace.Matrix4().makeTranslation(
      display.viewOrigin
    );
    const cameraToWorld = camera.matrixWorld.clone();
    const worldToCamera = cameraToWorld.invert();
    const accumToCamera = worldToCamera.multiply(accumToWorld);
    accumToCamera.decompose(
      this.uniforms.renderToViewPos.value,
      this.uniforms.renderToViewQuat.value,
      renderToViewScaleTmp
    );
    this.uniforms.renderToViewScale.value = (renderToViewScaleTmp.x + renderToViewScaleTmp.y + renderToViewScaleTmp.z) / 3;
    this.uniforms.maxStdDev.value = gaussianSplatRenderer.maxStdDev;
    this.uniforms.minPixelRadius.value = gaussianSplatRenderer.minPixelRadius;
    this.uniforms.maxPixelRadius.value = gaussianSplatRenderer.maxPixelRadius;
    this.uniforms.minAlpha.value = gaussianSplatRenderer.minAlpha;
    this.uniforms.enable2DGS.value = gaussianSplatRenderer.enable2DGS;
    this.uniforms.preBlurAmount.value = gaussianSplatRenderer.preBlurAmount;
    this.uniforms.blurAmount.value = gaussianSplatRenderer.blurAmount;
    this.uniforms.focalDistance.value = gaussianSplatRenderer.focalDistance;
    this.uniforms.apertureAngle.value = gaussianSplatRenderer.apertureAngle;
    this.uniforms.clipXY.value = gaussianSplatRenderer.clipXY;
    this.uniforms.focalAdjustment.value = gaussianSplatRenderer.focalAdjustment;
    const outputColorSpace = currentRenderTarget === null ? renderer.outputColorSpace : isXRRenderTarget ? currentRenderTarget.texture.colorSpace : THREE__namespace.ColorManagement.workingColorSpace;
    this.uniforms.encodeLinear.value = outputColorSpace !== THREE__namespace.SRGBColorSpace;
    this.uniforms.ordering.value = gaussianSplatRenderer.orderingTexture ?? _GaussianSplatRenderer.emptyOrdering;
    this.uniforms.enableExtSplats.value = display.extSplats;
    const splatTextures = display.getTextures();
    if (display.extSplats) {
      this.uniforms.extSplats.value = splatTextures[0];
      this.uniforms.extSplats2.value = splatTextures[1];
    } else {
      this.uniforms.extSplats.value = splatTextures[0];
      this.uniforms.extSplats2.value = splatTextures[0];
    }
    this.uniforms.splatShape.value = display.getSplatShapeTexture();
    this.uniforms.time.value = display.time;
    this.uniforms.deltaTime.value = display.deltaTime;
    this.uniforms.debugFlag.value = performance.now() / 1e3 % 2 < 1;
    gaussianSplatRenderer.dirty = false;
  }
  clearSplats() {
    this.activeSplats = 0;
    this.display.numSplats = 0;
    this.setDirty();
  }
  async update({
    scene,
    camera
  }) {
    await this.updateInternal({ scene, camera, autoUpdate: false });
  }
  updateInternal(request) {
    if (this.disposed) return Promise.resolve();
    const pending = this.queuedUpdate;
    this.queuedUpdate = {
      scene: request.scene,
      camera: request.camera,
      // A queued explicit update must not be weakened by a later automatic one.
      autoUpdate: request.autoUpdate && ((pending == null ? void 0 : pending.autoUpdate) ?? true)
    };
    if (!this.updateRunning) {
      this.updateRunning = true;
      this.updatePromise = this.drainUpdates();
    }
    return this.updatePromise;
  }
  async drainUpdates() {
    try {
      while (this.queuedUpdate) {
        const request = this.queuedUpdate;
        this.queuedUpdate = null;
        await this.performUpdate(request);
      }
    } catch (error) {
      this.queuedUpdate = null;
      throw error;
    } finally {
      this.updateRunning = false;
    }
  }
  async performUpdate({ scene, camera, autoUpdate }) {
    const renderer = this.renderer;
    if (this.ownsTimer) {
      this.timer.update();
    }
    const center = camera.getWorldPosition(new THREE__namespace.Vector3());
    const dir = camera.getWorldDirection(new THREE__namespace.Vector3());
    const viewChanged = center.distanceTo(this.sortedCenter) > 1e-3 * getCameraWorldScale(camera) || dir.dot(this.sortedDir) < 0.999 || this.sortRadial !== this.sortedRadial;
    const next = this.accumulators.pop();
    if (!next) {
      throw new Error("No next accumulator");
    }
    if (next === this.current) {
      throw new Error(
        "Next accumulator is the same as the current accumulator"
      );
    }
    let preparation;
    try {
      preparation = next.prepareGenerate({
        renderer,
        scene,
        timer: this.timer,
        camera,
        previous: this.current
      });
    } catch (error) {
      this.accumulators.push(next);
      throw error;
    }
    const { version, sortUpdated, generate } = preparation;
    let doUpdate = true;
    const needsUpdate = viewChanged || version !== this.current.version;
    const needsSort = viewChanged || sortUpdated;
    if (autoUpdate && !needsUpdate) {
      doUpdate = false;
    }
    if (!doUpdate) {
      this.accumulators.push(next);
    } else {
      try {
        generate();
      } catch (error) {
        this.accumulators.push(next);
        throw error;
      }
      if (sortUpdated) {
        this.sortCentersRevision += 1;
      }
      if (this.display.mappingVersion === next.mappingVersion && !needsSort) {
        this.accumulators.push(this.display);
        this.display = next;
      } else {
        if (this.display !== this.current) {
          this.accumulators.push(this.current);
        }
      }
      this.current = next;
      this.sortDirty || (this.sortDirty = needsSort);
      this.setDirty();
    }
    await this.driveSort();
  }
  async driveSort() {
    if (this.disposed || this.sorting || !this.sortDirty) {
      return;
    }
    const now = performance.now();
    const nextSortTime = this.lastSortTime ? this.lastSortTime + this.minSortIntervalMs : now;
    if (now < nextSortTime) {
      await new Promise((resolve) => setTimeout(resolve, nextSortTime - now));
      if (this.disposed) return;
    }
    this.sorting = true;
    this.sortDirty = false;
    this.lastSortTime = performance.now();
    const current = this.current;
    const previousActiveSplats = this.activeSplats;
    try {
      const { numSplats, maxSplats } = current;
      const rows = Math.max(1, Math.ceil(maxSplats / 16384));
      const orderingMaxSplats = rows * 16384;
      this.maxSplats = Math.max(this.maxSplats, orderingMaxSplats);
      const ordering = new Uint32Array(this.maxSplats);
      if (!this.sortWorker) {
        this.sortWorker = new SplatWorker();
      }
      const centersRevision = this.sortCentersRevision;
      if (this.uploadedSortCentersRevision !== centersRevision) {
        const { centers, rangeBases, rangeCounts, rangeOrigins } = buildSortCenters(current);
        await this.sortWorker.call("setSortCenters", {
          centers,
          rangeBases,
          rangeCounts,
          rangeOrigins
        });
        this.uploadedSortCentersRevision = centersRevision;
      }
      const sortRadial = this.sortRadial;
      const result = await this.sortWorker.call("sortCenters32", {
        numSplats,
        cameraPosition: [
          current.viewOrigin.x,
          current.viewOrigin.y,
          current.viewOrigin.z
        ],
        direction: [
          current.viewDirection.x,
          current.viewDirection.y,
          current.viewDirection.z
        ],
        radial: sortRadial,
        ordering
      });
      this.activeSplats = result.activeSplats;
      const activeRows = Math.ceil(result.activeSplats / 16384);
      if (this.orderingTexture && rows > this.orderingTexture.image.height) {
        this.orderingTexture.dispose();
        this.orderingTexture = null;
      }
      if (!this.orderingTexture) {
        const orderingTexture = new THREE__namespace.DataTexture(
          result.ordering,
          4096,
          rows,
          THREE__namespace.RGBAIntegerFormat,
          THREE__namespace.UnsignedIntType
        );
        orderingTexture.internalFormat = "RGBA32UI";
        orderingTexture.needsUpdate = true;
        this.orderingTexture = orderingTexture;
      } else {
        const renderer = this.renderer;
        if (!renderer.properties.has(this.orderingTexture)) {
          this.orderingTexture.image.data = result.ordering;
          this.orderingTexture.needsUpdate = true;
        } else if (activeRows > 0) {
          uploadU32DataTextureRows(
            renderer,
            this.orderingTexture,
            4096,
            activeRows,
            result.ordering
          );
        }
      }
      this.sortedCenter.copy(current.viewOrigin);
      this.sortedDir.copy(current.viewDirection);
      this.sortedRadial = sortRadial;
      if (this.current === current && this.display !== current) {
        this.accumulators.push(this.display);
        this.display = current;
      }
      this.setDirty();
    } catch (error) {
      if (this.disposed) return;
      this.sortDirty = true;
      if (this.current === current && current !== this.display && this.accumulators.length === 0) {
        this.current = this.display;
        this.accumulators.push(current);
        this.activeSplats = previousActiveSplats;
        this.sortDirty = false;
        this.uploadedSortCentersRevision = -1;
      }
      throw error;
    } finally {
      this.sorting = false;
    }
  }
  render(scene, camera) {
    const previousOverride = _GaussianSplatRenderer.gaussianSplatOverride;
    try {
      _GaussianSplatRenderer.gaussianSplatOverride = this;
      this.renderer.render(scene, camera);
    } finally {
      _GaussianSplatRenderer.gaussianSplatOverride = previousOverride;
    }
  }
  renderTarget({
    scene,
    camera
  }) {
    const target = this.backTarget ?? this.target;
    if (!target) {
      throw new Error("No target");
    }
    const previousTarget = this.renderer.getRenderTarget();
    const previousOverride = _GaussianSplatRenderer.gaussianSplatOverride;
    try {
      this.renderer.setRenderTarget(target);
      _GaussianSplatRenderer.gaussianSplatOverride = this;
      this.renderer.render(scene, camera);
    } finally {
      _GaussianSplatRenderer.gaussianSplatOverride = previousOverride;
      this.renderer.setRenderTarget(previousTarget);
    }
    if (target !== this.target) {
      [this.target, this.backTarget] = [this.backTarget, this.target];
    }
    return target;
  }
  // Read back the previously rendered target image as a Uint8Array of packed
  // RGBA values (in that order). Subsequent calls to this.readTarget()
  // will reuse the same buffers to minimize memory allocations.
  async readTarget() {
    if (!this.target) {
      throw new Error("Must initialize with target");
    }
    const { width, height } = this.target;
    const byteSize = width * height * 4;
    if (!this.superPixels || this.superPixels.length < byteSize) {
      this.superPixels = new Uint8Array(byteSize);
    }
    const superPixels = this.superPixels;
    await this.renderer.readRenderTargetPixelsAsync(
      this.target,
      0,
      0,
      width,
      height,
      superPixels
    );
    const { superXY } = this;
    if (superXY === 1) {
      return superPixels;
    }
    const subWidth = width / superXY;
    const subHeight = height / superXY;
    const subSize = subWidth * subHeight * 4;
    if (!this.targetPixels || this.targetPixels.length < subSize) {
      this.targetPixels = new Uint8Array(subSize);
    }
    const targetPixels = this.targetPixels;
    const super2 = superXY * superXY;
    for (let y = 0; y < subHeight; y++) {
      const row = y * subWidth;
      for (let x = 0; x < subWidth; x++) {
        const superCol = x * superXY;
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let sy = 0; sy < superXY; sy++) {
          const superRow = (y * superXY + sy) * width;
          for (let sx = 0; sx < superXY; sx++) {
            const superIndex = (superRow + superCol + sx) * 4;
            r += superPixels[superIndex];
            g += superPixels[superIndex + 1];
            b += superPixels[superIndex + 2];
            a += superPixels[superIndex + 3];
          }
        }
        const pixelIndex = (row + x) * 4;
        targetPixels[pixelIndex] = r / super2;
        targetPixels[pixelIndex + 1] = g / super2;
        targetPixels[pixelIndex + 2] = b / super2;
        targetPixels[pixelIndex + 3] = a / super2;
      }
    }
    return targetPixels;
  }
  async renderReadTarget({
    scene,
    camera
  }) {
    this.renderTarget({ scene, camera });
    return this.readTarget();
  }
  // Renders out the scene to a cube map that can be used for
  // Image-based lighting or similar applications. First optionally updates Gsplats,
  // sorts them with respect to the provided worldCenter, renders 6 cube faces.
  async renderCubeMap({
    scene,
    worldCenter,
    size = 256,
    near = 0.1,
    far = 1e3,
    hideObjects = [],
    update = true,
    filter = false
  }) {
    if (!_GaussianSplatRenderer.cubeRender || _GaussianSplatRenderer.cubeRender.target.width !== size || _GaussianSplatRenderer.cubeRender.near !== near || _GaussianSplatRenderer.cubeRender.far !== far) {
      if (_GaussianSplatRenderer.cubeRender) {
        _GaussianSplatRenderer.cubeRender.target.dispose();
      }
      const target2 = new THREE__namespace.WebGLCubeRenderTarget(size, {
        format: THREE__namespace.RGBAFormat,
        type: THREE__namespace.UnsignedByteType,
        generateMipmaps: filter,
        minFilter: filter ? THREE__namespace.LinearMipMapLinearFilter : THREE__namespace.LinearFilter,
        magFilter: THREE__namespace.LinearFilter,
        colorSpace: filter ? THREE__namespace.LinearSRGBColorSpace : THREE__namespace.SRGBColorSpace
      });
      const cubeCamera2 = new THREE__namespace.CubeCamera(near, far, target2);
      _GaussianSplatRenderer.cubeRender = { target: target2, cubeCamera: cubeCamera2, near, far };
    }
    const { target, cubeCamera } = _GaussianSplatRenderer.cubeRender;
    cubeCamera.position.copy(worldCenter);
    const objectVisibility = /* @__PURE__ */ new Map();
    for (const object of hideObjects) {
      objectVisibility.set(object, object.visible);
      object.visible = false;
    }
    if (update) {
      const tempCamera = new THREE__namespace.Camera();
      tempCamera.position.copy(worldCenter);
      await this.update({ scene, camera: tempCamera });
    }
    const previousOverride = _GaussianSplatRenderer.gaussianSplatOverride;
    try {
      _GaussianSplatRenderer.gaussianSplatOverride = this;
      cubeCamera.update(this.renderer, scene);
    } finally {
      _GaussianSplatRenderer.gaussianSplatOverride = previousOverride;
    }
    for (const [object, visible] of objectVisibility.entries()) {
      object.visible = visible;
    }
    return target.texture;
  }
  async readCubeTargets() {
    if (!_GaussianSplatRenderer.cubeRender) {
      throw new Error("No cube render");
    }
    const textures = _GaussianSplatRenderer.cubeRender.target.texture;
    const promises = [];
    const buffers = [];
    for (let i = 0; i < textures.images.length; ++i) {
      const { width, height } = textures.images[i];
      const byteSize = width * height * 4;
      const readback = new Uint8Array(byteSize);
      buffers.push(readback);
      const promise = this.renderer.readRenderTargetPixelsAsync(
        _GaussianSplatRenderer.cubeRender.target,
        0,
        0,
        width,
        height,
        readback,
        i
      );
      promises.push(promise);
    }
    await Promise.all(promises);
    return buffers;
  }
  // Renders out the scene to an environment map that can be used for
  // Image-based lighting or similar applications. First optionally updates Gsplats,
  // sorts them with respect to the provided worldCenter, renders 6 cube faces,
  // then pre-filters them using THREE.PMREMGenerator and returns a THREE.Texture
  // that can assigned directly to a THREE.MeshStandardMaterial.envMap property.
  async renderEnvMap({
    scene,
    worldCenter,
    size = 256,
    near = 0.1,
    far = 1e3,
    hideObjects = [],
    update = true
  }) {
    var _a;
    const cubeTexture = await this.renderCubeMap({
      scene,
      worldCenter,
      size,
      near,
      far,
      hideObjects,
      update,
      filter: true
    });
    if (!_GaussianSplatRenderer.pmrem) {
      _GaussianSplatRenderer.pmrem = new THREE__namespace.PMREMGenerator(this.renderer);
    }
    return (_a = _GaussianSplatRenderer.pmrem) == null ? void 0 : _a.fromCubemap(cubeTexture).texture;
  }
  // Utility function to recursively set the envMap property for any
  // THREE.MeshStandardMaterial within the subtree of root.
  recurseSetEnvMap(root, envMap) {
    root.traverse((node) => {
      if (node instanceof THREE__namespace.Mesh) {
        if (Array.isArray(node.material)) {
          for (const material of node.material) {
            if (material instanceof THREE__namespace.MeshStandardMaterial) {
              material.envMap = envMap;
            }
          }
        } else {
          if (node.material instanceof THREE__namespace.MeshStandardMaterial) {
            node.material.envMap = envMap;
          }
        }
      }
    });
  }
  get premultipliedAlpha() {
    return this.material.premultipliedAlpha;
  }
  set premultipliedAlpha(value) {
    if (this.material.premultipliedAlpha !== value) {
      this.material.premultipliedAlpha = value;
      this.material.needsUpdate = true;
    }
  }
};
_GaussianSplatRenderer.emptyOrdering = (() => {
  const numIndices = 4 * 4096 * 1;
  const emptyArray = new Uint32Array(numIndices);
  const texture = new THREE__namespace.DataTexture(emptyArray, 4096, 1);
  texture.format = THREE__namespace.RGBAIntegerFormat;
  texture.type = THREE__namespace.UnsignedIntType;
  texture.internalFormat = "RGBA32UI";
  texture.needsUpdate = true;
  return texture;
})();
_GaussianSplatRenderer.cubeRender = null;
_GaussianSplatRenderer.pmrem = null;
let GaussianSplatRenderer = _GaussianSplatRenderer;
function checkIsXRRenderTarget(renderTarget) {
  return renderTarget == null ? void 0 : renderTarget.isXRRenderTarget;
}
exports.ExtSplats = ExtSplats;
exports.GaussianSplatRenderer = GaussianSplatRenderer;
exports.LN_SCALE_MAX = LN_SCALE_MAX;
exports.LN_SCALE_MIN = LN_SCALE_MIN;
exports.SplatAccumulator = SplatAccumulator;
exports.SplatEdit = SplatEdit;
exports.SplatEditRgbaBlendMode = SplatEditRgbaBlendMode;
exports.SplatEditSdf = SplatEditSdf;
exports.SplatEditSdfType = SplatEditSdfType;
exports.SplatEdits = SplatEdits;
exports.SplatFileType = SplatFileType;
exports.SplatLoader = SplatLoader;
exports.SplatMesh = SplatMesh;
exports.SplatWorker = SplatWorker;
exports.defines = defines;
exports.fromHalf = fromHalf;
exports.toHalf = toHalf;
exports.utils = utils;
//# sourceMappingURL=gaussian-splat-lite.cjs.map
