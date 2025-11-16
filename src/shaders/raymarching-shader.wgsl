
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    // simple (big)triangle
    var pos = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0)
    );

    let p = pos[vertexIndex];

    var vertex: VertexOutput;
    vertex.position = vec4f(p, 0.0, 1.0);
    vertex.uv = vec2f(p.x, -p.y);

    return vertex;
}

// fragment shader 

@group(0) @binding(0) var<uniform> time: f32;
@group(0) @binding(1) var<uniform> resolution: vec2f;
@group(0) @binding(2) var prevFrame: texture_2d<f32>;
@group(0) @binding(3) var frameSampler: sampler;

const PI =  3.14159265359 ;
const MAX_STEPS: f32 = 96.0;
const MIN_DISTANCE: f32 = 0.0;
const MAX_DISTANCE: f32 = 100.0;
const EPSILON: f32 = 0.0001;

const AMBIENT: vec3<f32> = vec3<f32>(1.0, 0.4, 1.0) * 0.25;
const DIFFUSE: vec3<f32> = vec3<f32>(1.0, 0.0, 0.0);
const SPECULAR: vec3<f32> = vec3<f32>(1.0, 1.0, 1.0);

const PHI: f32 = 1.618033988749895; // golden ratio

//
fn rotationMatrix3(axis: vec3<f32>, angle: f32) -> mat3x3<f32> {
    // Early return
    if dot(axis, axis) < 1e-10 {
        return mat3x3<f32>(
            1.0, 0.0, 0.0,
            0.0, 1.0, 0.0,
            0.0, 0.0, 1.0
        );
    }

    let n = normalize(axis);
    let s = sin(angle);
    let c = cos(angle);
    let oc = 1.0 - c;
    
    // precomputation
    let nx_ny = n.x * n.y;
    let nx_nz = n.x * n.z;
    let ny_nz = n.y * n.z;
    let nx_s = n.x * s;
    let ny_s = n.y * s;
    let nz_s = n.z * s;

    // matrix for columns (WGSL is column-major)
    return mat3x3<f32>(
        vec3<f32>(oc * n.x * n.x + c, oc * nx_ny + nz_s, oc * nx_nz - ny_s),
        vec3<f32>(oc * nx_ny - nz_s, oc * n.y * n.y + c, oc * ny_nz + nx_s),
        vec3<f32>(oc * nx_nz + ny_s, oc * ny_nz - nx_s, oc * n.z * n.z + c)
    );
}

// SDF RoundBox
fn sdRoundBox(p: vec3<f32>, b: vec3<f32>, r: f32) -> f32 {
    let q = abs(p) - b;
    return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

// some twist fun wih vec3f p      
fn twist(p: vec3<f32>, time: f32) -> vec3<f32> {
    let k = sin(time * 1.5) * 2.; // Twist amount
    let c = cos(k * p.y);
    let s = sin(k * p.y);
    let m = mat2x2<f32>(c, -s, s, c);
    return vec3<f32>(m * p.xz, p.y);
}

fn modf(x: f32, y: f32) -> f32 {
    return x - y * floor(x / y);
}

// sdf scene/map fn
fn map(p: vec3<f32>) -> f32 {
    let rotMat: mat3x3<f32> = rotationMatrix3(vec3<f32>(0.0, 1.0, 1.0), time);
    
    // SDF 
    let sdf = sdRoundBox(rotMat * twist(p, time), vec3<f32>(0.3, 0.3, 0.3), 0.1);

    return sdf;
}

// compute normal (classic)
fn normal(p: vec3<f32>) -> vec3<f32> {
    let e = vec2<f32>(EPSILON, 0.0);
    return normalize(vec3<f32>(
        map(p + e.xyy) - map(p - e.xyy),
        map(p + e.yxy) - map(p - e.yxy),
        map(p + e.yyx) - map(p - e.yyx)
    ));
}

// raymarching with ray origin + ray direction
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

struct FragmentInput {
  @location(0) uv: vec2f, // same location(n), see VertexOutput
};

@fragment
fn fragmentMain(frag: FragmentInput) -> @location(0) vec4f {
    
    // normalize uv on fragment -1 +1
    let uv = frag.uv * 0.5 + 0.5;
    
    // prev frame
    let prevColor = textureSample(prevFrame, frameSampler, uv);

    // ray origin
    let ro = vec3f(0.0, 0.0, 1.0); 
    let lookAt = vec3f(0.0, 0.0, 0.0);
   
    // offset for camera
    let cameraOffset = vec3f(
        sin(time * 0.5) * 0.1,
        sin(time * 0.5) * 0.1,
        0.0
    );

    let forward = normalize(lookAt - ro + cameraOffset);
    let right = normalize(cross(forward,  vec3f(0.0, 1.0, 1.0)));

    // ray direction
     let aspect = resolution.x / resolution.y;
    let screenPos = vec2f(frag.uv.x * aspect, frag.uv.y);
       
    let rd = normalize(forward + 1.0 * (screenPos.x * right + screenPos.y * cross(right, forward)));

    // computer ray distance
    let d = trace(ro + cameraOffset, rd);

    var c = mix(
            vec3f(0.5, 0.7, 1.0), 
            vec3f(0.3, 0.15, 0.4),  
            rd.y * 0.5 + 0.5
        );

    if (d < MAX_DISTANCE) { // hit somethin

      let p = ro + d * rd;

      // get normal
      let no = normal(p);
      //return vec4f(no * 0.5 + 0.5, 1.0); // normals debug in [0, 1]
      
      // light direction
      let ld = vec3f(-.5, .5, 0.8);

      // light point
      let lp = vec3f(0.0, 0.3, 1.0);

      // diffuse
      let dif=  max(dot(no, ld), 0.0);

      // fresnel
      let fr =  vec3f(0.8, 0.4, 0.) * pow(1.0 - abs(dot(no,rd)), 4.); 

      // specular
      let sp = vec3f(0.8, 0.4, 0.) * pow(max(0., dot(reflect(-ld, no), -rd)), 32.); 

      //
      let sss = smoothstep(0.,1.,map(p + ld*.4)/.4);

      let albedo = vec3f(0.8, 0.4, 0.);
  
      let ao = clamp(map(p + no*.05)/.05, 0. ,1.); // AO = AMBIENT OCCLUSION

       // dif + spec
      c = mix(sp + albedo * (ao + .2) * (dif + sss * .2), c, min(fr, vec3f(0.3)));
    } 

    let decay = vec3f(1., 0.98, 0.97);
    c = mix(c, prevColor.rgb * decay, 0.87);

    // final color
    return vec4f(c, 1.0);
}