// Небо і горизонт (середня/висока якість, ясна погода): рухомі хмари та силует міста за туманом. Лише вигляд, на правила не впливає.
// Обидва об'єкти — шейдерні, без текстур; їдуть за камерою, тож «нескінченні». Малюються лише на небі/горизонті (далі за туман).
import { BackSide, Color, CylinderGeometry, Group, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import type { Tod } from './quality';

const NOISE = `
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }`;
const TAIL = `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>`;

const CLOUD_V = `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const CLOUD_F = `varying vec3 vDir; uniform float uTime; uniform float uCover; uniform vec3 uLit; uniform vec3 uShade; uniform float uAlpha;${NOISE}
void main(){
  vec3 d = normalize(vDir);
  if (d.y < 0.015) discard;
  vec2 uv = d.xz / (d.y + 0.2) * 1.15 + vec2(uTime * 0.010, uTime * 0.004);
  float n = fbm(uv);
  float c = smoothstep(uCover, uCover + 0.16, n) * smoothstep(0.015, 0.2, d.y);
  float body = smoothstep(uCover, uCover + 0.55, fbm(uv * 1.7 + 3.1)); // темніша основа щільних хмар
  gl_FragColor = vec4(mix(uLit, uShade, body * 0.6), c * uAlpha);${TAIL}
}`;

const CITY_V = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const CITY_F = `varying vec2 vUv; uniform vec3 uHaze; uniform float uNight; uniform float uH;${NOISE}
void main(){
  float ang = vUv.x * 6.2831853, h = vUv.y * uH;
  float id = floor(vUv.x * 150.0);
  float cluster = 0.25 + 0.9 * fbm(vec2(ang * 1.6, 3.0));       // райони: де вище, де нижче
  float hgt = (5.0 + 34.0 * pow(h21(vec2(id, 7.0)), 2.2)) * cluster;
  if (h > hgt) discard;
  vec3 col = mix(uHaze, vec3(0.50, 0.58, 0.68), 0.32) * (0.9 + 0.1 * (h / uH));
  if (uNight > 0.0) { // освітлені вікна
    vec2 g = vec2(vUv.x * 150.0 * 5.0, h * 0.45);
    vec2 f = fract(g);
    float win = step(0.8, h21(floor(g) + id)) * step(0.2, f.x) * step(f.x, 0.75) * step(0.25, f.y) * step(f.y, 0.7);
    col = mix(col * 0.55, vec3(1.0, 0.82, 0.45), win * 0.75 * uNight);
  }
  gl_FragColor = vec4(col, 1.0);${TAIL}
}`;

export class SkyFx {
  readonly group = new Group();
  private readonly cloud: ShaderMaterial;
  private readonly city: ShaderMaterial;
  private on = false;

  constructor() {
    this.cloud = new ShaderMaterial({
      vertexShader: CLOUD_V, fragmentShader: CLOUD_F, side: BackSide, transparent: true, depthWrite: false, fog: false,
      uniforms: { uTime: { value: 0 }, uCover: { value: 0.43 }, uLit: { value: new Color(1, 1, 1) }, uShade: { value: new Color(0.62, 0.68, 0.78) }, uAlpha: { value: 0.9 } },
    });
    this.city = new ShaderMaterial({
      vertexShader: CITY_V, fragmentShader: CITY_F, side: BackSide, depthWrite: false, fog: false,
      uniforms: { uHaze: { value: new Color(0.7, 0.8, 0.9) }, uNight: { value: 0 }, uH: { value: 60 } },
    });
    const dome = new Mesh(new SphereGeometry(225, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), this.cloud);
    dome.renderOrder = -2; dome.frustumCulled = false;
    const ring = new Mesh(new CylinderGeometry(215, 215, 60, 72, 1, true), this.city);
    ring.position.y = 27; ring.renderOrder = -3; ring.frustumCulled = false;
    this.group.add(ring, dome);
    this.group.visible = false;
  }

  // Параметри від якості, погоди, часу доби й кольору туману (на горизонті силует зливається з ним).
  configure(on: boolean, tod: Tod, haze: Color): void {
    this.on = on;
    this.city.uniforms['uHaze']!.value.copy(haze);
    this.city.uniforms['uNight']!.value = tod === 'night' ? 1 : tod === 'evening' ? 0.4 : 0;
    const lit = this.cloud.uniforms['uLit']!.value as Color, shade = this.cloud.uniforms['uShade']!.value as Color;
    if (tod === 'night') { lit.set(0x2b3a5c); shade.set(0x161d33); this.cloud.uniforms['uAlpha']!.value = 0.5; }
    else if (tod === 'evening') { lit.set(0xffb98a); shade.set(0x9a6a6e); this.cloud.uniforms['uAlpha']!.value = 0.85; }
    else { lit.set(0xffffff); shade.set(0x9fb0c8); this.cloud.uniforms['uAlpha']!.value = 0.9; }
  }

  update(t: number, cx: number, cz: number, visible: boolean): void {
    this.group.visible = this.on && visible;
    if (!this.group.visible) return;
    this.group.position.set(cx, 0, cz);
    this.cloud.uniforms['uTime']!.value = t;
  }
}
