'use client';

import {useEffect, useRef} from 'react';

const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_resolution;
uniform float u_time;

vec3 colorA = vec3(0.72, 0.92, 0.97);
vec3 colorB = vec3(0.20, 0.36, 0.58);
vec3 colorC = vec3(0.56, 0.84, 0.94);
vec3 base = vec3(0.974, 0.987, 0.996);

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);

  // Autonomous magma-like drift (time-based only, scroll-independent).
  uv.x += sin(uv.y * 6.0 + u_time * 0.22) * 0.0035;
  uv.y += cos(uv.x * 5.0 + u_time * 0.16) * 0.0029;

  vec2 p1 = vec2(
    0.14 + sin(u_time * 0.18) * 0.065,
    0.2 + cos(u_time * 0.14) * 0.05
  );
  vec2 p2 = vec2(
    0.86 + cos(u_time * 0.15) * 0.07,
    0.76 + sin(u_time * 0.12) * 0.05
  );
  vec2 p3 = vec2(
    0.56 + sin(u_time * 0.11 + 1.3) * 0.055,
    0.38 + cos(u_time * 0.14 + 0.7) * 0.045
  );

  vec2 d1v = (uv - p1) * vec2(aspect, 1.0);
  vec2 d2v = (uv - p2) * vec2(aspect, 1.0);
  vec2 d3v = (uv - p3) * vec2(aspect, 1.0);

  float f1 = exp(-dot(d1v, d1v) * 2.7);
  float f2 = exp(-dot(d2v, d2v) * 2.5);
  float f3 = exp(-dot(d3v, d3v) * 2.9);

  float weight = f1 + f2 + f3 + 0.0001;
  vec3 field = (colorA * f1 + colorB * f2 + colorC * f3) / weight;

  float influence = smoothstep(0.06, 0.94, clamp(weight * 0.64, 0.0, 1.0));
  vec3 finalColor = mix(base, field, influence * 0.22);

  gl_FragColor = vec4(finalColor, 1.0);
}
`;

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext, vsSource: string, fsSource: string) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  if (!vertexShader || !fragmentShader) return null;

  const program = gl.createProgram();
  if (!program) return null;

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }

  return program;
}

export function WebGLBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
      premultipliedAlpha: true,
      preserveDrawingBuffer: false
    });

    if (!gl) return;

    const program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    if (!program) return;

    const posLocation = gl.getAttribLocation(program, 'a_position');
    const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
    const timeLocation = gl.getUniformLocation(program, 'u_time');

    const buffer = gl.createBuffer();
    if (!buffer || posLocation < 0 || !resolutionLocation || !timeLocation) {
      gl.deleteProgram(program);
      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        -1, 1,
        1, -1,
        1, 1
      ]),
      gl.STATIC_DRAW
    );

    gl.useProgram(program);
    gl.enableVertexAttribArray(posLocation);
    gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 0, 0);

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isMobile = window.matchMedia('(max-width: 980px)').matches;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, isMobile ? 1.1 : 1.35);
    const frameInterval = reduceMotion ? 1000 : 1000 / (isMobile ? 22 : 30);

    let raf = 0;
    let start = performance.now();
    let lastFrame = 0;

    const resize = () => {
      const width = Math.max(1, Math.floor(window.innerWidth * pixelRatio));
      const height = Math.max(1, Math.floor(window.innerHeight * pixelRatio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
    };

    const draw = (now: number) => {
      if (now - lastFrame < frameInterval) {
        raf = window.requestAnimationFrame(draw);
        return;
      }
      lastFrame = now;
      const elapsed = (now - start) * 0.001;

      resize();
      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, reduceMotion ? 0 : elapsed);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      if (!reduceMotion) {
        raf = window.requestAnimationFrame(draw);
      }
    };

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      if (raf) window.cancelAnimationFrame(raf);
    };

    canvas.addEventListener('webglcontextlost', handleContextLost, {passive: false});
    resize();
    raf = window.requestAnimationFrame(draw);

    const onResize = () => {
      resize();
      if (reduceMotion) {
        start = performance.now();
        lastFrame = 0;
        raf = window.requestAnimationFrame(draw);
      }
    };

    window.addEventListener('resize', onResize, {passive: true});

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  return (
    <>
      <div className="webgl-fallback" aria-hidden="true" />
      <canvas ref={canvasRef} className="webgl-bg" aria-hidden="true" />
    </>
  );
}
