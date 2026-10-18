/* global bench */
// 고정 작업량 그래픽 테스트: 전체 화면 셰이더(GPU 부하) + 소형 사각형 1500회 드로우 콜(CPU·드라이버 부하)
// 해상도 1280x720 고정 → 전/후 측정 작업량이 항상 같다.
(function () {
  const seconds = Number(new URLSearchParams(location.search).get('s')) || 15;
  const WARMUP = 3000;
  const DRAWS = 1500;
  const hud = document.getElementById('hud');
  const canvas = document.getElementById('c');
  // desynchronized(저지연 캔버스)는 쓰지 않는다: 켜면 60 FPS 로 묶여 빠른 GPU 끼리 차이가 사라진다
  const gl = canvas.getContext('webgl2', { antialias: false, powerPreference: 'high-performance' });
  const report = (r) => { try { bench.done(r); } catch (_) {} };
  if (!gl) { report({ error: 'WebGL2를 사용할 수 없습니다 (그래픽 드라이버 확인)' }); return; }

  function prog(vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    return p;
  }

  const VS = `#version 300 es
  in vec2 a; uniform vec4 r; out vec2 uv;
  void main(){ uv = a*0.5+0.5; gl_Position = vec4(r.xy + a*r.zw, 0.0, 1.0); }`;

  // 전체 화면: 레이마칭 프랙탈 (고정 반복 횟수)
  const FS_BG = `#version 300 es
  precision highp float; in vec2 uv; uniform float t; out vec4 o;
  float map(vec3 p){
    vec3 z = p; float dr = 1.0, r = 0.0;
    for (int i = 0; i < 6; i++) {
      r = length(z); if (r > 2.0) break;
      float th = acos(clamp(z.z / r, -1.0, 1.0)) * 8.0, ph = atan(z.y, z.x) * 8.0;
      dr = pow(r, 7.0) * 8.0 * dr + 1.0;
      z = pow(r, 8.0) * vec3(sin(th)*cos(ph), sin(ph)*sin(th), cos(th)) + p;
    }
    return 0.5 * log(r) * r / dr;
  }
  void main(){
    vec2 q = (uv - 0.5) * vec2(1.777, 1.0);
    float a = t * 0.3;
    vec3 ro = vec3(2.6*sin(a), 0.4, 2.6*cos(a));
    vec3 f = normalize(-ro), rr = normalize(cross(vec3(0,1,0), f)), u = cross(f, rr);
    vec3 rd = normalize(f + q.x*rr + q.y*u);
    float d = 0.0; float g = 0.0; int k;
    for (k = 0; k < 64; k++) { float h = map(ro + rd*d); if (h < 0.001 || d > 6.0) break; d += h; g += 1.0; }
    vec3 c = d < 6.0 ? vec3(0.13,0.89,0.63) * (1.0 - g/64.0) + vec3(0.1,0.7,1.0)*0.2 : vec3(0.02,0.03,0.05);
    o = vec4(c, 1.0);
  }`;

  const FS_Q = `#version 300 es
  precision mediump float; in vec2 uv; uniform vec3 col; out vec4 o;
  void main(){ float e = smoothstep(0.5, 0.45, length(uv-0.5)); o = vec4(col*e, e); }`;

  let pBg, pQ;
  try { pBg = prog(VS, FS_BG); pQ = prog(VS, FS_Q); } catch (e) { report({ error: '셰이더 오류: ' + e.message }); return; }

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindAttribLocation(pBg, 0, 'a');
  gl.bindAttribLocation(pQ, 0, 'a');
  gl.linkProgram(pBg); gl.linkProgram(pQ);
  const uBgR = gl.getUniformLocation(pBg, 'r'), uBgT = gl.getUniformLocation(pBg, 't');
  const uQR = gl.getUniformLocation(pQ, 'r'), uQC = gl.getUniformLocation(pQ, 'col');
  gl.viewport(0, 0, 1280, 720);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const start = performance.now();
  let last = start, frames = [], shown = 0;

  function frame(now) {
    const t = (now - start) / 1000;
    gl.useProgram(pBg);
    gl.uniform4f(uBgR, 0, 0, 1, 1);
    gl.uniform1f(uBgT, t);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.useProgram(pQ);
    for (let i = 0; i < DRAWS; i++) {
      const a = i * 0.618 + t * (0.2 + (i % 7) * 0.05);
      gl.uniform4f(uQR, Math.sin(a) * 0.9, Math.cos(a * 1.3) * 0.9, 0.02, 0.035);
      gl.uniform3f(uQC, 0.5 + 0.5 * Math.sin(i), 0.6, 0.5 + 0.5 * Math.cos(i));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    const el = now - start;
    if (el > WARMUP) frames.push(now - last);
    last = now;
    if (now - shown > 250) {
      shown = now;
      const recent = frames.slice(-30);
      const fps = recent.length ? Math.round(1000 / (recent.reduce((x, y) => x + y, 0) / recent.length)) : 0;
      hud.textContent = el < WARMUP ? '예열 중…' : `그래픽 테스트 ${Math.max(0, Math.ceil((WARMUP + seconds * 1000 - el) / 1000))}초 · ${fps} FPS`;
    }
    if (el >= WARMUP + seconds * 1000) return finish();
    requestAnimationFrame(frame);
  }

  function finish() {
    const n = frames.length;
    const total = frames.reduce((x, y) => x + y, 0);
    const mean = total / n;
    const sorted = [...frames].sort((x, y) => y - x);
    const k = Math.max(1, Math.round(n * 0.01));
    const worst = sorted.slice(0, k).reduce((x, y) => x + y, 0) / k;
    const std = Math.sqrt(frames.reduce((s, f) => s + (f - mean) ** 2, 0) / n);
    report({ avgFps: +(1000 / mean).toFixed(1), low1: +(1000 / worst).toFixed(1), ftStd: +std.toFixed(3), frames: n });
  }

  requestAnimationFrame(frame);
})();
