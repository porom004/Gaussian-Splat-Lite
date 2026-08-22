use std::cell::RefCell;

use gaussian_splat_lib::decoder::{ChunkReceiver, MultiDecoder, SplatFileType};
use js_sys::{Float32Array, Float64Array, Reflect, Uint32Array};
use wasm_bindgen::prelude::*;

use crate::{decoder::ChunkDecoder, ext_splats::ExtSplatsData};

mod decoder;
mod ext_splats;
mod raycast;
mod sort;

use raycast::raycast_ext_ellipsoids;
use sort::{sort32_centers_internal, Sort32Buffers};

#[wasm_bindgen(start)]
pub fn wasm_start() {
    console_error_panic_hook::set_once();
}

thread_local! {
    static SORT32_BUFFERS: RefCell<Sort32Buffers> = RefCell::new(Sort32Buffers::default());
}

#[wasm_bindgen]
pub fn set_sort_centers(
    centers: Float32Array,
    range_bases: Uint32Array,
    range_counts: Uint32Array,
    range_origins: Float64Array,
) {
    if range_bases.length() != range_counts.length() {
        wasm_bindgen::throw_str("Sort range base/count arrays must have equal lengths");
    }
    if range_origins.length() != range_bases.length().saturating_mul(3) {
        wasm_bindgen::throw_str("Sort range origins must contain three values per range");
    }

    SORT32_BUFFERS.with_borrow_mut(|buffers| {
        buffers.centers.resize(centers.length() as usize, 0.0);
        centers.copy_to(&mut buffers.centers);
        buffers.range_bases.resize(range_bases.length() as usize, 0);
        range_bases.copy_to(&mut buffers.range_bases);
        buffers
            .range_counts
            .resize(range_counts.length() as usize, 0);
        range_counts.copy_to(&mut buffers.range_counts);
        buffers
            .range_origins
            .resize(range_origins.length() as usize, 0.0);
        range_origins.copy_to(&mut buffers.range_origins);
    });
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)] // Flat scalars keep the JS/WASM sort call allocation-free.
pub fn sort32_centers(
    num_splats: u32,
    camera_x: f64,
    camera_y: f64,
    camera_z: f64,
    direction_x: f32,
    direction_y: f32,
    direction_z: f32,
    radial: bool,
    ordering: Uint32Array,
) -> u32 {
    let max_splats = ordering.length() as usize;

    SORT32_BUFFERS.with_borrow_mut(|buffers| {
        let active_splats = match sort32_centers_internal(
            buffers,
            max_splats,
            num_splats as usize,
            [camera_x, camera_y, camera_z],
            [direction_x, direction_y, direction_z],
            radial,
        ) {
            Ok(active_splats) => active_splats,
            Err(err) => wasm_bindgen::throw_str(&err),
        };

        if active_splats > 0 {
            ordering
                .subarray(0, active_splats)
                .copy_from(&buffers.ordering[..active_splats as usize]);
        }
        active_splats
    })
}

fn parse_file_type(file_type: Option<String>) -> Result<Option<SplatFileType>, JsValue> {
    file_type
        .map(|file_type| {
            SplatFileType::from_enum_str(&file_type).map_err(|err| JsValue::from(err.to_string()))
        })
        .transpose()
}

#[wasm_bindgen]
pub fn decode_to_extsplats(
    file_type: Option<String>,
    path_name: Option<String>,
) -> Result<ChunkDecoder, JsValue> {
    let file_type = parse_file_type(file_type)?;

    let decoder = MultiDecoder::new(ExtSplatsData::new(), file_type, path_name.as_deref());
    let on_finish = |receiver: Box<dyn ChunkReceiver>| {
        let decoder: Box<MultiDecoder<ExtSplatsData>> = receiver.into_any().downcast().unwrap();
        let file_type = decoder.file_type.unwrap();
        let object = decoder.into_splats().into_splat_object();
        Reflect::set(
            &object,
            &JsValue::from_str("fileType"),
            &JsValue::from(file_type.to_enum_str()),
        )?;
        Ok(JsValue::from(object))
    };

    Ok(ChunkDecoder::new(Box::new(decoder), Box::new(on_finish)))
}

const RAYCAST_BUFFER_COUNT: usize = 65536;

thread_local! {
    static RAYCAST_BUFFERS: RefCell<(Vec<u32>, Vec<u32>, Vec<f32>)> = RefCell::new((vec![0; RAYCAST_BUFFER_COUNT * 4], vec![0; RAYCAST_BUFFER_COUNT * 4], vec![0.0; RAYCAST_BUFFER_COUNT]));
}

#[wasm_bindgen]
pub fn get_raycast_buffer() -> Uint32Array {
    RAYCAST_BUFFERS.with_borrow_mut(|(buffer, _, _)| unsafe { Uint32Array::view(&buffer) })
}

#[wasm_bindgen]
pub fn get_raycast_buffer2() -> Uint32Array {
    RAYCAST_BUFFERS.with_borrow_mut(|(_, buffer, _)| unsafe { Uint32Array::view(&buffer) })
}

#[wasm_bindgen]
pub fn raycast_ext_buffers(
    origin_x: f32,
    origin_y: f32,
    origin_z: f32,
    dir_x: f32,
    dir_y: f32,
    dir_z: f32,
    min_opacity: f32,
    near: f32,
    far: f32,
    count: u32,
) -> Float32Array {
    RAYCAST_BUFFERS.with_borrow_mut(|(buffer, buffer2, distances)| {
        distances.clear();
        let subbuffer = &buffer[0..(4 * count as usize)];
        let subbuffer2 = &buffer2[0..(4 * count as usize)];
        raycast_ext_ellipsoids(
            subbuffer,
            subbuffer2,
            distances,
            [origin_x, origin_y, origin_z],
            [dir_x, dir_y, dir_z],
            min_opacity,
            near,
            far,
        );

        unsafe { Float32Array::view(&distances) }
    })
}
