const sharp = require('sharp');
const fs = require('fs');
const Dialogs = require('dialogs');
const { ipcRenderer, remote } = require('electron')
const { dialog } = remote;
const { Color, Image, Matrix4, Vector2, Texture } = require('./twodee');
let dialogs = Dialogs();

class DrawingMode {
}
DrawingMode.None = 0;
DrawingMode.RotationalMirroring = 1;
DrawingMode.ArrayTiling = 2;

class Tool {
}
Tool.Pencil = 0;
Tool.Dropper = 1;
Tool.Bucket = 2;
Tool.Syringe = 3;
Tool.Eraser = 4;
Tool.Rectangle = 5;

let preferencesPath = require('os').homedir() + '/.phil.json';
let isDirty;
let tools;

// Lines
let linesProgram;
let linesProjectionUniform;
let linesModelviewUniform;
let linesColorUniform;

let outlineProgram;
let outlineProjectionUniform;
let outlineModelviewUniform;
let outlineColorUniform;
let outlineScaleUniform;

let selectionIndexBuffer;
let borderIndexBuffer;
let gridIndexBuffer;
let arrayTilingIndexBuffer;
let rotationalMirroringAxesIndexBuffer;

// Grid
let isGridShownBox;
let gridVao;
let gridVbo;
let gridCellWidthBox;
let gridCellHeightBox;
let gridLineCount;

// Border
let borderVao;
let borderVbo;

// Selection
let selectionVao;
let selectionVbo;

// Rotational mirroring
let rotationalMirroringAxesVao;
let rotationalMirroringAxesVbo;

// Array tiling
let arrayTilingGridVao;
let arrayTilingGridVbo;
let arrayTilingLineCount;

// Autodrawing widgets
let autoDrawNoneButton;
let autoDrawRotationalMirroringButton;
let autoDrawArrayTilingButton;
let wedgeCountBox;
let rotationOffsetBox;
let tileWidthBox;
let tileHeightBox;

// Tools
let pendingTool = null;
let pixelCoordinatesBox;
let rectangleStart = null;
let rectangleStop = null;
let isSelectionAnchored = [false, false];

// Undos
let undosList;
let history;

// Color
let rgbWidgets;
let hsvWidgets;
let channelsRoot;
let colorPreview;
let backgroundColorPreview;
let colorHistoryRoot;

let shiftWrapButton;
let horizontalShiftWrapBox;
let verticalShiftWrapBox;

let resizeButton;
let resizeLeftBox;
let resizeRightBox;
let resizeTopBox;
let resizeBottomBox;

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
let modelviewUniform;

let projection;
let inverseProjection;

let imagePath;
let image;
let mouseScreen;
let mouseObject;
let mouseImage;

let isShift;

let modelview;
let scale;

class UndoHistory {
  constructor(image) {
    this.latestId = 0;
    this.current = null;
    this.undos = [];
    this.original = image;
  }

  commit() {
    if (!this.current) return;

    if (!this.current.isEffective) {
      this.current = null;
      return;
    }

    this.current.id = this.latestId;
    ++this.latestId;

    let div = document.createElement('div');
    let id = this.current.id;

    div.classList.add('grid3');
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

  undoMostRecent() {
    for (let i = this.undos.length - 1; i >= 0; --i) {
      if (this.undos[i].isDone) {
        this.undos[i].checkbox.checked = false;
        this.undos[i].isDone = false;
        this.undos[i].setPixelsToLatest(this);
        render();
        return;
      }
    }
  }

  redoMostRecent() {
    for (let i = this.undos.length - 1; i >= 0 && !this.undos[i].isDone; --i) {
      if (i == 0 || this.undos[i - 1].isDone) {
        this.undos[i].checkbox.checked = true;
        this.undos[i].isDone = true;
        this.undos[i].setPixelsToLatest(this);
        render();
        return;
      }
    }
  }

  getMostRecentSize() {
    for (let i = this.undos.length - 1; i >= 0; --i) {
      if (this.undos[i].isDone) {
        if (this.undos[i] instanceof UndoableImage) {
          return this.undos[i].newImage.size;
        }
      }
    }
    return this.original.size;
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
    
    // label += this.timestamp.getFullYear();
    // label += '/';
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

class UndoableImage extends Undoable {
  constructor(id) {
    super(id);
    this.newImage = null;
  }

  get isEffective() {
    return this.newImage != null;
  }

  setPixelsToLatest(history) {
    let size = history.getMostRecentSize();
    image.resize(size.x, size.y);

    for (let r = 0; r < image.height; ++r) {
      for (let c = 0; c < image.width; ++c) {
        let color = history.getMostRecentColor(c, r);
        image.set(c, r, color);
      }
    }

    imageTexture.upload();
    updateProjection();
  }

  getLabel() {
    return super.getLabel() + ' (resize to ' + this.newImage.width + 'x' + this.newImage.height + ')';
  }

  getColor(x, y) {
    let p = new Vector2(x, y);
    if (this.newImage.containsPixel(p)) {
      return this.newImage.get(x, y);
    } else {
      return null;
    }
  }
}

class UndoablePixels extends Undoable {
  constructor(id) {
    super(id);
    this.pixels = new Map();
  }

  setPixelsToLatest(history) {
    for (let pixel of this.pixels.values()) {
      if (image.containsPixel(pixel)) {
        image.set(pixel.x, pixel.y, history.getMostRecentColor(pixel.x, pixel.y));
        imageTexture.uploadPixel(pixel.x, pixel.y);
      }
    }
  }

  get isEffective() {
    return this.pixels.size > 0;
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
    } else {
      return null;
    }
  }
}

class Configuration {
  constructor() {
    this.activeTool = Tool.Pencil;
    this.isGridShown = false;
    this.tileSize = new Vector2(8, 8);
    this.wedgeCount = 3;
    this.rotationOffset = 0;
    this.drawingMode = DrawingMode.None;
    this.foregroundColor = Color.fromBytes(0, 0, 0, 255);
    this.backgroundColor = Color.fromBytes(255, 255, 255, 0);
    this.gridCellSize = new Vector2(4, 4);
    this.isPanelOpened = {
      tools: true,
      information: false,
      color: false,
      autodraw: false,
      grid: false,
      effects: false,
      undo: false,
      canvas: false,
    };
  }

  simplify() {
    let object = {};
    for (let key in this) {
      if (this.hasOwnProperty(key)) {
        if (this[key] instanceof Vector2) {
          object[key] = this[key].values;
        } else if (this[key] instanceof Color) {
          object[key] = this[key].values;
        } else {
          object[key] = this[key];
        }
      }
    }
    return object;
  }

  static fromPojo(pojo) {
    let configuration = Object.assign(new Configuration(), pojo);
    configuration.foregroundColor = Color.fromByteArray(configuration.foregroundColor);
    configuration.backgroundColor = Color.fromByteArray(configuration.backgroundColor);
    configuration.tileSize = Vector2.fromArray(configuration.tileSize);
    configuration.gridCellSize = Vector2.fromArray(configuration.gridCellSize);
    return configuration;
  }
}

let configuration;

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
  backgroundTexture = Texture.createTexture(2, 2, 4, checker);

  backgroundTextureUniform = gl.getUniformLocation(backgroundProgram, 'backgroundTexture');
  resolutionUniform = gl.getUniformLocation(backgroundProgram, 'resolution');

  gl.useProgram(backgroundProgram);
  gl.uniform1i(backgroundTextureUniform, 0);
  gl.useProgram(null);
}

function createOutlineProgram() {
  let vertexSource = `#version 300 es
uniform mat4 projection;
uniform mat4 modelview;
uniform float scale;
in vec4 position;
in vec2 offset;

void main() {
  gl_Position = projection * modelview * (position + vec4(offset * scale, 0.0, 0.0));
}
  `;

  let fragmentSource = `#version 300 es
precision mediump float;
uniform vec4 color;
out vec4 fragmentColor;

void main() {
  fragmentColor = color;
}
  `; 

  let vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
  let fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
  outlineProgram = linkProgram(vertexShader, fragmentShader);

  outlineProjectionUniform = gl.getUniformLocation(outlineProgram, 'projection');
  outlineModelviewUniform = gl.getUniformLocation(outlineProgram, 'modelview');
  outlineColorUniform = gl.getUniformLocation(outlineProgram, 'color');
  outlineScaleUniform = gl.getUniformLocation(outlineProgram, 'scale');
}

function createLinesProgram() {
  let vertexSource = `#version 300 es
uniform mat4 projection;
uniform mat4 modelview;
in vec4 position;

void main() {
  gl_Position = projection * modelview * position;
}
  `;

  let fragmentSource = `#version 300 es
precision mediump float;
uniform vec4 color;
out vec4 fragmentColor;

void main() {
  fragmentColor = color;
}
  `; 

  let vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
  let fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
  linesProgram = linkProgram(vertexShader, fragmentShader);

  linesProjectionUniform = gl.getUniformLocation(linesProgram, 'projection');
  linesModelviewUniform = gl.getUniformLocation(linesProgram, 'modelview');
  linesColorUniform = gl.getUniformLocation(linesProgram, 'color');
}

function createSelectionOutline() {
  selectionVao = gl.createVertexArray();
  gl.bindVertexArray(selectionVao);
  selectionVbo = gl.createBuffer();
  // updateSelectionOutline();
}

function createBorder() {
  borderVao = gl.createVertexArray();
  gl.bindVertexArray(borderVao);
  borderVbo = gl.createBuffer();
  updateBorder();
}

function createGrid() {
  gridVao = gl.createVertexArray();
  gl.bindVertexArray(gridVao);
  gridVbo = gl.createBuffer();
  updateGrid();
}

function createRotationalMirroringAxes() {
  rotationalMirroringAxesVao = gl.createVertexArray();
  gl.bindVertexArray(rotationalMirroringAxesVao);
  rotationalMirroringAxesVbo = gl.createBuffer();
  updateRotationalMirroringAxes();
}

function createArrayTilingGrid() {
  arrayTilingGridVao = gl.createVertexArray();
  gl.bindVertexArray(arrayTilingGridVao);
  arrayTilingGridVbo = gl.createBuffer();
  updateArrayTilingGrid();
}

function updateRotationalMirroringAxes() {
  let vertices = [];
  let indices = [];

  let delta = 2 * Math.PI / configuration.wedgeCount;
  for (let i = 0; i < configuration.wedgeCount; ++i) {
    // The anchor is the positive y-axis.
    let base = 2 * Math.PI / 4;
    base += configuration.rotationOffset * Math.PI / 180;

    let theta = i * delta + base;
    let radius = 1.414;
    let x = radius * Math.cos(theta);
    let y = radius * Math.sin(theta);
    let offset = [-Math.sin(theta), Math.cos(theta)];

    vertices.push(0, 0, 0, 1);
    vertices.push(offset[0], offset[1]);

    vertices.push(x, y, 0, 1);
    vertices.push(offset[0], offset[1]);

    vertices.push(0, 0, 0, 1);
    vertices.push(-offset[0], -offset[1]);

    vertices.push(x, y, 0, 1);
    vertices.push(-offset[0], -offset[1]);

    indices.push(i * 4 + 0, i * 4 + 2, i * 4 + 3);
    indices.push(i * 4 + 0, i * 4 + 3, i * 4 + 1);
  }

  gl.bindVertexArray(rotationalMirroringAxesVao);

  gl.bindBuffer(gl.ARRAY_BUFFER, rotationalMirroringAxesVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

  let positionAttributeLocation = gl.getAttribLocation(outlineProgram, 'position');
  gl.vertexAttribPointer(positionAttributeLocation, 4, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(positionAttributeLocation);

  let offsetAttributeLocation = gl.getAttribLocation(outlineProgram, 'offset');
  gl.vertexAttribPointer(offsetAttributeLocation, 2, gl.FLOAT, false, 24, 16);
  gl.enableVertexAttribArray(offsetAttributeLocation);

  rotationalMirroringAxesIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, rotationalMirroringAxesIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
}

function updateArrayTilingGrid() {
  let vertices = [];
  let indices = [];

  arrayTilingLineCount = 0;

  if (image) {
    for (let x = configuration.tileSize.x; x < image.width; x += configuration.tileSize.x) {
      let xx = x / (image.width) * 2 - 1;

      // Left
      vertices.push(xx, -1, 0, 1);
      vertices.push(-1, 0);

      vertices.push(xx, 1, 0, 1);
      vertices.push(-1, 0);

      // Right
      vertices.push(xx, -1, 0, 1);
      vertices.push(1, 0);

      vertices.push(xx, 1, 0, 1);
      vertices.push(1, 0);

      indices.push(arrayTilingLineCount * 4 + 0, arrayTilingLineCount * 4 + 2, arrayTilingLineCount * 4 + 3);
      indices.push(arrayTilingLineCount * 4 + 0, arrayTilingLineCount * 4 + 3, arrayTilingLineCount * 4 + 1);

      arrayTilingLineCount += 1;
    }

    for (let y = configuration.tileSize.y; y < image.height; y += configuration.tileSize.y) {
      let yy = y / (image.height) * 2 - 1;

      // Top
      vertices.push(-1, yy, 0, 1);
      vertices.push(0, 1);

      vertices.push(1, yy, 0, 1);
      vertices.push(0, 1);

      // Bottom
      vertices.push(-1, yy, 0, 1);
      vertices.push(0, -1);

      vertices.push(1, yy, 0, 1);
      vertices.push(0, -1);

      indices.push(arrayTilingLineCount * 4 + 0, arrayTilingLineCount * 4 + 2, arrayTilingLineCount * 4 + 3);
      indices.push(arrayTilingLineCount * 4 + 0, arrayTilingLineCount * 4 + 3, arrayTilingLineCount * 4 + 1);

      arrayTilingLineCount += 1;
    }
  }

  gl.bindVertexArray(arrayTilingGridVao);

  gl.bindBuffer(gl.ARRAY_BUFFER, arrayTilingGridVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

  let positionAttributeLocation = gl.getAttribLocation(outlineProgram, 'position');
  gl.vertexAttribPointer(positionAttributeLocation, 4, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(positionAttributeLocation);

  let offsetAttributeLocation = gl.getAttribLocation(outlineProgram, 'offset');
  gl.vertexAttribPointer(offsetAttributeLocation, 2, gl.FLOAT, false, 24, 16);
  gl.enableVertexAttribArray(offsetAttributeLocation);

  arrayTilingIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, arrayTilingIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
}

function updateGrid() {
  let vertices = [];
  let indices = [];

  gridLineCount = 0;

  if (image) {
    for (let x = configuration.gridCellSize.x; x < image.width; x += configuration.gridCellSize.x) {
      let xx = x / (image.width) * 2 - 1;

      // Left
      vertices.push(xx, -1, 0, 1);
      vertices.push(-1, 0);

      vertices.push(xx, 1, 0, 1);
      vertices.push(-1, 0);

      // Right
      vertices.push(xx, -1, 0, 1);
      vertices.push(1, 0);

      vertices.push(xx, 1, 0, 1);
      vertices.push(1, 0);

      indices.push(gridLineCount * 4 + 0, gridLineCount * 4 + 2, gridLineCount * 4 + 3);
      indices.push(gridLineCount * 4 + 0, gridLineCount * 4 + 3, gridLineCount * 4 + 1);

      gridLineCount += 1;
    }

    for (let y = configuration.gridCellSize.y; y < image.height; y += configuration.gridCellSize.y) {
      let yy = y / (image.height) * 2 - 1;

      // Top
      vertices.push(-1, yy, 0, 1);
      vertices.push(0, 1);

      vertices.push(1, yy, 0, 1);
      vertices.push(0, 1);

      // Bottom
      vertices.push(-1, yy, 0, 1);
      vertices.push(0, -1);

      vertices.push(1, yy, 0, 1);
      vertices.push(0, -1);

      indices.push(gridLineCount * 4 + 0, gridLineCount * 4 + 2, gridLineCount * 4 + 3);
      indices.push(gridLineCount * 4 + 0, gridLineCount * 4 + 3, gridLineCount * 4 + 1);

      gridLineCount += 1;
    }
  }

  gl.bindVertexArray(gridVao);

  gl.bindBuffer(gl.ARRAY_BUFFER, gridVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

  let positionAttributeLocation = gl.getAttribLocation(outlineProgram, 'position');
  gl.vertexAttribPointer(positionAttributeLocation, 4, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(positionAttributeLocation);

  let offsetAttributeLocation = gl.getAttribLocation(outlineProgram, 'offset');
  gl.vertexAttribPointer(offsetAttributeLocation, 2, gl.FLOAT, false, 24, 16);
  gl.enableVertexAttribArray(offsetAttributeLocation);

  gridIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gridIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
}

function updateSelectionOutline() {
  let vertices = [];

  let away = Math.sqrt(2);

  // Inner

  let l = Math.min(rectangleStart.x, rectangleStop.x);
  let r = Math.max(rectangleStart.x, rectangleStop.x);
  let b = Math.min(rectangleStart.y, rectangleStop.y);
  let t = Math.max(rectangleStart.y, rectangleStop.y);

  // Bottom left
  vertices.push(l, b, 0, 1);
  vertices.push(0, 0);

  // Bottom right
  vertices.push(r, b, 0, 1);
  vertices.push(0, 0);

  // Top right
  vertices.push(r, t, 0, 1);
  vertices.push(0, 0);

  // Top left
  vertices.push(l, t, 0, 1);
  vertices.push(0, 0);

  // Outer

  // Bottom left
  vertices.push(l, b, 0, 1);
  vertices.push(-away, -away);

  // Bottom right
  vertices.push(r, b, 0, 1);
  vertices.push(away, -away);

  // Top right
  vertices.push(r, t, 0, 1);
  vertices.push(away, away);

  // Top left
  vertices.push(l, t, 0, 1);
  vertices.push(-away, away);

  let indices = [
    0, 5, 1,
    0, 4, 5,
    1, 6, 2,
    1, 5, 6,
    2, 7, 3,
    2, 6, 7,
    3, 4, 0,
    3, 7, 4,
  ];

  gl.bindVertexArray(selectionVao);

  gl.bindBuffer(gl.ARRAY_BUFFER, selectionVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

  selectionIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, selectionIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

  let positionAttributeLocation = gl.getAttribLocation(outlineProgram, 'position');
  gl.vertexAttribPointer(positionAttributeLocation, 4, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(positionAttributeLocation);

  let offsetAttributeLocation = gl.getAttribLocation(outlineProgram, 'offset');
  gl.vertexAttribPointer(offsetAttributeLocation, 2, gl.FLOAT, false, 24, 16);
  gl.enableVertexAttribArray(offsetAttributeLocation);
}

function updateBorder() {
  let vertices = [];

  let away = Math.sqrt(2);

  // Inner

  // Bottom left
  vertices.push(-1, -1, 0, 1);
  vertices.push(0, 0);

  // Bottom right
  vertices.push(1, -1, 0, 1);
  vertices.push(0, 0);

  // Top right
  vertices.push(1, 1, 0, 1);
  vertices.push(0, 0);

  // Top left
  vertices.push(-1, 1, 0, 1);
  vertices.push(0, 0);

  // Outer

  // Bottom left
  vertices.push(-1, -1, 0, 1);
  vertices.push(-away, -away);

  // Bottom right
  vertices.push(1, -1, 0, 1);
  vertices.push(away, -away);

  // Top right
  vertices.push(1, 1, 0, 1);
  vertices.push(away, away);

  // Top left
  vertices.push(-1, 1, 0, 1);
  vertices.push(-away, away);

  let indices = [
    0, 5, 1,
    0, 4, 5,
    1, 6, 2,
    1, 5, 6,
    2, 7, 3,
    2, 6, 7,
    3, 4, 0,
    3, 7, 4,
  ];

  gl.bindVertexArray(borderVao);

  gl.bindBuffer(gl.ARRAY_BUFFER, borderVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

  borderIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, borderIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

  let positionAttributeLocation = gl.getAttribLocation(outlineProgram, 'position');
  gl.vertexAttribPointer(positionAttributeLocation, 4, gl.FLOAT, false, 24, 0);
  gl.enableVertexAttribArray(positionAttributeLocation);

  let offsetAttributeLocation = gl.getAttribLocation(outlineProgram, 'offset');
  gl.vertexAttribPointer(offsetAttributeLocation, 2, gl.FLOAT, false, 24, 16);
  gl.enableVertexAttribArray(offsetAttributeLocation);
}

function createImage() {
  let vertexSource = `#version 300 es
uniform mat4 projection;
uniform mat4 modelview;
in vec4 position;
in vec2 texCoords;
out vec2 fTexCoords;

void main() {
  gl_Position = projection * modelview * position;
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
  // fragmentColor = vec4(boo * 0.5 + 0.5, 0.0, 1.0);
}
  `; 

  let vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
  let fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
  imageProgram = linkProgram(vertexShader, fragmentShader);

  let vertices = [
    -1.0, -1.0, 0.0, 1.0,
    0.0, 1.0,

    1.0, -1.0, 0.0, 1.0,
    1.0, 1.0,

    -1.0, 1.0, 0.0, 1.0,
    0.0, 0.0,

    1.0, 1.0, 0.0, 1.0,
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
  modelviewUniform = gl.getUniformLocation(imageProgram, 'modelview');

  gl.useProgram(imageProgram);
  gl.uniform1i(imageTextureUniform, 1);
  gl.useProgram(null);
}

function screenToObject(screenX, screenY) {
  let positionScreen = [screenX, screenY];

  // Normalize the screen coordinates to [-1, 1] space.
  let positionNormalized = [
    positionScreen[0] / gl.canvas.width * 2 - 1,
    positionScreen[1] / gl.canvas.height * 2 - 1,
    0,
    1
  ];

  let positionClip = inverseProjection.multiplyVector(positionNormalized);
  let positionObject = modelview.inverse().multiplyVector(positionClip);

  return positionObject;
}

function objectToImage(positionObject) {
  let positionImage = new Vector2(
    Math.floor((positionObject[0] * 0.5 + 0.5) * image.width),
    image.height - 1 - Math.floor((positionObject[1] * 0.5 + 0.5) * image.height)
  );
  return positionImage;
}

function setPixelToColor(p, color) {
  history.current.add(p.x, p.y, color.clone());
  image.set(p.x, p.y, color);
  imageTexture.uploadPixel(p.x, p.y);
}

function drawKnownPixel(p, color) {
  if (configuration.drawingMode == DrawingMode.None) {
    setPixelToColor(p, color);
  } else if (configuration.drawingMode == DrawingMode.ArrayTiling) {
    for (let r = p.y % configuration.tileSize.y; r < image.height; r += configuration.tileSize.y) {
      for (let c = p.x % configuration.tileSize.x; c < image.width; c += configuration.tileSize.x) {
        setPixelToColor(new Vector2(c, r), color);
      }
    }
  } else if (configuration.drawingMode == DrawingMode.RotationalMirroring) {
    let middle = image.size.subtract(new Vector2(1, 1)).multiplyScalar(0.5);
    let diff = p.subtract(middle);
    let radius = diff.magnitude;
    let theta = Math.atan2(diff.y, diff.x);
    let radiansPerWedge = 2 * Math.PI / configuration.wedgeCount;

    // Start at positive x-axis and wind counterclockwise to 2 * pi.
    if (theta < 0) {
      theta = -theta;
    } else {
      theta = 2 * Math.PI - theta;
    }

    theta -= Math.PI * 0.5 + configuration.rotationOffset * Math.PI / 180;

    if (theta < 0) {
      theta += 2 * Math.PI;
    }

    let iWedge0 = Math.floor(theta / radiansPerWedge);
    let radiansFromWedgeStart = theta - iWedge0 * radiansPerWedge;

    for (let i = 0; i < configuration.wedgeCount; ++i) {
      let phi;
      if (i % 2 == iWedge0 % 2) {
        phi = i * radiansPerWedge + radiansFromWedgeStart;
      } else {
        phi = (i + 1) % configuration.wedgeCount * radiansPerWedge - radiansFromWedgeStart;
      }

      phi = -(phi + Math.PI * 0.5 + configuration.rotationOffset * Math.PI / 180);

      let pp = new Vector2(radius * Math.cos(phi), radius * Math.sin(phi)).add(middle).round();
      if (image.containsPixel(pp)) {
        setPixelToColor(pp, color);
      }
    }
  }
}

function drawPixel(p, color) {
  if (image.containsPixel(p)) {
    drawKnownPixel(p, color);
  }
}

function drawLine(from, to, color) {
  let n = Vector2.diagonalDistance(from, to);
  for (let step = 0; step <= n; step += 1) {
    let t = n == 0 ? 0.0 : step / n;
    let p = Vector2.lerp(from, to, t).round(); 
    drawPixel(p, color);
  }
}

function onMouseDown(e) {
  mouseScreen = new Vector2(e.clientX, gl.canvas.height - 1 - e.clientY);
  mouseObject = screenToObject(mouseScreen.x, mouseScreen.y);
  mouseImage = objectToImage(mouseObject);

  if (e.which == 1) {
    if (configuration.activeTool == Tool.Pencil) {
      rememberColor();
      history.begin(new UndoablePixels());
      drawPixel(mouseImage, configuration.foregroundColor);
      render();
    }

    else if (configuration.activeTool == Tool.Eraser) {
      history.begin(new UndoablePixels());
      drawPixel(mouseImage, configuration.backgroundColor);
      render();
    }
    
    else if (configuration.activeTool == Tool.Dropper) {
      if (isOverImage(mouseImage)) {
        selectColor(image.get(mouseImage.x, mouseImage.y));
      }
    }

    else if (configuration.activeTool == Tool.Rectangle) {
      isSelectionAnchored[0] = false;
      isSelectionAnchored[1] = false;
      rectangleStart = new Vector2(mouseObject[0], mouseObject[1]);
      rectangleStop = new Vector2(mouseObject[0], mouseObject[1]);

      updateSelectionOutline();
      render();
    }
  }
}

function isOverImage(p) {
  return p.x >= 0 && p.x < image.width && p.y >= 0 && p.y < image.height;
}

function selectColor(rgba) {
  configuration.foregroundColor = rgba;
  syncWidgetsToColor();
  syncHsv();
}

function onMouseUp(e) {
  // Mouse up gets called on the window to handle going offscreen. But filling
  // should only happen when the bucket is released on the canvas.
  if (e.target == canvas) {
    if (configuration.activeTool == Tool.Bucket) {
      mouseScreen = new Vector2(e.clientX, gl.canvas.height - 1 - e.clientY);
      mouseObject = screenToObject(mouseScreen.x, mouseScreen.y);
      mouseImage = objectToImage(mouseObject);

      if (isOverImage(mouseImage)) {
        history.begin(new UndoablePixels());
        image.fill(mouseImage.x, mouseImage.y, configuration.foregroundColor, e.shiftKey);
        imageTexture.upload();
        rememberColor();
        render();
      }
    } else if (configuration.activeTool == Tool.Syringe) {
      mouseScreen = new Vector2(e.clientX, gl.canvas.height - 1 - e.clientY);
      mouseObject = screenToObject(mouseScreen.x, mouseScreen.y);
      mouseImage = objectToImage(mouseObject);

      if (isOverImage(mouseImage)) {
        history.begin(new UndoablePixels());
        image.replace(mouseImage.x, mouseImage.y, configuration.foregroundColor);
        imageTexture.upload();
        rememberColor();
        render();
      }
    } else if (configuration.activeTool == Tool.Rectangle) {
      if (mouseObject[0] > rectangleStart.x) {
        rectangleStop.x = (mouseImage.x + 1) / image.width * 2 - 1;
      } else if (mouseObject[0] < rectangleStart.x) {
        rectangleStop.x = (mouseImage.x + 0) / image.width * 2 - 1;
      }

      if (mouseObject[1] > rectangleStart.y) {
        rectangleStop.y = (mouseImage.y + 0) / image.height * -2 + 1;
      } else if (mouseObject[1] < rectangleStart.y) {
        rectangleStop.y = (mouseImage.y + 1) / image.height * -2 + 1;
      }

      updateSelectionOutline();
      render();

      rectangleStart = null;
      rectangleStop = null;
    }
  }

  history.commit();
  lockAxis = null;
}

function hotDrop(p) {
  if (isOverImage(p)) {
    selectColor(image.get(p.x, p.y));
  }
}

function onMouseMove(e) {
  if (!image) {
    pixelCoordinatesBox.innerText = `-`;
    return;
  }

  let newMouseScreen = new Vector2(e.clientX, gl.canvas.height - 1 - e.clientY);
  let newMouseObject = screenToObject(newMouseScreen.x, newMouseScreen.y);
  let newMouseImage = objectToImage(newMouseObject);
  pixelCoordinatesBox.innerText = `${newMouseImage.x}, ${newMouseImage.y}`;

  if (configuration.activeTool == Tool.Dropper && pendingTool != null) {
    hotDrop(newMouseImage);
  }

  if (lockAxis == null && mouseImage && !newMouseImage.equals(mouseImage) && e.shiftKey) {
    let diff = newMouseScreen.subtract(mouseScreen).abs();
    if (diff.x > diff.y) {
      lockAxis = 1;
    } else {
      lockAxis = 0;
    }
  }

  if (lockAxis == 0) {
    newMouseScreen.x = mouseScreen.x;
    newMouseImage.x = mouseImage.x;
  } else if (lockAxis == 1) {
    newMouseScreen.y = mouseScreen.y;
    newMouseImage.y = mouseImage.y;
  }

  syncCursor(newMouseImage);

  if (e.which == 1) {
    if (configuration.activeTool == Tool.Pencil) {
      drawLine(mouseImage, newMouseImage, configuration.foregroundColor);
      render();
    }

    else if (configuration.activeTool == Tool.Eraser) {
      drawLine(mouseImage, newMouseImage, configuration.backgroundColor);
      render();
    }

    else if (configuration.activeTool == Tool.Dropper) {
      if (isOverImage(mouseScreen)) {
        selectColor(image.get(newMouseImage.x, newMouseImage.y));
      }
    }

    else if (configuration.activeTool == Tool.Rectangle) {
      rectangleStop = new Vector2(newMouseObject[0], newMouseObject[1]);

      // if moving s, round n
      // if moving n, round s
      // if moving e, round w
      // if moving w, round e
 
      if (!isSelectionAnchored[0]) {
        if (newMouseObject[0] > mouseObject[0]) {
          rectangleStart.x = mouseImage.x / image.width * 2 - 1;
          isSelectionAnchored[0] = true;
        } else if (newMouseObject[0] < mouseObject[0]) {
          rectangleStart.x = (mouseImage.x + 1) / image.width * 2 - 1;
          isSelectionAnchored[0] = true;
        }
      }
 
      if (!isSelectionAnchored[1]) {
        if (newMouseObject[1] > mouseObject[1]) {
          rectangleStart.y = (mouseImage.y + 1) / image.height * -2 + 1;
          isSelectionAnchored[1] = true;
        } else if (newMouseObject[1] < mouseObject[1]) {
          rectangleStart.y = (mouseImage.y + 0) / image.height * -2 + 1;
          isSelectionAnchored[1] = true;
        }
      }

      updateSelectionOutline();
      render();
    }
  } else if (e.which == 3) {
    let diff = newMouseScreen.subtract(mouseScreen);
    let aspectRatio = canvas.width / canvas.height;
    let constraints = aspectRatio >= 1 ? new Vector2(2 * aspectRatio, 2) : new Vector2(2, 2 / aspectRatio);
    diff = diff.divideVector(new Vector2(canvas.width, canvas.height)).multiplyVector(constraints);
    modelview = Matrix4.translate(diff.x, diff.y, 0).multiplyMatrix(modelview);
    render();
  }

  mouseScreen = newMouseScreen;
  mouseObject = newMouseObject;
  mouseImage = newMouseImage;
}

function syncCursor(mousePosition) {
  canvas.classList.remove('pencilHovered', 'bucketHovered', 'dropperHovered', 'syringeHovered', 'eraserHovered', 'rectangleHovered');

  if (mousePosition && isOverImage(mousePosition)) {
    if (configuration.activeTool == Tool.Pencil) {
      canvas.classList.add('pencilHovered');
    } else if (configuration.activeTool == Tool.Bucket) {
      canvas.classList.add('bucketHovered');
    } else if (configuration.activeTool == Tool.Dropper) {
      canvas.classList.add('dropperHovered');
    } else if (configuration.activeTool == Tool.Syringe) {
      canvas.classList.add('syringeHovered');
    } else if (configuration.activeTool == Tool.Eraser) {
      canvas.classList.add('eraserHovered');
    } else if (configuration.activeTool == Tool.Rectangle) {
      canvas.classList.add('rectangleHovered');
    }
  }
}

function onMouseWheel(e) {
  let factor = 1 - e.deltaY / 100;
  if (scale * factor > 0.1) {
    scale *= factor;
    modelview = Matrix4.scale(factor, factor, 1).multiplyMatrix(modelview);
  }
  render();
}

function onReady() {
  try {
    let json = fs.readFileSync(preferencesPath, 'utf8');
    let pojo = JSON.parse(json);
    configuration = Configuration.fromPojo(pojo);
  } catch (e) {
    configuration = new Configuration();
  }
  
  // Grab references to widgets.
  canvas = document.getElementById('canvas');
  undosList = document.getElementById('undosList');
  channelsRoot = document.getElementById('channelsRoot');
  colorPreview = document.getElementById('colorPreview');
  backgroundColorPreview = document.getElementById('backgroundColorPreview');
  colorHistoryRoot = document.getElementById('colorHistoryRoot');
  resizeButton = document.getElementById('resizeButton');
  resizeLeftBox = document.getElementById('resizeLeftBox');
  resizeRightBox = document.getElementById('resizeRightBox');
  resizeTopBox = document.getElementById('resizeTopBox');
  resizeBottomBox = document.getElementById('resizeBottomBox');
  shiftWrapButton = document.getElementById('shiftWrapButton');
  horizontalShiftWrapBox = document.getElementById('horizontalShiftWrapBox');
  verticalShiftWrapBox = document.getElementById('verticalShiftWrapBox');
  pixelCoordinatesBox = document.getElementById('pixelCoordinatesBox');
  autoDrawNoneButton = document.getElementById('autoDrawNoneButton');
  autoDrawRotationalMirroringButton = document.getElementById('autoDrawRotationalMirroringButton');
  autoDrawArrayTilingButton = document.getElementById('autoDrawArrayTilingButton');
  wedgeCountBox = document.getElementById('wedgeCountBox');
  rotationOffsetBox = document.getElementById('rotationOffsetBox');
  tileWidthBox = document.getElementById('tileWidthBox');
  tileHeightBox = document.getElementById('tileHeightBox');
  gridCellWidthBox = document.getElementById('gridCellWidthBox');
  gridCellHeightBox = document.getElementById('gridCellHeightBox');
  isGridShownBox = document.getElementById('isGridShownBox');

  // Set default state.
  modelview = new Matrix4();
  isShift = false;

  // Initialize OpenGL.
  gl = canvas.getContext('webgl2');
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  createBackground();
  createImage();
  createLinesProgram();
  createOutlineProgram();
  createArrayTilingGrid();
  createRotationalMirroringAxes();
  createGrid();
  createBorder();
  createSelectionOutline();

  render();

  syncWidgets();
  registerCallbacks();
  onSize();

  isDirty = false;
  scale = 1.0;
}

function syncWidgets() {
  if (configuration.drawingMode == DrawingMode.None) {
    autoDrawNoneButton.checked = true;
  } else if (configuration.drawingMode == DrawingMode.RotationalMirroring) {
    autoDrawRotationalMirroringButton.checked = true;
  } else if (configuration.drawingMode == DrawingMode.ArrayTiling) {
    autoDrawArrayTilingButton.checked = true;
  }

  wedgeCountBox.value = configuration.wedgeCount;
  rotationOffsetBox.value = configuration.rotationOffset;
  tileWidthBox.value = configuration.tileSize.x;
  tileHeightBox.value = configuration.tileSize.y;
  gridCellWidthBox.value = configuration.gridCellSize.x;
  gridCellHeightBox.value = configuration.gridCellSize.y;
  isGridShownBox.checked = configuration.isGridShown;

  updateBackgroundColorPreview();
}

function assertIntegerGreaterThan(input, minimum, action) {
  let isOkay = false;

  if (isInteger(input.value)) {
    let value = parseInt(input.value);
    if (value > minimum) {
      action(value);
      isOkay = true;
    }
  }

  if (isOkay) {
    input.classList.remove('error');
  } else {
    input.classList.add('error');
  }
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
    initializeRgbWidget(i, widget.slider, widget.box);
  }

  hsvWidgets = [
    {
      slider: document.getElementById('hueSlider'),
      box: document.getElementById('hueBox'),
    },
    {
      slider: document.getElementById('saturationSlider'),
      box: document.getElementById('saturationBox'),
    },
    {
      slider: document.getElementById('valueSlider'),
      box: document.getElementById('valueBox'),
    },
  ];

  for (let [i, widget] of hsvWidgets.entries()) {
    initializeHsvWidget(i, widget.slider, widget.box);
  }
  syncHsv();

  // Tools
  tools = new Array(5);
  tools[Tool.Pencil] = document.getElementById('pencil');
  tools[Tool.Dropper] = document.getElementById('dropper');
  tools[Tool.Bucket] = document.getElementById('bucket');
  tools[Tool.Syringe] = document.getElementById('syringe');
  tools[Tool.Eraser] = document.getElementById('eraser');
  tools[Tool.Rectangle] = document.getElementById('rectangle');

  activateTool(configuration.activeTool);
  for (let iTool = 0; iTool < tools.length; ++iTool) {
    tools[iTool].addEventListener('click', e => {
      activateTool(iTool);
    });
  }

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('wheel', onMouseWheel);
  window.addEventListener('mouseup', onMouseUp);

  window.addEventListener('keydown', e => {
    let hasModifier = e.altKey || e.ctrlKey || e.metaKey || e.shiftKey;
    if (!hasModifier) {
      if (e.key == 'p') {
        activateTool(Tool.Pencil);
      } else if (e.key == 'd') {
        activateTool(Tool.Dropper);
      } else if (e.key == 'b') {
        activateTool(Tool.Bucket);
      } else if (e.key == 's') {
        activateTool(Tool.Syringe);
      } else if (e.key == 'e') {
        activateTool(Tool.Eraser);
      } else if (e.key == 'r') {
        activateTool(Tool.Rectangle);
      } else if (e.key == '[') {
        history.undoMostRecent();
      } else if (e.key == ']') {
        history.redoMostRecent();
      } else if (e.key == 'z' && pendingTool == null) {
        hotDrop(mouseImage);
        pendingTool = configuration.activeTool;
        activateTool(Tool.Dropper);
      }
    } else if (e.key == 'Shift') {
      isShift = true;
    }
  });

  window.addEventListener('keyup', e => {
    if (e.key == 'Shift') {
      isShift = false;
    } else if (e.key == 'z') {
      activateTool(pendingTool);
      pendingTool = null;
    }
  });
  
  shiftWrapButton.addEventListener('click', () => {
    let dc = parseInt(horizontalShiftWrapBox.value);
    let dr = parseInt(verticalShiftWrapBox.value);

    history.begin(new UndoableImage());
    image.shiftWrap(dc, dr);

    imageTexture.upload();
    render();

    history.current.newImage = image.clone();
    history.commit();
  });

  resizeButton.addEventListener('click', () => {
    let l = parseInt(resizeLeftBox.value);
    let r = parseInt(resizeRightBox.value);
    let b = parseInt(resizeBottomBox.value);
    let t = parseInt(resizeTopBox.value);

    if (isNaN(l)) l = 0;
    if (isNaN(r)) r = 0;
    if (isNaN(t)) t = 0;
    if (isNaN(b)) b = 0;

    history.begin(new UndoableImage());
    image.resizeDelta(t, r, b, l);

    updateArrayTilingGrid();
    updateGrid();

    imageTexture.upload();
    updateProjection();
    render();

    resizeTopBox.value = '';
    resizeRightBox.value = '';
    resizeBottomBox.value = '';
    resizeLeftBox.value = '';

    history.current.newImage = image.clone();
    history.commit();
  });

  resizeTopBox.addEventListener('input', syncResizeButton);
  resizeRightBox.addEventListener('input', syncResizeButton);
  resizeBottomBox.addEventListener('input', syncResizeButton);
  resizeLeftBox.addEventListener('input', syncResizeButton);

  let headers = document.querySelectorAll('.panelHeader');
  for (let header of headers) {
    let key = header.id.replace(/Header$/, '');

    header.addEventListener('click', e => {
      let headerDiv = e.target;
      headerDiv.classList.toggle('open');
      configuration.isPanelOpened[key] = headerDiv.classList.contains('open');
    });

    if (configuration.isPanelOpened[key]) {
      header.classList.add('open');
    } else {
      header.classList.remove('open');
    }
  }

  document.getElementById('nameColor').addEventListener('click', nameColor);

  autoDrawNoneButton.addEventListener('click', () => {
    configuration.drawingMode = DrawingMode.None; 
    render();
  });

  autoDrawRotationalMirroringButton.addEventListener('click', () => {
    configuration.drawingMode = DrawingMode.RotationalMirroring; 
    render();
  });

  autoDrawArrayTilingButton.addEventListener('click', () => {
    configuration.drawingMode = DrawingMode.ArrayTiling; 
    render();
  });

  let foregroundToBackgroundButton = document.getElementById('foregroundToBackgroundButton');
  foregroundToBackgroundButton.addEventListener('click', () => {
    configuration.backgroundColor = configuration.foregroundColor.clone();
    updateBackgroundColorPreview();
  });

  let backgroundToForegroundButton = document.getElementById('backgroundToForegroundButton');
  backgroundToForegroundButton.addEventListener('click', () => {
    selectColor(configuration.backgroundColor.clone());
  });

  wedgeCountBox.addEventListener('input', e => {
    assertIntegerGreaterThan(wedgeCountBox, 1, value => {
      configuration.wedgeCount = value;
      updateRotationalMirroringAxes();
      render();
    });
  });

  rotationOffsetBox.addEventListener('input', e => {
    configuration.rotationOffset = parseFloat(rotationOffsetBox.value);
    updateRotationalMirroringAxes();
    render();
  });

  tileWidthBox.addEventListener('input', e => {
    assertIntegerGreaterThan(tileWidthBox, 0, value => {
      configuration.tileSize.x = value;
      updateArrayTilingGrid();
      render();
    });
  });

  tileHeightBox.addEventListener('input', e => {
    assertIntegerGreaterThan(tileHeightBox, 0, value => {
      configuration.tileSize.y = value;
      updateArrayTilingGrid();
      render();
    });
  });

  gridCellWidthBox.addEventListener('input', e => {
    assertIntegerGreaterThan(gridCellWidthBox, 0, value => {
      configuration.gridCellSize.x = value;
      updateGrid();
      render();
    });
  });

  gridCellHeightBox.addEventListener('input', e => {
    assertIntegerGreaterThan(gridCellHeightBox, 0, value => {
      configuration.gridCellSize.y = value;
      updateGrid();
      render();
    });
  });

  isGridShownBox.addEventListener('click', e => {
    configuration.isGridShown = isGridShownBox.checked;
    render();
  });

  let outlineFourButton = document.getElementById('outlineFourButton');
  outlineFourButton.addEventListener('click', e => {
    history.begin(new UndoableImage());
    image.outline4(configuration.backgroundColor, configuration.foregroundColor);
    imageTexture.upload();
    render();
    history.current.newImage = image.clone();
    history.commit();
  });

  let flipLeftRightButton = document.getElementById('flipLeftRightButton');
  flipLeftRightButton.addEventListener('click', e => {
    history.begin(new UndoableImage());
    image.flipLeftRight();
    imageTexture.upload();
    render();
    history.current.newImage = image.clone();
    history.commit();
  });

  let flipTopBottomButton = document.getElementById('flipTopBottomButton');
  flipTopBottomButton.addEventListener('click', e => {
    history.begin(new UndoableImage());
    image.flipTopBottom();
    imageTexture.upload();
    render();
    history.current.newImage = image.clone();
    history.commit();
  });

  let rotate180Button = document.getElementById('rotate180Button');
  rotate180Button.addEventListener('click', e => {
    history.begin(new UndoableImage());
    image.rotate180();
    imageTexture.upload();
    updateProjection();
    render();
    history.current.newImage = image.clone();
    history.commit();
  });

  let rotateClockwiseButton = document.getElementById('rotateClockwiseButton');
  rotateClockwiseButton.addEventListener('click', e => {
    history.begin(new UndoableImage());
    image.rotateClockwise();
    imageTexture.upload();
    updateProjection();
    render();
    history.current.newImage = image.clone();
    history.commit();
  });

  let rotateCounterclockwiseButton = document.getElementById('rotateCounterclockwiseButton');
  rotateCounterclockwiseButton.addEventListener('click', e => {
    history.begin(new UndoableImage());
    image.rotateCounterclockwise();
    imageTexture.upload();
    updateProjection();
    render();
    history.current.newImage = image.clone();
    history.commit();
  });

  let autocropButton = document.getElementById('autocropButton');
  autocropButton.addEventListener('click', e => {
    history.begin(new UndoableImage());
    image.autocrop(configuration.backgroundColor);

    updateArrayTilingGrid();
    updateGrid();

    imageTexture.upload();
    updateProjection();
    render();

    history.current.newImage = image.clone();
    history.commit();
  });
}

function updateBackgroundColorPreview() {
  backgroundColorPreview.style['background-color'] = `rgb(${configuration.backgroundColor.r}, ${configuration.backgroundColor.g}, ${configuration.backgroundColor.b})`;
}

function activateTool(tool) {
  if (tools[configuration.activeTool]) {
    tools[configuration.activeTool].classList.remove('active');
  }
  configuration.activeTool = tool;
  tools[tool].classList.add('active');
  syncCursor(mouseImage);
}

function rememberColor() {
  ipcRenderer.send('remember-color', configuration.foregroundColor.values);
}

function nameColor() {
  let name = dialogs.prompt('Name this color:', name => {
    if (name) {
      ipcRenderer.send('name-color', name, configuration.foregroundColor.values);
    }
  });
}

function syncColorSwatch() {
  colorPreview.style['background-color'] = `rgb(${configuration.foregroundColor.r}, ${configuration.foregroundColor.g}, ${configuration.foregroundColor.b})`;
}

function syncWidgetsToColor() {
  syncColorSwatch();

  for (let [i, widget] of rgbWidgets.entries()) {
    widget.slider.value = configuration.foregroundColor.values[i];
    widget.box.value = configuration.foregroundColor.values[i];
  }
}

function syncHsv() {
  let hsv = configuration.foregroundColor.toHsv();

  // This approach yields 100 instead of 100.0.
  let hsvRounded = [
    Number((hsv[0] * 360).toFixed(1)),
    Number((hsv[1] * 100).toFixed(1)),
    Number((hsv[2] * 100).toFixed(1)),
  ];

  hsvWidgets[0].slider.value = hsvRounded[0];
  hsvWidgets[1].slider.value = hsvRounded[1];
  hsvWidgets[2].slider.value = hsvRounded[2];
  hsvWidgets[0].box.value = hsvRounded[0];
  hsvWidgets[1].box.value = hsvRounded[1];
  hsvWidgets[2].box.value = hsvRounded[2];
}

function initializeRgbWidget(i, slider, box) {
  syncColorSwatch();
  box.value = configuration.foregroundColor.values[i];
  slider.value = configuration.foregroundColor.values[i];

  slider.addEventListener('input', e => {
    configuration.foregroundColor.values[i] = parseInt(slider.value);
    box.value = configuration.foregroundColor.values[i];

    if (i < 3 && isShift) {
      configuration.foregroundColor.values[(i + 1) % 3] = configuration.foregroundColor.values[i];
      configuration.foregroundColor.values[(i + 2) % 3] = configuration.foregroundColor.values[i];
    }

    syncColorSwatch();

    if (i < 3 && isShift) {
      syncWidgetsToColor();
    }

    if (i < 3) {
      syncHsv();
    }
  });

  box.addEventListener('input', () => {
    if (integerPattern.test(box.value)) {
      configuration.foregroundColor.values[i] = parseInt(box.value);
      slider.value = configuration.foregroundColor.values[i];
      syncColorSwatch();
    }
  });
}

function hsvToRgb(h, s, v) {
  let r, g, b;

  let i = Math.floor(h * 6);
  let f = h * 6 - i;
  let p = v * (1 - s);
  let q = v * (1 - f * s);
  let t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0: r = v, g = t, b = p; break;
    case 1: r = q, g = v, b = p; break;
    case 2: r = p, g = v, b = t; break;
    case 3: r = p, g = q, b = v; break;
    case 4: r = t, g = p, b = v; break;
    case 5: r = v, g = p, b = q; break;
  }

  return [
    Math.floor(r * 255),
    Math.floor(g * 255),
    Math.floor(b * 255),
  ];
}

function syncColorToHsv() {
  let hsv = [
    parseFloat(hsvWidgets[0].box.value) / 360,
    parseFloat(hsvWidgets[1].box.value) / 100,
    parseFloat(hsvWidgets[2].box.value) / 100,
  ];
  let rgb = hsvToRgb(hsv[0], hsv[1], hsv[2]);

  configuration.foregroundColor.r = rgb[0];
  configuration.foregroundColor.g = rgb[1];
  configuration.foregroundColor.b = rgb[2];
  syncColorSwatch();
  syncWidgetsToColor();
}

function initializeHsvWidget(i, slider, box) {
  slider.addEventListener('input', e => {
    box.value = slider.value;
    syncColorToHsv();
  });

  box.addEventListener('input', () => {
    if (isFloat(box.value)) {
      slider.value = parseFloat(box.value);
      syncColorToHsv();
    }
  });
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
    gl.uniformMatrix4fv(modelviewUniform, false, modelview.toBuffer());
    gl.bindVertexArray(imageVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.useProgram(null);

    // Draw lines.
    // gl.useProgram(linesProgram);
    // gl.uniformMatrix4fv(linesProjectionUniform, false, projection.toBuffer());
    // gl.uniformMatrix4fv(linesModelviewUniform, false, modelview.toBuffer());

    gl.useProgram(outlineProgram);
    gl.uniformMatrix4fv(outlineProjectionUniform, false, projection.toBuffer());
    gl.uniformMatrix4fv(outlineModelviewUniform, false, modelview.toBuffer());
    gl.uniform4f(outlineColorUniform, 0.0, 0.0, 0.0, 1.0);

    if (configuration.isGridShown) {
      gl.uniform4f(outlineColorUniform, 0.0, 0.0, 0.0, 1.0);
      gl.uniform1f(outlineScaleUniform, 0.002 / scale);
      gl.bindVertexArray(gridVao);
      gl.drawElements(gl.TRIANGLES, gridLineCount * 6, gl.UNSIGNED_SHORT, 0);
    }

    gl.uniform1f(outlineScaleUniform, 0.01 / scale);
    gl.uniform4f(outlineColorUniform, 0.0, 0.0, 0.0, 1.0);
    gl.bindVertexArray(borderVao);
    gl.drawElements(gl.TRIANGLES, 4 * 6, gl.UNSIGNED_SHORT, 0);

    if (rectangleStart && rectangleStop) {
      gl.uniform1f(outlineScaleUniform, 0.02 / scale);
      gl.uniform4f(outlineColorUniform, 0.0, 1.0, 0.0, 1.0);
      gl.bindVertexArray(selectionVao);
      gl.drawElements(gl.TRIANGLES, 4 * 6, gl.UNSIGNED_SHORT, 0);
    }

    if (configuration.drawingMode == DrawingMode.RotationalMirroring) {
      gl.uniform4f(outlineColorUniform, 0.0, 0.5, 1.0, 1.0);
      gl.uniform1f(outlineScaleUniform, 0.002 / scale);
      gl.bindVertexArray(rotationalMirroringAxesVao);
      gl.drawElements(gl.TRIANGLES, configuration.wedgeCount * 6, gl.UNSIGNED_SHORT, 0);
    } else if (configuration.drawingMode == DrawingMode.ArrayTiling) {
      gl.uniform4f(outlineColorUniform, 1.0, 0.5, 0.0, 1.0);
      gl.uniform1f(outlineScaleUniform, 0.002 / scale);
      gl.bindVertexArray(arrayTilingGridVao);
      gl.drawElements(gl.TRIANGLES, arrayTilingLineCount * 6, gl.UNSIGNED_SHORT, 0);
    }

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

function newImage(width, height) {
  loadImage({
    path: null,
    sharp: sharp({
      create: {
        width: width,
        height: height,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      }
    }),
  });
}

function openImage(path) {
  if (path.endsWith('.phil')) {
    let json = fs.readFileSync(path, 'utf8');
    let object = JSON.parse(json);
    let png = object.frames[0].png;
    loadImage({
      path: path,
      sharp: sharp(Buffer.from(png, 'binary')),
    });
  } else {
    loadImage({
      path: path,
      sharp: sharp(path.toString()),
    });
  }
}

function loadImage(loader) {
  loader.sharp
    .raw()
    .metadata()
    .then(meta => {
      // if (meta.channels == 3) {
        // image = image.joinChannel(Buffer.alloc(meta.width * meta.height, 255), {
          // raw: {
            // width: meta.width,
            // height: meta.height,
            // channels: 1
          // }
        // })
      // }

      loader.sharp.toBuffer({resolveWithObject: true}).then(({ data, info }) => {
        let pixels = Uint8Array.from(data); // Node's buffers aren't compatible with WebGL. :(
        imagePath = loader.path;
        image = new Image(info.width, info.height, info.channels, pixels);
        history = new UndoHistory(image.clone());
        updateProjection();
        gl.activeTexture(gl.TEXTURE1);
        imageTexture = new Texture(image);

        updateArrayTilingGrid();
        updateGrid();

        render();
        syncResizeButton();
      });
    })
  .catch(e => {
    console.error(e);
  });
}

function isFloat(text) {
  return text.match(/^-?\d+(\.\d*)?$/);
}

function isInteger(text) {
  return text.match(/^-?\d+$/);
}

function isIntegerOrBlank(text) {
  return text == '' || text.match(/^-?\d+$/);
}

function syncResizeButton() {
  let resizeBoxes = [resizeTopBox, resizeRightBox, resizeBottomBox, resizeLeftBox];
  let sizes = [];

  for (let resizeBox of resizeBoxes) {
    if (isIntegerOrBlank(resizeBox.value)) {
      let value = parseInt(resizeBox.value);
      sizes.push(isNaN(value) ? 0 : value);
      resizeBox.classList.remove('error');
    } else {
      resizeBox.classList.add('error');
    }
  }

  if (sizes.length == 4) {
    resizeButton.innerText = `Resize to ${image.width + sizes[3] + sizes[1]}x${image.height + sizes[0] + sizes[2]}`;
    resizeButton.disabled = false;
  } else {
    resizeButton.innerText = `Resize`;
    resizeButton.disabled = true;
  }
}

function saveImage(path) {
  if (path.endsWith('.phil')) {
    let options = {
      raw: {
        width: image.width,
        height: image.height,
        channels: image.nchannels,
      }
    };

    sharp(Buffer.from(image.bytes), options)
      .png()
      .toBuffer()
      .then(data => {
        let contents = {
          width: image.width,
          height: image.height,
          frames: [
            {
              png: data.toString('binary'),
            }
          ],
        };
        let json = JSON.stringify(contents, null, 2);
        fs.writeFileSync(path, json, 'utf8');
        isDirty = false;
      }).catch(error => {
        console.log("error:", error);
      });
  } else {
    sharp(Buffer.from(image.bytes), {
      raw: {
        width: image.width,
        height: image.height,
        channels: image.nchannels,
      }
    }).toFile(imagePath, error => {
      isDirty = false;
      console.log("error:", error);
    });
  }
  saveConfiguration();
}

require('electron').ipcRenderer.on('newImage', (event, width, height) => {
  newImage(width, height);
});

require('electron').ipcRenderer.on('openImage', (event, path) => {
  openImage(path);
});

let saveAsPath;

function saveAs() {
  let defaultPath;
  if (saveAsPath) {
    defaultPath = saveAsPath;
  } else if (imagePath) {
    defaultPath = imagePath;
  } else {
    defaultPath = 'untitled.phil';
  }

  dialog.showSaveDialog({
    title: 'Save as...',
    defaultPath: defaultPath,
  }, function(path) {
    if (path) {
      saveAsPath = path;
      if (/\.(png|jpg|phil)$/.test(path)) {
        imagePath = saveAsPath;
        saveImage(imagePath);
      } else {
        dialog.showMessageBox({
          message: `The file must have a .png, .jpg, or .phil extension. ${path} does not.`,
        }, () => {
          saveAs();
        });
      }
    }
  });
}

ipcRenderer.on('saveAs', function(event, data) {
  saveAs();
});

ipcRenderer.on('save', function(event, data) {
  if (imagePath) {
    saveImage(imagePath);
  } else {
    saveAs();
  }
});

ipcRenderer.on('update-color-history', function(event, history) {
  while (colorHistoryRoot.firstChild) {
    colorHistoryRoot.removeChild(colorHistoryRoot.firstChild);
  }

  for (let i = history.length - 1; i >= 0; --i) {
    let color = Color.fromByteArray(history[i].color);
    let button = document.createElement('div');
    button.classList.add('colorHistorySwatch');
    button.style['background-color'] = `rgb(${color.r}, ${color.g}, ${color.b})`;
    button.addEventListener('click', () => {
      selectColor(color);
    });
    colorHistoryRoot.appendChild(button);
  }
});

ipcRenderer.on('update-color-palette', function(event, palette) {
  while (colorPaletteRoot.firstChild) {
    colorPaletteRoot.removeChild(colorPaletteRoot.firstChild);
  }

  for (let i = palette.length - 1; i >= 0; --i) {
    let {name, color} = palette[i];
    color = Color.fromByteArray(color);

    let swatch = document.createElement('div');
    swatch.classList.add('colorPaletteSwatch');
    swatch.classList.add('column0');
    swatch.style['background-color'] = `rgb(${color.r}, ${color.g}, ${color.b})`;

    let label = document.createElement('span');
    label.classList.add('column1');
    label.innerText = name;

    let deleter = document.createElement('span');
    deleter.classList.add('column2');
    deleter.innerText = '\u2715';

    let entry = document.createElement('div');
    entry.classList.add('colorPaletteEntry');
    entry.classList.add('grid3');
    entry.appendChild(swatch);
    entry.appendChild(label);
    entry.appendChild(deleter);

    entry.addEventListener('click', () => {
      selectColor(color);
    });

    label.addEventListener('mouseenter', () => {
      swatch.classList.add('hovered');
    });

    label.addEventListener('mouseleave', () => {
      swatch.classList.remove('hovered');
    });

    deleter.addEventListener('click', () => {
      ipcRenderer.send('unname-color', name);
    });

    colorPaletteRoot.appendChild(entry);
  }
});

function saveConfiguration() {
  let json = JSON.stringify(configuration, null, 2);
  fs.writeFileSync(preferencesPath, json, 'utf8');
}

// Should I save the configuration in the renderer process, or in the main
// process? If I save it here, less volley.
function onPossibleClose() {
  saveConfiguration();
  return isDirty;
}

window.addEventListener('load', onReady);
window.addEventListener('resize', onSize, false);
