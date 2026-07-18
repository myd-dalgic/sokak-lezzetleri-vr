import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/* ============================================================
   SOKAK LEZZETLERİ ARABASI
   Köfte-ekmek standı simülasyonu (WebXR + Mouse destekli)
   - Gerçek 3D modeller: Barbeque (ızgara), Tongs (maşa), Glove (eldiven)
   - Eldivenler VR kontrolcülerine takılı, parmaklar grip ile kıvrılır
   ============================================================ */

let scene, camera, renderer, clock;
let raycaster, mouse;
let grabbed = null; // { object, controller/pointer, offset }
let controller1, controller2;
let money = 0;
let toastTimer = null;

// --- Hareket (locomotion) ---
let playerRig;
const keysDown = {};
const MOVE_SPEED = 1.8; // m/s
const SNAP_TURN_DEG = 32;
const ROOM_BOUNDS = { minX: -4.5, maxX: 4.5, minZ: -3.2, maxZ: 4.5 };
const CART_KEEPOUT = { minX: -1.5, maxX: 1.5, minZ: -1.3, maxZ: -0.25 };

const grabbables = [];
const grillSlots = [];
const orderTypes = [
  { name: 'Köfte-Ekmek', needs: ['bread', 'kofte', 'tomato'], price: 45 },
  { name: 'Sade Köfte-Ekmek', needs: ['bread', 'kofte'], price: 35 },
  { name: 'Köfte-Ekmek (Soğanlı)', needs: ['bread', 'kofte', 'onion'], price: 40 },
  { name: 'Full Köfte-Ekmek', needs: ['bread', 'kofte', 'tomato', 'onion'], price: 55 },
];

let currentOrder = null;
let packetKofte = null;
const smokeParticles = [];
const stains = [];
const MAX_STAINS = 18;

let audioCtx = null;
let hoverTarget = null;
let dragTarget = new THREE.Vector3();
let dragOffsetY = 0.05;
const TONG_CLOSE_ANGLE = 0.42;

// Eldiven sistemi
let gloveModel = null; // base (paylaşılan) model
const gloves = []; // { model, pivotNodes: {Index, Middle, Ring, Pinky, Thumb}, closeAmount, targetClose, attachedTo }
let gltfLoader = null;
let coalMesh = null; // ızgara içindeki kömür glow (Barbeque.glb'den)

function init() {
  clock = new THREE.Clock();

  scene = new THREE.Scene();
  scene.background = makeSkyTexture();
  scene.fog = new THREE.Fog(0xaed4e8, 10, 32);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 100);
  camera.position.set(0, 1.6, 0);

  playerRig = new THREE.Group();
  playerRig.position.set(0, 0, 2.2);
  playerRig.add(camera);

  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas'), antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');

  document.getElementById('vrBtn').addEventListener('click', () => {
    document.body.appendChild(VRButton.createButton(renderer));
    document.getElementById('vrBtn').style.display = 'none';
  });

  // Işıklar
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x554433, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3d9, 1.7);
  sun.position.set(3, 6, 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -4;
  sun.shadow.camera.right = 4;
  sun.shadow.camera.top = 4;
  sun.shadow.camera.bottom = -4;
  scene.add(sun);

  scene.add(playerRig);

  buildEnvironment();
  buildCart();
  buildIngredients();
  buildMeatPacket();
  buildBell();

  // 3D modeller
  gltfLoader = new GLTFLoader();
  loadBarbeque();
  loadTongs();
  loadGloves();

  // Mouse / touch
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  setupControllers();

  // Masaüstü: Boşluk ile sık
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && grabbed && !e.repeat) {
      e.preventDefault();
      if (grabbed.userData.isTongs) {
        grabbed.userData.closed = true;
      } else {
        trySqueeze(grabbed);
      }
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && grabbed && grabbed.userData.isTongs) {
      grabbed.userData.closed = false;
    }
  });

  window.addEventListener('resize', onResize);

  window.addEventListener('keydown', (e) => { keysDown[e.code] = true; });
  window.addEventListener('keyup', (e) => { keysDown[e.code] = false; });

  nextOrder();
  showToast('Standa hoş geldin! Ellerinde eldiven var, köfte paketinden al, ızgaraya koy 🔥');
}

/* ---------------- ORTAM ---------------- */
function makeSkyTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#5f9fd6');
  grad.addColorStop(0.55, '#a9d3e8');
  grad.addColorStop(0.8, '#e7c98f');
  grad.addColorStop(1, '#f2ddb0');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeCobbleTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#8d8677';
  ctx.fillRect(0, 0, size, size);
  const tile = 32;
  for (let y = 0; y < size; y += tile) {
    for (let x = 0; x < size; x += tile) {
      const shade = 130 + Math.floor(Math.random() * 40);
      ctx.fillStyle = `rgb(${shade},${shade - 10},${shade - 25})`;
      const off = (Math.floor(y / tile) % 2) * (tile / 2);
      ctx.fillRect(x + off - tile / 2, y, tile - 3, tile - 3);
      ctx.strokeStyle = 'rgba(0,0,0,0.15)';
      ctx.strokeRect(x + off - tile / 2, y, tile - 3, tile - 3);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 10);
  return tex;
}

function makeBrickTexture(base = '#a05a3f', mortar = '#c9b79c') {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, size, size);
  const bw = 32, bh = 16;
  ctx.fillStyle = base;
  for (let y = 0; y < size; y += bh) {
    const off = (Math.floor(y / bh) % 2) * (bw / 2);
    for (let x = -bw; x < size + bw; x += bw) {
      ctx.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 3);
  return tex;
}

function buildEnvironment() {
  const groundGeo = new THREE.PlaneGeometry(40, 40);
  const groundMat = new THREE.MeshStandardMaterial({ map: makeCobbleTexture(), roughness: 0.95 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  buildCityBackdrop();
  buildStreetLamp(-3.4, -2.3);
  buildStreetLamp(3.4, 2.8);
  buildPlanter(-1.7, -1.3);
  buildPlanter(1.9, -0.9);
  buildSignboard();
}

// Arka planda basit bina silüetleri - meydanın "boşlukta" durmasını engeller
function buildCityBackdrop() {
  const positions = [
    [-6.5, -6.5, 2.4, 0xd8b98e], [-4.2, -7.5, 3.2, 0xc9a878], [-1.5, -8, 3.8, 0xdcc39a],
    [1.6, -8, 3.4, 0xceb282], [4.3, -7.4, 2.8, 0xdac89f], [6.6, -6.3, 3.6, 0xc3a274],
    [-7.5, 3, 3.0, 0xd2b68d], [7.6, 3.3, 3.4, 0xcaa87f],
  ];
  const brick = makeBrickTexture();
  positions.forEach(([x, z, height, color]) => {
    const w = 2.6 + Math.random() * 1.2;
    const geo = new THREE.BoxGeometry(w, height, 2.4);
    const mat = new THREE.MeshStandardMaterial({ map: brick, color, roughness: 0.9 });
    const bldg = new THREE.Mesh(geo, mat);
    bldg.position.set(x, height / 2, z);
    bldg.castShadow = false;
    bldg.receiveShadow = true;
    scene.add(bldg);

    // basit çatı
    const roofGeo = new THREE.BoxGeometry(w + 0.2, 0.15, 2.6);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x5a4636, roughness: 0.8 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(x, height + 0.08, z);
    scene.add(roof);

    // birkaç pencere (emissive, akşam ışığı hissi)
    for (let i = 0; i < 3; i++) {
      const winGeo = new THREE.PlaneGeometry(0.35, 0.45);
      const winMat = new THREE.MeshStandardMaterial({ color: 0xfff2c4, emissive: 0xffd98a, emissiveIntensity: 0.7 });
      const win = new THREE.Mesh(winGeo, winMat);
      win.position.set(x - w / 2 + 0.5 + i * (w - 1) / 2, height * 0.5 + (Math.random() - 0.5) * height * 0.3, z + 1.21);
      scene.add(win);
    }
  });
}

function buildStreetLamp(x, z) {
  const group = new THREE.Group();
  const poleGeo = new THREE.CylinderGeometry(0.035, 0.045, 2.3, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.5, metalness: 0.6 });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 1.15;
  pole.castShadow = true;
  group.add(pole);

  const armGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.32, 6);
  const arm = new THREE.Mesh(armGeo, poleMat);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(0.16, 2.28, 0);
  group.add(arm);

  const shadeGeo = new THREE.ConeGeometry(0.13, 0.16, 12, 1, true);
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.6, side: THREE.DoubleSide });
  const shade = new THREE.Mesh(shadeGeo, shadeMat);
  shade.position.set(0.31, 2.24, 0);
  group.add(shade);

  const bulbGeo = new THREE.SphereGeometry(0.045, 10, 10);
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffcf70, emissiveIntensity: 1.1 });
  const bulb = new THREE.Mesh(bulbGeo, bulbMat);
  bulb.position.set(0.31, 2.16, 0);
  group.add(bulb);

  const lampLight = new THREE.PointLight(0xffcf80, 0.9, 3.5, 2);
  lampLight.position.copy(bulb.position);
  group.add(lampLight);

  group.position.set(x, 0, z);
  scene.add(group);
}

function buildPlanter(x, z) {
  const group = new THREE.Group();
  const potGeo = new THREE.CylinderGeometry(0.16, 0.13, 0.22, 12);
  const potMat = new THREE.MeshStandardMaterial({ color: 0x9c5a3c, roughness: 0.9 });
  const pot = new THREE.Mesh(potGeo, potMat);
  pot.position.y = 0.11;
  pot.castShadow = true;
  pot.receiveShadow = true;
  group.add(pot);

  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 0.8 });
  for (let i = 0; i < 6; i++) {
    const leafGeo = new THREE.ConeGeometry(0.035, 0.28 + Math.random() * 0.1, 5);
    const leaf = new THREE.Mesh(leafGeo, leafMat);
    const ang = (i / 6) * Math.PI * 2;
    leaf.position.set(Math.cos(ang) * 0.05, 0.32, Math.sin(ang) * 0.05);
    leaf.rotation.z = Math.cos(ang) * 0.35;
    leaf.rotation.x = Math.sin(ang) * 0.35;
    leaf.castShadow = true;
    group.add(leaf);
  }
  group.position.set(x, 0, z);
  scene.add(group);
}

// Tezgahın üstünde asılı tabela: "SOKAK LEZZETLERİ"
function buildSignboard() {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#2b1d14';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#f4d489';
  ctx.font = 'bold 54px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SOKAK LEZZETLERİ', 256, 64);
  const tex = new THREE.CanvasTexture(canvas);
  const geo = new THREE.PlaneGeometry(1.5, 0.375);
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
  const sign = new THREE.Mesh(geo, mat);
  sign.position.set(0, 2.32, -0.32);
  scene.add(sign);
}

/* ---------------- ARABA / TEZGAH ---------------- */
function buildCart() {
  const cartGroup = new THREE.Group();

  const bodyGeo = new THREE.BoxGeometry(2.4, 1.0, 0.8);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb33939, roughness: 0.6, metalness: 0.15 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.set(0, 0.5, -0.8);
  body.castShadow = true;
  body.receiveShadow = true;
  cartGroup.add(body);

  const stripeGeo = new THREE.BoxGeometry(2.42, 0.12, 0.82);
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xffd166, roughness: 0.5 });
  const stripe = new THREE.Mesh(stripeGeo, stripeMat);
  stripe.position.set(0, 0.08, -0.8);
  cartGroup.add(stripe);

  const topGeo = new THREE.BoxGeometry(2.5, 0.06, 0.9);
  const topMat = new THREE.MeshStandardMaterial({ color: 0xd8dce0, roughness: 0.35, metalness: 0.6 });
  const top = new THREE.Mesh(topGeo, topMat);
  top.position.set(0, 1.03, -0.8);
  top.receiveShadow = true;
  top.castShadow = true;
  cartGroup.add(top);

  const canopyGeo = new THREE.BoxGeometry(2.6, 0.08, 1.0);
  const canopyMat = new THREE.MeshStandardMaterial({ map: makeCanopyTexture(), roughness: 0.85 });
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.set(0, 2.1, -0.8);
  canopy.castShadow = true;
  cartGroup.add(canopy);

  for (let i = -5; i <= 5; i++) {
    const flapGeo = new THREE.ConeGeometry(0.11, 0.15, 4);
    const flapMat = new THREE.MeshStandardMaterial({ color: i % 2 === 0 ? 0xff6b35 : 0xffffff, roughness: 0.8 });
    const flap = new THREE.Mesh(flapGeo, flapMat);
    flap.rotation.x = Math.PI;
    flap.position.set(i * 0.23, 2.02, -0.32);
    cartGroup.add(flap);
  }

  const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.1, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
  [[-1.15, -0.35], [1.15, -0.35], [-1.15, -1.25], [1.15, -1.25]].forEach(([x, z]) => {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, 1.55, z);
    cartGroup.add(pole);
  });

  // Izgara üzeri ışık
  const grillLight = new THREE.PointLight(0xff5522, 2.2, 2.2, 2);
  grillLight.position.set(0.75, 1.35, -0.8);
  grillLight.castShadow = true;
  grillLight.shadow.mapSize.set(512, 512);
  cartGroup.add(grillLight);
  scene.userData.grillLight = grillLight;

  // Tente kenarında ışık dizisi (eski tekli "ampul" yerine - daha kaliteli/pazar-tezgahı hissi)
  const stringLightGroup = new THREE.Group();
  const bulbGeo = new THREE.SphereGeometry(0.02, 8, 8);
  const bulbColors = [0xffcf80, 0xffe0a0, 0xffb877];
  for (let i = -6; i <= 6; i++) {
    const bColor = bulbColors[Math.abs(i) % bulbColors.length];
    const bMat = new THREE.MeshStandardMaterial({ color: bColor, emissive: bColor, emissiveIntensity: 1.1 });
    const b = new THREE.Mesh(bulbGeo, bMat);
    const sag = 0.05 * Math.cos((i / 6) * (Math.PI / 2));
    b.position.set(i * 0.2, 2.02 - sag, -0.28);
    stringLightGroup.add(b);
  }
  cartGroup.add(stringLightGroup);
  const stringLight = new THREE.PointLight(0xffd9a0, 0.6, 1.8, 2);
  stringLight.position.set(0, 2.0, -0.28);
  cartGroup.add(stringLight);
  scene.userData.stringLightBulbs = stringLightGroup.children;

  // Servis / ekmek / köfte halkaları
  const trayZone = new THREE.Mesh(
    new THREE.RingGeometry(0.18, 0.22, 24),
    new THREE.MeshBasicMaterial({ color: 0x00ff88, side: THREE.DoubleSide, transparent: true, opacity: 0.6 })
  );
  trayZone.rotation.x = -Math.PI / 2;
  trayZone.position.set(-0.85, 1.065, -0.8);
  trayZone.name = 'serveZone';
  cartGroup.add(trayZone);
  scene.userData.serveZonePos = trayZone.getWorldPosition(new THREE.Vector3());

  const breadZone = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.18, 24),
    new THREE.MeshBasicMaterial({ color: 0xffcc66, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
  );
  breadZone.rotation.x = -Math.PI / 2;
  breadZone.position.set(-0.25, 1.065, -0.8);
  cartGroup.add(breadZone);

  const meatZone = new THREE.Mesh(
    new THREE.RingGeometry(0.12, 0.15, 24),
    new THREE.MeshBasicMaterial({ color: 0xff5544, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })
  );
  meatZone.rotation.x = -Math.PI / 2;
  meatZone.position.set(0.35, 1.065, -0.55);
  cartGroup.add(meatZone);

  scene.add(cartGroup);
  scene.userData.grillCenter = new THREE.Vector3(0.75, 1.14, -0.8);
}

function makeCanopyTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const stripeW = size / 8;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#ff6b35' : '#ffffff';
    ctx.fillRect(i * stripeW, 0, stripeW, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  return tex;
}

/* ---------------- MALZEMELER ---------------- */
function buildIngredients() {
  for (let i = 0; i < 3; i++) {
    const bread = createBread();
    bread.position.set(-0.25 + (i - 1) * 0.13, 1.13, -0.62 - i * 0.02);
    scene.add(bread);
    grabbables.push(bread);
  }

  for (let i = 0; i < 3; i++) {
    const tomato = createTomatoSlice();
    tomato.position.set(-0.55 + i * 0.08, 1.11, -0.55);
    scene.add(tomato);
    grabbables.push(tomato);
  }

  for (let i = 0; i < 3; i++) {
    const onion = createOnion();
    onion.position.set(0.15 + i * 0.08, 1.11, -0.55);
    scene.add(onion);
    grabbables.push(onion);
  }

  const ketchupBottle = createSauceBottle(0xcc1111, 'ketchup');
  ketchupBottle.position.set(-1.05, 1.1, -0.55);
  scene.add(ketchupBottle);
  grabbables.push(ketchupBottle);

  const mayoBottle = createSauceBottle(0xf2ead1, 'mayo');
  mayoBottle.position.set(-1.05, 1.1, -0.7);
  scene.add(mayoBottle);
  grabbables.push(mayoBottle);

  const waterBottle = createWaterBottle();
  waterBottle.position.set(1.1, 1.1, -1.05);
  scene.add(waterBottle);
  grabbables.push(waterBottle);

  const cloth = createCloth();
  cloth.position.set(1.25, 1.06, -1.05);
  scene.add(cloth);
  grabbables.push(cloth);
}

function createSauceBottle(color, sauceType) {
  const group = new THREE.Group();
  const bodyGeo = new THREE.CylinderGeometry(0.022, 0.028, 0.11, 12);
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.05 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.055;
  body.castShadow = true;
  group.add(body);

  const capGeo = new THREE.ConeGeometry(0.014, 0.035, 10);
  const capMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.y = 0.128;
  group.add(cap);

  group.userData.type = sauceType;
  group.userData.sauceType = sauceType;
  group.userData.grabbable = true;
  group.userData.isSauceBottle = true;
  return group;
}

function createWaterBottle() {
  const group = new THREE.Group();
  const bodyGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.14, 12);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3d8bd6, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.07;
  body.castShadow = true;
  group.add(body);

  const nozzleGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.05, 8);
  const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6, roughness: 0.3 });
  const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
  nozzle.rotation.z = Math.PI / 2;
  nozzle.position.set(0.035, 0.15, 0);
  group.add(nozzle);

  group.userData.type = 'water';
  group.userData.grabbable = true;
  group.userData.isWaterBottle = true;
  return group;
}

function createCloth() {
  const geo = new THREE.BoxGeometry(0.13, 0.012, 0.13);
  const mat = new THREE.MeshStandardMaterial({ color: 0x5aa9e6, roughness: 0.95 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.userData.type = 'cloth';
  mesh.userData.grabbable = true;
  mesh.userData.isCloth = true;
  return mesh;
}

function createBread() {
  const group = new THREE.Group();
  const geo = new THREE.CapsuleGeometry(0.06, 0.16, 4, 8);
  const mat = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.9 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.z = Math.PI / 2;
  mesh.castShadow = true;
  group.add(mesh);
  group.userData.type = 'bread';
  group.userData.contents = ['bread'];
  group.userData.grabbable = true;
  group.userData.isPlate = true;
  return group;
}

function createTomatoSlice() {
  const geo = new THREE.CylinderGeometry(0.035, 0.035, 0.015, 16);
  const mat = new THREE.MeshStandardMaterial({ color: 0xe74c3c });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.userData.type = 'tomato';
  mesh.userData.grabbable = true;
  return mesh;
}

function createOnion() {
  const geo = new THREE.TorusGeometry(0.03, 0.008, 8, 16);
  const mat = new THREE.MeshStandardMaterial({ color: 0xf3e5f5 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI / 2;
  mesh.castShadow = true;
  mesh.userData.type = 'onion';
  mesh.userData.grabbable = true;
  return mesh;
}

function createKofte() {
  const geo = new THREE.CapsuleGeometry(0.028, 0.09, 6, 10);
  const posAttr = geo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const nx = posAttr.getX(i), ny = posAttr.getY(i), nz = posAttr.getZ(i);
    const n = (Math.random() - 0.5) * 0.004;
    posAttr.setXYZ(i, nx + n, ny + n, nz + n);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.85, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.z = Math.PI / 2;
  mesh.castShadow = true;
  mesh.userData.type = 'kofte';
  mesh.userData.grabbable = true;
  mesh.userData.cookLevel = 0;
  mesh.userData.cookTime = 0;
  mesh.userData.onGrill = false;

  const indGeo = new THREE.SphereGeometry(0.014, 8, 8);
  const indMat = new THREE.MeshStandardMaterial({ color: 0xffaa33, emissive: 0xffaa33, emissiveIntensity: 0.9 });
  const indicator = new THREE.Mesh(indGeo, indMat);
  indicator.visible = false;
  scene.add(indicator);
  mesh.userData.indicator = indicator;
  return mesh;
}

/* ---------------- ÇİĞ KÖFTE PAKETİ ---------------- */
function buildMeatPacket() {
  const packetPos = new THREE.Vector3(0.35, 1.11, -0.55);
  scene.userData.packetPos = packetPos;

  const trayGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.02, 20);
  const trayMat = new THREE.MeshStandardMaterial({ color: 0xcfd4d8, roughness: 0.3, metalness: 0.6 });
  const tray = new THREE.Mesh(trayGeo, trayMat);
  tray.position.copy(packetPos).setY(1.1);
  tray.receiveShadow = true;
  scene.add(tray);

  spawnPacketKofte();
}

function spawnPacketKofte() {
  const k = createKofte();
  k.position.copy(scene.userData.packetPos);
  k.userData.fromPacket = true;
  scene.add(k);
  grabbables.push(k);
  grillSlots.push(k);
  packetKofte = k;
}

/* ---------------- 3D MODEL YÜKLEME ---------------- */
function normalizeAndGround(object, targetSize, groundAtZero = true) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = targetSize / maxDim;
  object.scale.setScalar(scale);
  object.position.set(
    -center.x * scale,
    groundAtZero ? -box.min.y * scale : -center.y * scale,
    -center.z * scale
  );
  return scale;
}

function loadBarbeque() {
  gltfLoader.load(
    './assets/Barbeque.glb',
    (gltf) => {
      try {
        const model = gltf.scene;
        normalizeAndGround(model, 0.62, true);
        const gc = scene.userData.grillCenter;
        model.position.x += gc.x;
        model.position.y += 1.0;
        model.position.z += gc.z;
        model.traverse((c) => {
          if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
            // Kömür parıltısı için: turuncu/kırmızı emisyonu olan materyalleri bul
            if (c.material && c.material.color) {
              const hex = c.material.color.getHex();
              // Koyu kırmızı/turuncu (kömür hissi) - emissive ayarla
              if ((hex & 0xff0000) > 0x500000 && (hex & 0x00ff00) < 0x600000) {
                if (!c.material.emissive || c.material.emissive.getHex() === 0x000000) {
                  c.material.emissive = c.material.color.clone();
                  c.material.emissiveIntensity = 0.8;
                }
                coalMesh = c; // ilk uygun materyali kömür olarak kullan
              }
            }
          }
        });
        scene.add(model);
        scene.userData.barbequeModel = model;
      } catch (err) {
        console.error('Izgara modeli yerleştirilemedi', err);
      }
    },
    undefined,
    (err) => { console.error('Barbeque.glb yüklenemedi', err); showToast('⚠️ Izgara modeli yüklenemedi'); }
  );
}

function loadTongs() {
  gltfLoader.load(
    './assets/Tongs.glb',
    (gltf) => setupTongsRig(gltf.scene),
    undefined,
    (err) => { console.error('Tongs.glb yüklenemedi', err); showToast('⚠️ Maşa modeli yüklenemedi'); }
  );
}

// GÜVENLİ SÜRÜM: model artık parçalarına ayrılıp menteşelenmiyor (o yöntem
// pim/kol isimlerine göre riskli bir tahmindi ve bozuk/kırık görünüme yol
// açabiliyordu). Tek parça olarak yükleniyor; açma/kapama, tüm objenin
// hafif bir "sıkışma" + dönüş animasyonuyla stilize ediliyor. İşlevsel olarak
// aynı: kapalıyken köfteyi tutar, açınca bırakır.
function setupTongsRig(rawScene) {
  try {
    normalizeAndGround(rawScene, 0.32, true);
    rawScene.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });

    const rig = new THREE.Group();
    rig.add(rawScene);
    rig.userData.isTongs = true;
    rig.userData.grabbable = true;
    rig.userData.type = 'tongs';
    rig.userData.closed = false;
    rig.userData.closeAmount = 0;
    rig.userData.heldKofte = null;
    rig.userData.visualMesh = rawScene;

    rig.position.set(0.92, 1.09, -1.05);
    scene.add(rig);
    grabbables.push(rig);
    showToast('🥢 Maşa hazır! Tut, Boşluk (VR: grip) ile kapat');
  } catch (err) {
    console.error('Maşa kurulamadı', err);
  }
}

function updateTongs(delta) {
  grabbables.forEach((obj) => {
    if (!obj.userData.isTongs) return;
    const target = obj.userData.closed ? 1 : 0;
    obj.userData.closeAmount = THREE.MathUtils.lerp(obj.userData.closeAmount, target, Math.min(1, delta * 12));
    const t = obj.userData.closeAmount;
    const visual = obj.userData.visualMesh;
    if (visual) {
      visual.scale.set(1 - t * 0.12, 1 - t * 0.08, 1 + t * 0.08);
      visual.rotation.z = t * 0.12;
    }

    const isHeld = grabbed === obj ||
      (controller1 && controller1.userData.grabbed === obj) ||
      (controller2 && controller2.userData.grabbed === obj);

    if (isHeld && obj.userData.closed && !obj.userData.heldKofte && t > 0.8) {
      const pos = new THREE.Vector3();
      obj.getWorldPosition(pos);
      let nearest = null, nd = 0.18;
      grillSlots.forEach((k) => {
        if (!k.parent || !k.userData.grabbable) return;
        const kp = new THREE.Vector3();
        k.getWorldPosition(kp);
        const d = kp.distanceTo(pos);
        if (d < nd) { nearest = k; nd = d; }
      });
      if (nearest) {
        obj.attach(nearest);
        nearest.userData.grabbable = false;
        obj.userData.heldKofte = nearest;
        sfx.grab();
      }
    }

    if (!obj.userData.closed && obj.userData.heldKofte) {
      const k = obj.userData.heldKofte;
      scene.attach(k);
      k.userData.grabbable = true;
      obj.userData.heldKofte = null;
      handleDrop(k);
    }
  });
}

/* ---------------- ELDİVEN SİSTEMİ ---------------- */
function loadGloves() {
  gltfLoader.load(
    './assets/Glove.glb',
    (gltf) => {
      try {
        gloveModel = gltf.scene;
        makeGloveFor('left', controller1, new THREE.Vector3(0, 0.04, 0.07));
        makeGloveFor('right', controller2, new THREE.Vector3(0, 0.04, 0.07));
        gloves.forEach(g => {
          if (g.handedness === 'left') {
            g.instance.position.set(-0.25, 1.5, 0.4);
            g.instance.rotation.set(0, 0, 0.3);
          } else {
            g.instance.position.set(0.25, 1.5, 0.4);
            g.instance.rotation.set(0, 0, -0.3);
          }
          g.instance.visible = false; // VR başlayınca görünür
        });
        showToast('🧤 Eldivenler hazır! VR modunda ellerinde göreceksin');
      } catch (err) {
        console.error('Eldivenler kurulamadı', err);
      }
    },
    undefined,
    (err) => { console.error('Glove.glb yüklenemedi', err); showToast('⚠️ Eldiven modeli yüklenemedi'); }
  );
}

function makeGloveFor(handedness, controller, attachOffset) {
  if (!gloveModel) return;
  try {
    const instance = gloveModel.clone(true);
    instance.traverse((c) => {
      if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
    });

    const pivotNodes = {};
    instance.traverse((c) => {
      if (c.isObject3D && c.name) {
        if (['Index', 'Middle', 'Ring', 'Pinky', 'Thumb'].includes(c.name)) {
          pivotNodes[c.name] = c;
          c.userData.baseRotX = c.rotation.x;
          c.userData.baseRotY = c.rotation.y;
          c.userData.baseRotZ = c.rotation.z;
        }
      }
    });

    if (handedness === 'right') {
      instance.scale.x = -1;
    }
    instance.scale.multiplyScalar(0.85);
    playerRig.add(instance);

    gloves.push({
      instance,
      pivotNodes,
      controller,
      handedness,
      attachOffset,
      closeAmount: 0,
      targetClose: 0,
      attachedTo: null,
    });
  } catch (err) {
    console.error('Eldiven oluşturulamadı (' + handedness + ')', err);
  }
}

function updateGloves(delta) {
  if (gloves.length === 0) return;
  const inVR = renderer.xr.isPresenting;

  gloves.forEach((g) => {
    try {
      if (inVR && g.controller) {
        // VR'de kontrolcüye bağla (sadece bir kez yeniden ebeveynle, her frame değil)
        if (!g.attachedTo || g.attachedTo !== g.controller) {
          g.controller.add(g.instance);
          g.instance.position.copy(g.attachOffset);
          g.instance.rotation.set(-Math.PI / 2, 0, g.handedness === 'left' ? 0.15 : -0.15);
          g.attachedTo = g.controller;
        }
        g.instance.visible = true;
      } else {
        g.instance.visible = false;
      }

      // Hedef: sıkılıyorsa (grip basılı / bir şey tutuyorsa) kapan
      let target = 0;
      if (g.controller) {
        const held = g.controller.userData.grabbed;
        const gripPressed = g.controller.userData.gripPressed;
        if (held || gripPressed) target = 1;
      }
      g.targetClose = target;
      g.closeAmount = THREE.MathUtils.lerp(g.closeAmount, g.targetClose, Math.min(1, delta * 8));

      // Parmakları kapat
      const c = g.closeAmount;
      const closeAngle = 0.9; // parmakların ne kadar kıvrılacağı (radyan)
      Object.entries(g.pivotNodes).forEach(([name, node]) => {
        const base = node.userData.baseRotX || 0;
        node.rotation.x = base - closeAngle * c;
      });
    } catch (err) {
      console.error('Eldiven güncellenemedi', err);
    }
  });
}

/* ---------------- ZİL ---------------- */
let bellObject = null;
let bellAnimT = 0;

function buildBell() {
  const group = new THREE.Group();
  const baseGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.02, 16);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.5, roughness: 0.5 });
  const base = new THREE.Mesh(baseGeo, baseMat);
  group.add(base);

  const domeGeo = new THREE.SphereGeometry(0.045, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const domeMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.85, roughness: 0.25 });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.position.y = 0.01;
  group.add(dome);

  const knobGeo = new THREE.SphereGeometry(0.012, 10, 10);
  const knob = new THREE.Mesh(knobGeo, domeMat);
  knob.position.y = 0.06;
  group.add(knob);

  group.position.set(-1.15, 1.065, -1.0);
  scene.add(group);
  bellObject = group;
}

function ringBell() {
  ensureAudio();
  playTone(1400, 0.05, 'sine', 0.18);
  setTimeout(() => playTone(1600, 0.08, 'sine', 0.12), 60);
  bellAnimT = 0.001;
  showToast('🔔 Zil çaldı! Yeni sipariş geliyor...');
  nextOrder();
}

function updateBellAnim(delta) {
  if (!bellObject || bellAnimT <= 0) return;
  bellAnimT += delta;
  const wobble = Math.sin(bellAnimT * 40) * Math.max(0, 0.15 - bellAnimT) * 2;
  bellObject.rotation.z = wobble;
  if (bellAnimT > 0.3) { bellAnimT = 0; bellObject.rotation.z = 0; }
}

/* ---------------- SİPARİŞ SİSTEMİ ---------------- */
const ORDER_TIME_LIMIT = 55;
let orderTimeLeft = ORDER_TIME_LIMIT;

function nextOrder() {
  currentOrder = orderTypes[Math.floor(Math.random() * orderTypes.length)];
  orderTimeLeft = ORDER_TIME_LIMIT;
  document.getElementById('orderText').innerHTML =
    `<b>${currentOrder.name}</b><br>Malzemeler: ${translateNeeds(currentOrder.needs)}<br>💵 ${currentOrder.price} TL`;
  const bar = document.getElementById('orderTimerBar');
  if (bar) { bar.style.width = '100%'; bar.style.background = '#66ff88'; }
}

function updateOrderTimer(delta) {
  if (!currentOrder) return;
  orderTimeLeft -= delta;
  const bar = document.getElementById('orderTimerBar');
  if (bar) {
    const pct = Math.max(0, orderTimeLeft / ORDER_TIME_LIMIT) * 100;
    bar.style.width = pct + '%';
    bar.style.background = pct > 45 ? '#66ff88' : pct > 20 ? '#ffcc33' : '#ff4444';
  }
  if (orderTimeLeft <= 0) {
    showToast('⏰ Müşteri sabrı taştı, siparişten vazgeçti!');
    sfx.fail();
    nextOrder();
  }
  updateBellAnim(delta);
}

function translateNeeds(needs) {
  const map = { bread: 'Ekmek', kofte: 'Köfte', tomato: 'Domates', onion: 'Soğan' };
  return needs.map(n => map[n]).join(', ');
}

function checkServe(plateGroup) {
  const contents = plateGroup.userData.contents || [];
  const needs = currentOrder.needs;
  const sauceTypes = ['ketchup', 'mayo'];
  const hasAll = needs.every(n => contents.includes(n));
  const noExtra = contents.every(c => needs.includes(c) || sauceTypes.includes(c));
  const hasBurnt = plateGroup.userData.burnt;
  const hasRaw = plateGroup.userData.raw;

  if (hasAll && noExtra && !hasBurnt && !hasRaw) {
    const tip = orderTimeLeft > ORDER_TIME_LIMIT * 0.6 ? Math.round(currentOrder.price * 0.2) : 0;
    money += currentOrder.price + tip;
    document.getElementById('score').textContent = `💰 ${money} TL`;
    showToast(tip > 0 ? `✅ Servis edildi! +${currentOrder.price} TL (+${tip} TL bahşiş 🌟)` : `✅ Servis edildi! +${currentOrder.price} TL`);
    sfx.success();
  } else if (hasBurnt) {
    showToast('❌ Köfte yanmış! Müşteri kabul etmedi.');
    sfx.fail();
  } else if (hasRaw) {
    showToast('❌ Köfte çiğ! Izgarada biraz daha pişir.');
    sfx.fail();
  } else {
    showToast('❌ Sipariş eksik veya yanlış malzemeli.');
    sfx.fail();
  }

  scene.remove(plateGroup);
  const idx = grabbables.indexOf(plateGroup);
  if (idx >= 0) grabbables.splice(idx, 1);

  const newBread = createBread();
  newBread.position.set(-0.25, 1.13, -0.62);
  scene.add(newBread);
  grabbables.push(newBread);

  nextOrder();
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2200);
}

/* ---------------- ETKİLEŞİM: MOUSE ---------------- */
let pointerDown = false;
let dragPlaneY = 1.15;

function onPointerDown(e) {
  ensureAudio();
  pointerDown = true;
  updateMouse(e);
  raycaster.setFromCamera(mouse, camera);

  if (bellObject) {
    const bellHit = raycaster.intersectObject(bellObject, true);
    if (bellHit.length > 0) { ringBell(); return; }
  }

  const hits = raycaster.intersectObjects(grabbables, true);
  if (hits.length > 0) {
    let obj = hits[0].object;
    while (obj.parent && !obj.userData.grabbable && obj.parent !== scene) obj = obj.parent;
    if (obj.userData.grabbable) {
      grabbed = obj;
      dragPlaneY = obj.position.y;
      dragTarget.copy(obj.position);
      setHover(null);
      sfx.grab();
      if (obj === packetKofte) spawnPacketKofte();
    }
  }
}

function onPointerMove(e) {
  updateMouse(e);
  if (!pointerDown || !grabbed) {
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(grabbables, true);
    if (hits.length > 0) {
      let obj = hits[0].object;
      while (obj.parent && !obj.userData.grabbable && obj.parent !== scene) obj = obj.parent;
      setHover(obj.userData.grabbable ? obj : null);
    } else {
      setHover(null);
    }
    return;
  }
  raycaster.setFromCamera(mouse, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -dragPlaneY);
  const point = new THREE.Vector3();
  raycaster.ray.intersectPlane(plane, point);
  if (point) {
    dragTarget.set(point.x, dragPlaneY + dragOffsetY, point.z);
  }
}

function onPointerUp() {
  pointerDown = false;
  if (grabbed) {
    if (grabbed.userData.isTongs) grabbed.userData.closed = false;
    sfx.drop();
    handleDrop(grabbed);
  }
  grabbed = null;
}

function updateMouse(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

/* ---------------- VR KONTROLCÜLERİ ---------------- */
function setupControllers() {
  const controllerModelFactory = new XRControllerModelFactory();

  function makeController(index) {
    const controller = renderer.xr.getController(index);
    controller.userData.grabbed = null;
    controller.userData.hoverObj = null;
    controller.userData.gripPressed = false;
    controller.userData.inputSource = null;

    controller.addEventListener('connected', (e) => {
      controller.userData.inputSource = e.data;
      // Eldiveni bu kontrolcüye ata (handedness'a göre)
      const handedness = e.data.handedness;
      const glove = gloves.find(g => g.handedness === handedness);
      if (glove) glove.controller = controller;
    });
    controller.addEventListener('disconnected', () => { controller.userData.inputSource = null; });
    controller.addEventListener('selectstart', () => onVRSelectStart(controller));
    controller.addEventListener('selectend', () => onVRSelectEnd(controller));
    controller.addEventListener('squeezestart', () => {
      controller.userData.gripPressed = true;
      const held = controller.userData.grabbed;
      if (!held) return;
      if (held.userData.isTongs) {
        held.userData.closed = true;
        hapticPulse(controller, 0.4, 25);
      } else {
        trySqueeze(held, controller);
      }
    });
    controller.addEventListener('squeezeend', () => {
      controller.userData.gripPressed = false;
      const held = controller.userData.grabbed;
      if (held && held.userData.isTongs) held.userData.closed = false;
    });
    playerRig.add(controller);

    const grip = renderer.xr.getControllerGrip(index);
    grip.add(controllerModelFactory.createControllerModel(grip));
    playerRig.add(grip);

    // Işın göstergesi
    const rayGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)
    ]);
    const rayMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    const ray = new THREE.Line(rayGeo, rayMat);
    ray.scale.z = 0.3;
    controller.add(ray);
    controller.userData.ray = ray;

    return controller;
  }

  controller1 = makeController(0);
  controller2 = makeController(1);
}

function onVRSelectStart(controller) {
  const controllerPos = new THREE.Vector3();
  controller.getWorldPosition(controllerPos);

  if (bellObject) {
    const bellPos = bellObject.getWorldPosition(new THREE.Vector3());
    if (bellPos.distanceTo(controllerPos) < 0.22) { ringBell(); return; }
  }

  let closest = null;
  let closestDist = 0.25;
  grabbables.forEach(obj => {
    const objPos = new THREE.Vector3();
    obj.getWorldPosition(objPos);
    const d = objPos.distanceTo(controllerPos);
    if (d < closestDist) {
      closest = obj;
      closestDist = d;
    }
  });

  if (closest) {
    controller.userData.grabbed = closest;
    controller.attach(closest);
    setHover(null);
    ensureAudio();
    sfx.grab();
    hapticPulse(controller, 0.4, 30);
    if (closest === packetKofte) spawnPacketKofte();
  }
}

function onVRSelectEnd(controller) {
  const obj = controller.userData.grabbed;
  if (obj) {
    scene.attach(obj);
    if (obj.userData.isTongs) obj.userData.closed = false;
    sfx.drop();
    hapticPulse(controller, 0.3, 20);
    handleDrop(obj);
  }
  controller.userData.grabbed = null;
}

/* ---------------- BIRAKMA MANTIĞI ---------------- */
function handleDrop(obj) {
  const worldPos = new THREE.Vector3();
  obj.getWorldPosition(worldPos);

  // Collision guard: eğer obje yere doğru çok düştüyse veya tezgahın dışına çıktıysa
  // düzeltme (köfteler yere düşmesin)
  if (obj.userData.type === 'kofte' && worldPos.y < 1.0) {
    // Izgara üzerine veya tezgaha geri koy
    if (obj.userData.onGrill) {
      // zaten ızgarada, bırak
    } else {
      // Tezgah üstüne (y=1.06 civarı) geri yerleştir
      const target = new THREE.Vector3(worldPos.x, 1.13, Math.max(worldPos.z, -1.0));
      obj.position.copy(target);
      return;
    }
  }

  // 1) Servis bölgesi
  if (obj.userData.isPlate) {
    const serveZone = new THREE.Vector3(-0.85, 1.06, -0.8);
    if (worldPos.distanceTo(serveZone) < 0.18) {
      checkServe(obj);
      return;
    }
  }

  // 2) Köfte ızgaraya konulduysa pişmeye başla
  if (obj.userData.type === 'kofte') {
    const grillCenter = scene.userData.grillCenter;
    const flatDist = Math.hypot(worldPos.x - grillCenter.x, worldPos.z - grillCenter.z);
    const wasOnGrill = obj.userData.onGrill;
    obj.userData.onGrill = flatDist < 0.35 && worldPos.y < 1.3;
    if (obj.userData.onGrill && !wasOnGrill) sfx.sizzle();
  }

  // 3) Malzeme bir ekmeğin üstüne bırakıldı mı?
  const consumableTypes = ['tomato', 'onion', 'kofte'];
  if (consumableTypes.includes(obj.userData.type)) {
    grabbables.forEach(plate => {
      if (!plate.userData.isPlate || plate === obj) return;
      const platePos = new THREE.Vector3();
      plate.getWorldPosition(platePos);
      if (worldPos.distanceTo(platePos) < 0.1) {
        if (obj.userData.type === 'kofte') {
          if (obj.userData.cookLevel === 2) plate.userData.burnt = true;
          if (obj.userData.cookLevel === 0) plate.userData.raw = true;
        }
        if (!plate.userData.contents.includes(obj.userData.type)) {
          plate.userData.contents.push(obj.userData.type);
        }
        if (obj.userData.indicator) scene.remove(obj.userData.indicator);
        scene.remove(obj);
        const idx = grabbables.indexOf(obj);
        if (idx >= 0) grabbables.splice(idx, 1);
        const slotIdx = grillSlots.indexOf(obj);
        if (slotIdx >= 0) grillSlots.splice(slotIdx, 1);
      }
    });
  }
}

/* ---------------- SOS SIKMA + TEMİZLİK ---------------- */
const SQUEEZE_COOLDOWN = 0.35;
function trySqueeze(obj, controller = null) {
  const now = clock.elapsedTime;
  if (obj.userData.lastSqueeze !== undefined && now - obj.userData.lastSqueeze < SQUEEZE_COOLDOWN) return;
  obj.userData.lastSqueeze = now;
  triggerSquish(obj);
  if (controller) hapticPulse(controller, 0.6, 25);

  if (obj.userData.isSauceBottle) {
    sfx.squeezeSauce();
    squirtSauce(obj);
  } else if (obj.userData.isWaterBottle) {
    sfx.squeezeWater();
    squirtWater(obj);
  }
}

function squirtSauce(bottle) {
  const pos = new THREE.Vector3();
  bottle.getWorldPosition(pos);
  const sauceType = bottle.userData.sauceType;
  const color = sauceType === 'ketchup' ? 0xd81e1e : 0xfff6e0;

  let hitPlate = null;
  grabbables.forEach(plate => {
    if (!plate.userData.isPlate) return;
    const platePos = new THREE.Vector3();
    plate.getWorldPosition(platePos);
    if (pos.distanceTo(platePos) < 0.12) hitPlate = plate;
  });

  if (hitPlate) {
    if (!hitPlate.userData.contents.includes(sauceType)) {
      hitPlate.userData.contents.push(sauceType);
    }
    const dropGeo = new THREE.SphereGeometry(0.018, 8, 8);
    const dropMat = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.1 });
    const drop = new THREE.Mesh(dropGeo, dropMat);
    drop.position.set((Math.random() - 0.5) * 0.06, 0.05, (Math.random() - 0.5) * 0.03);
    hitPlate.add(drop);
    showToast(sauceType === 'ketchup' ? '🍅 Ketçap eklendi' : '🥚 Mayonez eklendi');
  }

  addStain(pos.x + (Math.random() - 0.5) * 0.06, pos.z + (Math.random() - 0.5) * 0.06, color);
}

function addStain(x, z, color) {
  const geo = new THREE.CircleGeometry(0.02 + Math.random() * 0.015, 10);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, transparent: true, opacity: 0.85 });
  const stain = new THREE.Mesh(geo, mat);
  stain.rotation.x = -Math.PI / 2;
  stain.position.set(x, 1.061, z);
  scene.add(stain);
  const entry = { mesh: stain, wet: false };
  stains.push(entry);

  if (stains.length > MAX_STAINS) {
    const old = stains.shift();
    scene.remove(old.mesh);
  }
}

function squirtWater(bottle) {
  const pos = new THREE.Vector3();
  bottle.getWorldPosition(pos);
  let wetted = 0;
  stains.forEach(s => {
    const sPos = s.mesh.position;
    if (Math.hypot(sPos.x - pos.x, sPos.z - pos.z) < 0.15 && !s.wet) {
      s.wet = true;
      s.mesh.material.opacity = 0.5;
      s.mesh.material.roughness = 0.15;
      wetted++;
    }
  });
  if (wetted > 0) showToast('💧 Islatıldı, şimdi bezle sil!');
}

function updateCleaning() {
  const held = [grabbed, controller1 && controller1.userData.grabbed, controller2 && controller2.userData.grabbed]
    .filter(o => o && o.userData.isCloth);
  if (held.length === 0) return;

  held.forEach(cloth => {
    const pos = new THREE.Vector3();
    cloth.getWorldPosition(pos);
    for (let i = stains.length - 1; i >= 0; i--) {
      const s = stains[i];
      const sPos = s.mesh.position;
      if (s.wet && Math.hypot(sPos.x - pos.x, sPos.z - pos.z) < 0.09) {
        scene.remove(s.mesh);
        stains.splice(i, 1);
        sfx.wipe();
      }
    }
  });
}

/* ---------------- SES SİSTEMİ ---------------- */
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* yoksay */ }
  } else if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playTone(freq, duration, type = 'sine', gain = 0.15, glideTo = null) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, audioCtx.currentTime + duration);
  g.gain.setValueAtTime(gain, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.connect(g).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function playNoiseBurst(duration, gain = 0.15, filterFreq = 2000) {
  if (!audioCtx) return;
  const bufferSize = Math.floor(audioCtx.sampleRate * duration);
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = filterFreq;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(gain, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  src.connect(filter).connect(g).connect(audioCtx.destination);
  src.start();
}

function playTink() {
  if (!audioCtx) return;
  // Gerçek bir fırın/mikrodalga zili gibi: temel ton + hafif metalik üst harmonik
  const now = audioCtx.currentTime;
  [1568, 3136].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    const vol = i === 0 ? 0.16 : 0.05;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(vol, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  });
}

const sfx = {
  grab: () => playTone(520, 0.05, 'triangle', 0.12),
  drop: () => playTone(260, 0.06, 'triangle', 0.1),
  squeezeSauce: () => playNoiseBurst(0.12, 0.18, 900),
  squeezeWater: () => playNoiseBurst(0.1, 0.12, 3500),
  wipe: () => playNoiseBurst(0.15, 0.08, 1200),
  sizzle: () => playNoiseBurst(0.2, 0.06, 4500),
  ready: () => { playTink(); },
  burnt: () => playTone(140, 0.35, 'sawtooth', 0.15, 90),
  success: () => {
    playTone(523, 0.09, 'sine', 0.16);
    setTimeout(() => playTone(659, 0.09, 'sine', 0.16), 90);
    setTimeout(() => playTone(784, 0.14, 'sine', 0.16), 180);
  },
  fail: () => playTone(180, 0.25, 'sawtooth', 0.13, 90),
};

/* ---------------- HOVER / TUTMA VURGUSU ---------------- */
function traverseMeshes(obj, fn) {
  obj.traverse((child) => { if (child.isMesh) fn(child); });
}

function highlightObject(obj, on) {
  if (!obj) return;
  traverseMeshes(obj, (mesh) => {
    if (!mesh.userData._origEmissive) {
      mesh.userData._origEmissive = mesh.material.emissive ? mesh.material.emissive.getHex() : 0x000000;
      mesh.userData._origEmissiveIntensity = mesh.material.emissiveIntensity ?? 1;
    }
    if (mesh.material.emissive) {
      mesh.material.emissive.setHex(on ? 0x224488 : mesh.userData._origEmissive);
      mesh.material.emissiveIntensity = on ? 0.6 : mesh.userData._origEmissiveIntensity;
    }
  });
}

function setHover(obj) {
  if (hoverTarget === obj) return;
  if (hoverTarget) highlightObject(hoverTarget, false);
  hoverTarget = obj;
  if (hoverTarget) highlightObject(hoverTarget, true);
  const crosshair = document.getElementById('crosshair');
  if (crosshair) crosshair.classList.toggle('active', !!hoverTarget);
}

/* ---------------- VR HAPTİK ---------------- */
function hapticPulse(controller, intensity = 0.5, duration = 40) {
  const source = controller.userData.inputSource;
  const actuator = source && source.gamepad && source.gamepad.hapticActuators && source.gamepad.hapticActuators[0];
  if (actuator && actuator.pulse) actuator.pulse(intensity, duration);
}

/* ---------------- SIKMA SQUISH ANİMASYONU ---------------- */
function triggerSquish(bottle) {
  bottle.userData.squishT = 0;
}

function updateSquishAnimations(delta) {
  grabbables.forEach((obj) => {
    if (obj.userData.squishT === undefined) return;
    if (obj.userData.squishT > 0.3) return;
    obj.userData.squishT += delta;
    const t = obj.userData.squishT;
    const squish = t < 0.15 ? 1 - (t / 0.15) * 0.25 : 0.75 + ((t - 0.15) / 0.15) * 0.25;
    obj.scale.set(1 + (1 - squish) * 0.3, Math.min(squish, 1), 1 + (1 - squish) * 0.3);
  });
}

/* ---------------- IZGARA PİŞİRME DÖNGÜSÜ ---------------- */
function updateGrill(delta) {
  grillSlots.forEach(k => {
    const ind = k.userData.indicator;
    if (!k.parent) {
      if (ind) ind.visible = false;
      return;
    }
    if (k.userData.onGrill) {
      k.userData.cookTime += delta;
      if (k.userData.cookTime > 9 && k.userData.cookLevel < 2) {
        k.userData.cookLevel = 2;
        k.material.color.set(0x1a1a1a);
        sfx.burnt();
      } else if (k.userData.cookTime > 4 && k.userData.cookLevel < 1) {
        k.userData.cookLevel = 1;
        k.material.color.set(0x4a2a12);
        sfx.ready();
      }
      if (ind) {
        ind.visible = true;
        ind.position.set(k.position.x, k.position.y + 0.05, k.position.z);
        if (k.userData.cookLevel === 2) {
          ind.material.color.set(0xff2222);
          ind.material.emissive.set(0xff2222);
          ind.material.emissiveIntensity = 0.9;
        } else if (k.userData.cookLevel === 1) {
          const pulse = 0.6 + Math.sin(k.userData.cookTime * 6) * 0.3;
          ind.material.color.set(0x33ff55);
          ind.material.emissive.set(0x33ff55);
          ind.material.emissiveIntensity = pulse;
        } else {
          ind.material.color.set(0xffaa33);
          ind.material.emissive.set(0xffaa33);
          ind.material.emissiveIntensity = 0.7;
        }
      }
    } else if (ind) {
      ind.visible = false;
    }
  });
}

/* ---------------- HAREKET ---------------- */
function getThumbstickAxes(controller) {
  const source = controller && controller.userData.inputSource;
  const gp = source && source.gamepad;
  if (!gp || !gp.axes) return null;
  const x = gp.axes.length > 3 ? gp.axes[2] : gp.axes[0];
  const y = gp.axes.length > 3 ? gp.axes[3] : gp.axes[1];
  return { x: x || 0, y: y || 0, handedness: source.handedness };
}

function clampToBounds(pos) {
  const x = THREE.MathUtils.clamp(pos.x, ROOM_BOUNDS.minX, ROOM_BOUNDS.maxX);
  const z = THREE.MathUtils.clamp(pos.z, ROOM_BOUNDS.minZ, ROOM_BOUNDS.maxZ);
  return new THREE.Vector3(x, pos.y, z);
}

function blockedByCart(pos) {
  return pos.x > CART_KEEPOUT.minX && pos.x < CART_KEEPOUT.maxX &&
         pos.z > CART_KEEPOUT.minZ && pos.z < CART_KEEPOUT.maxZ;
}

function tryMoveRig(deltaVec) {
  const target = playerRig.position.clone().add(deltaVec);
  const bounded = clampToBounds(target);
  if (blockedByCart(bounded)) return;
  playerRig.position.copy(bounded);
}

function updateVRLocomotion(delta) {
  if (!renderer.xr.isPresenting) return;
  [controller1, controller2].forEach((controller) => {
    const axes = getThumbstickAxes(controller);
    if (!axes) return;
    const deadzone = 0.15;

    if (axes.handedness === 'left') {
      if (Math.abs(axes.x) > deadzone || Math.abs(axes.y) > deadzone) {
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0; forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
        const move = new THREE.Vector3();
        move.addScaledVector(forward, -axes.y * MOVE_SPEED * delta);
        move.addScaledVector(right, axes.x * MOVE_SPEED * delta);
        tryMoveRig(move);
      }
    } else if (axes.handedness === 'right') {
      controller.userData.turnCooldown = (controller.userData.turnCooldown || 0) - delta;
      if (Math.abs(axes.x) > 0.6 && controller.userData.turnCooldown <= 0) {
        const headPos = new THREE.Vector3();
        camera.getWorldPosition(headPos);
        const angle = THREE.MathUtils.degToRad(axes.x > 0 ? -SNAP_TURN_DEG : SNAP_TURN_DEG);
        const rel = new THREE.Vector3().subVectors(playerRig.position, headPos);
        rel.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        playerRig.position.copy(headPos).add(rel);
        playerRig.rotation.y += angle;
        controller.userData.turnCooldown = 0.35;
      }
    }
  });
}

function updateDesktopMovement(delta) {
  if (renderer.xr.isPresenting) return;
  let x = 0, z = 0;
  if (keysDown['KeyW'] || keysDown['ArrowUp']) z -= 1;
  if (keysDown['KeyS'] || keysDown['ArrowDown']) z += 1;
  if (keysDown['KeyA'] || keysDown['ArrowLeft']) x -= 1;
  if (keysDown['KeyD'] || keysDown['ArrowRight']) x += 1;
  if (x === 0 && z === 0) return;
  const move = new THREE.Vector3(x, 0, z);
  if (move.lengthSq() > 0) move.normalize().multiplyScalar(MOVE_SPEED * delta);
  tryMoveRig(move);
}

/* ---------------- VR MENZİL VURGUSU ---------------- */
function updateVRHover() {
  [controller1, controller2].forEach((controller) => {
    if (!controller) return;
    if (controller.userData.grabbed) {
      if (controller.userData.hoverObj) {
        highlightObject(controller.userData.hoverObj, false);
        controller.userData.hoverObj = null;
      }
      if (controller.userData.ray) controller.userData.ray.material.color.set(0xffffff);
      return;
    }
    const controllerPos = new THREE.Vector3();
    controller.getWorldPosition(controllerPos);
    let closest = null, closestDist = 0.25;
    grabbables.forEach((obj) => {
      const p = new THREE.Vector3();
      obj.getWorldPosition(p);
      const d = p.distanceTo(controllerPos);
      if (d < closestDist) { closest = obj; closestDist = d; }
    });
    if (controller.userData.hoverObj !== closest) {
      if (controller.userData.hoverObj) highlightObject(controller.userData.hoverObj, false);
      if (closest) highlightObject(closest, true);
      controller.userData.hoverObj = closest;
    }
    if (controller.userData.ray) controller.userData.ray.material.color.set(closest ? 0x66ff88 : 0xffffff);
  });
}

/* ---------------- KÖMÜR PARLAMASI + IŞIK DİZİSİ + DUMAN ---------------- */
let coalPulseT = 0;
function updateCoalGlow(delta) {
  coalPulseT += delta;
  // coalMesh: Barbeque.glb yüklendiyse materyalinden parlat
  if (coalMesh && coalMesh.material) {
    coalMesh.material.emissiveIntensity = 0.75 + Math.sin(coalPulseT * 3.2) * 0.15 + Math.random() * 0.05;
  }
  const light = scene.userData.grillLight;
  if (light) light.intensity = 1.9 + Math.sin(coalPulseT * 3.2) * 0.35;

  // Tentedeki ışık dizisi: yavaş, rastgele göz kırpma hissi (sıcak pazar tezgahı ambiyansı)
  const bulbs = scene.userData.stringLightBulbs;
  if (bulbs) {
    bulbs.forEach((b, i) => {
      b.material.emissiveIntensity = 0.85 + Math.sin(coalPulseT * 1.4 + i * 0.9) * 0.35;
    });
  }
}

let smokeSpawnTimer = 0;
function updateSmoke(delta) {
  smokeSpawnTimer += delta;
  if (smokeSpawnTimer > 0.4 && smokeParticles.length < 12) {
    smokeSpawnTimer = 0;
    const geo = new THREE.SphereGeometry(0.02 + Math.random() * 0.015, 6, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.35 });
    const puff = new THREE.Mesh(geo, mat);
    puff.position.set(0.75 + (Math.random() - 0.5) * 0.3, 1.2, -0.8 + (Math.random() - 0.5) * 0.3);
    puff.userData.life = 0;
    scene.add(puff);
    smokeParticles.push(puff);
  }
  for (let i = smokeParticles.length - 1; i >= 0; i--) {
    const p = smokeParticles[i];
    p.userData.life += delta;
    p.position.y += delta * 0.25;
    p.scale.multiplyScalar(1 + delta * 0.6);
    p.material.opacity = Math.max(0, 0.35 - p.userData.life * 0.15);
    if (p.userData.life > 2.2) {
      scene.remove(p);
      smokeParticles.splice(i, 1);
    }
  }
}

/* ---------------- RESIZE / LOOP ---------------- */
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render() {
  const delta = clock.getDelta();
  try {
    if (grabbed && pointerDown) {
      grabbed.position.lerp(dragTarget, Math.min(1, delta * 14));
    }
    updateGrill(delta);
    updateCoalGlow(delta);
    updateSmoke(delta);
    updateCleaning();
    updateSquishAnimations(delta);
    updateTongs(delta);
    updateGloves(delta);
    updateDesktopMovement(delta);
    updateOrderTimer(delta);
    if (renderer.xr.isPresenting) {
      updateVRHover();
      updateVRLocomotion(delta);
    }
  } catch (err) {
    // Bir güncelleme adımında hata olsa bile render döngüsü asla durmasın -
    // hatayı konsola yaz, bu kareyi atla, devam et.
    console.error('Frame güncelleme hatası (yoksayıldı, oyun devam ediyor):', err);
  }
  renderer.render(scene, camera);
}

init();
animate();
