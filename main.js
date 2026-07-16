import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

/* ============================================================
   SOKAK LEZZETLERİ ARABASI
   Basit köfte-ekmek standı simülasyonu (WebXR + Mouse destekli)
   ============================================================ */

let scene, camera, renderer, clock;
let raycaster, mouse;
let grabbed = null; // { object, controller/pointer, offset }
let controller1, controller2;
let money = 0;
let toastTimer = null;

const grabbables = []; // tüm tutulabilir nesneler
const grillSlots = [];  // ızgara üzerindeki köfte pozisyonları
const orderTypes = [
  { name: 'Köfte-Ekmek', needs: ['bread', 'kofte', 'tomato'], price: 45 },
  { name: 'Sade Köfte-Ekmek', needs: ['bread', 'kofte'], price: 35 },
  { name: 'Köfte-Ekmek (Soğanlı)', needs: ['bread', 'kofte', 'onion'], price: 40 },
  { name: 'Full Köfte-Ekmek', needs: ['bread', 'kofte', 'tomato', 'onion'], price: 55 },
];

let currentOrder = null;
let servingTray = []; // müşteriye teslim edilecek tabak içeriği (mantıksal, plate objesine eklenen ingredient tag'leri)

init();
animate();

function init() {
  clock = new THREE.Clock();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 8, 30);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 100);
  camera.position.set(0, 1.6, 2.2);

  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas'), antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.xr.enabled = true;

  document.getElementById('vrBtn').addEventListener('click', () => {
    document.body.appendChild(VRButton.createButton(renderer));
    document.getElementById('vrBtn').style.display = 'none';
  });

  // Işıklar
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, 6, 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  scene.add(sun);

  buildEnvironment();
  buildCart();
  buildIngredients();

  // Mouse / touch etkileşimi (masaüstü test için)
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  // VR kontrolcüleri
  setupControllers();

  window.addEventListener('resize', onResize);

  nextOrder();
  spawnGrillMeatballs();

  showToast('Standa hoş geldin! İlk siparişi hazırla 🔥');
}

/* ---------------- ORTAM ---------------- */
function buildEnvironment() {
  const groundGeo = new THREE.PlaneGeometry(40, 40);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x8d8d7a });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // basit sokak dokusu hissi için ızgara çizgileri
  const grid = new THREE.GridHelper(40, 40, 0x555555, 0x666666);
  grid.position.y = 0.001;
  scene.add(grid);
}

/* ---------------- ARABA / TEZGAH ---------------- */
function buildCart() {
  const cartGroup = new THREE.Group();

  // Tezgah gövdesi
  const bodyGeo = new THREE.BoxGeometry(2.4, 1.0, 0.8);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb33939 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.set(0, 0.5, -0.8);
  body.castShadow = true;
  body.receiveShadow = true;
  cartGroup.add(body);

  // Tezgah üstü (çalışma yüzeyi)
  const topGeo = new THREE.BoxGeometry(2.5, 0.06, 0.9);
  const topMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });
  const top = new THREE.Mesh(topGeo, topMat);
  top.position.set(0, 1.03, -0.8);
  top.receiveShadow = true;
  cartGroup.add(top);

  // Tente
  const canopyGeo = new THREE.BoxGeometry(2.6, 0.08, 1.0);
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0xffd166 });
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.set(0, 2.1, -0.8);
  cartGroup.add(canopy);

  const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.1, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
  [[-1.15, -0.35], [1.15, -0.35], [-1.15, -1.25], [1.15, -1.25]].forEach(([x, z]) => {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, 1.55, z);
    cartGroup.add(pole);
  });

  // Izgara (grill) - tezgahın sağ tarafında
  const grillBaseGeo = new THREE.BoxGeometry(0.6, 0.1, 0.5);
  const grillBaseMat = new THREE.MeshStandardMaterial({ color: 0x2f2f2f });
  const grillBase = new THREE.Mesh(grillBaseGeo, grillBaseMat);
  grillBase.position.set(0.75, 1.09, -0.8);
  cartGroup.add(grillBase);

  // Kızgın kömür efekti (emissive)
  const coalGeo = new THREE.PlaneGeometry(0.55, 0.45);
  const coalMat = new THREE.MeshStandardMaterial({ color: 0xff4500, emissive: 0xff2200, emissiveIntensity: 0.6 });
  const coal = new THREE.Mesh(coalGeo, coalMat);
  coal.rotation.x = -Math.PI / 2;
  coal.position.set(0.75, 1.141, -0.8);
  cartGroup.add(coal);

  // Servis tepsisi alanı (sol taraf) - müşteriye vermek için bırakma bölgesi
  const trayZoneGeo = new THREE.RingGeometry(0.18, 0.22, 24);
  const trayZoneMat = new THREE.MeshBasicMaterial({ color: 0x00ff88, side: THREE.DoubleSide, transparent: true, opacity: 0.6 });
  const trayZone = new THREE.Mesh(trayZoneGeo, trayZoneMat);
  trayZone.rotation.x = -Math.PI / 2;
  trayZone.position.set(-0.85, 1.065, -0.8);
  trayZone.name = 'serveZone';
  cartGroup.add(trayZone);
  scene.userData.serveZonePos = trayZone.getWorldPosition(new THREE.Vector3());

  // Ekmek sepeti alanı işareti
  const breadZoneGeo = new THREE.RingGeometry(0.15, 0.18, 24);
  const breadZoneMat = new THREE.MeshBasicMaterial({ color: 0xffcc66, side: THREE.DoubleSide, transparent: true, opacity: 0.5 });
  const breadZone = new THREE.Mesh(breadZoneGeo, breadZoneMat);
  breadZone.rotation.x = -Math.PI / 2;
  breadZone.position.set(-0.25, 1.065, -0.8);
  cartGroup.add(breadZone);

  scene.add(cartGroup);
  scene.userData.grillCenter = new THREE.Vector3(0.75, 1.14, -0.8);
}

/* ---------------- MALZEMELER ---------------- */
function buildIngredients() {
  // Ekmek sepeti - birkaç ekmek örneği hazır dursun
  for (let i = 0; i < 3; i++) {
    const bread = createBread();
    bread.position.set(-0.25 + (i - 1) * 0.13, 1.13, -0.62 - i * 0.02);
    scene.add(bread);
    grabbables.push(bread);
  }

  // Domates dilimleri tabağı
  for (let i = 0; i < 3; i++) {
    const tomato = createTomatoSlice();
    tomato.position.set(-0.55 + i * 0.08, 1.11, -0.55);
    scene.add(tomato);
    grabbables.push(tomato);
  }

  // Soğan
  for (let i = 0; i < 3; i++) {
    const onion = createOnion();
    onion.position.set(0.15 + i * 0.08, 1.11, -0.55);
    scene.add(onion);
    grabbables.push(onion);
  }

  // Maşa (görsel amaçlı, sabit dursun - tutma mekaniği köfteye uygulanıyor)
  const tongGeo = new THREE.BoxGeometry(0.35, 0.02, 0.04);
  const tongMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, metalness: 0.7, roughness: 0.3 });
  const tong = new THREE.Mesh(tongGeo, tongMat);
  tong.position.set(0.75, 1.08, -1.05);
  scene.add(tong);
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
  group.userData.isPlate = true; // ekmek diğer malzemeleri "taşıyabilir"
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
  const geo = new THREE.CapsuleGeometry(0.028, 0.09, 4, 8);
  const mat = new THREE.MeshStandardMaterial({ color: 0x6b3a1f, roughness: 0.95 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.z = Math.PI / 2;
  mesh.castShadow = true;
  mesh.userData.type = 'kofte';
  mesh.userData.grabbable = true;
  mesh.userData.cookLevel = 0; // 0 çiğ, 1 pişmiş, 2 yanmış
  mesh.userData.cookTime = 0;
  mesh.userData.onGrill = true;
  return mesh;
}

function spawnGrillMeatballs() {
  const positions = [
    [-0.13, -0.13], [0, -0.13], [0.13, -0.13],
    [-0.13, 0], [0, 0], [0.13, 0],
  ];
  positions.forEach(([dx, dz]) => {
    const k = createKofte();
    k.position.set(0.75 + dx, 1.16, -0.8 + dz);
    scene.add(k);
    grabbables.push(k);
    grillSlots.push(k);
  });
}

/* ---------------- SİPARİŞ SİSTEMİ ---------------- */
function nextOrder() {
  currentOrder = orderTypes[Math.floor(Math.random() * orderTypes.length)];
  document.getElementById('orderText').innerHTML =
    `<b>${currentOrder.name}</b><br>Malzemeler: ${translateNeeds(currentOrder.needs)}<br>💵 ${currentOrder.price} TL`;
}

function translateNeeds(needs) {
  const map = { bread: 'Ekmek', kofte: 'Köfte', tomato: 'Domates', onion: 'Soğan' };
  return needs.map(n => map[n]).join(', ');
}

function checkServe(plateGroup) {
  const contents = plateGroup.userData.contents || [];
  const needs = currentOrder.needs;
  const hasAll = needs.every(n => contents.includes(n));
  const noExtra = contents.every(c => needs.includes(c));
  const hasBurnt = plateGroup.userData.burnt;

  if (hasAll && noExtra && !hasBurnt) {
    money += currentOrder.price;
    document.getElementById('score').textContent = `💰 ${money} TL`;
    showToast(`✅ Servis edildi! +${currentOrder.price} TL`);
  } else if (hasBurnt) {
    showToast('❌ Köfte yanmış! Müşteri kabul etmedi.');
  } else {
    showToast('❌ Sipariş eksik veya yanlış malzemeli.');
  }

  // tabağı sahneden temizle ve yeni ekmek getir
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

/* ---------------- ETKİLEŞİM: MOUSE (masaüstü test) ---------------- */
let pointerDown = false;
let dragPlaneY = 1.15;

function onPointerDown(e) {
  pointerDown = true;
  updateMouse(e);
  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(grabbables, true);
  if (hits.length > 0) {
    let obj = hits[0].object;
    while (obj.parent && !obj.userData.grabbable && obj.parent !== scene) obj = obj.parent;
    if (obj.userData.grabbable) {
      grabbed = obj;
      dragPlaneY = obj.position.y;
    }
  }
}

function onPointerMove(e) {
  if (!pointerDown || !grabbed) return;
  updateMouse(e);
  raycaster.setFromCamera(mouse, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -dragPlaneY);
  const point = new THREE.Vector3();
  raycaster.ray.intersectPlane(plane, point);
  if (point) {
    grabbed.position.x = point.x;
    grabbed.position.z = point.z;
    grabbed.position.y = dragPlaneY + 0.05;
  }
}

function onPointerUp() {
  pointerDown = false;
  if (grabbed) handleDrop(grabbed);
  grabbed = null;
}

function updateMouse(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

/* ---------------- ETKİLEŞİM: VR KONTROLCÜLERİ ---------------- */
function setupControllers() {
  const controllerModelFactory = new XRControllerModelFactory();

  function makeController(index) {
    const controller = renderer.xr.getController(index);
    controller.userData.grabbed = null;
    controller.addEventListener('selectstart', () => onVRSelectStart(controller));
    controller.addEventListener('selectend', () => onVRSelectEnd(controller));
    scene.add(controller);

    const grip = renderer.xr.getControllerGrip(index);
    grip.add(controllerModelFactory.createControllerModel(grip));
    scene.add(grip);

    // basit ışın (ray) göstergesi
    const rayGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)
    ]);
    const rayMat = new THREE.LineBasicMaterial({ color: 0xffffff });
    const ray = new THREE.Line(rayGeo, rayMat);
    ray.scale.z = 0.3;
    controller.add(ray);

    return controller;
  }

  controller1 = makeController(0);
  controller2 = makeController(1);
}

function onVRSelectStart(controller) {
  // en yakın grabbable nesneyi bul
  const controllerPos = new THREE.Vector3();
  controller.getWorldPosition(controllerPos);

  let closest = null;
  let closestDist = 0.25; // yakalama menzili
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
  }
}

function onVRSelectEnd(controller) {
  const obj = controller.userData.grabbed;
  if (obj) {
    scene.attach(obj);
    handleDrop(obj);
  }
  controller.userData.grabbed = null;
}

/* ---------------- BIRAKMA MANTIĞI (mouse + VR ortak) ---------------- */
function handleDrop(obj) {
  const worldPos = new THREE.Vector3();
  obj.getWorldPosition(worldPos);

  // 1) Servis bölgesine bırakıldı mı? (sadece ekmek/tabak grubu)
  if (obj.userData.isPlate) {
    const serveZone = new THREE.Vector3(-0.85, 1.06, -0.8);
    if (worldPos.distanceTo(serveZone) < 0.18) {
      checkServe(obj);
      return;
    }
  }

  // 2) Köfte ızgaraya geri konulduysa pişmeye devam etsin
  if (obj.userData.type === 'kofte') {
    const grillCenter = scene.userData.grillCenter;
    const flatDist = Math.hypot(worldPos.x - grillCenter.x, worldPos.z - grillCenter.z);
    obj.userData.onGrill = flatDist < 0.35 && worldPos.y < 1.3;
  }

  // 3) Malzeme bir ekmeğin/tabağın üstüne bırakıldıysa ekmeğe "eklensin"
  if (obj.userData.type && obj.userData.type !== 'bread') {
    grabbables.forEach(plate => {
      if (!plate.userData.isPlate || plate === obj) return;
      const platePos = new THREE.Vector3();
      plate.getWorldPosition(platePos);
      if (worldPos.distanceTo(platePos) < 0.1) {
        // yanmış köfte kontrolü
        if (obj.userData.type === 'kofte' && obj.userData.cookLevel === 2) {
          plate.userData.burnt = true;
        }
        if (!plate.userData.contents.includes(obj.userData.type)) {
          plate.userData.contents.push(obj.userData.type);
        }
        // görsel olarak nesneyi ekmeğin üstüne sabitle ve küçült, sahneden ayrı obje olarak kaldır
        scene.remove(obj);
        const idx = grabbables.indexOf(obj);
        if (idx >= 0) grabbables.splice(idx, 1);

        // eğer köfte ızgaradan alındıysa yerine yeni çiğ köfte koy
        const slotIdx = grillSlots.indexOf(obj);
        if (slotIdx >= 0) {
          const replacement = createKofte();
          replacement.position.copy(obj.position.clone().setY(1.16));
          scene.add(replacement);
          grabbables.push(replacement);
          grillSlots[slotIdx] = replacement;
        }
      }
    });
  }
}

/* ---------------- IZGARA PİŞİRME DÖNGÜSÜ ---------------- */
function updateGrill(delta) {
  grillSlots.forEach(k => {
    if (!k.parent) return; // ekmeğe eklenip kaldırılmışsa atla
    if (k.userData.onGrill) {
      k.userData.cookTime += delta;
      if (k.userData.cookTime > 9 && k.userData.cookLevel < 2) {
        k.userData.cookLevel = 2;
        k.material.color.set(0x1a1a1a); // yanık
      } else if (k.userData.cookTime > 4 && k.userData.cookLevel < 1) {
        k.userData.cookLevel = 1;
        k.material.color.set(0x4a2a12); // pişmiş
      }
    }
  });
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
  updateGrill(delta);
  renderer.render(scene, camera);
}
