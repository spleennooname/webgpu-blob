(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))a(n);new MutationObserver(n=>{for(const t of n)if(t.type==="childList")for(const i of t.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&a(i)}).observe(document,{childList:!0,subtree:!0});function r(n){const t={};return n.integrity&&(t.integrity=n.integrity),n.referrerPolicy&&(t.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?t.credentials="include":n.crossOrigin==="anonymous"?t.credentials="omit":t.credentials="same-origin",t}function a(n){if(n.ep)return;n.ep=!0;const t=r(n);fetch(n.href,t)}})();const P=`
// vertex shader

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
     // simple quad (big)triangle
    var pos = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0)
    );

    let p = pos[vertexIndex];

    var vertex: VertexOutput;
    vertex.position = vec4f(p, 0.0, 1.0);
    vertex.uv = p;

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

fn torus(p: vec3<f32>, t: vec2<f32>) -> f32 {
    let q = vec2<f32>(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}
      
// some twist fun wih vec3f p      
fn twist(p: vec3<f32>, time: f32) -> vec3<f32> {
    let timeVal = sin(time * 0.5) * 3.0 * p.y;
    let c = cos(sin(time * 2.0) * 2.2 * p.y);
    let s = sin(timeVal);
    let m = mat2x2<f32>(c, s, -s, c);
    return vec3<f32>(m * p.xz, p.y);
}

//
fn rotationMatrix3(axis: vec3<f32>, angle: f32) -> mat3x3<f32> {
    // early return for zero axis to avoid normalization issues
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
    
    // precompute common terms
    let nx_ny = n.x * n.y;
    let nx_nz = n.x * n.z;
    let ny_nz = n.y * n.z;
    let nx_s = n.x * s;
    let ny_s = n.y * s;
    let nz_s = n.z * s;

    // construct matrix with clearer row organization
    return mat3x3<f32>(
        // Row 1
        oc * n.x * n.x + c,
        oc * nx_ny + nz_s,
        oc * nx_nz - ny_s,
        // Row 2
        oc * nx_ny - nz_s,
        oc * n.y * n.y + c,
        oc * ny_nz + nx_s,
        // Row 3
        oc * nx_nz + ny_s,
        oc * ny_nz - nx_s,
        oc * n.z * n.z + c
    );
}

// sdf scene/map fn
fn map(p: vec3<f32>) -> f32 {
    let t: vec3<f32> = twist(p, time);
    let rotMat: mat3x3<f32> = rotationMatrix3(vec3<f32>(0.0, 1.0, 1.0), time);
    return torus(t * rotMat, vec2<f32>(0.4, 0.4));
}

// compute normal with classic formula
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
    let ro = vec3f(0.0, 0.0, -1.5); 
    let lookAt = vec3f(0.0, 0.0, 0.0);
   
    // offset for camera
    let cameraOffset = vec3f(
        sin(time * 0.5) * 0.5,
        sin(time * 0.3) * 0.3,
        0.0
    );

    let forward = normalize(lookAt - ro + cameraOffset);
    let right = normalize(cross(forward,  vec3f(0.0, 1.0, 0.0)));

    // ray direction
    let rd = normalize(forward + 1.0 * (screenPos.x * right + screenPos.y * cross(right, forward)));

    // computer ray distance
    let d = trace(ro + cameraOffset, rd);

    var c = vec3f(0);

    if (d < MAX_DISTANCE) { // hit somethin

      let p = ro + d * rd;

      // get normal
      let no = normal(p);
            
      // light direction
      let ld = vec3f(1.0, 1.0, -1.0);

      // light point
      let lp = vec3f(-1.0, -1.0, -1.0) * sin(time);

      // diffuse
      let dif=  max(dot(no, ld), 0.0);
      // fresnel
      let fr = pow(1.0 - abs(dot(no,rd)), 2.0); 
      // specular
      let sp = pow(max(0., dot(reflect(-ld, no), -rd)), SHININESS); 

      c = mix(vec3f(0.5)*(dif + sp* 1e-4), vec3f(0.1, 0.4, 0.8), min(fr, 0.2));
    }

    // +: gradient bg color
    c += mix(vec3f(0.5, 0.7, 1.0), vec3f(0.1, 0.1, 0.3),  rd.y * 0.5 + 0.5);

    // final color
    return vec4f(c, 1.0);
}`;async function b(){if(!navigator.gpu){console.error("WebGPU not supported");return}const o=await navigator.gpu.requestAdapter();if(!o){console.error("WebGPU not available");return}const e=await o.requestDevice(),r=document.getElementById("canvas"),a=r.getContext("webgpu"),n=[1024,1024],t=navigator.gpu.getPreferredCanvasFormat();a.configure({device:e,size:n,format:t,alphaMode:"opaque"});const i=e.createShaderModule({code:P}),x=e.createPipelineLayout({bindGroupLayouts:[e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]})]}),m=await e.createRenderPipelineAsync({layout:x,vertex:{module:i,entryPoint:"vertexMain"},fragment:{module:i,entryPoint:"fragmentMain",targets:[{format:t}]},primitive:{topology:"triangle-list"}}),p=e.createBuffer({size:4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),u=e.createBuffer({size:8,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),h=new Float32Array([r.width,r.height]);e.queue.writeBuffer(u,0,h);const w=e.createBindGroup({layout:m.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:p}},{binding:1,resource:{buffer:u}}]});function v(c){requestAnimationFrame(v);const s=new Float32Array([c/1e3]);e.queue.writeBuffer(p,0,s);const d={colorAttachments:[{view:a.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]},y=e.createCommandEncoder(),f=y.beginRenderPass(d);f.setPipeline(m),f.setBindGroup(0,w),f.draw(3),f.end(),e.queue.submit([y.finish()])}function g(){const c=window.devicePixelRatio||1,s=r.clientWidth*c,l=r.clientHeight*c;r.width=s,r.height=l;const d=new Float32Array([s,l]);e.queue.writeBuffer(u,0,d)}window.addEventListener("resize",g),g(),requestAnimationFrame(v)}b().catch(o=>{console.error("WebGPU:",o),document.body.innerHTML=`<p>Errore WebGPU: ${o.message}</p>`});
