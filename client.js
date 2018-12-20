let canvas;
let gl;

let backgroundProgram;
let backgroundVao;
let backgroundTexture;

let imageProgram;
let imageVao;
let imageTexture;

let backgroundTextureUniform;
let imageTextureUniform;
let resolutionUniform;
let projectionUniform;

let projection;

let imageAspect = 1;

class Matrix4 {
  constructor() {
    this.buffer = new ArrayBuffer(16 * 4);
    this.floats = new Float32Array(this.buffer);
    // this.dataview = new DataView(this.buffer);
    this.set(0, 0, 1);
    this.set(1, 1, 1);
    this.set(2, 2, 1);
    this.set(3, 3, 1);
  }

  get(r, c) {
    return this.floats[c * 4 + r];
  }

  set(r, c, value) {
    this.floats[c * 4 + r] = value;
    return this;
  }

  toString() {
    let s = '';
    for (let r = 0; r < 4; ++r) {
      for (let c = 0; c < 4; ++c) {
        let value = this.get(r, c);
        value = Math.round(value * 1000) / 1000
        s += value + ' ';
      }
      s += '\n';
    }
    return s;
  }

  toBuffer() {
    return this.floats;
  }

  static ortho(left, right, bottom, top, near = -1, far = 1) {
    var m = new Matrix4();
    m.set(0, 0, 2 / (right - left));
    m.set(1, 1, 2 / (top - bottom));
    m.set(2, 2, 2 / (near - far));
    m.set(0, 3, -(right + left) / (right - left));
    m.set(1, 3, -(top + bottom) / (top - bottom));
    m.set(2, 3, (near + far) / (near - far));
    return m;
  }
}

function createBackground() {
  let vertexSource = `#version 300 es
uniform vec2 resolution;
in vec4 position;
out vec2 fTexCoords;

void main() {
  gl_Position = position;
  fTexCoords = (position.xy * 0.5 + 0.5) * (resolution * 0.05);
}
  `;

  let fragmentSource = `#version 300 es
precision mediump float;
uniform sampler2D backgroundTexture;
in vec2 fTexCoords;
out vec4 fragmentColor;

void main() {
  // fragmentColor = vec4(fTexCoords, 0.0, 1.0);
  fragmentColor = texture(backgroundTexture, fTexCoords);
}
  `; 

  let vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
  let fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
  backgroundProgram = linkProgram(vertexShader, fragmentShader);

  let positions = [
    -1.0, -1.0, 0.0, 1.0,
     1.0, -1.0, 0.0, 1.0,
    -1.0,  1.0, 0.0, 1.0,
     1.0,  1.0, 0.0, 1.0
  ];

  let positionAttributeLocation = gl.getAttribLocation(backgroundProgram, 'position');
  let positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

  backgroundVao = gl.createVertexArray();
  gl.bindVertexArray(backgroundVao);
  gl.enableVertexAttribArray(positionAttributeLocation);
  gl.vertexAttribPointer(positionAttributeLocation, 4, gl.FLOAT, false, 0, 0);

  let dark = 60;
  let lite = 90;
  let checker = new Uint8Array([
    dark, dark, dark, 255,
    lite, lite, lite, 255,
    lite, lite, lite, 255,
    dark, dark, dark, 255,
  ]);

  gl.activeTexture(gl.TEXTURE0);
  backgroundTexture = createTexture(gl, 2, 2, 4, checker);

  backgroundTextureUniform = gl.getUniformLocation(backgroundProgram, 'backgroundTexture');
  resolutionUniform = gl.getUniformLocation(backgroundProgram, 'resolution');

  gl.useProgram(backgroundProgram);
  gl.uniform1i(backgroundTextureUniform, 0);
  gl.useProgram(null);
}

function createImage() {
  let vertexSource = `#version 300 es
uniform mat4 projection;
in vec4 position;
in vec2 texCoords;
out vec2 fTexCoords;

void main() {
  gl_Position = projection * position;
  fTexCoords = texCoords;
}
  `;

  let fragmentSource = `#version 300 es
precision mediump float;
uniform sampler2D imageTexture;
in vec2 fTexCoords;
out vec4 fragmentColor;

void main() {
  // fragmentColor = vec4(fTexCoords, 0.0, 1.0);
  fragmentColor = texture(imageTexture, fTexCoords);
}
  `; 

  let vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
  let fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
  imageProgram = linkProgram(vertexShader, fragmentShader);

  let scale = 0.9;
  let vertices = [
    -scale, -scale, 0.0, 1.0,
    0.0, 1.0,

    scale, -scale, 0.0, 1.0,
    1.0, 1.0,

    -scale,  scale, 0.0, 1.0,
    0.0, 0.0,

    scale,  scale, 0.0, 1.0,
    1.0, 0.0,
  ];

  imageVao = gl.createVertexArray();
  gl.bindVertexArray(imageVao);

  let vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

  let positionAttributeLocation = gl.getAttribLocation(imageProgram, 'position');
  gl.vertexAttribPointer(positionAttributeLocation, 4, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(positionAttributeLocation);

  let texCoordsAttributeLocation = gl.getAttribLocation(imageProgram, 'texCoords');
  gl.vertexAttribPointer(texCoordsAttributeLocation, 2, gl.FLOAT, false, 24, 16);
  gl.enableVertexAttribArray(texCoordsAttributeLocation);

  imageTextureUniform = gl.getUniformLocation(imageProgram, 'imageTexture');
  projectionUniform = gl.getUniformLocation(imageProgram, 'projection');

  gl.useProgram(imageProgram);
  gl.uniform1i(imageTextureUniform, 1);
  gl.useProgram(null);
}

function onReady() {
  canvas = document.getElementById('canvas');
  gl = canvas.getContext('webgl2');
  createBackground();
  createImage();
  render();

  onSize();
}

function createTexture(gl, width, height, nchannels, pixels) {
  let texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, nchannels == 4 ? gl.RGBA : gl.RGB, gl.UNSIGNED_BYTE, pixels);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  return texture;
}

function render() {
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(backgroundProgram);
  gl.uniform2f(resolutionUniform, gl.canvas.width, gl.canvas.height);
  gl.bindVertexArray(backgroundVao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
  gl.useProgram(null);

  if (imageTexture) {
    gl.useProgram(imageProgram);
    gl.uniformMatrix4fv(projectionUniform, false, projection.toBuffer());
    gl.bindVertexArray(imageVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.useProgram(null);
  }
}

function linkProgram(vertexShader, fragmentShader) {
  let program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return program;
  } else {
    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
  }
}

function compileShader(type, source) {
  let shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return shader;
  } else {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
}

function onSize() {
  canvas.width = canvas.clientWidth; 
  canvas.height = canvas.clientHeight; 
  updateProjection();
  render();
}

function updateProjection() {
  let windowAspect = canvas.width / canvas.height;
  if (windowAspect < imageAspect) {
    projection = Matrix4.ortho(-1, 1, -1 / windowAspect * imageAspect, 1 / windowAspect * imageAspect);
  } else {
    projection = Matrix4.ortho(-1 * windowAspect / imageAspect, 1 * windowAspect / imageAspect, -1, 1);
  }
}

function loadTexture(width, height, nchannels, pixels) {
  console.log("width:", width);
  console.log("height:", height);
  console.log("nchannels:", nchannels);
  imageAspect = width / height;
  updateProjection();
  gl.activeTexture(gl.TEXTURE1);
  imageTexture = createTexture(gl, width, height, nchannels, pixels);
  render();
}

require('electron').ipcRenderer.on('loadTexture', (event, width, height, nchannels, pixels) => {
  loadTexture(width, height, nchannels, pixels);
});

window.addEventListener('load', onReady);
window.addEventListener('resize', onSize, false);
