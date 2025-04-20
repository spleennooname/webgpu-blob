
// vertex shader

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
     // quad triangle
    var pos = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0)
    );

    let p = pos[vertexIndex];

    var vertex: VertexOutput;
    vertex.position = vec4f(p, 0.0, 1.0);
    vertex.uv = p; // p* 0.5 + 0.5 Normalizza le coordinate UV

    return vertex;
}

// fragment shader 

@group(0) @binding(0) var<uniform> time: f32;
@group(0) @binding(1) var<uniform> resolution: vec2f;

const MAX_STEPS: f32 = 128.0;
const MIN_DISTANCE: f32 = 0.0;
const MAX_DISTANCE: f32 = 100.0;
const EPSILON: f32 = 0.0001;

const AMBIENT: vec3<f32> = vec3<f32>(1.0, 0.4, 1.0) * 0.25;
const DIFFUSE: vec3<f32> = vec3<f32>(1.0, 0.0, 0.0);
const SPECULAR: vec3<f32> = vec3<f32>(1.0, 1.0, 1.0);
const SHININESS: f32 = 8.0;

fn map(p: vec3<f32>) -> f32 {
    let t = twist(p, time);
    let rot_mat = rotationMatrix3(vec3<f32>(0.0, 1.0, 1.0), time);
    let r = rotate(t, rot_mat);
    return torus(r, vec2<f32>(0.4, 0.4));
}

fn torus(p: vec3<f32>, t: vec2<f32>) -> f32 {
    let q = vec2<f32>(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}
      
fn twist(p: vec3<f32>, time: f32) -> vec3<f32> {
    let timeVal = sin(time * 0.5) * 3.0 * p.y;
    let c = cos(sin(time * 2.0) * 2.2 * p.y);
    let s = sin(timeVal);
    let m = mat2x2<f32>(c, s, -s, c);
    return vec3<f32>(m * p.xz, p.y);
}

fn rotationMatrix3(axis: vec3<f32>, angle: f32) -> mat3x3<f32> {
    let axis_norm = normalize(axis);
    let s = sin(angle);
    let c = cos(angle);
    let oc = 1.0 - c;
        
        // Direct construction of mat3x3 without conversions
    return mat3x3<f32>(
        oc * axis_norm.x * axis_norm.x + c,
        oc * axis_norm.x * axis_norm.y + axis_norm.z * s,
        oc * axis_norm.z * axis_norm.x - axis_norm.y * s,
        oc * axis_norm.x * axis_norm.y - axis_norm.z * s,
        oc * axis_norm.y * axis_norm.y + c,
        oc * axis_norm.y * axis_norm.z + axis_norm.x * s,
        oc * axis_norm.z * axis_norm.x + axis_norm.y * s,
        oc * axis_norm.y * axis_norm.z - axis_norm.x * s,
        oc * axis_norm.z * axis_norm.z + c
    );
}

fn rotate(p: vec3<f32>, m: mat3x3<f32>) -> vec3<f32> {
  return m * p;
}

// Ray marching

fn normal(p: vec3<f32>) -> vec3<f32> {
    let e = vec2<f32>(EPSILON, 0.0);
    return normalize(vec3<f32>(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

fn trace(ro: vec3f, rd: vec3f) -> f32 {
  var t: f32 = 0.0;
  var d: f32 = 0.0;
  for (var i = 0.0; i < MAX_STEPS; i = i + 1) {
    d = map(ro + rd * t);
    if (abs(d) < EPSILON|| t >= MAX_DISTANCE ) { 
      break;
    }
    t = t+ d ;
  }
  return t;
}

// fragment shader

struct FragmentInput {
  @location(0) uv: vec2f, // same location(n), see VertexOutput
};

@fragment
fn fragmentMain(frag: FragmentInput) -> @location(0) vec4f {
    
    // normalize uv on fragment
    let uv = frag.uv * 0.5 + 0.5;
    let aspect = resolution.x / resolution.y;
    let screenPos = vec2f(frag.uv.x * aspect, frag.uv.y);
        
    // ray origin
    let ro = vec3f(0.0, 0.0, -2.0); // Ray origin / camera position
    
    let lookAt = vec3f(0.0, 0.0, 0.0);
   
    // camera
    let cameraOffset = vec3f(
        sin(time * 0.5) * 0.5,
        sin(time * 0.3) * 0.3,
        0.0
    );

    let forward = normalize(lookAt - ro + cameraOffset);
    let right = normalize(cross(forward,  vec3f(0.0, 1.0, 0.0)));
    //let cameraUp = cross(right, forward);
    
    // ray direction
    let rd = normalize(forward + 1.0 * (screenPos.x * right + screenPos.y * cross(right, forward)));

    let lp1 = vec3<f32>(4.0 * sin(time), 2.0, 4.0 * cos(time));
    let lp2 = vec3<f32>(4.0 * sin(time), 2.0, 5.0 * sin(time));

    let intensity1 = vec3<f32>(0.4);
    let intensity2 = vec3<f32>(0.2);

    let d = trace(ro + cameraOffset, rd);

    var c = vec3f(0);

    if (d < MAX_DISTANCE) {

      let p = ro + d * rd;

      let no = normal(p);
            
      // lighting
      let ld = vec3f(1.0, 1.0, -1.0);
      let lp = vec3f(-1.0, -1.0, -1.0)* sin(time);

      let ldd = length(lp - p);
      let attn = 1.0 - pow(min(1.0, ldd/16.0), 2.0); // attenuation
      let dif=  max(dot(no, ld), 0.0);
      let fr = pow(1.0 - abs(dot(no,rd)), 2.0); // fresnel
      let sp = pow(max(0., dot(reflect(-ld, no), -rd)), 15.); //specular

      c = mix(vec3f(0.5)*(dif + sp* 1e-4)* attn, vec3f(0.1, 0.4, 0.8), min(fr, 0.2));
    }

    c += mix(vec3f(0.5, 0.7, 1.0), vec3f(0.1, 0.1, 0.3),  rd.y * 0.5 + 0.5);

    return vec4f(c, 1.0);
}