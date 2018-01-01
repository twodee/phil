const sharp = require('sharp');
const fsdialog = require('electron').remote.dialog;

// Tools
let activeToolDiv;
let tools = {};

// Undos
let undosList;
let history;

// Color
let rgbWidgets;
let channelsRoot;
let selectedColor = [0, 255, 0, 255];

let lockAxis = null;

let integerPattern = /^\d+$/;
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

class UndoHistory {
  constructor(image) {
    this.latestId = 0;
    this.current = null;
    this.undos = [];
    this.original = image;
  }

  commit() {
    if (!this.current) return;

    this.current.id = this.latestId;
    ++this.latestId;

    let div = document.createElement('div');
    let id = this.current.id;

    div.classList.add('undoEntry');
    div.id = `undo${id}`;
    div.innerHTML = `<input type="checkbox" class="column0" checked><span class="column1">${this.current.getLabel()}</span><span class="column2">\u2715</span>`;
    undosList.insertBefore(div, undosList.firstChild);

    let checkbox = document.querySelector(`#${div.id} input[type="checkbox"]`);
    checkbox.addEventListener('click', e => {
      if (checkbox.checked) {
        this.redo(id, e.shiftKey);
      } else {
        this.undo(id, e.shiftKey);
      }
    });

    let deleteButton = document.querySelector(`#${div.id} > .column2`);
    deleteButton.addEventListener('click', e => {
      this.remove(id, e.shiftKey);
    });

    this.current.checkbox = checkbox;
    this.current.div = div;
    this.undos.push(this.current);
    this.current = null;
  }

  begin(undoable) {
    this.current = undoable;
  }

  indexOf(id) {
    for (let i = this.undos.length - 1; i >= 0; --i) {
      if (this.undos[i].id == id) {
        return i;
      }
    }
    return -1;
  }

  modify(id, includeSuccessors, state) {
    for (let i = this.undos.length - 1; i >= 0; --i) {
      if (this.undos[i].id == id || includeSuccessors) {
        this.undos[i].checkbox.checked = state;
        this.undos[i].isDone = state;
        this.undos[i].setPixelsToLatest(history);
      }

      if (this.undos[i].id == id) {
        break;
      }
    }

    render();
  }

  remove(id, includeSuccessors) {
    this.modify(id, includeSuccessors, false);

    let i;
    for (i = this.undos.length - 1; i >= 0; --i) {
      if (this.undos[i].id == id || includeSuccessors) {
        undosList.removeChild(this.undos[i].div);
      }

      if (this.undos[i].id == id) {
        break;
      }
    }

    if (includeSuccessors) {
      this.undos.splice(i, this.undos.length - i);
    } else {
      this.undos.splice(i, 1);
    }
  }

  undo(id, includeSuccessors) {
    this.modify(id, includeSuccessors, false);
  }

  redo(id, includeSuccessors) {
    this.modify(id, includeSuccessors, true);
  }

  getMostRecentColor(c, r) {
    for (let i = this.undos.length - 1; i >= 0; --i) {
      if (this.undos[i].isDone) {
        let color = this.undos[i].getColor(c, r);
        if (color) {
          return color;
        }
      }
    }
    return this.original.get(c, r);
  }
}

class Undoable {
  constructor(id) {
    this.id = id;
    this.timestamp = new Date();
    this.isDone = true;
    this.checkbox = null;
    this.div = null;
  }

  setPixelsToLatest(history) {
  }

  getLabel() {
    let label = '';
    
    label += this.timestamp.getFullYear();
    label += '/';
    label += this.timestamp.getMonth() + 1;
    label += '/';
    label += this.timestamp.getDate();

    label += ' ';

    if (this.timestamp.getHours() < 10) {
      label += '0';
    }
    label += this.timestamp.getHours();
    label += ':';
    if (this.timestamp.getMinutes() < 10) {
      label += '0';
    }
    label += this.timestamp.getMinutes();
    label += ':';
    if (this.timestamp.getSeconds() < 10) {
      label += '0';
    }
    label += this.timestamp.getSeconds();
    
    return label;
  }

  getColor(c, r) {
  }
}

class UndoablePixels extends Undoable {
  constructor(id) {
    super(id);
    this.pixels = new Map();
  }

  setPixelsToLatest(history) {
    for (let pixel of this.pixels.values()) {
      image.set(pixel.x, pixel.y, history.getMostRecentColor(pixel.x, pixel.y));
    }
  }

  getLabel() {
    let label = this.pixels.length == 1 ? 'pixel' : 'pixels';
    return super.getLabel() + ' (' + this.pixels.size + ' ' + label + ')';
  }

  add(x, y, color) {
    let key = x + ',' + y;
    if (this.pixels.has(key)) {
      this.pixels.get(key).color = color;
    } else {
      this.pixels.set(key, {x: x, y: y, color: color});
    }
  }

  getColor(x, y) {
    let key = x + ',' + y;
    if (this.pixels.has(key)) {
      return this.pixels.get(key).color;
    }
  }
}

class Image {
  constructor(width, height, nchannels, pixels) {
    this.size = [width, height];
    this.nchannels = nchannels;
    this.bytes = pixels;
  }

  clone() {
    let newBytes = new Uint8Array(this.bytes.length);
    for (let i = 0; i < newBytes.length; ++i) {
      newBytes[i] = this.bytes[i];
    }
    return new Image(this.width, this.height, this.nchannels, newBytes);
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

  get(c, r) {
    var start = (r * this.width + c) * 4;
    return [
      this.bytes[start + 0],
      this.bytes[start + 1],
      this.bytes[start + 2],
      this.bytes[start + 3],
    ];
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

  equals(that) {
    return this.x == that.x && this.y == that.y;
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

function drawPixel(p) {
  if (p.x >= 0 && p.x < image.width && p.y >= 0 && p.y < image.height) {
    history.current.add(p.x, p.y, selectedColor.slice(0));
    image.set(p.x, p.y, selectedColor);
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
    // selectedColor = [0, 0, 0, 255];
  // } else {
    // selectedColor = [0, 0, 0, Math.round(0.1 * 255)];
  }
  mouseAt = mouseToPixels(e.clientX, e.clientY);

  if (activeToolDiv == tools.pencil) {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, imageTexture);
    history.begin(new UndoablePixels());
    drawPixel(mouseAt);
    render();
  }
  
  else if (activeToolDiv == tools.eyedropper) {
    if (isOverImage(mouseAt)) {
      selectColor(image.get(mouseAt.x, mouseAt.y));
    }
  }
}

function isOverImage(p) {
  return p.x >= 0 && p.x < image.width && p.y >= 0 && p.y < image.height;
}

function selectColor(rgba) {
  selectedColor = rgba;
  syncWidgetsToColor();
}

function onMouseUp(e) {
  history.commit();
  lockAxis = null;
}

function onMouseMove(e) {
  if (!image) return;

  let newMouseAt = mouseToPixels(e.clientX, e.clientY);

  if (lockAxis == null && mouseAt && !newMouseAt.equals(mouseAt) && e.shiftKey) {
    let diff = newMouseAt.subtract(mouseAt).abs();
    if (diff.x > diff.y) {
      lockAxis = 1;
    } else {
      lockAxis = 0;
    }
  }

  if (lockAxis == 0) {
    newMouseAt.x = mouseAt.x;
  } else if (lockAxis == 1) {
    newMouseAt.y = mouseAt.y;
  }

  if (isOverImage(newMouseAt)) {
    canvas.classList.add('imageHovered');
  } else {
    canvas.classList.remove('imageHovered');
  }

  if (activeToolDiv == tools.pencil) {
    if (e.buttons == 1) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, imageTexture);
      drawLine(mouseAt, newMouseAt);
      render();
      mouseAt = newMouseAt;
    }
  }

  else if (activeToolDiv == tools.eyedropper) {
    mouseAt = newMouseAt;
    if (e.buttons == 1 && isOverImage(mouseAt)) {
      selectColor(image.get(mouseAt.x, mouseAt.y));
    }
  }
}

function onReady() {
  canvas = document.getElementById('canvas');
  undosList = document.getElementById('undosList');
  channelsRoot = document.getElementById('channelsRoot');

  gl = canvas.getContext('webgl2');
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  createBackground();
  createImage();
  render();

  registerCallbacks();
  onSize();
}

function registerCallbacks() {
  // RGB sliders
  rgbWidgets = [
    {
      slider: document.getElementById('redSlider'),
      box: document.getElementById('redBox'),
    },
    {
      slider: document.getElementById('greenSlider'),
      box: document.getElementById('greenBox'),
    },
    {
      slider: document.getElementById('blueSlider'),
      box: document.getElementById('blueBox'),
    },
    {
      slider: document.getElementById('alphaSlider'),
      box: document.getElementById('alphaBox'),
    },
  ];

  for (let [i, widget] of rgbWidgets.entries()) {
    initializeChannelWidgets(i, widget.slider, widget.box);
  }

  // Tools
  tools.pencil = document.getElementById('pencil');
  tools.eyedropper = document.getElementById('eyedropper');
  tools.bucket = document.getElementById('bucket');

  activateTool(tools.pencil);
  for (var tool in tools) {
    tools[tool].addEventListener('click', e => {
      activateTool(e.srcElement);
    });
  }

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
}

function activateTool(div) {
  if (activeToolDiv) {
    activeToolDiv.classList.remove('active');
  }
  activeToolDiv = div;
  activeToolDiv.classList.add('active');
}

function syncColor() {
  channelsRoot.style['background-color'] = `rgb(${selectedColor[0]}, ${selectedColor[1]}, ${selectedColor[2]})`;
}

function syncWidgetsToColor() {
  syncColor();
  for (let [i, widget] of rgbWidgets.entries()) {
    widget.slider.value = selectedColor[i];
    widget.box.value = selectedColor[i];
  }
}

function initializeChannelWidgets(i, slider, box) {
  syncColor();
  box.value = selectedColor[i];
  slider.value = selectedColor[i];

  slider.addEventListener('input', () => {
    selectedColor[i] = parseInt(slider.value);
    box.value = selectedColor[i];
    syncColor();
  });

  box.addEventListener('input', () => {
    if (integerPattern.test(box.value)) {
      selectedColor[i] = parseInt(box.value);
      slider.value = selectedColor[i];
      syncColor();
    }
  });
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
  history = new UndoHistory(image.clone());
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

let saveAsPath;

function saveAs() {
  let defaultPath;
  if (saveAsPath) {
    defaultPath = saveAsPath;
  } else if (imagePath) {
    defaultPath = imagePath;
  } else {
    defaultPath = 'untitled.png';
  }

  fsdialog.showSaveDialog({
    title: 'Save as...',
    defaultPath: defaultPath,
  }, function(path) {
    if (path) {
      saveAsPath = path;
      if (/\.(png|jpg)$/.test(path)) {
        imagePath = saveAsPath;
        saveImage(imagePath);
      } else {
        fsdialog.showMessageBox({
          message: `The file must have a .png or .jpg extension. ${path} does not.`,
        }, () => {
          saveAs();
        });
      }
    }
  });
}

require('electron').ipcRenderer.on('saveAs', function(event, data) {
  saveAs();
});

require('electron').ipcRenderer.on('save', function(event, data) {
  saveImage(imagePath);
});

window.addEventListener('load', onReady);
window.addEventListener('resize', onSize, false);
