use gaussian_splat_lib::splat_encode::{
    decode_ext_splat_center, decode_ext_splat_ln_scale, decode_ext_splat_opacity,
    decode_ext_splat_quat,
};

pub fn raycast_ext_ellipsoids(
    buffer: &[u32],
    buffer2: &[u32],
    distances: &mut Vec<f32>,
    origin: [f32; 3],
    dir: [f32; 3],
    min_opacity: f32,
    near: f32,
    far: f32,
) {
    assert_eq!(buffer.len(), buffer2.len());
    let dir_length_squared = vec3_dot(dir, dir);
    if dir_length_squared <= f32::EPSILON || !dir_length_squared.is_finite() {
        return;
    }
    let inv_dir_length_squared = 1.0 / dir_length_squared;

    for (ext_a, ext_b) in buffer.chunks(4).zip(buffer2.chunks(4)) {
        let opacity = decode_ext_splat_opacity(ext_a);
        if opacity < min_opacity {
            continue;
        }

        let center = decode_ext_splat_center(ext_a);
        let ln_scale = decode_ext_splat_ln_scale(ext_b);
        let rescale = opacity.max(1.0) * 4.0 - 3.0;
        let (longest_axis, radius) = longest_scale(ln_scale, rescale);
        if !raycast_sphere_may_hit(
            origin,
            dir,
            inv_dir_length_squared,
            center,
            radius,
            near,
            far,
        ) {
            continue;
        }

        let scale = expand_scale(ln_scale, rescale, longest_axis, radius);
        let quat = decode_ext_splat_quat(ext_b);
        if let Some(t) = raycast_ellipsoid(origin, dir, center, scale, quat) {
            if t >= near && t <= far {
                distances.push(t);
            }
        }
    }
}

#[inline]
fn longest_scale(ln_scale: [f32; 3], rescale: f32) -> (usize, f32) {
    let mut axis = 0;
    if ln_scale[1] > ln_scale[axis] {
        axis = 1;
    }
    if ln_scale[2] > ln_scale[axis] {
        axis = 2;
    }
    (axis, ln_scale[axis].exp() * rescale)
}

#[inline]
fn expand_scale(
    ln_scale: [f32; 3],
    rescale: f32,
    longest_axis: usize,
    longest_scale: f32,
) -> [f32; 3] {
    match longest_axis {
        0 => [
            longest_scale,
            ln_scale[1].exp() * rescale,
            ln_scale[2].exp() * rescale,
        ],
        1 => [
            ln_scale[0].exp() * rescale,
            longest_scale,
            ln_scale[2].exp() * rescale,
        ],
        _ => [
            ln_scale[0].exp() * rescale,
            ln_scale[1].exp() * rescale,
            longest_scale,
        ],
    }
}

fn raycast_ellipsoid(
    origin: [f32; 3],
    dir: [f32; 3],
    center: [f32; 3],
    scale: [f32; 3],
    quat: [f32; 4],
) -> Option<f32> {
    let origin = vec3_sub(origin, center);
    let inv_quat = [-quat[0], -quat[1], -quat[2], quat[3]];

    // Model the Gaussian splat as an ellipsoid for higher quality raycasting
    let local_origin = quat_vec(inv_quat, origin);
    let local_dir = quat_vec(inv_quat, dir);

    let min_scale = scale[0].max(scale[1]).max(scale[2]) * 0.01;
    if scale[2] < min_scale {
        // Treat it as a flat elliptical disk
        if local_dir[2].abs() < 1e-6 {
            return None;
        }
        let t = -local_origin[2] / local_dir[2];
        let p_x = local_origin[0] + t * local_dir[0];
        let p_y = local_origin[1] + t * local_dir[1];
        if sqr(p_x / scale[0]) + sqr(p_y / scale[1]) > 1.0 {
            return None;
        }
        Some(t)
    } else if scale[1] < min_scale {
        // Treat it as a flat elliptical disk
        if local_dir[1].abs() < 1e-6 {
            return None;
        }
        let t = -local_origin[1] / local_dir[1];
        let p_x = local_origin[0] + t * local_dir[0];
        let p_z = local_origin[2] + t * local_dir[2];
        if sqr(p_x / scale[0]) + sqr(p_z / scale[2]) > 1.0 {
            return None;
        }
        Some(t)
    } else if scale[0] < min_scale {
        // Treat it as a flat elliptical disk
        if local_dir[0].abs() < 1e-6 {
            return None;
        }
        let t = -local_origin[0] / local_dir[0];
        let p_y = local_origin[1] + t * local_dir[1];
        let p_z = local_origin[2] + t * local_dir[2];
        if sqr(p_y / scale[1]) + sqr(p_z / scale[2]) > 1.0 {
            return None;
        }
        Some(t)
    } else {
        let inv_scale = [1.0 / scale[0], 1.0 / scale[1], 1.0 / scale[2]];
        let local_origin = vec3_mul(local_origin, inv_scale);
        let local_dir = vec3_mul(local_dir, inv_scale);

        let a = vec3_dot(local_dir, local_dir);
        let b = vec3_dot(local_origin, local_dir);
        let c = vec3_dot(local_origin, local_origin) - 1.0;
        let discriminant = b * b - a * c;
        if discriminant < 0.0 {
            return None;
        }

        let t = (-b - discriminant.sqrt()) / a;
        Some(t)
    }
}

// Use the ellipsoid's longest semi-axis as a conservative bounding sphere.
// The direction is intentionally not assumed to be normalized: SplatMesh
// transforms it into mesh space without normalization so that `t` remains in
// the raycaster's world-distance units.
fn raycast_sphere_may_hit(
    origin: [f32; 3],
    dir: [f32; 3],
    inv_dir_length_squared: f32,
    center: [f32; 3],
    radius: f32,
    near: f32,
    far: f32,
) -> bool {
    if !radius.is_finite() {
        // Preserve the exact path for malformed data rather than introducing
        // a broad-phase false negative.
        return true;
    }

    let offset = vec3_sub(origin, center);
    let closest_t = (-vec3_dot(offset, dir) * inv_dir_length_squared)
        .max(near)
        .min(far);
    let closest = [
        offset[0] + closest_t * dir[0],
        offset[1] + closest_t * dir[1],
        offset[2] + closest_t * dir[2],
    ];
    vec3_dot(closest, closest) <= radius * radius
}

fn sqr(x: f32) -> f32 {
    x * x
}

fn vec3_sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn vec3_mul(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] * b[0], a[1] * b[1], a[2] * b[2]]
}

fn vec3_dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn vec3_cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn quat_vec(q: [f32; 4], v: [f32; 3]) -> [f32; 3] {
    let q_vec = [q[0], q[1], q[2]];
    let uv = vec3_cross(q_vec, v);
    let uuv = vec3_cross(q_vec, uv);
    [
        v[0] + 2.0 * (q[3] * uv[0] + uuv[0]),
        v[1] + 2.0 * (q[3] * uv[1] + uuv[1]),
        v[2] + 2.0 * (q[3] * uv[2] + uuv[2]),
    ]
}
