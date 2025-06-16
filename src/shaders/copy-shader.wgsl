
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
