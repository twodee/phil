class Color {
  constructor() {
    this.values = [255, 255, 255, 0];
  }

  equals(that) {
    return this.values[0] == that.values[0] &&
           this.values[1] == that.values[1] &&
           this.values[2] == that.values[2] &&
           this.values[3] == that.values[3];
  }

  set r(value) {
    this.values[0] = value;
  }

  set g(value) {
    this.values[1] = value;
  }

  set b(value) {
    this.values[2] = value;
  }

  set a(value) {
    this.values[3] = value;
  }

  get r() {
    return this.values[0];
  }

  get g() {
    return this.values[1];
  }

  get b() {
    return this.values[2];
  }

  get a() {
    return this.values[3];
  }

  // https://gist.github.com/mjackson/5311256
  toHsv() {
    let rr = this.r / 255;
    let gg = this.g / 255;
    let bb = this.b / 255;

    let max = Math.max(rr, gg, bb);
    let min = Math.min(rr, gg, bb);
    let h, s, v = max;

    var d = max - min;
    s = max == 0 ? 0 : d / max;

    if (max == min) {
      h = 0; // achromatic
    } else {
      switch (max) {
        case rr: h = (gg - bb) / d + (gg < bb ? 6 : 0); break;
        case gg: h = (bb - rr) / d + 2; break;
        case bb: h = (rr - gg) / d + 4; break;
      }
      h /= 6;
    }

    return [h, s, v];
  }

  clone() {
    let newColor = new Color();
    newColor.r = this.r;
    newColor.g = this.g;
    newColor.b = this.b;
    newColor.a = this.a;
    return newColor;
  }

  toString() {
    return `[${this.r} ${this.g} ${this.b} ${this.a}]`;
  }

  toJSON() {
    return this.values;
  }

  static fromBytes(r, g, b, a) {
    let color = new Color();
    color.values[0] = r; 
    color.values[1] = g; 
    color.values[2] = b; 
    color.values[3] = a; 
    return color;
  }

  static fromByteArray(rgba) {
    let color = new Color();
    color.values[0] = rgba[0]; 
    color.values[1] = rgba[1]; 
    color.values[2] = rgba[2]; 
    color.values[3] = rgba[3]; 
    return color;
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
    isDirty = true;
    let start = (r * this.width + c) * 4;
    this.bytes[start + 0] = rgb.r;
    this.bytes[start + 1] = rgb.g;
    this.bytes[start + 2] = rgb.b;
    this.bytes[start + 3] = rgb.a;
  }

  get(c, r) {
    let start = (r * this.width + c) * 4;
    return Color.fromBytes(
      this.bytes[start + 0],
      this.bytes[start + 1],
      this.bytes[start + 2],
      this.bytes[start + 3]
    );
  }

  isPixel(c, r, color) {
    let start = (r * this.width + c) * 4;
    return this.bytes[start + 0] == color.r &&
           this.bytes[start + 1] == color.g &&
           this.bytes[start + 2] == color.b &&
           this.bytes[start + 3] == color.a;
  }

  replace(c, r, newColor) {
    isDirty = true;
    let oldColor = this.get(c, r);

    // Walk through pixels. If pixel is oldColor, replace it.
    for (let rr = 0; rr < this.height; ++rr) {
      for (let cc = 0; cc < this.width; ++cc) {
        if (this.isPixel(cc, rr, oldColor)) {
          drawKnownPixel(new Vector2(cc, rr), newColor);
          history.current.add(cc, rr, newColor.clone());
        }
      }
    }
  }

  fill(c, r, color, isDiagonal = false) {
    isDirty = true;
    let oldColor = this.get(c, r);
    let newColor = color.clone();

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
        drawKnownPixel(new Vector2(cc, rr), color);
        history.current.add(cc, rr, newColor.clone());

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
    isDirty = true;
    let newWidth = this.width - l - r;
    let newHeight = this.height - t - b;
    let newBytes = new Uint8Array(newWidth * newHeight * 4);

    for (let rNew = 0; rNew < newHeight; ++rNew) {
      for (let cNew = 0; cNew < newWidth; ++cNew) {
        let rOld = rNew + t;
        let cOld = cNew + l;
        let iOld = 4 * (rOld * this.width + cOld);
        let iNew = 4 * (rNew * newWidth + cNew);
        for (let ci = 0; ci < 4; ++ci) {
          newBytes[iNew + ci] = this.bytes[iOld + ci];
        }
      }
    }

    this.width = newWidth;
    this.height = newHeight;
    this.bytes = newBytes;
  }

  extend(t, r, b, l) {
    isDirty = true;
    let newWidth = this.width + l + r;
    let newHeight = this.height + t + b;
    let newBytes = new Uint8Array(newWidth * newHeight * 4);

    for (let rOld = 0; rOld < this.height; ++rOld) {
      for (let cOld = 0; cOld < this.width; ++cOld) {
        let rNew = rOld + t;
        let cNew = cOld + l;
        let iOld = 4 * (rOld * this.width + cOld);
        let iNew = 4 * (rNew * newWidth + cNew);
        for (let ci = 0; ci < 4; ++ci) {
          newBytes[iNew + ci] = this.bytes[iOld + ci];
        }
      }
    }

    this.width = newWidth;
    this.height = newHeight;
    this.bytes = newBytes;
  }

  resize(newWidth, newHeight) {
    isDirty = true;
    this.bytes = Buffer.alloc(newWidth * newHeight * 4, 255);
    this.width = newWidth;
    this.height = newHeight;
  }

  shiftWrap(dc, dr) {
    isDirty = true;
    let newBytes = Buffer.alloc(this.width * this.height * 4, 255);
    for (let r = 0; r < this.height; ++r) {
      for (let c = 0; c < this.width; ++c) {
        let rr = ((r + dr) % this.height + this.height) % this.height;
        let cc = ((c + dc) % this.width + this.width) % this.width;
        let iOld = 4 * (r * this.width + c);
        let iNew = 4 * (rr * this.width + cc);
        this.bytes.copy(newBytes, iNew, iOld, iOld + 4);
      }
    }
    this.bytes = newBytes;
  }

  resizeDelta(t, r, b, l) {
    isDirty = true;
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

  flipLeftRight() {
    isDirty = true;
    let originalImage = this.clone();
    for (let r = 0; r < this.height; ++r) {
      for (let c = 0; c < this.width; ++c) {
        let cc = this.width - 1 - c;
        this.set(c, r, originalImage.get(cc, r));
      }
    }
  }

  flipTopBottom() {
    isDirty = true;
    let originalImage = this.clone();
    for (let r = 0; r < this.height; ++r) {
      for (let c = 0; c < this.width; ++c) {
        let rr = this.height - 1 - r;
        this.set(c, r, originalImage.get(c, rr));
      }
    }
  }

  rotateClockwise() {
    isDirty = true;
    let originalImage = this.clone();
    this.resize(this.height, this.width);

    for (let r = 0; r < this.height; ++r) {
      for (let c = 0; c < this.width; ++c) {
        this.set(c, r, originalImage.get(r, this.width - 1 - c));
      }
    }
  }

  rotateCounterclockwise() {
    isDirty = true;
    let originalImage = this.clone();
    this.resize(this.height, this.width);

    for (let r = 0; r < this.height; ++r) {
      for (let c = 0; c < this.width; ++c) {
        this.set(c, r, originalImage.get(this.height - 1 - r, c));
      }
    }
  }

  rotate180() {
    isDirty = true;
    let originalImage = this.clone();
    for (let r = 0; r < this.height; ++r) {
      for (let c = 0; c < this.width; ++c) {
        this.set(c, r, originalImage.get(this.width - 1 - c, this.height - 1 - r));
      }
    }
  }

  outline4(backgroundColor, outlineColor) {
    isDirty = true;
    let originalImage = this.clone();

    for (let r = 0; r < this.height; ++r) {
      for (let c = 0; c < this.width; ++c) {
        if (originalImage.isPixel(c, r, backgroundColor) &&
            ((r > 0 && !originalImage.isPixel(c, r - 1, backgroundColor) && !originalImage.isPixel(c, r - 1, outlineColor)) ||
             (r < this.height - 1 && !originalImage.isPixel(c, r + 1, backgroundColor) && !originalImage.isPixel(c, r + 1, outlineColor)) ||
             (c > 0 && !originalImage.isPixel(c - 1, r, backgroundColor) && !originalImage.isPixel(c - 1, r, outlineColor)) ||
             (c < this.width - 1 && !originalImage.isPixel(c + 1, r, backgroundColor) && !originalImage.isPixel(c + 1, r, outlineColor)))) {
          this.set(c, r, outlineColor);
        }
      }
    }
  }

  isRow(r, color) {
    for (let c = 0; c < this.width; ++c) {
      if (!this.isPixel(c, r, color)) {
        return false;
      }
    }
    return true;
  }

  isColumn(c, color) {
    for (let r = 0; r < this.height; ++r) {
      if (!this.isPixel(c, r, color)) {
        return false;
      }
    }
    return true;
  }

  autocrop(backgroundColor) {
    isDirty = true;
    let l = 0;
    let r = this.width - 1;
    let t = 0;
    let b = this.height - 1;

    while (l < this.width && this.isColumn(l, backgroundColor)) {
      ++l;
    }
    
    if (l == this.width) {
      return;
    }

    while (r >= 0 && this.isColumn(r, backgroundColor)) {
      --r;
    }

    while (t < this.height && this.isRow(t, backgroundColor)) {
      ++t;
    }

    while (b >= 0 && this.isRow(b, backgroundColor)) {
      --b;
    }

    r = this.width - 1 - r;
    b = this.height - 1 - b;

    this.extract(t, r, b, l);
  }
}

class Texture {
  constructor(image) {
    this.image = image;
    this.textureId = Texture.createTexture(this.image.width, this.image.height, this.image.nchannels, this.image.bytes);
  }

  uploadPixel(c, r) {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, c, r, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.image.bytes, (r * this.image.width + c) * 4);
  }

  upload() {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textureId);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.image.width, this.image.height, 0, this.image.nchannels == 4 ? gl.RGBA : gl.RGB, gl.UNSIGNED_BYTE, this.image.bytes);
  }

  static createTexture(width, height, nchannels, bytes) {
    let texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, nchannels == 4 ? gl.RGBA : gl.RGB, gl.UNSIGNED_BYTE, bytes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    return texture;
  }
}

class Vector2 {
  constructor(x, y) {
    this.values = [x, y];
  }

  toJSON() {
    return this.values;
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

  static fromArray(array) {
    return new Vector2(array[0], array[1]);
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

module.exports = {
  Color,
  Image,
  Matrix4,
  Vector2,
  Texture,
};
