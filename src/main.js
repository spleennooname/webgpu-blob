import './style.css';

import blobShader from './shaders/raymarching-blob.wgsl?raw';
import copyShader from './shaders/copy-shader.wgsl?raw';

async function init() {
  if (!navigator.gpu) {
    console.error('WebGPU not supported');
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    console.error('WebGPU not available');
    return;
  }

  const device = await adapter.requestDevice();
  const canvas = document.getElementById('canvas');
  const context = canvas.getContext('webgpu');
  const size = [512, 512];

  const format = navigator.gpu.getPreferredCanvasFormat();

  function createPingPongTexture(device, width, height, format) {
    return device.createTexture({
      size: [width, height, 1],
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
  }

  context.configure({
    device,
    size,
    format,
    alphaMode: 'opaque',
  });

  // Crea le texture per ping pong buffering
  let pingPongTextures = [
    createPingPongTexture(device, size[0], size[1], format),
    createPingPongTexture(device, size[0], size[1], format)
  ];

  let pingPongViews = [
    pingPongTextures[0].createView(),
    pingPongTextures[1].createView()
  ];

  let currentBuffer = 0;

  // shader module
  const shaderModule = device.createShaderModule({
    label: "Raymarching Shader",
    code: blobShader,
  });

  /*  device.popErrorScope().then(async error => {
    if (error) {
      const info = await shaderModule.getCompilationInfo();
 
      // Split the code into lines
      const lines = code.split('\n');
 
      // Sort the messages by line numbers in reverse order
      // so that as we insert the messages they won't affect
      // the line numbers.
      const msgs = [...info.messages].sort((a, b) => b.lineNum - a.lineNum);
 
      // Insert the error messages between lines
      for (const msg of msgs) {
        lines.splice(msg.lineNum, 0,
          `${''.padEnd(msg.linePos - 1)}${''.padEnd(msg.length, '^')}`,
          msg.message,
        );
      }
 
      log(lines.join('\n'));
    }
  }); */

  // pipeline layout, bind 2 uniforms on fragment
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
          // 
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

  //  blob pipeline
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
      topology: 'triangle-list',
    },
  });

  // Pipeline separata per copiare alla canvas finale
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

  const copyShaderModule = device.createShaderModule({
    label: 'Passthrough Shader',
    code: copyShader
  });

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

  // time buffer
  const timeBuffer = device.createBuffer({
    size: 4, // Float32 -4 bytes
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // resolution buffer
  const resolutionBuffer = device.createBuffer({
    size: 8, // 2 x Float32 (longword) ( width and height)
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // sampler
  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
    mipmapFilter: 'nearest'
  });

  // bind resolution
  const resolutionArray = new Float32Array([canvas.width, canvas.height]);
  device.queue.writeBuffer(resolutionBuffer, 0, resolutionArray);

  // Funzione per creare bind group per il ping pong
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
          resource: prevTextureView,
        },
        {
          binding: 3,
          resource: sampler,
        },
      ],
    });
  }

  // Bind group per la copia finale
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

  let startTime = performance.now();

  let fps = 0;
  let fpsTime = 0;
  let fpsCount =0 ;
  // render
  function render(time) {

    time*=1e-3;

    fpsCount++;
    if (time - fpsTime > 1) {
      fps = fpsCount;
      fpsCount = 0;
      fpsTime = time;
      document.getElementById('fps').textContent = fps;
    }

    // update time
    const timeValue = new Float32Array([time]);
    device.queue.writeBuffer(timeBuffer, 0, timeValue);

    const commandEncoder = device.createCommandEncoder();

    // raymarching pass

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
    pingPongPass.draw(3);
    pingPongPass.end();

    // copy pass
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
    copyPass.draw(3);
    copyPass.end();

    device.queue.submit([commandEncoder.finish()]);

    // Scambia i buffer
    currentBuffer = 1 - currentBuffer;

    // next frame
    requestAnimationFrame(render);
  }

  // resize canvas
  function resize() {
    const devicePixelRatio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth * devicePixelRatio;
    const height = canvas.clientHeight * devicePixelRatio;

    canvas.width = width;
    canvas.height = height;

    const resolutionArray = new Float32Array([width, height]);
    device.queue.writeBuffer(resolutionBuffer, 0, resolutionArray);

    // Ricrea le texture ping pong con le nuove dimensioni
    if (pingPongTextures) {
      
      pingPongTextures[0].destroy();
      pingPongTextures[1].destroy();

      pingPongTextures = [
        createPingPongTexture(device, width, height, format),
        createPingPongTexture(device, width, height, format)
      ];

      pingPongViews = [
        pingPongTextures[0].createView(),
        pingPongTextures[1].createView()
      ];
    }

    context.configure({
      device,
      size: [width, height],
      format,
      alphaMode: 'opaque',
    });
  }

  window.addEventListener('resize', resize);

  // trigger resize
  resize();

  // start render loop
  requestAnimationFrame(render);
}

init().catch((error) => {
  console.error('WebGPU:', error);
  document.body.innerHTML = `<p>Errore WebGPU: ${error.message}</p>`;
});
