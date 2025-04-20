import './style.css';

import shaderCode from './shaders/raymarching-blob.wgsl?raw';

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
  const size = [1024, 1024];

  const format = navigator.gpu.getPreferredCanvasFormat();

  context.configure({
    device,
    size,
    format,
    alphaMode: 'opaque',
  });

  // shader module
  const shaderModule = device.createShaderModule({
    code: shaderCode,
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
  const pipelineLayout = device.createPipelineLayout({
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
        ],
      }),
    ],
  });

  //  render pipeline
  const pipeline = await device.createRenderPipelineAsync({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vertexMain',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fragmentMain',
      targets: [{ format: format }],
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

  // bind resolution
  const resolutionArray = new Float32Array([canvas.width, canvas.height]);
  device.queue.writeBuffer(resolutionBuffer, 0, resolutionArray);

  // Crea il bind group
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      {
        binding: 0,
        resource: { buffer: timeBuffer },
      },
      {
        binding: 1,
        resource: { buffer: resolutionBuffer },
      },
    ],
  });

  // render
  function render(time) {
    // next frame
    requestAnimationFrame(render);

    // update time
    const timeValue = new Float32Array([time / 1000]);
    device.queue.writeBuffer(timeBuffer, 0, timeValue);

    // get current texture
    const textureView = context.getCurrentTexture().createView();

    const renderPassDescriptor = {
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    };

    const commandEncoder = device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    // set pipeline
    passEncoder.setPipeline(pipeline);
    // set bindings
    passEncoder.setBindGroup(0, bindGroup);
    passEncoder.draw(3); // draw full quad triangle
    passEncoder.end();

    device.queue.submit([commandEncoder.finish()]);
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
  }

  window.addEventListener('resize', resize);
  resize();

  // start render loop
  requestAnimationFrame(render);
}

init().catch((error) => {
  console.error('WebGPU:', error);
  document.body.innerHTML = `<p>Errore WebGPU: ${error.message}</p>`;
});
