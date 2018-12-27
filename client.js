const sharp = require('sharp');
const fsdialog = require('electron').remote.dialog;

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
let inverseProjection;

let imagePath;
let image;
let mouseAt;

class Image {
  constructor(width, height, nchannels, pixels) {
    this.size = [width, height];
    this.nchannels = nchannels;
    this.bytes = pixels;
  }

  aspectRatio() {
    return this.width / this.height;
  }

  set(c, r, rgb) {
    var start = (r * this.width + c) * 4;
    this.bytes[start + 0] = rgb[0];
    this.bytes[start + 1] = rgb[1];
    this.bytes[start + 2] = rgb[2];
    this.bytes[start + 3] = rgb[3];
    gl.texSubImage2D(gl.TEXTURE_2D, 0, c, r, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.bytes, (r * this.width + c) * 4);
  }

  get width() {
    return this.size[0];
  }

  get height() {
    return this.size[1];
  }

  set width(value) {
    this.size[0] = value;
  }

  set height(value) {
    this.size[1] = value;
  }
}

class Vector2 {
  constructor(x, y) {
    this.values = [x, y];
  }

  subtract(that) {
    return new Vector2(this.x - that.x, this.y - that.y);
  }

  get x() {
    return this.values[0];
  }

  get y() {
    return this.values[1];
  }

  set x(value) {
    this.values[0] = value;
  }

  set y(value) {
    this.values[1] = value;
  }

  abs() {
    return new Vector2(Math.abs(this.x), Math.abs(this.y));
  }

  round() {
    return new Vector2(Math.round(this.x), Math.round(this.y));
  }

  maxValue() {
    return Math.max(this.x, this.y);
  }

  toString() {
    return `${this.x} ${this.y}`;
  }

  static lerp(from, to, t) {
    let diff = to.subtract(from);
    return new Vector2(from.x + t * diff.x, from.y + t * diff.y);
  }

  static diagonalDistance(from, to) {
    return to.subtract(from).abs().maxValue();
  }
}

class Matrix4 {
  constructor() {
    this.buffer = new ArrayBuffer(16 * 4);
    this.floats = new Float32Array(this.buffer);
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

  multiply(v) {
    var product = [0, 0, 0, 0];
    for (var r = 0; r < 4; ++r) {
      for (var c = 0; c < 4; ++c) {
        product[r] += this.get(r, c) * v[c];
      }
    }
    return product;
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

  static inverseOrtho(left, right, bottom, top, near = -1, far = 1) {
    var m = Matrix4.scale((right - left) * 0.5, (top - bottom) * 0.5, (near - far) * 0.5);
    m.set(0, 3, (right + left) * 0.5);
    m.set(1, 3, (top + bottom) * 0.5);
    m.set(2, 3, (far + near) * 0.5);
    return m;
  }

  static scale(x, y, z) {
    var m = new Matrix4();
    m.set(0, 0, x);
    m.set(1, 1, y);
    m.set(2, 2, z);
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
  fTexCoords = (vec2(position.x, -position.y) * 0.5 + 0.5) * (resolution * 0.05);
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

  let dark = 120;
  let lite = 150;
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
  vec4 rgba = texture(imageTexture, fTexCoords);
  fragmentColor = rgba;
}
  `; 

  let vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
  let fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
  imageProgram = linkProgram(vertexShader, fragmentShader);

  let scale = 1.0;
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

function mouseToPixels(mouseX, mouseY) {
  var positionMouse = [mouseX, mouseY];

  var positionClip = [
    positionMouse[0] / gl.canvas.width * 2 - 1,
    positionMouse[1] / gl.canvas.height * 2 - 1,
    0,
    1
  ];

  var positionTexture = inverseProjection.multiply(positionClip);

  var positionPixels = new Vector2(
    Math.floor((positionTexture[0] * 0.5 + 0.5) * image.width),
    Math.floor((positionTexture[1] * 0.5 + 0.5) * image.height)
  );

  return positionPixels;
}

var color = [0, 0, 0, 255];
function drawPixel(p) {
  if (p.x >= 0 && p.x < image.width && p.y >= 0 && p.y < image.height) {
    image.set(p.x, p.y, color);
  }
}

function drawLine(from, to) {
  let n = Vector2.diagonalDistance(from, to);
  for (let step = 0; step <= n; step += 1) {
    let t = n == 0 ? 0.0 : step / n;
    let p = Vector2.lerp(from, to, t).round(); 
    drawPixel(p);
  }
}

function onMouseDown(e) {
  if (e.buttons == 1) {
    color = [0, 0, 0, 255];
  } else {
    color = [0, 0, 0, Math.round(0.1 * 255)];
  }
  mouseAt = mouseToPixels(e.clientX, e.clientY);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, imageTexture);
  drawPixel(mouseAt);
  render();
}

function isOverImage(p) {
  return p.x >= 0 && p.x < image.width && p.y >= 0 && p.y < image.height;
}

function onMouseMove(e) {
  let newMouseAt = mouseToPixels(e.clientX, e.clientY);
  if (isOverImage(newMouseAt)) {
    canvas.classList.remove('image-hovered');
  } else {
    canvas.classList.add('image-hovered');
  }

  if (e.buttons == 1) {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, imageTexture);
    drawLine(mouseAt, newMouseAt);
    render();
    mouseAt = newMouseAt;
  }
}

function onReady() {
  canvas = document.getElementById('canvas');

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);

  gl = canvas.getContext('webgl2');
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
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
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.useProgram(backgroundProgram);
  gl.uniform2f(resolutionUniform, gl.canvas.width, gl.canvas.height);
  gl.bindVertexArray(backgroundVao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
  gl.useProgram(null);

  if (imageTexture) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
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
  if (!image) return;

  let windowAspect = canvas.width / canvas.height;
  let imageAspect = image.aspectRatio();

  if (windowAspect < imageAspect) {
    projection = Matrix4.ortho(-1, 1, -1 / windowAspect * imageAspect, 1 / windowAspect * imageAspect);
    inverseProjection = Matrix4.inverseOrtho(-1, 1, -1 / windowAspect * imageAspect, 1 / windowAspect * imageAspect);
  } else {
    projection = Matrix4.ortho(-1 * windowAspect / imageAspect, 1 * windowAspect / imageAspect, -1, 1);
    inverseProjection = Matrix4.inverseOrtho(-1 * windowAspect / imageAspect, 1 * windowAspect / imageAspect, -1, 1);
  }
}

function loadImage(path, width, height, nchannels, pixels) {
  imagePath = path;
  image = new Image(width, height, nchannels, pixels);
  updateProjection();
  gl.activeTexture(gl.TEXTURE1);
  imageTexture = createTexture(gl, width, height, nchannels, pixels);
  render();
}

function saveImage(path) {
  sharp(image.bytes, {
    raw: {
      width: image.width,
      height: image.height,
      channels: image.nchannels,
    }
  }).toFile(imagePath, error => {
    console.log("error:", error);
  });
}

require('electron').ipcRenderer.on('loadImage', (event, path, width, height, nchannels, pixels) => {
  loadImage(path, width, height, nchannels, pixels);
});

require('electron').ipcRenderer.on('saveAs', function(event, data) {
  fsdialog.showSaveDialog({
    title: 'Save as...',
  }, function(path) {
    imagePath = path;
    saveImage(imagePath);
  });
});

require('electron').ipcRenderer.on('save', function(event, data) {
  saveImage(imagePath);
});

window.addEventListener('load', onReady);
window.addEventListener('resize', onSize, false);
