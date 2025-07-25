import './style.css';

import blobShader from './shaders/raymarching-shader.wgsl?raw';
import copyShader from './shaders/copy-shader.wgsl?raw';

async function init() {
  // basic WebGPU availability check
  if (!navigator.gpu) {
    console.error('WebGPU not supported');
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    console.error('WebGPU not available');
    return;
  }

  // get the device and set up canvas context
  const device = await adapter.requestDevice();
  const canvas = document.getElementById('canvas');
  const context = canvas.getContext('webgpu');
  const size = [512, 512]; // initial render size

  const format = navigator.gpu.getPreferredCanvasFormat();

  // helper function to create textures for ping-pong rendering
  // these textures can be used as both render targets and sampling sources
  function createPingPongTexture(device, width, height, format) {
    return device.createTexture({
      size: [width, height, 1],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
  }

  // configure the canvas context for WebGPU rendering
  context.configure({
    device,
    size,
    format,
    alphaMode: 'opaque',
  });

  // create two textures for ping-pong buffering - this allows temporal effects
  // by reading from previous frame while writing to current frame
  let pingPongTextures = [
    createPingPongTexture(device, size[0], size[1], format),
    createPingPongTexture(device, size[0], size[1], format)
  ];

  // create texture views for binding to shaders
  let pingPongViews = [
    pingPongTextures[0].createView(),
    pingPongTextures[1].createView()
  ];

  let currentBuffer = 0; // tracks which buffer we're currently rendering to

  // load the main raymarching shader
  const shaderModule = device.createShaderModule({
    label: "Raymarching Shader",
    code: blobShader,
  });

  /* commented out error handling code - useful for shader debugging
  device.popErrorScope().then(async error => {
    if (error) {
      const info = await shaderModule.getCompilationInfo();
 
      // split the code into lines
      const lines = code.split('\n');
 
      // sort the messages by line numbers in reverse order
      // so that as we insert the messages they won't affect
      // the line numbers.
      const msgs = [...info.messages].sort((a, b) => b.lineNum - a.lineNum);
 
      // insert the error messages between lines
      for (const msg of msgs) {
        lines.splice(msg.lineNum, 0,
          `${''.padEnd(msg.linePos - 1)}${''.padEnd(msg.length, '^')}`,
          msg.message,
        );
      }
 
      log(lines.join('\n'));
    }
  }); */

  // define the bind group layout for the main raymarching pipeline
  // binding 0: time uniform, binding 1: resolution uniform
  // binding 2: previous frame texture, binding 3: sampler
  const blobPipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [
      device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: 'float' },
          },
          {
            binding: 3,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: {},
          },
        ],
      }),
    ],
  });

  // create the main rendering pipeline for raymarching
  const blobPipeline = await device.createRenderPipelineAsync({
    layout: blobPipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vertexMain',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fragmentMain',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list', // fullscreen triangle approach
    },
  });

  // separate pipeline for copying the final result to canvas
  // this is a common pattern to keep the main rendering separate from display
  const copyPipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [
      device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: 'float' },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: {},
          },
        ],
      }),
    ],
  });

  // load the simple copy shader
  const copyShaderModule = device.createShaderModule({
    label: 'Passthrough Shader',
    code: copyShader
  });

  // create the copy pipeline - just blits texture to screen
  const copyPipeline = await device.createRenderPipelineAsync({
    layout: copyPipelineLayout,
    vertex: {
      module: copyShaderModule,
      entryPoint: 'vertexMain',
    },
    fragment: {
      module: copyShaderModule,
      entryPoint: 'fragmentMain',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  // uniform buffer for time - essential for animated raymarching
  const timeBuffer = device.createBuffer({
    size: 4, // float32 - 4 bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // uniform buffer for resolution - needed for proper UV coordinates
  const resolutionBuffer = device.createBuffer({
    size: 8, // 2 x float32 (width and height)
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // linear sampler for smooth texture sampling
  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    mipmapFilter: 'nearest'
  });

  // initialize resolution buffer with canvas dimensions
  const resolutionArray = new Float32Array([canvas.width, canvas.height]);
  device.queue.writeBuffer(resolutionBuffer, 0, resolutionArray);

  // factory function to create bind groups for ping-pong rendering
  // takes the previous frame's texture as input
  function createPingPongBindGroup(prevTextureView) {
    return device.createBindGroup({
      layout: blobPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: timeBuffer },
        },
        {
          binding: 1,
          resource: { buffer: resolutionBuffer },
        },
        {
          binding: 2,
          resource: prevTextureView, // previous frame for temporal effects
        },
        {
          binding: 3,
          resource: sampler,
        },
      ],
    });
  }

  // factory function for copy pass bind group
  function createCopyBindGroup(textureView) {
    return device.createBindGroup({
      layout: copyPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: textureView,
        },
        {
          binding: 1,
          resource: sampler,
        },
      ],
    });
  }

  // fps tracking variables
  let fps = 0;
  let fpsTime = 0;
  let fpsCount = 0;

  // main render loop
  function render(time) {
    time *= 1e-3; // convert to seconds

    // fps calculation - updates every second
    fpsCount++;
    if (time - fpsTime > 1) {
      fps = fpsCount;
      fpsCount = 0;
      fpsTime = time;
      document.getElementById('fps').textContent = `${fps}fps`;
    }

    // update time uniform for shader animations
    const timeValue = new Float32Array([time]);
    device.queue.writeBuffer(timeBuffer, 0, timeValue);

    const commandEncoder = device.createCommandEncoder();

    // first pass: raymarching to ping-pong buffer
    // read from previous frame (1 - currentBuffer), write to current frame
    const pingPongBindGroup = createPingPongBindGroup(pingPongViews[1 - currentBuffer]);

    const pingPongPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: pingPongViews[currentBuffer],
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pingPongPass.setPipeline(blobPipeline);
    pingPongPass.setBindGroup(0, pingPongBindGroup);
    pingPongPass.draw(3); // draw fullscreen triangle
    pingPongPass.end();

    // second pass: copy result to screen
    const copyBindGroup = createCopyBindGroup(pingPongViews[currentBuffer]);

    const copyPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    copyPass.setPipeline(copyPipeline);
    copyPass.setBindGroup(0, copyBindGroup);
    copyPass.draw(3); // another fullscreen triangle
    copyPass.end();

    // submit all commands to GPU
    device.queue.submit([commandEncoder.finish()]);

    // swap ping-pong buffers for next frame
    currentBuffer = 1 - currentBuffer;

    // schedule next frame
    requestAnimationFrame(render);
  }

  // handle window resize - important for responsive rendering
  function resize() {
    const devicePixelRatio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth * devicePixelRatio;
    const height = canvas.clientHeight * devicePixelRatio;

    // update canvas size
    canvas.width = width;
    canvas.height = height;

    // update resolution uniform
    const resolutionArray = new Float32Array([width, height]);
    device.queue.writeBuffer(resolutionBuffer, 0, resolutionArray);

    // recreate ping-pong textures with new dimensions
    if (pingPongTextures) {
      // clean up old textures
      pingPongTextures[0].destroy();
      pingPongTextures[1].destroy();

      // create new textures with updated size
      pingPongTextures = [
        createPingPongTexture(device, width, height, format),
        createPingPongTexture(device, width, height, format)
      ];

      // update texture views
      pingPongViews = [
        pingPongTextures[0].createView(),
        pingPongTextures[1].createView()
      ];
    }

    // reconfigure canvas context
    context.configure({
      device,
      size: [width, height],
      format,
      alphaMode: 'opaque',
    });
  }

  // listen for window resize events
  window.addEventListener('resize', resize);

  // initial resize to set correct dimensions
  resize();

  // kick off the render loop
  requestAnimationFrame(render);
}

// initialize everything and handle any setup errors
init().catch((error) => {
  console.error('WebGPU:', error);
  document.body.innerHTML = `<p>Errore WebGPU: ${error.message}</p>`;
});