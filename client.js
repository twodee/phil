let canvas;
let gl;
let shaderProgram;
let vao;
let backgroundTexture;
let backgroundTextureUniform;
let resolutionUniform;

function onReady() {
  canvas = document.getElementById('canvas');
  gl = canvas.getContext('webgl2');
  onSize();

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
  shaderProgram = linkProgram(vertexShader, fragmentShader);

  let positions = [
    -1.0, -1.0, 0.0, 1.0,
     1.0, -1.0, 0.0, 1.0,
    -1.0,  1.0, 0.0, 1.0,
     1.0,  1.0, 0.0, 1.0
  ];

  let positionAttributeLocation = gl.getAttribLocation(shaderProgram, 'position');
  let positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

  vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
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
  backgroundTexture = createTexture(gl, checker, 2, 2);

  let backgroundTextureUniform = gl.getUniformLocation(shaderProgram, 'backgroundTexture');
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, backgroundTexture);

  resolutionUniform = gl.getUniformLocation(shaderProgram, 'resolution');

  gl.useProgram(shaderProgram);
  gl.uniform1i(backgroundTextureUniform, 0);

  render();
}

function createTexture(gl, pixels, width, height) {
  let texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  return texture;
}

function render() {
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(shaderProgram);
  gl.uniform2f(resolutionUniform, gl.canvas.width, gl.canvas.height);
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
  gl.useProgram(null);
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
  render();
}

window.addEventListener('load', onReady);
window.addEventListener('resize', onSize, false);
