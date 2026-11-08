// three.js による描画。物理の状態を受け取って表示するだけにする。
import * as THREE from 'three';
import { BOWL, DIE_SIZE, FACE_VALUES } from './physics.js';

// 目の配置（-1〜1 の座標）
const PIPS = {
  1: [[0, 0]],
  2: [[-0.5, -0.5], [0.5, 0.5]],
  3: [[-0.5, -0.5], [0, 0], [0.5, 0.5]],
  4: [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]],
  5: [[-0.5, -0.5], [0.5, -0.5], [0, 0], [-0.5, 0.5], [0.5, 0.5]],
  6: [[-0.5, -0.55], [0.5, -0.55], [-0.5, 0], [0.5, 0], [-0.5, 0.55], [0.5, 0.55]],
};

function faceTexture(value) {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#f7f3ea';
  g.fillRect(0, 0, s, s);
  // 角を少し暗くして丸みを出す
  const grad = g.createRadialGradient(s / 2, s / 2, s * 0.35, s / 2, s / 2, s * 0.75);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(90,70,40,0.35)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const one = value === 1;
  g.fillStyle = one ? '#c8102e' : '#1b1b1b';
  const r = one ? s * 0.17 : s * 0.085;
  for (const [x, y] of PIPS[value]) {
    g.beginPath();
    g.arc(s / 2 + x * s * 0.6, s / 2 + y * s * 0.6, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function feltTexture() {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  g.fillStyle = '#1f5a3a';
  g.fillRect(0, 0, s, s);
  const img = g.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class TableScene {
  constructor(container) {
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#120d0a');
    scene.fog = new THREE.Fog('#120d0a', 14, 30);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.cameraBase = new THREE.Vector3(0, 9.6, 7.6);
    this.lookAt = new THREE.Vector3(0, 0.6, 0.5);
    this.camera.position.copy(this.cameraBase);
    this.camera.lookAt(this.lookAt);

    scene.add(new THREE.HemisphereLight('#ffe9c9', '#2a1a10', 0.7));
    const lamp = new THREE.SpotLight('#ffd9a0', 120, 30, Math.PI / 5, 0.5, 1.6);
    lamp.position.set(1.5, 11, 2.5);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 2048);
    lamp.shadow.bias = -0.0004;
    scene.add(lamp);
    scene.add(lamp.target);

    // 卓
    const table = new THREE.Mesh(
      new THREE.CircleGeometry(14, 64),
      new THREE.MeshStandardMaterial({ map: feltTexture(), roughness: 0.95 }),
    );
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    scene.add(table);

    this.#buildBowl();
    this.#buildDice();
    this.#buildParticles();

    this.shake = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  #buildBowl() {
    const { profile, wallThickness: t } = BOWL;
    // 内側の断面の外側に厚みを付け、縁で折り返す
    const inner = [[0, 0.16], ...profile].map(([r, y]) => new THREE.Vector2(r, y));
    const top = profile[profile.length - 1];
    const outer = [
      [top[0] + t, top[1]],
      [top[0] + t * 0.9, top[1] - 0.5],
      [profile[1][0] + t, 0.12],
      [profile[0][0] * 0.8, 0.0],
      [0, 0.0],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const insideGeo = new THREE.LatheGeometry(inner, 64);
    const outsideGeo = new THREE.LatheGeometry([inner[inner.length - 1], ...outer], 64);
    const inside = new THREE.Mesh(insideGeo, new THREE.MeshStandardMaterial({ color: '#f4efe6', roughness: 0.25, metalness: 0.0, side: THREE.DoubleSide }));
    const outside = new THREE.Mesh(outsideGeo, new THREE.MeshStandardMaterial({ color: '#7a2318', roughness: 0.35, side: THREE.DoubleSide }));
    inside.receiveShadow = true;
    outside.castShadow = true;
    outside.receiveShadow = true;
    // 内側の縁に藍色の線
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(top[0] + t * 0.5, 0.05, 8, 64),
      new THREE.MeshStandardMaterial({ color: '#d9cfbd', roughness: 0.4 }),
    );
    band.rotation.x = Math.PI / 2;
    band.position.y = top[1];
    this.scene.add(inside, outside, band);
  }

  #buildDice() {
    const geo = new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE);
    const mats = FACE_VALUES.map((v) => new THREE.MeshStandardMaterial({ map: faceTexture(v), roughness: 0.4 }));
    this.dice = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(geo, mats);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      return m;
    });
  }

  #buildParticles() {
    const n = 220;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.particleVel = new Float32Array(n * 3);
    this.particleLife = 0;
    const mat = new THREE.PointsMaterial({ size: 0.13, vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
    this.particles = new THREE.Points(geo, mat);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
  }

  /** 紙吹雪を丼から噴き上げる。palette は色の配列 */
  burst(palette = ['#ffd54a', '#ff5a3c', '#ffffff']) {
    const pos = this.particles.geometry.attributes.position;
    const col = this.particles.geometry.attributes.color;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, (Math.random() - 0.5) * 1.5, 1.0, (Math.random() - 0.5) * 1.5);
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4;
      this.particleVel[i * 3] = Math.cos(a) * sp * 0.6;
      this.particleVel[i * 3 + 1] = 6 + Math.random() * 6;
      this.particleVel[i * 3 + 2] = Math.sin(a) * sp * 0.6;
      c.set(palette[i % palette.length]);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.particleLife = 2.2;
  }

  addShake(amount) {
    this.shake = Math.max(this.shake, amount);
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // 縦長の画面では引いて丼全体が入るようにする
    this.camera.fov = w / h < 0.8 ? 72 : 44;
    this.camera.updateProjectionMatrix();
  }

  /** 画面座標を、高さ y の水平面上の点に変換する */
  screenToPlane(clientX, clientY, y) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const out = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, out) ? out : null;
  }

  render(bodies, dt) {
    bodies.forEach((b, i) => {
      this.dice[i].position.set(b.position.x, b.position.y, b.position.z);
      this.dice[i].quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      this.dice[i].visible = b.position.y > -4;
    });

    if (this.particleLife > 0) {
      this.particleLife -= dt;
      const pos = this.particles.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        this.particleVel[i * 3 + 1] -= 12 * dt;
        pos.setXYZ(
          i,
          pos.getX(i) + this.particleVel[i * 3] * dt,
          pos.getY(i) + this.particleVel[i * 3 + 1] * dt,
          pos.getZ(i) + this.particleVel[i * 3 + 2] * dt,
        );
      }
      pos.needsUpdate = true;
      this.particles.material.opacity = Math.min(1, this.particleLife);
    } else {
      this.particles.material.opacity = 0;
    }

    this.camera.position.copy(this.cameraBase);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 1.5);
    }
    this.camera.lookAt(this.lookAt);
    this.renderer.render(this.scene, this.camera);
  }
}
