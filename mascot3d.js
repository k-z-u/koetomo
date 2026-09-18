// こえとも 3D 表示（Blender で作った 3d/koetomo.glb を three.js で動かす）
// 顔は 2D 版と同じパス文字列を Canvas に描き、体のテクスチャとして貼る。
// 体のぷるぷる・ぬるっとした動きは、シェイプキー（Squash / Stretch / LeanL / LeanR / Puff）と
// 頂点シェーダーの揺らぎで作る。
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const CYAN = "#16C4DA", MOUTH_FILL = "#DDF6FA", SKIN = "#FBFCFD", INK = 0x17191d;

// ばね（行き過ぎて戻る＝ぷるんとした動き）
function spring(k = .12, damp = .82) {
  return { x: 0, v: 0, step(target) { this.v = (this.v + (target - this.x) * k) * damp; this.x += this.v; return this.x; } };
}

export async function createMascot3D(canvas, url) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture;
  scene.environmentIntensity = .55;

  const camera = new THREE.PerspectiveCamera(26, 1, .1, 50);
  const lookAt = new THREE.Vector3(0, .5, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xdfe4ea, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(-2.5, 4, 4.5); scene.add(key);
  const rim = new THREE.DirectionalLight(0xe8fbff, .9); rim.position.set(3, 2.5, -3); scene.add(rim);

  // 顔テクスチャ（SVG の座標 580×460 を 2 倍で描く）
  const faceCanvas = document.createElement("canvas");
  faceCanvas.width = 1160; faceCanvas.height = 920;
  const fctx = faceCanvas.getContext("2d");
  const faceTex = new THREE.CanvasTexture(faceCanvas);
  faceTex.flipY = false; faceTex.colorSpace = THREE.SRGBColorSpace;
  faceTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  // ぬるぬる揺れる頂点シェーダー
  const uniforms = { uTime: { value: 0 }, uWave: { value: 0 }, uJelly: { value: 0 } };
  function patch(mat, outline) {
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = "uniform float uTime; uniform float uWave; uniform float uJelly;\n" +
        sh.vertexShader.replace("#include <project_vertex>", `
          float hgt = clamp((transformed.y + 0.1) / 1.7, 0.0, 1.0);
          float amp = 1.0 + uWave * 2.5;
          transformed.x += sin(uTime * 2.1 + transformed.y * 3.2) * 0.012 * hgt * amp;
          transformed.z += sin(uTime * 1.6 + transformed.x * 2.6) * 0.010 * hgt * amp;
          transformed.y += sin(uTime * 2.7 + transformed.x * 4.0) * 0.006 * hgt * uWave;
          transformed.x += uJelly * 0.10 * hgt * hgt;
          ${outline ? "transformed += normalize(normal) * 0.024;" : ""}
          #include <project_vertex>`);
    };
    return mat;
  }
  const skinMat = patch(new THREE.MeshPhysicalMaterial({
    map: faceTex, roughness: .34, clearcoat: .85, clearcoatRoughness: .22, sheen: .4, sheenColor: new THREE.Color(0xdff8fc),
  }), false);
  const footMat = patch(new THREE.MeshPhysicalMaterial({ color: 0xfbfcfd, roughness: .38, clearcoat: .7, clearcoatRoughness: .3 }), false);
  const inkMat = patch(new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }), true);

  const gltf = await new GLTFLoader().loadAsync(url);
  const root = new THREE.Group(); root.add(gltf.scene); scene.add(root);
  let body = null; const feet = [];
  const meshes = []; gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  meshes.forEach((o) => {
    const isBody = !!o.morphTargetDictionary;
    o.material = isBody ? skinMat : footMat;
    const outline = new THREE.Mesh(o.geometry, inkMat);
    outline.morphTargetInfluences = o.morphTargetInfluences;
    outline.morphTargetDictionary = o.morphTargetDictionary;
    o.add(outline);
    if (isBody) body = o; else feet.push({ mesh: o, y: o.position.y });
  });
  feet.sort((a, b) => a.mesh.position.x - b.mesh.position.x);

  // やわらかい床の影
  const sh = document.createElement("canvas"); sh.width = sh.height = 128;
  const sctx = sh.getContext("2d"); const g = sctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, "rgba(40,50,70,.22)"); g.addColorStop(1, "rgba(40,50,70,0)");
  sctx.fillStyle = g; sctx.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.3), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sh), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -.37; scene.add(shadow);

  // 視差（指やマウスの位置でちょっと回り込む）
  const pointer = { x: 0, y: 0 };
  addEventListener("pointermove", (e) => { pointer.x = e.clientX / innerWidth - .5; pointer.y = e.clientY / innerHeight - .5; }, { passive: true });

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 横長画面いっぱいでもキャラが程よい大きさになる距離
    const fitH = 3.5, fitW = 5.4;
    const dist = Math.max(fitH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))), fitW / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
    camera.userData.dist = dist;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas); resize();

  const sq = spring(.10, .80), lean = spring(.06, .86), jelly = spring(.09, .78), hop = spring(.14, .74);
  const yaw = spring(.03, .9);
  let lastTalk = 0;
  const idx = body.morphTargetDictionary;

  function drawFace(f) {
    const c = fctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = SKIN; c.fillRect(0, 0, faceCanvas.width, faceCanvas.height);
    c.setTransform(2, 0, 0, 2, 0, 0);
    c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = CYAN;
    const rotAt = (deg, x, y, fn) => { c.save(); c.translate(x, y); c.rotate(deg * Math.PI / 180); c.translate(-x, -y); fn(); c.restore(); };
    if (f.browOpacity > .01) {
      c.globalAlpha = f.browOpacity; c.lineWidth = 12;
      for (const b of f.brows) rotAt(b.rot, b.x, b.y, () => c.stroke(new Path2D(b.d)));
      c.globalAlpha = 1;
    }
    for (const e of f.eyes) rotAt(e.rot, e.x, 225, () => {
      const p = new Path2D(e.d);
      if (f.eyeFill > .01) { c.globalAlpha = f.eyeFill; c.fillStyle = CYAN; c.fill(p); c.globalAlpha = 1; }
      c.lineWidth = 15; c.stroke(p);
    });
    rotAt(f.mouthRot, 290, 316, () => {
      const p = new Path2D(f.mouth);
      c.fillStyle = MOUTH_FILL; c.fill(p); c.lineWidth = 13; c.stroke(p);
    });
    faceTex.needsUpdate = true;
  }

  let visible = true;
  return {
    setVisible(v) { visible = v; canvas.hidden = !v; if (v) resize(); },
    update(p) {
      if (!visible) return;
      const t = p.now / 1000;
      drawFace(p.face);

      // 話す：声の山で縦にぷるんと伸び縮み、聞く：少し前のめり＆ふくらむ
      const talk = p.talkEnv;
      if (talk - lastTalk > .18) { sq.v -= .12; hop.v += .05; }
      lastTalk = talk;
      const breath = Math.sin(t * 1.6) * .06;
      const s = sq.step(breath + talk * .35 + p.micLevel * .25);
      const inf = body.morphTargetInfluences;
      inf[idx.Squash] = Math.max(0, s) * 1.2;
      inf[idx.Stretch] = Math.max(0, -s) * 1.2 + (p.state === "speaking" ? Math.max(0, Math.sin(t * 7.5)) * talk * .25 : 0);
      inf[idx.Puff] = .15 + Math.sin(t * 1.6) * .1 + p.micLevel * .6 + (p.state === "hearing" ? .25 : 0);
      const l = lean.step(-p.tilt / 7);
      inf[idx.LeanL] = Math.max(0, -l); inf[idx.LeanR] = Math.max(0, l);
      uniforms.uJelly.value = jelly.step(0) + (lean.v * 6);
      uniforms.uWave.value = talk + p.micLevel * .6;
      uniforms.uTime.value = t;

      root.position.y = Math.max(0, hop.step(0)) + Math.sin(t * 1.1) * .015;
      root.rotation.y = yaw.step(Math.sin(t * .45) * .12 + pointer.x * .5);
      root.rotation.z = THREE.MathUtils.degToRad(-p.tilt * .5);
      if (p.state === "away") { root.rotation.x = .06; root.position.y -= .03; } else root.rotation.x = 0;

      // 足：話すときはトコトコ
      feet.forEach((f, i) => {
        f.mesh.position.y = f.y + (p.state === "speaking" ? Math.max(0, Math.sin(t * 9 + i * 2.1)) * .025 * talk : 0);
      });
      shadow.scale.setScalar(1 - root.position.y * .6);

      const d = camera.userData.dist || 7;
      camera.position.set(Math.sin(.18 + pointer.x * .15) * d, .95 + d * .08 - pointer.y * .3, Math.cos(.18 + pointer.x * .15) * d);
      camera.lookAt(lookAt);
      renderer.render(scene, camera);
    },
  };
}
