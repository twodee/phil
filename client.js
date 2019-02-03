const sharp = require('sharp');
const { ipcRenderer } = require('electron')
const fsdialog = require('electron').remote.dialog;
const Dialogs = require('dialogs');
let dialogs = Dialogs();

class DrawingMode {
}
DrawingMode.None = 0;
DrawingMode.RotationalMirroring = 1;
DrawingMode.ArrayTiling = 2;

// Lines
let linesProgram;
let linesProjectionUniform;
let linesModelviewUniform;
let linesColorUniform;

// Grid
let isGridShown;
let isGridShownBox;
let gridCellSize;
let gridVao;
let gridVbo;
let gridCellWidthBox;
let gridCellHeightBox;
let gridLineCount;

// Border
let borderVao;
let borderVbo;

// Rotational mirroring
let rotationalMirroringAxesVao;
let rotationalMirroringAxesVbo;
let wedgeCount;
let rotationOffset;

// Array tiling
let tileSize;
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
let activeToolDiv;
let tools = {};
let pixelCoordinatesBox;
let drawingMode;

// Undos
let undosList;
let history;

// Color
let rgbWidgets;
let hsvWidgets;
let channelsRoot;
let colorPreview;
let colorHistoryRoot;
let selectedColor = [0, 255, 0, 255];

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

class Image {
  constructor(width, height, nchannels, pixels) {
    this.size = new Vector2(width, height);
    this.nchannels = nchannels;
    this.bytes = pixels;
  }

  clone() {
    return new Image(this.width, this.height, this.nchannels, Buffer.from(this.bytes));
  }

  aspectRatio() {
    return this.width / this.height;
  }

  containsPixel(p) {
    return p.x >= 0 && p.x < this.width && p.y >= 0 && p.y < this.height;
  }

  set(c, r, rgb) {
    let start = (r * this.width + c) * 4;
    this.bytes[start + 0] = rgb[0];
    this.bytes[start + 1] = rgb[1];
    this.bytes[start + 2] = rgb[2];
    this.bytes[start + 3] = rgb[3];
  }

  get(c, r) {
    let start = (r * this.width + c) * 4;
    return [
      this.bytes[start + 0],
      this.bytes[start + 1],
      this.bytes[start + 2],
      this.bytes[start + 3],
    ];
  }

  isPixel(c, r, color) {
    let start = (r * this.width + c) * 4;
    return this.bytes[start + 0] == color[0] &&
           this.bytes[start + 1] == color[1] &&
           this.bytes[start + 2] == color[2] &&
           this.bytes[start + 3] == color[3];
  }

  fill(c, r, color, isDiagonal = false) {
    let oldColor = this.get(c, r);
    let newColor = color.slice(0);

    // Bail if this pixel is already the fill color.
    if (this.isPixel(c, r, newColor)) {
      return;
    }

    let stack = [];
    stack.push([c, r]);

    while (stack.length > 0) {
      let [cc, rr] = stack.pop();

      // Move cc as far left as possible.
      while (cc >= 0 && this.isPixel(cc, rr, oldColor)) {
        --cc;
      }
      ++cc;

      let spanAbove = false;
      let spanBelow = false;

      if (isDiagonal && cc > 0) {
        // Look up and left for diagonal.
        if (rr > 0 && this.isPixel(cc - 1, rr - 1, oldColor)) {
          stack.push([cc - 1, rr - 1]);
          spanAbove = true;
        }

        // Look down and left for diagonal.
        if (rr < this.height - 1 && this.isPixel(cc - 1, rr + 1, oldColor)) {
          stack.push([cc - 1, rr + 1]);
          spanBelow = true;
        }
      }

      while (cc < this.width && this.isPixel(cc, rr, oldColor)) {
        this.set(cc, rr, newColor);
        drawKnownPixel(new Vector2(cc, rr));
        history.current.add(cc, rr, newColor.slice(0));

        if (!spanAbove && rr > 0 && this.isPixel(cc, rr - 1, oldColor)) {
          stack.push([cc, rr - 1]);
          spanAbove = true;
        } else if (spanAbove && rr > 0 && !this.isPixel(cc, rr - 1, oldColor)) {
          spanAbove = false;
        }

        if (!spanBelow && rr < this.height - 1 && this.isPixel(cc, rr + 1, oldColor)) {
          stack.push([cc, rr + 1]);
          spanBelow = true;
        } else if (spanBelow && rr < this.height - 1 && !this.isPixel(cc, rr + 1, oldColor)) {
          spanBelow = false;
        }

        ++cc;
      }

      if (isDiagonal && cc < this.width - 1) {
        if (!spanAbove && rr > 0 && this.isPixel(cc + 1, rr - 1, oldColor)) {
          stack.push([cc + 1, rr - 1]);
        }

        if (!spanBelow && rr < this.height - 1 && this.isPixel(cc + 1, rr + 1, oldColor)) {
          stack.push([cc + 1, rr + 1]);
        }
      }
    }
  }

  get width() {
    return this.size.x;
  }

  get height() {
    return this.size.y;
  }

  set width(value) {
    this.size.x = value;
  }

  set height(value) {
    this.size.y = value;
  }

  extract(t, r, b, l) {
    let newWidth = this.width - l - r;
    let newHeight = this.height - t - b;
    let newBytes = Buffer.alloc(newWidth * newHeight * 4);

    for (let rNew = 0; rNew < newHeight; ++rNew) {
      for (let cNew = 0; cNew < newWidth; ++cNew) {
        let rOld = rNew + t;
        let cOld = cNew + l;
        let iOld = 4 * (rOld * this.width + cOld);
        let iNew = 4 * (rNew * newWidth + cNew);
        this.bytes.copy(newBytes, iNew, iOld, iOld + 4);
      }
    }

    this.width = newWidth;
    this.height = newHeight;
    this.bytes = newBytes;
  }

  extend(t, r, b, l) {
    let newWidth = this.width + l + r;
    let newHeight = this.height + t + b;
    let newBytes = Buffer.alloc(newWidth * newHeight * 4);

    for (let rOld = 0; rOld < this.height; ++rOld) {
      for (let cOld = 0; cOld < this.width; ++cOld) {
        let rNew = rOld + t;
        let cNew = cOld + l;
        let iOld = 4 * (rOld * this.width + cOld);
        let iNew = 4 * (rNew * newWidth + cNew);
        this.bytes.copy(newBytes, iNew, iOld, iOld + 4);
      }
    }

    this.width = newWidth;
    this.height = newHeight;
    this.bytes = newBytes;
  }

  resize(newWidth, newHeight) {
    this.bytes = Buffer.alloc(newWidth * newHeight * 4, 255);
    this.size[0] = newWidth;
    this.size[1] = newHeight;
  }

  resizeDelta(t, r, b, l) {
    this.extract(
      t < 0 ? -t : 0,
      r < 0 ? -r : 0,
      b < 0 ? -b : 0,
      l < 0 ? -l : 0
    );

    this.extend(
      t > 0 ? t : 0,
      r > 0 ? r : 0,
      b > 0 ? b : 0,
      l > 0 ? l : 0
    );
  }
}

class Texture {
  constructor(image) {
    this.image = image;
    this.textureId = createTexture(gl, image.width, image.height, image.nchannels, image.bytes);
  }

  uploadPixel(c, r) {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, c, r, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.image.bytes, (r * this.image.width + c) * 4);
  }

  upload() {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textureId);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.image.width, this.image.height, 0, this.image.nchannels == 4 ? gl.RGBA : gl.RGB, gl.UNSIGNED_BYTE, this.image.bytes);
  }
}

class Vector2 {
  constructor(x, y) {
    this.values = [x, y];
  }

  add(that) {
    return new Vector2(this.x + that.x, this.y + that.y);
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

  get magnitude() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  }

  abs() {
    return new Vector2(Math.abs(this.x), Math.abs(this.y));
  }

  round() {
    return new Vector2(Math.round(this.x), Math.round(this.y));
  }

  multiplyScalar(factor) {
    return new Vector2(factor * this.x, factor * this.y);
  }

  multiplyVector(that) {
    return new Vector2(this.x * that.x, this.y * that.y);
  }

  divideVector(that) {
    return new Vector2(this.x / that.x, this.y / that.y);
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

  multiplyMatrix(that) {
    let product = new Matrix4()
    for (let r = 0; r < 4; ++r) {
      for (let c = 0; c < 4; ++c) {
        let dot = 0;
        for (let i = 0; i < 4; ++i) {
          dot += this.get(r, i) * that.get(i, c);
        }
        product.set(r, c, dot);
      }
    }
    return product;
  }

  multiplyVector(v) {
    let product = [0, 0, 0, 0];
    for (let r = 0; r < 4; ++r) {
      for (let c = 0; c < 4; ++c) {
        product[r] += this.get(r, c) * v[c];
      }
    }
    return product;
  }

  inverse() {
    let m = new Matrix4();

    let a0 = this.get(0, 0) * this.get(1, 1) - this.get(0, 1) * this.get(1, 0);
    let a1 = this.get(0, 0) * this.get(1, 2) - this.get(0, 2) * this.get(1, 0);
    let a2 = this.get(0, 0) * this.get(1, 3) - this.get(0, 3) * this.get(1, 0);

    let a3 = this.get(0, 1) * this.get(1, 2) - this.get(0, 2) * this.get(1, 1);
    let a4 = this.get(0, 1) * this.get(1, 3) - this.get(0, 3) * this.get(1, 1);
    let a5 = this.get(0, 2) * this.get(1, 3) - this.get(0, 3) * this.get(1, 2);

    let b0 = this.get(2, 0) * this.get(3, 1) - this.get(2, 1) * this.get(3, 0);
    let b1 = this.get(2, 0) * this.get(3, 2) - this.get(2, 2) * this.get(3, 0);
    let b2 = this.get(2, 0) * this.get(3, 3) - this.get(2, 3) * this.get(3, 0);

    let b3 = this.get(2, 1) * this.get(3, 2) - this.get(2, 2) * this.get(3, 1);
    let b4 = this.get(2, 1) * this.get(3, 3) - this.get(2, 3) * this.get(3, 1);
    let b5 = this.get(2, 2) * this.get(3, 3) - this.get(2, 3) * this.get(3, 2);

    let determinant = a0 * b5 - a1 * b4 + a2 * b3 + a3 * b2 - a4 * b1 + a5 * b0;

    if (determinant != 0) {
      let inverseDeterminant = 1 / determinant;
      m.set(0, 0, (+this.get(1, 1) * b5 - this.get(1, 2) * b4 + this.get(1, 3) * b3) * inverseDeterminant);
      m.set(0, 1, (-this.get(0, 1) * b5 + this.get(0, 2) * b4 - this.get(0, 3) * b3) * inverseDeterminant);
      m.set(0, 2, (+this.get(3, 1) * a5 - this.get(3, 2) * a4 + this.get(3, 3) * a3) * inverseDeterminant);
      m.set(0, 3, (-this.get(2, 1) * a5 + this.get(2, 2) * a4 - this.get(2, 3) * a3) * inverseDeterminant);
      m.set(1, 0, (-this.get(1, 0) * b5 + this.get(1, 2) * b2 - this.get(1, 3) * b1) * inverseDeterminant);
      m.set(1, 1, (+this.get(0, 0) * b5 - this.get(0, 2) * b2 + this.get(0, 3) * b1) * inverseDeterminant);
      m.set(1, 2, (-this.get(3, 0) * a5 + this.get(3, 2) * a2 - this.get(3, 3) * a1) * inverseDeterminant);
      m.set(1, 3, (+this.get(2, 0) * a5 - this.get(2, 2) * a2 + this.get(2, 3) * a1) * inverseDeterminant);
      m.set(2, 0, (+this.get(1, 0) * b4 - this.get(1, 1) * b2 + this.get(1, 3) * b0) * inverseDeterminant);
      m.set(2, 1, (-this.get(0, 0) * b4 + this.get(0, 1) * b2 - this.get(0, 3) * b0) * inverseDeterminant);
      m.set(2, 2, (+this.get(3, 0) * a4 - this.get(3, 1) * a2 + this.get(3, 3) * a0) * inverseDeterminant);
      m.set(2, 3, (-this.get(2, 0) * a4 + this.get(2, 1) * a2 - this.get(2, 3) * a0) * inverseDeterminant);
      m.set(3, 0, (-this.get(1, 0) * b3 + this.get(1, 1) * b1 - this.get(1, 2) * b0) * inverseDeterminant);
      m.set(3, 1, (+this.get(0, 0) * b3 - this.get(0, 1) * b1 + this.get(0, 2) * b0) * inverseDeterminant);
      m.set(3, 2, (-this.get(3, 0) * a3 + this.get(3, 1) * a1 - this.get(3, 2) * a0) * inverseDeterminant);
      m.set(3, 3, (+this.get(2, 0) * a3 - this.get(2, 1) * a1 + this.get(2, 2) * a0) * inverseDeterminant);
    } else {
      throw 'singularity';
    }

    return m;
  }

  toString() {
    let s = '';
    for (let r = 0; r < 4; ++r) {
      for (let c = 0; c < 4; ++c) {
        s += this.get(r, c) + ', ';
      }
      s += '\n';
    }
    return s;
  }

  static ortho(left, right, bottom, top, near = -1, far = 1) {
    let m = new Matrix4();
    m.set(0, 0, 2 / (right - left));
    m.set(1, 1, 2 / (top - bottom));
    m.set(2, 2, 2 / (near - far));
    m.set(0, 3, -(right + left) / (right - left));
    m.set(1, 3, -(top + bottom) / (top - bottom));
    m.set(2, 3, (near + far) / (near - far));
    return m;
  }

  static inverseOrtho(left, right, bottom, top, near = -1, far = 1) {
    let m = Matrix4.scale((right - left) * 0.5, (top - bottom) * 0.5, (near - far) * 0.5);
    m.set(0, 3, (right + left) * 0.5);
    m.set(1, 3, (top + bottom) * 0.5);
    m.set(2, 3, (far + near) * 0.5);
    return m;
  }

  static scale(x, y, z) {
    let m = new Matrix4();
    m.set(0, 0, x);
    m.set(1, 1, y);
    m.set(2, 2, z);
    return m;
  }

  static translate(x, y, z) {
    let m = new Matrix4();
    m.set(0, 3, x);
    m.set(1, 3, y);
    m.set(2, 3, z);
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

  let delta = 2 * Math.PI / wedgeCount;
  for (let i = 0; i < wedgeCount; ++i) {
    // Center
    vertices.push(0);
    vertices.push(0);
    vertices.push(0);
    vertices.push(1);

    // The anchor is the positive y-axis.
    let base = 2 * Math.PI / 4;
    base += rotationOffset * Math.PI / 180;

    let theta = i * delta + base;
    let radius = 1.414;

    // Perimeter Point
    vertices.push(radius * Math.cos(theta));
    vertices.push(radius * Math.sin(theta));
    vertices.push(0);
    vertices.push(1);
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, rotationalMirroringAxesVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

  let positionAttributeLocation = gl.getAttribLocation(linesProgram, 'position');
  gl.vertexAttribPointer(positionAttributeLocation, 4, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(positionAttributeLocation);
}

function updateArrayTilingGrid() {
  let vertices = [];

  arrayTilingLineCount = 0;

  if (image) {
    for (let x = tileSize.x; x < image.width; x += tileSize.x) {
      let xx = x / (image.width) * 2 - 1;

      vertices.push(xx);
      vertices.push(-1);
      vertices.push(0);
      vertices.push(1);

      vertices.push(xx);
      vertices.push(1);
      vertices.push(0);
      vertices.push(1);

      arrayTilingLineCount += 1;
    }

    for (let y = tileSize.y; y < image.height; y += tileSize.y) {
      let yy = y / (image.height) * 2 - 1;

      vertices.push(-1);
      vertices.push(yy);
      vertices.push(0);
      vertices.push(1);

      vertices.push(1);
      vertices.push(yy);
      vertices.push(0);
      vertices.push(1);

      arrayTilingLineCount += 1;
    }
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, arrayTilingGridVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

  let positionAttributeLocation = gl.getAttribLocation(linesProgram, 'position');
  gl.vertexAttribPointer(positionAttributeLocation, 4, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(positionAttributeLocation);
}

function updateGrid() {
  let vertices = [];

  gridLineCount = 0;

  if (image) {
    for (let x = gridCellSize.x; x < image.width; x += gridCellSize.x) {
      let xx = x / (image.width) * 2 - 1;

      vertices.push(xx);
      vertices.push(-1);
      vertices.push(0);
      vertices.push(1);

      vertices.push(xx);
      vertices.push(1);
      vertices.push(0);
      vertices.push(1);

      gridLineCount += 1;
    }

    for (let y = gridCellSize.y; y < image.height; y += gridCellSize.y) {
      let yy = y / (image.height) * 2 - 1;

      vertices.push(-1);
      vertices.push(yy);
      vertices.push(0);
      vertices.push(1);

      vertices.push(1);
      vertices.push(yy);
      vertices.push(0);
      vertices.push(1);

      gridLineCount += 1;
    }
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, gridVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

  let positionAttributeLocation = gl.getAttribLocation(linesProgram, 'position');
  gl.vertexAttribPointer(positionAttributeLocation, 4, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(positionAttributeLocation);
}

function updateBorder() {
  let vertices = [];

  vertices.push(-1);
  vertices.push(-1);
  vertices.push(0);
  vertices.push(1);

  vertices.push(1);
  vertices.push(-1);
  vertices.push(0);
  vertices.push(1);

  vertices.push(1);
  vertices.push(1);
  vertices.push(0);
  vertices.push(1);

  vertices.push(-1);
  vertices.push(1);
  vertices.push(0);
  vertices.push(1);

  gl.bindBuffer(gl.ARRAY_BUFFER, borderVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

  let positionAttributeLocation = gl.getAttribLocation(linesProgram, 'position');
  gl.vertexAttribPointer(positionAttributeLocation, 4, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(positionAttributeLocation);
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

  let scale = 1.0;
  let vertices = [
    -scale, -scale, 0.0, 1.0,
    0.0, 1.0,

    scale, -scale, 0.0, 1.0,
    1.0, 1.0,

    -scale, scale, 0.0, 1.0,
    0.0, 0.0,

    scale, scale, 0.0, 1.0,
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

function setPixelToCurrentColor(p) {
  history.current.add(p.x, p.y, selectedColor.slice(0));
  image.set(p.x, p.y, selectedColor);
  imageTexture.uploadPixel(p.x, p.y);
}

function drawKnownPixel(p) {
  if (drawingMode == DrawingMode.None) {
    setPixelToCurrentColor(p);
  } else if (drawingMode == DrawingMode.ArrayTiling) {
    for (let r = p.y % tileSize.y; r < image.height; r += tileSize.y) {
      for (let c = p.x % tileSize.x; c < image.width; c += tileSize.x) {
        setPixelToCurrentColor(new Vector2(c, r));
      }
    }
  } else if (drawingMode == DrawingMode.RotationalMirroring) {
    let middle = image.size.subtract(new Vector2(1, 1)).multiplyScalar(0.5);
    let diff = p.subtract(middle);
    let radius = diff.magnitude;
    let theta = Math.atan2(diff.y, diff.x);
    let radiansPerWedge = 2 * Math.PI / wedgeCount;

    // Start at positive x-axis and wind counterclockwise to 2 * pi.
    if (theta < 0) {
      theta = -theta;
    } else {
      theta = 2 * Math.PI - theta;
    }

    theta -= Math.PI * 0.5 + rotationOffset * Math.PI / 180;

    if (theta < 0) {
      theta += 2 * Math.PI;
    }

    let iWedge0 = Math.floor(theta / radiansPerWedge);
    let radiansFromWedgeStart = theta - iWedge0 * radiansPerWedge;

    for (let i = 0; i < wedgeCount; ++i) {
      let phi;
      if (i % 2 == iWedge0 % 2) {
        phi = i * radiansPerWedge + radiansFromWedgeStart;
      } else {
        phi = (i + 1) % wedgeCount * radiansPerWedge - radiansFromWedgeStart;
      }

      phi = -(phi + Math.PI * 0.5 + rotationOffset * Math.PI / 180);

      let pp = new Vector2(radius * Math.cos(phi), radius * Math.sin(phi)).add(middle).round();
      if (image.containsPixel(pp)) {
        setPixelToCurrentColor(pp);
      }
    }
  }
}

function drawPixel(p) {
  if (image.containsPixel(p)) {
    rememberColor();
    drawKnownPixel(p);
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
  mouseScreen = new Vector2(e.clientX, gl.canvas.height - 1 - e.clientY);
  let mouseObject = screenToObject(mouseScreen.x, mouseScreen.y);
  mouseImage = objectToImage(mouseObject);

  if (e.which == 1) {
    if (activeToolDiv == tools.pencil) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, imageTexture.textureId);
      history.begin(new UndoablePixels());
      drawPixel(mouseImage);
      render();
    }
    
    else if (activeToolDiv == tools.dropper) {
      if (isOverImage(mouseImage)) {
        selectColor(image.get(mouseImage.x, mouseImage.y));
      }
    }
  }
}

function isOverImage(p) {
  return p.x >= 0 && p.x < image.width && p.y >= 0 && p.y < image.height;
}

function selectColor(rgba) {
  selectedColor = rgba;
  syncWidgetsToColor();
  syncHsv();
}

function onMouseUp(e) {
  // Mouse up gets called on the window to handle going offscreen. But filling
  // should only happen when the bucket is released on the canvas.
  if (e.target == canvas && activeToolDiv == tools.bucket) {
    mouseScreen = new Vector2(e.clientX, gl.canvas.height - 1 - e.clientY);
    let mouseObject = screenToObject(mouseScreen.x, mouseScreen.y);
    mouseImage = objectToImage(mouseObject);

    if (isOverImage(mouseImage)) {
      history.begin(new UndoablePixels());
      image.fill(mouseImage.x, mouseImage.y, selectedColor, e.shiftKey);
      imageTexture.upload();
      rememberColor();
      render();
    }
  }

  history.commit();
  lockAxis = null;
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
    if (activeToolDiv == tools.pencil) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, imageTexture.textureId);
      drawLine(mouseImage, newMouseImage);
      render();
    }

    else if (activeToolDiv == tools.dropper) {
      if (isOverImage(mouseScreen)) {
        selectColor(image.get(newMouseImage.x, newMouseImage.y));
      }
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
  mouseImage = newMouseImage;
}

function syncCursor(mousePosition) {
  canvas.classList.remove('pencilHovered');
  canvas.classList.remove('bucketHovered');
  canvas.classList.remove('dropperHovered');

  if (mousePosition && isOverImage(mousePosition)) {
    if (activeToolDiv == tools.pencil) {
      canvas.classList.add('pencilHovered');
    } else if (activeToolDiv == tools.bucket) {
      canvas.classList.add('bucketHovered');
    } else if (activeToolDiv == tools.dropper) {
      canvas.classList.add('dropperHovered');
    }
  }
}

function onMouseWheel(e) {
  let factor = 1 - e.deltaY / 100;
  if (scale * factor > 0.1) {
    scale *= factor;
  } else {
    modelview = Matrix4.scale(factor, factor, 1).multiplyMatrix(modelview);
  }
  render();
}

function onReady() {

  // Grab references to widgets.
  canvas = document.getElementById('canvas');
  undosList = document.getElementById('undosList');
  channelsRoot = document.getElementById('channelsRoot');
  colorPreview = document.getElementById('colorPreview');
  colorHistoryRoot = document.getElementById('colorHistoryRoot');
  resizeButton = document.getElementById('resizeButton');
  resizeLeftBox = document.getElementById('resizeLeftBox');
  resizeRightBox = document.getElementById('resizeRightBox');
  resizeTopBox = document.getElementById('resizeTopBox');
  resizeBottomBox = document.getElementById('resizeBottomBox');
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
  wedgeCount = 3;
  rotationOffset = 0;
  drawingMode = DrawingMode.None;
  tileSize = new Vector2(16, 16);
  gridCellSize = new Vector2(4, 4);
  isGridShown = false;

  // Initialize OpenGL.
  gl = canvas.getContext('webgl2');
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

  createBackground();
  createImage();
  createLinesProgram();
  createArrayTilingGrid();
  createRotationalMirroringAxes();
  createGrid();
  createBorder();

  render();

  syncWidgets();
  registerCallbacks();
  onSize();
}

function syncWidgets() {
  if (drawingMode == DrawingMode.None) {
    autoDrawNoneButton.checked = true;
  } else if (drawingMode == DrawingMode.RotationalMirroring) {
    autoDrawRotationalMirroringButton.checked = true;
  } else if (drawingMode == DrawingMode.ArrayTiling) {
    autoDrawArrayTilingButton.checked = true;
  }

  wedgeCountBox.value = wedgeCount;
  rotationOffsetBox.value = rotationOffset;
  tileWidthBox.value = tileSize.x;
  tileHeightBox.value = tileSize.y;
  gridCellWidthBox.value = gridCellSize.x;
  gridCellHeightBox.value = gridCellSize.y;
  isGridShownBox.checked = isGridShown;
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
  tools.pencil = document.getElementById('pencil');
  tools.dropper = document.getElementById('dropper');
  tools.bucket = document.getElementById('bucket');

  activateTool(tools.pencil);
  for (let tool in tools) {
    tools[tool].addEventListener('click', e => {
      activateTool(e.srcElement);
    });
  }

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('wheel', onMouseWheel);
  window.addEventListener('mouseup', onMouseUp);

  window.addEventListener('keydown', e => {
    if (e.key == 'p') {
      activateTool(tools.pencil);
    } else if (e.key == 'e') {
      activateTool(tools.dropper);
    } else if (e.key == 'b') {
      activateTool(tools.bucket);
    } else if (e.key == '[') {
      history.undoMostRecent();
    } else if (e.key == ']') {
      history.redoMostRecent();
    } else if (e.key == 'Shift') {
      isShift = true;
    }
  });

  window.addEventListener('keyup', e => {
    if (e.key == 'Shift') {
      isShift = false;
    }
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
    header.addEventListener('click', e => {
      let headerDiv = e.target;
      headerDiv.classList.toggle('open');
    });
  }

  document.getElementById('nameColor').addEventListener('click', nameColor);

  autoDrawNoneButton.addEventListener('click', () => {
    drawingMode = DrawingMode.None; 
    render();
  });

  autoDrawRotationalMirroringButton.addEventListener('click', () => {
    drawingMode = DrawingMode.RotationalMirroring; 
    render();
  });

  autoDrawArrayTilingButton.addEventListener('click', () => {
    drawingMode = DrawingMode.ArrayTiling; 
    render();
  });

  wedgeCountBox.addEventListener('input', e => {
    assertIntegerGreaterThan(wedgeCountBox, 1, value => {
      wedgeCount = value;
      updateRotationalMirroringAxes();
      render();
    });
  });

  rotationOffsetBox.addEventListener('input', e => {
    rotationOffset = parseFloat(rotationOffsetBox.value);
    updateRotationalMirroringAxes();
    render();
  });

  tileWidthBox.addEventListener('input', e => {
    assertIntegerGreaterThan(tileWidthBox, 0, value => {
      tileSize.x = value;
      updateArrayTilingGrid();
      render();
    });
  });

  tileHeightBox.addEventListener('input', e => {
    assertIntegerGreaterThan(tileHeightBox, 0, value => {
      tileSize.y = value;
      updateArrayTilingGrid();
      render();
    });
  });

  gridCellWidthBox.addEventListener('input', e => {
    assertIntegerGreaterThan(gridCellWidthBox, 0, value => {
      gridCellSize.x = value;
      updateGrid();
      render();
    });
  });

  gridCellHeightBox.addEventListener('input', e => {
    assertIntegerGreaterThan(gridCellHeightBox, 0, value => {
      gridCellSize.y = value;
      updateGrid();
      render();
    });
  });

  isGridShownBox.addEventListener('click', e => {
    isGridShown = isGridShownBox.checked;
    render();
  });
}

function activateTool(div) {
  if (activeToolDiv) {
    activeToolDiv.classList.remove('active');
  }
  activeToolDiv = div;
  activeToolDiv.classList.add('active');
  syncCursor(mouseImage);
}

function rememberColor() {
  ipcRenderer.send('remember-color', selectedColor);
}

function nameColor() {
  let name = dialogs.prompt('What name do you give this color?', name => {
    if (name) {
      ipcRenderer.send('name-color', name, selectedColor);
    }
  });
}

function syncColorSwatch() {
  colorPreview.style['background-color'] = `rgb(${selectedColor[0]}, ${selectedColor[1]}, ${selectedColor[2]})`;
}

function syncWidgetsToColor() {
  syncColorSwatch();

  for (let [i, widget] of rgbWidgets.entries()) {
    widget.slider.value = selectedColor[i];
    widget.box.value = selectedColor[i];
  }
}

function syncHsv() {
  let hsv = rgbToHsv(selectedColor[0], selectedColor[1], selectedColor[2]);

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
  box.value = selectedColor[i];
  slider.value = selectedColor[i];

  slider.addEventListener('input', e => {
    selectedColor[i] = parseInt(slider.value);
    box.value = selectedColor[i];

    if (i < 3 && isShift) {
      selectedColor[(i + 1) % 3] = selectedColor[i];
      selectedColor[(i + 2) % 3] = selectedColor[i];
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
      selectedColor[i] = parseInt(box.value);
      slider.value = selectedColor[i];
      syncColorSwatch();
    }
  });
}

function rgbToHsv(r, g, b) {
  r /= 255, g /= 255, b /= 255;

  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var h, s, v = max;

  var d = max - min;
  s = max == 0 ? 0 : d / max;

  if (max == min) {
    h = 0; // achromatic
  } else {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return [h, s, v];
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

  selectedColor[0] = rgb[0];
  selectedColor[1] = rgb[1];
  selectedColor[2] = rgb[2];
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
    gl.uniformMatrix4fv(modelviewUniform, false, modelview.toBuffer());
    gl.bindVertexArray(imageVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.useProgram(null);

    // Draw lines.
    gl.useProgram(linesProgram);
    gl.uniformMatrix4fv(linesProjectionUniform, false, projection.toBuffer());
    gl.uniformMatrix4fv(linesModelviewUniform, false, modelview.toBuffer());

    if (drawingMode == DrawingMode.RotationalMirroring) {
      gl.uniform4f(linesColorUniform, 1.0, 1.0, 1.0, 1.0);
      gl.bindVertexArray(rotationalMirroringAxesVao);
      gl.drawArrays(gl.LINES, 0, wedgeCount * 2);
    } else if (drawingMode == DrawingMode.ArrayTiling) {
      gl.uniform4f(linesColorUniform, 1.0, 0.5, 0.0, 1.0);
      gl.bindVertexArray(arrayTilingGridVao);
      gl.drawArrays(gl.LINES, 0, arrayTilingLineCount * 2);
    }

    if (isGridShown) {
      gl.uniform4f(linesColorUniform, 1.0, 0.5, 0.0, 1.0);
      gl.bindVertexArray(gridVao);
      gl.drawArrays(gl.LINES, 0, gridLineCount * 2);
    }

    gl.uniform4f(linesColorUniform, 1.0, 0.5, 0.5, 1.0);
    gl.bindVertexArray(borderVao);
    gl.drawArrays(gl.LINE_LOOP, 0, 4);

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
  imageTexture = new Texture(image);

  updateArrayTilingGrid();
  updateGrid();

  render();
  syncResizeButton();
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

ipcRenderer.on('saveAs', function(event, data) {
  saveAs();
});

ipcRenderer.on('save', function(event, data) {
  saveImage(imagePath);
});

ipcRenderer.on('update-color-history', function(event, history) {
  while (colorHistoryRoot.firstChild) {
    colorHistoryRoot.removeChild(colorHistoryRoot.firstChild);
  }

  for (let i = history.length - 1; i >= 0; --i) {
    let color = history[i].color;
    let button = document.createElement('div');
    button.classList.add('colorHistorySwatch');
    button.style['background-color'] = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
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

    let swatch = document.createElement('div');
    swatch.classList.add('colorPaletteSwatch');
    swatch.classList.add('column0');
    swatch.style['background-color'] = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;

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

window.addEventListener('load', onReady);
window.addEventListener('resize', onSize, false);
