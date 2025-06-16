(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))l(n);new MutationObserver(n=>{for(const t of n)if(t.type==="childList")for(const c of t.addedNodes)c.tagName==="LINK"&&c.rel==="modulepreload"&&l(c)}).observe(document,{childList:!0,subtree:!0});function i(n){const t={};return n.integrity&&(t.integrity=n.integrity),n.referrerPolicy&&(t.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?t.credentials="include":n.crossOrigin==="anonymous"?t.credentials="omit":t.credentials="same-origin",t}function l(n){if(n.ep)return;n.ep=!0;const t=i(n);fetch(n.href,t)}})();const N=`// vertex shader

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
    vertex.uv = vec2f(p.x, -p.y);

    return vertex;
}

// fragment shader 

@group(0) @binding(0) var<uniform> time: f32;
@group(0) @binding(1) var<uniform> resolution: vec2f;
@group(0) @binding(2) var prevFrame: texture_2d<f32>;
@group(0) @binding(3) var frameSampler: sampler;

const MAX_STEPS: f32 = 96.0;
const MIN_DISTANCE: f32 = 0.0;
const MAX_DISTANCE: f32 = 100.0;
const EPSILON: f32 = 0.0001;

const AMBIENT: vec3<f32> = vec3<f32>(1.0, 0.4, 1.0) * 0.25;
const DIFFUSE: vec3<f32> = vec3<f32>(1.0, 0.0, 0.0);
const SPECULAR: vec3<f32> = vec3<f32>(1.0, 1.0, 1.0);
const SHININESS: f32 = 8.0;

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

// sdf torus
fn torus(p: vec3<f32>, t: vec2<f32>) -> f32 {
    let q = vec2<f32>(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

// SDF RoundBox
fn sdRoundBox(p: vec3<f32>, b: vec3<f32>, r: f32) -> f32 {
    let q = abs(p) - b;
    return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

// some twist fun wih vec3f p      
fn twist(p: vec3<f32>, time: f32) -> vec3<f32> {
    let k = sin(time * 0.5) * 0.9; // Twist amount
    let c = cos(k * p.y);
    let s = sin(k * p.y);
    let m = mat2x2<f32>(c, -s, s, c);
    return vec3<f32>(m * p.xz, p.y);
}

// sdf scene/map fn
fn map(p: vec3<f32>) -> f32 {

    let t: vec3<f32> = twist(p, time);

    let rotMat: mat3x3<f32> = rotationMatrix3(vec3<f32>(0.0, 1.0, 1.0), time);
    
    // sdf shape
    let sdf = sdRoundBox(rotMat * t, vec3<f32>(0.3, 0.3, 0.3), 0.1);

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

// fragment shader

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
    let ro = vec3f(0.0, 0.0, -1.5); 
    let lookAt = vec3f(0.0, 0.0, 0.0);
   
    // offset for camera
    let cameraOffset = vec3f(
        sin(time * 0.5) * 0.2,
        sin(time * 0.5) * 0.2,
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

    var c = vec3f(0);

    if (d < MAX_DISTANCE) { // hit somethin

      let p = ro + d * rd;

      // get normal
      let no = normal(p);
            
      // light direction
      let ld = vec3f(1.0, -1.0, -1.0);

      // light point
      let lp = vec3f(-1.0, 0.0, 1.0);// * sin(time);

      // diffuse
      let dif=  vec3f(0.8, 0.4, 0.0) * max(dot(no, ld), 0.0);
      // fresnel
      let fr = pow(1.0 - abs(dot(no,rd)), 2.0); 
      // specular
      let sp = pow(max(0., dot(reflect(-ld, no), -rd)), SHININESS); 

      c = mix(vec3f(1.)*(dif + sp* 1e-4), vec3f(0.8, 0.4, 0.0), min(fr, 0.2));
    }

    // +: gradient bg color
    c += mix(
        vec3f(0.5, 0.7, 1.0), 
        vec3f(0.1, 0.1, 0.3),  
        rd.y * 0.5 + 0.5
    );

    let decay = vec3f(0.98, 0.97, 0.99);
    c = mix(c, prevColor.rgb * decay, 0.75);

    // final color
    return vec4f(c, 1.0);
}`,O=`
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
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

@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var textureSampler: sampler;
@group(0) @binding(2) var<uniform> time: f32;

struct FragmentInput {
  @location(0) uv: vec2f,
};

@fragment
fn fragmentMain(frag: FragmentInput) -> @location(0) vec4f {
    let uv = frag.uv * 0.5 + 0.5;
    
    var color = textureSample(inputTexture, textureSampler, uv);
    
    // post-processing
    let dist = length(uv - 0.5);
    let vignette = 1.0 - smoothstep(0.5, 0.8, dist) * 0.5;
    color = color * vignette;
    
    // color grading
    color.r = pow(color.r, 0.98);
    color.g = pow(color.g, 0.99);
    color.b = pow(color.b, 1.01);
    
    // scanlines
    //let scanline = sin(uv.y * 800.0 + time * 2.0) * 0.04;
    //color = color + scanline;
    
    return vec4f(color.rgb, 1.0);
}
`;async function F(){if(!navigator.gpu){console.error("WebGPU not supported");return}const f=await navigator.gpu.requestAdapter();if(!f){console.error("WebGPU not available");return}const e=await f.requestDevice(),i=document.getElementById("canvas"),l=i.getContext("webgpu"),n=[512,512],t=navigator.gpu.getPreferredCanvasFormat();function c(r,a,o,p){return r.createTexture({size:[a,o,1],format:p,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC})}l.configure({device:e,size:n,format:t,alphaMode:"opaque"});let s=[c(e,n[0],n[1],t),c(e,n[0],n[1],t)],d=[s[0].createView(),s[1].createView()],u=0;const x=e.createShaderModule({label:"Raymarching Shader",code:N}),E=e.createPipelineLayout({bindGroupLayouts:[e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:3,visibility:GPUShaderStage.FRAGMENT,sampler:{}}]})]}),b=await e.createRenderPipelineAsync({layout:E,vertex:{module:x,entryPoint:"vertexMain"},fragment:{module:x,entryPoint:"fragmentMain",targets:[{format:t}]},primitive:{topology:"triangle-list"}}),_=e.createPipelineLayout({bindGroupLayouts:[e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{}}]})]}),P=e.createShaderModule({label:"Passthrough Shader",code:O}),h=await e.createRenderPipelineAsync({layout:_,vertex:{module:P,entryPoint:"vertexMain"},fragment:{module:P,entryPoint:"fragmentMain",targets:[{format:t}]},primitive:{topology:"triangle-list"}}),S=e.createBuffer({size:4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),m=e.createBuffer({size:8,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),w=e.createSampler({magFilter:"linear",minFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge",mipmapFilter:"nearest"}),B=new Float32Array([i.width,i.height]);e.queue.writeBuffer(m,0,B);function z(r){return e.createBindGroup({layout:b.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:S}},{binding:1,resource:{buffer:m}},{binding:2,resource:r},{binding:3,resource:w}]})}function I(r){return e.createBindGroup({layout:h.getBindGroupLayout(0),entries:[{binding:0,resource:r},{binding:1,resource:w}]})}let G=0,M=0,y=0;function A(r){r*=.001,y++,r-M>1&&(G=y,y=0,M=r,document.getElementById("fps").textContent=`${G}fps`);const a=new Float32Array([r]);e.queue.writeBuffer(S,0,a);const o=e.createCommandEncoder(),p=z(d[1-u]),v=o.beginRenderPass({colorAttachments:[{view:d[u],clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});v.setPipeline(b),v.setBindGroup(0,p),v.draw(3),v.end();const U=I(d[u]),g=o.beginRenderPass({colorAttachments:[{view:l.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});g.setPipeline(h),g.setBindGroup(0,U),g.draw(3),g.end(),e.queue.submit([o.finish()]),u=1-u,requestAnimationFrame(A)}function T(){const r=window.devicePixelRatio||1,a=i.clientWidth*r,o=i.clientHeight*r;i.width=a,i.height=o;const p=new Float32Array([a,o]);e.queue.writeBuffer(m,0,p),s&&(s[0].destroy(),s[1].destroy(),s=[c(e,a,o,t),c(e,a,o,t)],d=[s[0].createView(),s[1].createView()]),l.configure({device:e,size:[a,o],format:t,alphaMode:"opaque"})}window.addEventListener("resize",T),T(),requestAnimationFrame(A)}F().catch(f=>{console.error("WebGPU:",f),document.body.innerHTML=`<p>Errore WebGPU: ${f.message}</p>`});
