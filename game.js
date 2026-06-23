const canvas = document.querySelector("#course");
const dateLabel = document.querySelector("#dateLabel");
const parLabel = document.querySelector("#parLabel");
const strokeLabel = document.querySelector("#strokeLabel");
const bestLabel = document.querySelector("#bestLabel");
const powerMeter = document.querySelector("#powerMeter");
const powerLabel = document.querySelector("#powerLabel");
const message = document.querySelector("#message");
const resetButton = document.querySelector("#resetButton");
const newRoundButton = document.querySelector("#newRoundButton");
const clubButtons = document.querySelector("#clubButtons");
const distanceLabel = document.querySelector("#distanceLabel");
const lieLabel = document.querySelector("#lieLabel");
const windLabel = document.querySelector("#windLabel");
const shareButton = document.querySelector("#shareButton");
const introModal = document.querySelector("#introModal");
const playButton = document.querySelector("#playButton");
const helpButton = document.querySelector("#helpButton");
const resetViewButton = document.querySelector("#resetViewButton");
const viewModeButton = document.querySelector("#viewModeButton");

const WIDTH = 760;
const HEIGHT = 520;
const SCALE = 1;
const BALL_RADIUS = 4;
const CUP_RADIUS = 5;
const MAX_DRAG = 155;
const YARDS_PER_PIXEL = 1;
const SURFACE_Y = 2.8;
const GREEN_Y = 3.4;
const BALL_WORLD_RADIUS = 0.9;

const CLUBS = [
  { id: "driver", label: "Driver", carry: 285, roll: 55, accuracy: 0.8, min: 145 },
  { id: "wood", label: "3 Wood", carry: 235, roll: 42, accuracy: 0.88, min: 115 },
  { id: "iron", label: "Iron", carry: 175, roll: 26, accuracy: 0.98, min: 68 },
  { id: "wedge", label: "Wedge", carry: 92, roll: 10, accuracy: 1.08, min: 18 },
  { id: "putter", label: "Putter", carry: 28, roll: 42, accuracy: 1.35, min: 0 },
];

const memoryScores = new Map();
let THREE;
let renderer;
let scene;
let camera;
let courseGroup;
let ballMesh;
let aimLine;
let aimMarker;
let course;
let ball;
let strokes = 0;
let aiming = false;
let aimPoint = null;
let lastPlayablePosition = null;
let holed = false;
let animationId = null;
let renderLoopId = null;
let activeClub = CLUBS[0];
let cameraState = {
  mode: "player",
  target: { x: 80, z: 0 },
  yaw: 0,
  pitch: 0.05,
  distance: 820,
  zoom: 1,
};
let navMode = null;
let navStart = null;
let shotStartClient = null;
let shotStartBall = null;
const activePointers = new Map();

import("https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js")
  .then((module) => {
    THREE = module;
    boot();
  })
  .catch(() => {
    message.textContent = "Could not load the 3D engine. Check your connection and reload.";
  });

function boot() {
  setupScene();
  course = generateDailyCourse(todayKey());
  createClubButtons();
  buildCourseScene();
  resetRound(true);
  message.textContent = `Today's hole is ${course.holeYards} yards, par ${course.par}. Drag the course to look around.`;
  bindEvents();
  renderLoop();
}

function todayKey() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function makeRng(seedText) {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) {
    seed ^= seedText.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed += 0x6d2b79f5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rand(rng, min, max) {
  return min + rng() * (max - min);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distancePointToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, start);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return distance(point, { x: start.x + dx * t, y: start.y + dy * t });
}

function yardsBetween(a, b) {
  return Math.round(distance(a, b) * YARDS_PER_PIXEL);
}

function bezier(a, b, c, t) {
  const p = 1 - t;
  return {
    x: p * p * a.x + 2 * p * t * b.x + t * t * c.x,
    y: p * p * a.y + 2 * p * t * b.y + t * t * c.y,
  };
}

function generateDailyCourse(key) {
  const rng = makeRng(key);
  const tee = { x: rand(rng, 42, 72), y: rand(rng, 155, 365) };
  const pin = { x: rand(rng, 650, 720), y: rand(rng, 105, 420) };
  const curve = rand(rng, -135, 135);
  const control = {
    x: rand(rng, 330, 450),
    y: clamp((tee.y + pin.y) / 2 + curve, 78, 455),
  };
  const holeYards = yardsBetween(tee, pin) + Math.round(Math.abs(curve) * 0.45);
  const par = holeYards > 560 ? 5 : holeYards > 380 ? 4 : 3;
  const fairwayWidth = rand(rng, 46, 62);
  const greenRadius = rand(rng, 21, 30);
  const windAngle = rand(rng, -Math.PI, Math.PI);
  const wind = {
    x: Math.cos(windAngle),
    y: Math.sin(windAngle),
    mph: Math.round(rand(rng, 4, 16)),
  };

  const bunkers = Array.from({ length: 4 + Math.floor(rng() * 2) }, (_, index) => {
    const t = rand(rng, 0.32, 0.94);
    const point = bezier(tee, control, pin, t);
    const side = index % 2 === 0 ? 1 : -1;
    return {
      x: point.x + side * rand(rng, 30, 58),
      y: point.y + rand(rng, -24, 24),
      rx: rand(rng, 13, 25),
      ry: rand(rng, 8, 16),
      angle: rand(rng, -0.9, 0.9),
    };
  });

  const waterPoint = bezier(tee, control, pin, rand(rng, 0.34, 0.72));
  const water = {
    x: waterPoint.x + rand(rng, -34, 34),
    y: waterPoint.y + rand(rng, -58, 58),
    rx: rand(rng, 32, 65),
    ry: rand(rng, 20, 42),
    angle: rand(rng, -0.45, 0.45),
  };

  return {
    key,
    tee,
    pin,
    control,
    par,
    holeYards,
    fairwayWidth,
    greenRadius,
    bunkers,
    water,
    wind,
  };
}

function pointInEllipse(point, ellipse) {
  const cos = Math.cos(ellipse.angle);
  const sin = Math.sin(ellipse.angle);
  const dx = point.x - ellipse.x;
  const dy = point.y - ellipse.y;
  const x = dx * cos + dy * sin;
  const y = -dx * sin + dy * cos;
  return (x * x) / (ellipse.rx * ellipse.rx) + (y * y) / (ellipse.ry * ellipse.ry) <= 1;
}

function fairwayDistance(point) {
  let best = Infinity;
  for (let i = 0; i <= 96; i += 1) {
    best = Math.min(best, distance(point, bezier(course.tee, course.control, course.pin, i / 96)));
  }
  return best;
}

function terrainAt(point) {
  if (
    point.x < BALL_RADIUS ||
    point.x > WIDTH - BALL_RADIUS ||
    point.y < BALL_RADIUS ||
    point.y > HEIGHT - BALL_RADIUS
  ) {
    return "out";
  }
  if (pointInEllipse(point, course.water)) return "water";
  if (course.bunkers.some((bunker) => pointInEllipse(point, bunker))) return "sand";
  if (distance(point, course.pin) <= course.greenRadius) return "green";
  return fairwayDistance(point) <= course.fairwayWidth / 2 ? "fairway" : "rough";
}

function lieName() {
  if (strokes === 0 && distance(ball, course.tee) < 3) return "Tee";
  const terrain = terrainAt(ball);
  return terrain[0].toUpperCase() + terrain.slice(1);
}

function liePowerFactor() {
  const terrain = terrainAt(ball);
  if (terrain === "sand") return 0.52;
  if (terrain === "rough") return 0.74;
  if (terrain === "green") return 0.34;
  return 1;
}

function loadScore(key) {
  try {
    return localStorage.getItem(key) || memoryScores.get(key) || null;
  } catch {
    return memoryScores.get(key) || null;
  }
}

function saveScore(key, value) {
  memoryScores.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // Some browsers block localStorage for local files. Session memory still works.
  }
}

function setupScene() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x8fbfda, 1);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fbfda);
  scene.fog = new THREE.Fog(0xb5d4df, 900, 1900);

  camera = new THREE.PerspectiveCamera(44, 1, 1, 2600);
  updateCamera();

  const hemi = new THREE.HemisphereLight(0xe5f7ff, 0x5b6f3f, 1.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1c8, 2.8);
  sun.position.set(-380, 560, 290);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -600;
  sun.shadow.camera.right = 600;
  sun.shadow.camera.top = 500;
  sun.shadow.camera.bottom = -500;
  scene.add(sun);

  const ambient = new THREE.AmbientLight(0xacc6a0, 1.05);
  scene.add(ambient);

  window.addEventListener("resize", resizeRenderer);
  resizeRenderer();
}

function resizeRenderer() {
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / Math.max(rect.height, 1);
  camera.zoom = cameraState.zoom;
  camera.updateProjectionMatrix();
  updateCamera();
}

function updateCamera() {
  if (!camera) return;
  if (cameraState.mode === "player" && ball) {
    const anchor = world(ball, 0);
    const direction = new THREE.Vector3(Math.sin(cameraState.yaw), 0, Math.cos(cameraState.yaw)).normalize();
    const position = anchor.clone().addScaledVector(direction, -154);
    position.y = 48;
    const lookAt = anchor.clone().addScaledVector(direction, 310);
    lookAt.y = 18 + cameraState.pitch * 215;
    camera.position.copy(position);
    camera.lookAt(lookAt);
    return;
  }

  const target = new THREE.Vector3(cameraState.target.x, 0, cameraState.target.z);
  const horizontal = cameraState.distance * Math.cos(cameraState.pitch);
  camera.position.set(
    target.x + Math.sin(cameraState.yaw) * horizontal,
    cameraState.distance * Math.sin(cameraState.pitch),
    target.z + Math.cos(cameraState.yaw) * horizontal,
  );
  camera.lookAt(target);
}

function angleFromTo(a, b) {
  const aw = world(a, 0);
  const bw = world(b, 0);
  return Math.atan2(bw.x - aw.x, bw.z - aw.z);
}

function setPlayerView() {
  cameraState.mode = "player";
  cameraState.yaw = angleFromTo(ball || course.tee, course.pin);
  cameraState.pitch = 0.04;
  cameraState.zoom = 1;
  resizeRenderer();
  viewModeButton.textContent = "Bird";
  viewModeButton.setAttribute("aria-label", "Bird view");
}

function setBirdView() {
  cameraState.mode = "bird";
  cameraState.target = { x: 60, z: 0 };
  cameraState.yaw = -0.38;
  cameraState.pitch = 1.04;
  cameraState.distance = 820;
  cameraState.zoom = 1;
  resizeRenderer();
  viewModeButton.textContent = "Play";
  viewModeButton.setAttribute("aria-label", "Player view");
}

function world(point, y = 0) {
  return new THREE.Vector3((point.x - WIDTH / 2) * SCALE, y, (point.y - HEIGHT / 2) * SCALE);
}

function createMaterial(color, roughness = 0.82, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function buildCourseScene() {
  if (courseGroup) scene.remove(courseGroup);
  courseGroup = new THREE.Group();
  scene.add(courseGroup);

  const roughPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(WIDTH * SCALE * 2.2, HEIGHT * SCALE * 2),
    createMaterial(0x355c31, 0.96),
  );
  roughPlane.rotation.x = -Math.PI / 2;
  roughPlane.position.y = 0;
  roughPlane.receiveShadow = true;
  courseGroup.add(roughPlane);

  addPathLayer(course.fairwayWidth + 96, 0x2f5b2f, 0.8, 1.6);
  addPathLayer(course.fairwayWidth + 52, 0x447939, 1.6, 1.8);
  addPathLayer(course.fairwayWidth, 0x78b65c, SURFACE_Y, 2.2);

  addFairwayMowingLines();
  addEllipse(course.water, 0x2d83a1, 2.2, 1.2, 0.9);
  course.bunkers.forEach((bunker) => addEllipse(bunker, 0xd8c078, 3.2, 1.2, 1));
  addCylinder(course.tee, 22, 22, 0xd8c18a, 4.2, 1.4);
  addCylinder(course.pin, course.greenRadius, course.greenRadius, 0x61a94a, GREEN_Y, 1.6);
  addTrees();
  addRoughDetail();
  addCupAndPin();
  addBall();
  addAimHelpers();
}

function addPathLayer(width, color, y, height) {
  const material = createMaterial(color, 0.88);
  const steps = 42;
  const radius = (width * SCALE) / 2;
  for (let i = 0; i <= steps; i += 1) {
    const point = bezier(course.tee, course.control, course.pin, i / steps);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 38), material);
    const pos = world(point, y);
    mesh.position.set(pos.x, y, pos.z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    courseGroup.add(mesh);
  }
}

function addCylinder(point, rx, rz, color, y = SURFACE_Y, height = 2) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(rx * SCALE, rx * SCALE, height, 64),
    createMaterial(color, 0.86),
  );
  const pos = world(point, y);
  mesh.position.set(pos.x, y, pos.z);
  mesh.scale.z = rz / rx;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  courseGroup.add(mesh);
  return mesh;
}

function addFairwayMowingLines() {
  const material = createMaterial(0x89c869, 0.92);
  material.transparent = true;
  material.opacity = 0.22;
  for (let i = 0; i <= 18; i += 1) {
    const t = i / 18;
    const point = bezier(course.tee, course.control, course.pin, t);
    const width = (course.fairwayWidth * SCALE) * (0.18 + (i % 2) * 0.08);
    const line = new THREE.Mesh(new THREE.BoxGeometry(width, 0.45, 10), material);
    const pos = world(point, SURFACE_Y + 2.2);
    line.position.set(pos.x, pos.y, pos.z);
    const next = bezier(course.tee, course.control, course.pin, Math.min(1, t + 0.03));
    line.rotation.y = -Math.atan2(next.x - point.x, next.y - point.y) + Math.PI / 2;
    line.receiveShadow = true;
    courseGroup.add(line);
  }
}

function addEllipse(ellipse, color, y, height, opacity = 1) {
  const material = createMaterial(color, 0.78);
  material.transparent = opacity < 1;
  material.opacity = opacity;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(ellipse.rx * SCALE, ellipse.rx * SCALE, height, 64), material);
  const pos = world(ellipse, y);
  mesh.position.set(pos.x, y, pos.z);
  mesh.scale.z = ellipse.ry / ellipse.rx;
  mesh.rotation.y = -ellipse.angle;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  courseGroup.add(mesh);
  return mesh;
}

function addCupAndPin() {
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 1.4, 32), createMaterial(0x07090b, 0.75));
  const cupPos = world(course.pin, GREEN_Y + 2);
  cup.position.set(cupPos.x, GREEN_Y + 2, cupPos.z);
  courseGroup.add(cup);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 78, 12), createMaterial(0xf4efe0, 0.48));
  pole.position.set(cupPos.x, GREEN_Y + 42, cupPos.z);
  pole.castShadow = true;
  courseGroup.add(pole);

  const flagShape = new THREE.Shape();
  flagShape.moveTo(0, 0);
  flagShape.lineTo(42, 13);
  flagShape.lineTo(0, 26);
  flagShape.lineTo(0, 0);
  const flag = new THREE.Mesh(new THREE.ShapeGeometry(flagShape), createMaterial(0xff5d42, 0.58));
  flag.position.set(cupPos.x + 2, GREEN_Y + 72, cupPos.z);
  flag.rotation.y = -0.35;
  flag.castShadow = true;
  courseGroup.add(flag);
}

function addBall() {
  ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_WORLD_RADIUS, 32, 24),
    createMaterial(0xf9f8ec, 0.38),
  );
  ballMesh.castShadow = true;
  courseGroup.add(ballMesh);
}

function addAimHelpers() {
  const material = new THREE.LineDashedMaterial({ color: 0x9af0b7, dashSize: 14, gapSize: 9, linewidth: 2 });
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  aimLine = new THREE.Line(geometry, material);
  aimLine.visible = false;
  courseGroup.add(aimLine);

  aimMarker = new THREE.Mesh(
    new THREE.TorusGeometry(17, 2.6, 12, 32),
    new THREE.MeshBasicMaterial({ color: 0x8bf2ad, transparent: true, opacity: 0.9 }),
  );
  aimMarker.rotation.x = Math.PI / 2;
  aimMarker.visible = false;
  courseGroup.add(aimMarker);
}

function addTrees() {
  const rng = makeRng(`${course.key}:trees`);
  for (let i = 0; i < 46; i += 1) {
    let point;
    for (let tries = 0; tries < 20; tries += 1) {
      point = { x: rand(rng, -80, WIDTH + 80), y: rand(rng, -80, HEIGHT + 80) };
      if (fairwayDistance(point) > course.fairwayWidth * 0.9 && distance(point, course.pin) > course.greenRadius + 55) break;
    }
    addTree(point, rand(rng, 32, 58), rand(rng, 0.8, 1.35));
  }
}

function addTree(point, height, spread) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(4 * spread, 6 * spread, height, 8),
    createMaterial(0x65402a, 0.8),
  );
  const pos = world(point, height / 2 - 5);
  trunk.position.set(pos.x, pos.y, pos.z);
  trunk.castShadow = true;
  courseGroup.add(trunk);

  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(22 * spread, 54 * spread, 10),
    createMaterial(0x1d5632, 0.92),
  );
  crown.position.set(pos.x, height + 18 * spread, pos.z);
  crown.castShadow = true;
  crown.receiveShadow = true;
  courseGroup.add(crown);
}

function addRoughDetail() {
  const rng = makeRng(`${course.key}:rough`);
  const material = createMaterial(0x426f34, 0.98);
  material.transparent = true;
  material.opacity = 0.55;
  for (let i = 0; i < 90; i += 1) {
    const point = { x: rand(rng, -60, WIDTH + 60), y: rand(rng, -50, HEIGHT + 50) };
    if (fairwayDistance(point) < course.fairwayWidth * 0.72 || distance(point, course.pin) < course.greenRadius + 38) continue;
    const grass = new THREE.Mesh(
      new THREE.ConeGeometry(rand(rng, 2.4, 5.8), rand(rng, 8, 18), 5),
      material,
    );
    const pos = world(point, rand(rng, 5, 9));
    grass.position.set(pos.x, pos.y, pos.z);
    grass.rotation.y = rand(rng, 0, Math.PI * 2);
    grass.castShadow = true;
    courseGroup.add(grass);
  }
}

function createClubButtons() {
  clubButtons.innerHTML = "";
  CLUBS.forEach((club) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = club.label;
    button.dataset.club = club.id;
    button.setAttribute("aria-pressed", club.id === activeClub.id ? "true" : "false");
    button.addEventListener("click", () => {
      if (ballIsMoving() || holed) return;
      activeClub = club;
      updateClubButtons();
      updateShotInfo();
      draw();
    });
    clubButtons.append(button);
  });
}

function updateClubButtons() {
  clubButtons.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.club === activeClub.id ? "true" : "false");
  });
}

function suggestClub() {
  const yards = yardsBetween(ball, course.pin);
  const onGreen = terrainAt(ball) === "green";
  const options = [...CLUBS].reverse();
  const next = onGreen
    ? CLUBS.find((club) => club.id === "putter")
    : options.find((club) => yards >= club.min && yards <= club.carry + club.roll + 30) || CLUBS[0];
  activeClub = next;
  updateClubButtons();
}

function updateStats() {
  dateLabel.textContent = course.key;
  parLabel.textContent = String(course.par);
  strokeLabel.textContent = String(strokes);
  bestLabel.textContent = loadScore(`daily-golf-best:${course.key}`) || "--";
}

function updatePower(value) {
  const rounded = Math.round(value);
  powerMeter.value = rounded;
  powerLabel.textContent = `${rounded}%`;
}

function updateShotInfo() {
  distanceLabel.textContent = `${yardsBetween(ball, course.pin)} yd`;
  lieLabel.textContent = lieName();
  windLabel.textContent = `${course.wind.mph} mph ${windArrow()}`;
}

function windArrow() {
  const angle = Math.atan2(course.wind.y, course.wind.x);
  const directions = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  const index = Math.round(((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return directions[index];
}

function resetRound(keepMessage = false) {
  ball = { x: course.tee.x, y: course.tee.y, vx: 0, vy: 0, target: null };
  lastPlayablePosition = { x: ball.x, y: ball.y };
  strokes = 0;
  holed = false;
  aiming = false;
  aimPoint = null;
  activeClub = CLUBS[0];
  updateStats();
  updatePower(0);
  updateClubButtons();
  updateShotInfo();
  setPlayerView();
  if (!keepMessage) message.textContent = "Drag from the ball to shoot. Drag elsewhere to look around.";
  draw();
}

function screenPoint(event) {
  return { x: event.clientX, y: event.clientY };
}

function ballScreenPoint() {
  if (!ballMesh) return null;
  const rect = canvas.getBoundingClientRect();
  const projected = ballMesh.position.clone().project(camera);
  return {
    x: rect.left + ((projected.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - projected.y) / 2) * rect.height,
  };
}

function isNearVisibleBall(point) {
  const ballPoint = ballScreenPoint();
  if (!ballPoint) return false;
  return pointerDistance(point, ballPoint) <= 74;
}

function aimPointFromScreen(point) {
  const pull = {
    x: shotStartClient.x - point.x,
    y: shotStartClient.y - point.y,
  };
  const drag = Math.max(pointerDistance(shotStartClient, point), 1);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  right.y = 0;
  right.normalize();

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();

  const direction = right.multiplyScalar(pull.x).add(forward.multiplyScalar(-pull.y));
  if (direction.lengthSq() < 0.001) {
    return { ...shotStartBall };
  }
  direction.normalize();
  const distancePixels = Math.min(drag, MAX_DRAG) / MAX_DRAG * 170;
  const startWorld = world(shotStartBall, 0);
  const targetWorld = startWorld.addScaledVector(direction, distancePixels * SCALE);
  return {
    x: targetWorld.x / SCALE + WIDTH / 2,
    y: targetWorld.z / SCALE + HEIGHT / 2,
  };
}

function clientPoint(event) {
  return { x: event.clientX, y: event.clientY };
}

function pointerDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function averagePointer() {
  const points = [...activePointers.values()];
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function pinchDistance() {
  const points = [...activePointers.values()];
  return points.length >= 2 ? pointerDistance(points[0], points[1]) : 0;
}

function startNavigation(event) {
  navMode = activePointers.size >= 2 ? "pinch" : "orbit";
  navStart = {
    pointer: activePointers.size >= 2 ? averagePointer() : clientPoint(event),
    mode: cameraState.mode,
    yaw: cameraState.yaw,
    pitch: cameraState.pitch,
    target: { ...cameraState.target },
    zoom: cameraState.zoom,
    pinch: pinchDistance(),
  };
}

function moveNavigation(event) {
  if (!navMode || !navStart) return;

  if (navMode === "pinch" && activePointers.size >= 2) {
    const center = averagePointer();
    const dx = center.x - navStart.pointer.x;
    const dy = center.y - navStart.pointer.y;
    const ratio = pinchDistance() / Math.max(navStart.pinch, 1);
    cameraState.zoom = clamp(navStart.zoom * ratio, 0.72, 2.25);
    cameraState.target.x = clamp(navStart.target.x - dx * 0.7 / cameraState.zoom, -430, 430);
    cameraState.target.z = clamp(navStart.target.z - dy * 0.7 / cameraState.zoom, -300, 300);
    resizeRenderer();
    message.textContent = "Pinch to zoom. Drag to look around.";
    return;
  }

  const point = clientPoint(event);
  const dx = point.x - navStart.pointer.x;
  const dy = point.y - navStart.pointer.y;
  if (navStart.mode === "player") {
    cameraState.yaw = navStart.yaw - dx * 0.006;
    cameraState.pitch = clamp(navStart.pitch + dy * 0.0016, -0.08, 0.24);
    updateCamera();
    message.textContent = "Looking around from the ball. Drag near the ball to shoot.";
    return;
  }

  const orbiting = event.shiftKey || event.altKey || Math.abs(dx) > Math.abs(dy) * 1.15;

  if (orbiting) {
    cameraState.yaw = navStart.yaw - dx * 0.008;
    cameraState.pitch = clamp(navStart.pitch + dy * 0.004, 0.52, 1.12);
  } else {
    cameraState.target.x = clamp(navStart.target.x - dx * 0.78 / cameraState.zoom, -430, 430);
    cameraState.target.z = clamp(navStart.target.z - dy * 0.78 / cameraState.zoom, -300, 300);
  }
  updateCamera();
  message.textContent = "Drag from the ball to shoot. Drag elsewhere to look around.";
}

function zoomCamera(delta) {
  cameraState.zoom = clamp(cameraState.zoom * (delta > 0 ? 0.9 : 1.1), 0.72, 2.25);
  resizeRenderer();
  message.textContent = "Scroll to zoom. Drag the course to change angle.";
}

function ballIsMoving() {
  return Math.hypot(ball.vx, ball.vy) > 0.1;
}

function startAim(event) {
  if (holed || ballIsMoving()) return;
  const point = screenPoint(event);
  activePointers.set(event.pointerId, point);
  if (activePointers.size >= 2) {
    aiming = false;
    startNavigation(event);
    return;
  }
  if (!isNearVisibleBall(point)) {
    startNavigation(event);
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  aiming = true;
  navMode = null;
  shotStartClient = point;
  shotStartBall = { x: ball.x, y: ball.y };
  aimPoint = aimPointFromScreen(point);
  canvas.setPointerCapture(event.pointerId);
  message.textContent = "Pull back from the ball, then release.";
}

function moveAim(event) {
  const point = screenPoint(event);
  activePointers.set(event.pointerId, point);
  if (navMode) {
    moveNavigation(event);
    return;
  }
  if (!aiming) return;
  aimPoint = aimPointFromScreen(point);
  updatePower(clamp(pointerDistance(shotStartClient, point) / MAX_DRAG, 0, 1) * 100);
  draw();
}

function releaseAim(event) {
  const point = screenPoint(event);
  activePointers.delete(event.pointerId);
  if (navMode) {
    if (activePointers.size === 0) {
      navMode = null;
      navStart = null;
    } else {
      startNavigation(event);
    }
    return;
  }
  if (!aiming) return;
  aiming = false;
  aimPoint = aimPointFromScreen(point);
  const drag = Math.min(pointerDistance(shotStartClient, point), MAX_DRAG);
  if (drag > 8) playShot(drag / MAX_DRAG);
  shotStartClient = null;
  shotStartBall = null;
  updatePower(0);
  draw();
}

function playShot(power) {
  const aimAngle = Math.atan2(aimPoint.y - ball.y, aimPoint.x - ball.x);
  const lieFactor = liePowerFactor();
  const windPush = activeClub.id === "putter" ? 0 : course.wind.mph * 0.9;
  const carryPixels = (activeClub.carry * power * lieFactor) / YARDS_PER_PIXEL;
  const rollPixels = (activeClub.roll * (0.55 + power * 0.45) * lieFactor) / YARDS_PER_PIXEL;
  const miss = (1 - activeClub.accuracy) * 34 + (1 - power) * 18;
  const drift = {
    x: course.wind.x * windPush + Math.sin(aimAngle) * miss,
    y: course.wind.y * windPush - Math.cos(aimAngle) * miss,
  };
  const total = carryPixels + rollPixels;
  ball.target = {
    x: clamp(ball.x + Math.cos(aimAngle) * total + drift.x, -32, WIDTH + 32),
    y: clamp(ball.y + Math.sin(aimAngle) * total + drift.y, -32, HEIGHT + 32),
  };
  const speed = activeClub.id === "putter" ? 10 : 18;
  ball.vx = Math.cos(aimAngle) * speed;
  ball.vy = Math.sin(aimAngle) * speed;
  strokes += 1;
  updateStats();
  message.textContent = `${activeClub.label} away.`;
  tick();
}

function tick() {
  cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(() => {
    stepPhysics();
    draw();
    if (ballIsMoving()) {
      tick();
      return;
    }
    settleBall();
  });
}

function stepPhysics() {
  const target = ball.target || ball;
  const dx = target.x - ball.x;
  const dy = target.y - ball.y;
  const remaining = Math.hypot(dx, dy);
  const speed = Math.max(Math.hypot(ball.vx, ball.vy) * 0.965, 0.12);
  const previous = { x: ball.x, y: ball.y };

  if (remaining <= speed) {
    ball.x = target.x;
    ball.y = target.y;
    ball.vx = 0;
    ball.vy = 0;
    ball.target = null;
    return;
  }

  ball.vx = (dx / remaining) * speed;
  ball.vy = (dy / remaining) * speed;
  ball.x += ball.vx;
  ball.y += ball.vy;

  const crossedCup = distancePointToSegment(course.pin, previous, ball) <= CUP_RADIUS * 1.35;
  const cupSpeedLimit = activeClub.id === "putter" ? 11.5 : 8.5;
  const onGreenLine = distance(previous, course.pin) <= course.greenRadius * 1.35 || distance(ball, course.pin) <= course.greenRadius * 1.35;
  if ((crossedCup || distance(ball, course.pin) <= CUP_RADIUS * 1.5) && speed <= cupSpeedLimit && onGreenLine) {
    ball.x = course.pin.x;
    ball.y = course.pin.y;
    ball.vx = 0;
    ball.vy = 0;
    ball.target = null;
    finishHole();
  }
}

function settleBall() {
  if (holed) return;
  const terrain = terrainAt(ball);
  if (terrain === "water" || terrain === "out") {
    ball.x = lastPlayablePosition.x;
    ball.y = lastPlayablePosition.y;
    strokes += 1;
    updateStats();
    updateShotInfo();
    if (cameraState.mode === "player") setPlayerView();
    message.textContent = terrain === "water" ? "Water penalty. Dropped at your last lie." : "Out of bounds. One-stroke penalty.";
    draw();
    return;
  }

  lastPlayablePosition = { x: ball.x, y: ball.y };
  suggestClub();
  updateShotInfo();
  if (cameraState.mode === "player") setPlayerView();
  const lie = lieName().toLowerCase();
  message.textContent = lie === "green" ? "On the green. Time to putt." : `Ball came to rest in the ${lie}.`;
}

function finishHole() {
  if (holed) return;
  holed = true;
  const key = `daily-golf-best:${course.key}`;
  const best = Number(loadScore(key));
  if (!best || strokes < best) {
    saveScore(key, String(strokes));
    message.textContent = `Holed in ${strokes}. New daily best.`;
  } else {
    message.textContent = `Holed in ${strokes}. Daily best: ${best}.`;
  }
  updateStats();
  updateShotInfo();
}

function ballHeight() {
  const terrain = terrainAt(ball);
  if (terrain === "sand") return SURFACE_Y - 0.5 + BALL_WORLD_RADIUS;
  if (terrain === "green") return GREEN_Y + 0.8 + BALL_WORLD_RADIUS;
  if (terrain === "fairway") return SURFACE_Y + 0.8 + BALL_WORLD_RADIUS;
  return 1.2 + BALL_WORLD_RADIUS;
}

function updateBallMesh() {
  const pos = world(ball, ballHeight());
  ballMesh.position.set(pos.x, pos.y, pos.z);
  ballMesh.rotation.x += ball.vy * 0.03;
  ballMesh.rotation.z -= ball.vx * 0.03;
}

function updateAimHelpers() {
  if (!aiming || !aimPoint) {
    aimLine.visible = false;
    aimMarker.visible = false;
    return;
  }

  const drag = Math.min(distance(ball, aimPoint), MAX_DRAG);
  const angle = Math.atan2(aimPoint.y - ball.y, aimPoint.x - ball.x);
  const projectedYards = Math.round((activeClub.carry + activeClub.roll) * (drag / MAX_DRAG) * liePowerFactor());
  const target = {
    x: ball.x + Math.cos(angle) * (projectedYards / YARDS_PER_PIXEL),
    y: ball.y + Math.sin(angle) * (projectedYards / YARDS_PER_PIXEL),
  };
  const start = world(ball, 46);
  const end = world(target, 46);
  aimLine.geometry.setFromPoints([start, end]);
  aimLine.computeLineDistances();
  aimLine.visible = true;
  aimMarker.position.set(end.x, end.y - 8, end.z);
  aimMarker.visible = true;
}

function draw() {
  updateBallMesh();
  updateAimHelpers();
  renderer.render(scene, camera);
}

function renderLoop() {
  renderLoopId = requestAnimationFrame(renderLoop);
  draw();
}

function bindEvents() {
  canvas.addEventListener("pointerdown", startAim);
  canvas.addEventListener("pointermove", moveAim);
  canvas.addEventListener("pointerup", releaseAim);
  canvas.addEventListener("pointerleave", releaseAim);
  canvas.addEventListener("pointercancel", () => {
    aiming = false;
    navMode = null;
    navStart = null;
    activePointers.clear();
    updatePower(0);
    draw();
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomCamera(event.deltaY);
    },
    { passive: false },
  );

  resetButton.addEventListener("click", () => {
    if (ballIsMoving() || holed) return;
    ball.x = lastPlayablePosition.x;
    ball.y = lastPlayablePosition.y;
    ball.vx = 0;
    ball.vy = 0;
    ball.target = null;
    suggestClub();
    updateShotInfo();
    message.textContent = "Returned to your last lie.";
    draw();
  });

  newRoundButton.addEventListener("click", () => resetRound());

  shareButton.addEventListener("click", async () => {
    const relation = strokes - course.par;
    const scoreText = relation === 0 ? "E" : relation > 0 ? `+${relation}` : String(relation);
    const result = holed ? `${strokes} strokes (${scoreText})` : `${strokes} strokes so far`;
    const text = `Daily Golf ${course.key}: ${result} on a ${course.holeYards} yd par ${course.par}.`;
    try {
      await navigator.clipboard.writeText(text);
      message.textContent = "Result copied. Send it to a friend.";
    } catch {
      message.textContent = text;
    }
  });

  playButton.addEventListener("click", () => {
    introModal.hidden = true;
  });

  introModal.addEventListener("click", (event) => {
    if (event.target === playButton) introModal.hidden = true;
  });

  helpButton.addEventListener("click", () => {
    introModal.hidden = false;
  });

  viewModeButton.addEventListener("click", () => {
    if (cameraState.mode === "player") {
      setBirdView();
      message.textContent = "Bird view. Drag to navigate the hole; scroll or pinch to zoom.";
    } else {
      setPlayerView();
      message.textContent = "Player view. Drag near the ball to shoot.";
    }
  });

  resetViewButton.addEventListener("click", () => {
    setPlayerView();
    message.textContent = "View reset behind the ball.";
  });
}
const canvas = document.querySelector("#course");
const dateLabel = document.querySelector("#dateLabel");
const parLabel = document.querySelector("#parLabel");
const strokeLabel = document.querySelector("#strokeLabel");
const bestLabel = document.querySelector("#bestLabel");
const powerMeter = document.querySelector("#powerMeter");
const powerLabel = document.querySelector("#powerLabel");
const message = document.querySelector("#message");
const resetButton = document.querySelector("#resetButton");
const newRoundButton = document.querySelector("#newRoundButton");
const clubButtons = document.querySelector("#clubButtons");
const distanceLabel = document.querySelector("#distanceLabel");
const lieLabel = document.querySelector("#lieLabel");
const windLabel = document.querySelector("#windLabel");
const shareButton = document.querySelector("#shareButton");
const introModal = document.querySelector("#introModal");
const playButton = document.querySelector("#playButton");
const helpButton = document.querySelector("#helpButton");
const resetViewButton = document.querySelector("#resetViewButton");
const viewModeButton = document.querySelector("#viewModeButton");

const WIDTH = 960;
const HEIGHT = 620;
const SCALE = 0.82;
const BALL_RADIUS = 7;
const CUP_RADIUS = 12;
const MAX_DRAG = 155;
const YARDS_PER_PIXEL = 0.58;
const SURFACE_Y = 2.8;
const GREEN_Y = 3.4;
const BALL_WORLD_RADIUS = 2.3;

const CLUBS = [
  { id: "driver", label: "Driver", carry: 285, roll: 55, accuracy: 0.8, min: 145 },
  { id: "wood", label: "3 Wood", carry: 235, roll: 42, accuracy: 0.88, min: 115 },
  { id: "iron", label: "Iron", carry: 175, roll: 26, accuracy: 0.98, min: 68 },
  { id: "wedge", label: "Wedge", carry: 92, roll: 10, accuracy: 1.08, min: 18 },
  { id: "putter", label: "Putter", carry: 28, roll: 42, accuracy: 1.35, min: 0 },
];

const memoryScores = new Map();
let THREE;
let renderer;
let scene;
let camera;
let courseGroup;
let ballMesh;
let aimLine;
let aimMarker;
let waterMeshes = [];
let course;
let ball;
let strokes = 0;
let aiming = false;
let aimPoint = null;
let lastPlayablePosition = null;
let holed = false;
let animationId = null;
let renderLoopId = null;
let activeClub = CLUBS[0];
let cameraState = {
  mode: "player",
  target: { x: 80, z: 0 },
  yaw: 0,
  pitch: 0.05,
  distance: 820,
  zoom: 1,
};
let navMode = null;
let navStart = null;
let shotStartClient = null;
let shotStartBall = null;
const activePointers = new Map();

import("https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js")
  .then((module) => {
    THREE = module;
    boot();
  })
  .catch(() => {
    message.textContent = "Could not load the 3D engine. Check your connection and reload.";
  });

function boot() {
  setupScene();
  course = generateDailyCourse(todayKey());
  createClubButtons();
  buildCourseScene();
  resetRound(true);
  message.textContent = `Today's hole is ${course.holeYards} yards, par ${course.par}. Drag the course to look around.`;
  bindEvents();
  renderLoop();
}

function todayKey() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function makeRng(seedText) {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) {
    seed ^= seedText.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed += 0x6d2b79f5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rand(rng, min, max) {
  return min + rng() * (max - min);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distancePointToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, start);
  const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1);
  return distance(point, { x: start.x + dx * t, y: start.y + dy * t });
}

function yardsBetween(a, b) {
  return Math.round(distance(a, b) * YARDS_PER_PIXEL);
}

function bezier(a, b, c, t) {
  const p = 1 - t;
  return {
    x: p * p * a.x + 2 * p * t * b.x + t * t * c.x,
    y: p * p * a.y + 2 * p * t * b.y + t * t * c.y,
  };
}

function generateDailyCourse(key) {
  const rng = makeRng(key);
  const tee = { x: rand(rng, 74, 116), y: rand(rng, 170, 450) };
  const pin = { x: rand(rng, 835, 890), y: rand(rng, 125, 500) };
  const curve = rand(rng, -185, 185);
  const control = {
    x: rand(rng, 420, 555),
    y: clamp((tee.y + pin.y) / 2 + curve, 92, 528),
  };
  const holeYards = yardsBetween(tee, pin) + Math.round(Math.abs(curve) * 0.45);
  const par = holeYards > 460 ? 5 : holeYards > 330 ? 4 : 3;
  const fairwayWidth = rand(rng, 104, 136);
  const greenRadius = rand(rng, 46, 62);
  const windAngle = rand(rng, -Math.PI, Math.PI);
  const wind = {
    x: Math.cos(windAngle),
    y: Math.sin(windAngle),
    mph: Math.round(rand(rng, 4, 16)),
  };

  const bunkers = Array.from({ length: 4 + Math.floor(rng() * 2) }, (_, index) => {
    const t = rand(rng, 0.32, 0.94);
    const point = bezier(tee, control, pin, t);
    const side = index % 2 === 0 ? 1 : -1;
    return {
      x: point.x + side * rand(rng, 50, 92),
      y: point.y + rand(rng, -36, 36),
      rx: rand(rng, 26, 50),
      ry: rand(rng, 16, 30),
      angle: rand(rng, -0.9, 0.9),
    };
  });

  const waterPoint = bezier(tee, control, pin, rand(rng, 0.34, 0.72));
  const water = {
    x: waterPoint.x + rand(rng, -48, 48),
    y: waterPoint.y + rand(rng, -86, 86),
    rx: rand(rng, 58, 110),
    ry: rand(rng, 34, 72),
    angle: rand(rng, -0.45, 0.45),
  };

  return {
    key,
    tee,
    pin,
    control,
    par,
    holeYards,
    fairwayWidth,
    greenRadius,
    bunkers,
    water,
    wind,
  };
}

function pointInEllipse(point, ellipse) {
  const cos = Math.cos(ellipse.angle);
  const sin = Math.sin(ellipse.angle);
  const dx = point.x - ellipse.x;
  const dy = point.y - ellipse.y;
  const x = dx * cos + dy * sin;
  const y = -dx * sin + dy * cos;
  return (x * x) / (ellipse.rx * ellipse.rx) + (y * y) / (ellipse.ry * ellipse.ry) <= 1;
}

function fairwayDistance(point) {
  let best = Infinity;
  for (let i = 0; i <= 96; i += 1) {
    best = Math.min(best, distance(point, bezier(course.tee, course.control, course.pin, i / 96)));
  }
  return best;
}

function terrainAt(point) {
  if (
    point.x < BALL_RADIUS ||
    point.x > WIDTH - BALL_RADIUS ||
    point.y < BALL_RADIUS ||
    point.y > HEIGHT - BALL_RADIUS
  ) {
    return "out";
  }
  if (pointInEllipse(point, course.water)) return "water";
  if (course.bunkers.some((bunker) => pointInEllipse(point, bunker))) return "sand";
  if (distance(point, course.pin) <= course.greenRadius) return "green";
  return fairwayDistance(point) <= course.fairwayWidth / 2 ? "fairway" : "rough";
}

function lieName() {
  if (strokes === 0 && distance(ball, course.tee) < 3) return "Tee";
  const terrain = terrainAt(ball);
  return terrain[0].toUpperCase() + terrain.slice(1);
}

function liePowerFactor() {
  const terrain = terrainAt(ball);
  if (terrain === "sand") return 0.52;
  if (terrain === "rough") return 0.74;
  if (terrain === "green") return 0.34;
  return 1;
}

function loadScore(key) {
  try {
    return localStorage.getItem(key) || memoryScores.get(key) || null;
  } catch {
    return memoryScores.get(key) || null;
  }
}

function saveScore(key, value) {
  memoryScores.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // Some browsers block localStorage for local files. Session memory still works.
  }
}

function setupScene() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x8fbfda, 1);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fbfda);
  scene.fog = new THREE.Fog(0xb5d4df, 900, 1900);

  camera = new THREE.PerspectiveCamera(44, 1, 1, 2600);
  updateCamera();

  const hemi = new THREE.HemisphereLight(0xe5f7ff, 0x5b6f3f, 1.9);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff1c8, 2.8);
  sun.position.set(-380, 560, 290);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -600;
  sun.shadow.camera.right = 600;
  sun.shadow.camera.top = 500;
  sun.shadow.camera.bottom = -500;
  scene.add(sun);

  const ambient = new THREE.AmbientLight(0xacc6a0, 1.05);
  scene.add(ambient);

  window.addEventListener("resize", resizeRenderer);
  resizeRenderer();
}

function resizeRenderer() {
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / Math.max(rect.height, 1);
  camera.zoom = cameraState.zoom;
  camera.updateProjectionMatrix();
  updateCamera();
}

function updateCamera() {
  if (!camera) return;
  if (cameraState.mode === "player" && ball) {
    const anchor = world(ball, 0);
    const direction = new THREE.Vector3(Math.sin(cameraState.yaw), 0, Math.cos(cameraState.yaw)).normalize();
    const position = anchor.clone().addScaledVector(direction, -154);
    position.y = 48;
    const lookAt = anchor.clone().addScaledVector(direction, 310);
    lookAt.y = 18 + cameraState.pitch * 215;
    camera.position.copy(position);
    camera.lookAt(lookAt);
    return;
  }

  const target = new THREE.Vector3(cameraState.target.x, 0, cameraState.target.z);
  const horizontal = cameraState.distance * Math.cos(cameraState.pitch);
  camera.position.set(
    target.x + Math.sin(cameraState.yaw) * horizontal,
    cameraState.distance * Math.sin(cameraState.pitch),
    target.z + Math.cos(cameraState.yaw) * horizontal,
  );
  camera.lookAt(target);
}

function angleFromTo(a, b) {
  const aw = world(a, 0);
  const bw = world(b, 0);
  return Math.atan2(bw.x - aw.x, bw.z - aw.z);
}

function setPlayerView() {
  cameraState.mode = "player";
  cameraState.yaw = angleFromTo(ball || course.tee, course.pin);
  cameraState.pitch = 0.04;
  cameraState.zoom = 1;
  resizeRenderer();
  viewModeButton.textContent = "Bird";
  viewModeButton.setAttribute("aria-label", "Bird view");
}

function setBirdView() {
  cameraState.mode = "bird";
  cameraState.target = { x: 60, z: 0 };
  cameraState.yaw = -0.38;
  cameraState.pitch = 1.04;
  cameraState.distance = 820;
  cameraState.zoom = 1;
  resizeRenderer();
  viewModeButton.textContent = "Play";
  viewModeButton.setAttribute("aria-label", "Player view");
}

function world(point, y = 0) {
  return new THREE.Vector3((point.x - WIDTH / 2) * SCALE, y, (point.y - HEIGHT / 2) * SCALE);
}

function createMaterial(color, roughness = 0.82, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function buildCourseScene() {
  if (courseGroup) scene.remove(courseGroup);
  waterMeshes = [];
  courseGroup = new THREE.Group();
  scene.add(courseGroup);

  const roughPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(WIDTH * SCALE * 2.2, HEIGHT * SCALE * 2),
    createMaterial(0x355c31, 0.96),
  );
  roughPlane.rotation.x = -Math.PI / 2;
  roughPlane.position.y = 0;
  roughPlane.receiveShadow = true;
  courseGroup.add(roughPlane);

  addPathLayer(course.fairwayWidth + 96, 0x2f5b2f, 0.8, 1.6);
  addPathLayer(course.fairwayWidth + 52, 0x447939, 1.6, 1.8);
  addPathLayer(course.fairwayWidth, 0x78b65c, SURFACE_Y, 2.2);

  addFairwayMowingLines();
  addWater(course.water);
  course.bunkers.forEach((bunker) => addBunker(bunker));
  addCylinder(course.tee, 22, 22, 0xd8c18a, 4.2, 1.4);
  addCylinder(course.pin, course.greenRadius, course.greenRadius, 0x61a94a, GREEN_Y, 1.6);
  addTrees();
  addRoughDetail();
  addCupAndPin();
  addBall();
  addAimHelpers();
}

function addPathLayer(width, color, y, height) {
  const material = createMaterial(color, 0.88);
  const steps = 42;
  const radius = (width * SCALE) / 2;
  for (let i = 0; i <= steps; i += 1) {
    const point = bezier(course.tee, course.control, course.pin, i / steps);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 38), material);
    const pos = world(point, y);
    mesh.position.set(pos.x, y, pos.z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    courseGroup.add(mesh);
  }
}

function addCylinder(point, rx, rz, color, y = SURFACE_Y, height = 2) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(rx * SCALE, rx * SCALE, height, 64),
    createMaterial(color, 0.86),
  );
  const pos = world(point, y);
  mesh.position.set(pos.x, y, pos.z);
  mesh.scale.z = rz / rx;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  courseGroup.add(mesh);
  return mesh;
}

function addFairwayMowingLines() {
  const material = createMaterial(0x89c869, 0.92);
  material.transparent = true;
  material.opacity = 0.22;
  for (let i = 0; i <= 18; i += 1) {
    const t = i / 18;
    const point = bezier(course.tee, course.control, course.pin, t);
    const width = (course.fairwayWidth * SCALE) * (0.18 + (i % 2) * 0.08);
    const line = new THREE.Mesh(new THREE.BoxGeometry(width, 0.45, 10), material);
    const pos = world(point, SURFACE_Y + 2.2);
    line.position.set(pos.x, pos.y, pos.z);
    const next = bezier(course.tee, course.control, course.pin, Math.min(1, t + 0.03));
    line.rotation.y = -Math.atan2(next.x - point.x, next.y - point.y) + Math.PI / 2;
    line.receiveShadow = true;
    courseGroup.add(line);
  }
}

function addEllipse(ellipse, color, y, height, opacity = 1) {
  const material = createMaterial(color, 0.78);
  material.transparent = opacity < 1;
  material.opacity = opacity;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(ellipse.rx * SCALE, ellipse.rx * SCALE, height, 64), material);
  const pos = world(ellipse, y);
  mesh.position.set(pos.x, y, pos.z);
  mesh.scale.z = ellipse.ry / ellipse.rx;
  mesh.rotation.y = -ellipse.angle;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  courseGroup.add(mesh);
  return mesh;
}

function addBunker(ellipse) {
  const lipMaterial = createMaterial(0x4d7835, 0.95);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(ellipse.rx * SCALE * 0.96, 3.4, 10, 72), lipMaterial);
  const pos = world(ellipse, SURFACE_Y + 1.5);
  lip.position.set(pos.x, pos.y, pos.z);
  lip.rotation.x = Math.PI / 2;
  lip.rotation.z = -ellipse.angle;
  lip.scale.y = ellipse.ry / ellipse.rx;
  lip.castShadow = true;
  lip.receiveShadow = true;
  courseGroup.add(lip);

  const shadow = new THREE.Mesh(
    new THREE.CylinderGeometry(ellipse.rx * SCALE * 0.88, ellipse.rx * SCALE * 0.88, 2.2, 64),
    createMaterial(0x8a6b3f, 0.98),
  );
  const shadowPos = world(ellipse, SURFACE_Y - 0.6);
  shadow.position.set(shadowPos.x, shadowPos.y, shadowPos.z);
  shadow.scale.z = ellipse.ry / ellipse.rx;
  shadow.rotation.y = -ellipse.angle;
  shadow.receiveShadow = true;
  courseGroup.add(shadow);

  const sandMaterial = createMaterial(0xd9c27d, 0.99);
  const sand = new THREE.Mesh(
    new THREE.CylinderGeometry(ellipse.rx * SCALE * 0.76, ellipse.rx * SCALE * 0.76, 0.9, 64),
    sandMaterial,
  );
  const sandPos = world(ellipse, SURFACE_Y - 1.4);
  sand.position.set(sandPos.x, sandPos.y, sandPos.z);
  sand.scale.z = ellipse.ry / ellipse.rx;
  sand.rotation.y = -ellipse.angle;
  sand.receiveShadow = true;
  courseGroup.add(sand);

  for (let i = 0; i < 5; i += 1) {
    const rake = new THREE.Mesh(
      new THREE.BoxGeometry(ellipse.rx * SCALE * 0.75, 0.18, 0.55),
      createMaterial(0xb79a5e, 1),
    );
    const offset = (i - 2) * (ellipse.ry * SCALE * 0.18);
    rake.position.set(sandPos.x, sandPos.y + 0.8, sandPos.z + offset);
    rake.rotation.y = -ellipse.angle;
    rake.receiveShadow = true;
    courseGroup.add(rake);
  }
}

function addWater(ellipse) {
  const waterMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x2f91b2,
    roughness: 0.18,
    metalness: 0,
    transmission: 0.15,
    transparent: true,
    opacity: 0.82,
    clearcoat: 0.8,
    clearcoatRoughness: 0.16,
  });
  const water = new THREE.Mesh(new THREE.CylinderGeometry(ellipse.rx * SCALE, ellipse.rx * SCALE, 0.7, 96), waterMaterial);
  const pos = world(ellipse, SURFACE_Y - 0.4);
  water.position.set(pos.x, pos.y, pos.z);
  water.scale.z = ellipse.ry / ellipse.rx;
  water.rotation.y = -ellipse.angle;
  water.receiveShadow = true;
  courseGroup.add(water);
  waterMeshes.push(water);

  const highlightMaterial = new THREE.MeshBasicMaterial({
    color: 0xbfeeff,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  for (let i = 0; i < 4; i += 1) {
    const ripple = new THREE.Mesh(new THREE.TorusGeometry(ellipse.rx * SCALE * (0.28 + i * 0.13), 0.65, 8, 80), highlightMaterial.clone());
    ripple.position.set(pos.x + (i - 1.5) * 8, pos.y + 1.2 + i * 0.08, pos.z + (i % 2 ? 8 : -6));
    ripple.rotation.x = Math.PI / 2;
    ripple.rotation.z = -ellipse.angle + i * 0.32;
    ripple.scale.y = ellipse.ry / ellipse.rx;
    courseGroup.add(ripple);
    waterMeshes.push(ripple);
  }
}

function addCupAndPin() {
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 3, 32), createMaterial(0x07090b, 0.75));
  const cupPos = world(course.pin, GREEN_Y + 2);
  cup.position.set(cupPos.x, GREEN_Y + 2, cupPos.z);
  courseGroup.add(cup);

  const pole = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 78, 12), createMaterial(0xf4efe0, 0.48));
  pole.position.set(cupPos.x, GREEN_Y + 42, cupPos.z);
  pole.castShadow = true;
  courseGroup.add(pole);

  const flagShape = new THREE.Shape();
  flagShape.moveTo(0, 0);
  flagShape.lineTo(42, 13);
  flagShape.lineTo(0, 26);
  flagShape.lineTo(0, 0);
  const flag = new THREE.Mesh(new THREE.ShapeGeometry(flagShape), createMaterial(0xff5d42, 0.58));
  flag.position.set(cupPos.x + 2, GREEN_Y + 72, cupPos.z);
  flag.rotation.y = -0.35;
  flag.castShadow = true;
  courseGroup.add(flag);
}

function addBall() {
  ballMesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_WORLD_RADIUS, 32, 24),
    createMaterial(0xf9f8ec, 0.38),
  );
  ballMesh.castShadow = true;
  courseGroup.add(ballMesh);
}

function addAimHelpers() {
  const material = new THREE.LineDashedMaterial({ color: 0x9af0b7, dashSize: 14, gapSize: 9, linewidth: 2 });
  const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  aimLine = new THREE.Line(geometry, material);
  aimLine.visible = false;
  courseGroup.add(aimLine);

  aimMarker = new THREE.Mesh(
    new THREE.TorusGeometry(17, 2.6, 12, 32),
    new THREE.MeshBasicMaterial({ color: 0x8bf2ad, transparent: true, opacity: 0.9 }),
  );
  aimMarker.rotation.x = Math.PI / 2;
  aimMarker.visible = false;
  courseGroup.add(aimMarker);
}

function addTrees() {
  const rng = makeRng(`${course.key}:trees`);
  for (let i = 0; i < 46; i += 1) {
    let point;
    for (let tries = 0; tries < 20; tries += 1) {
      point = { x: rand(rng, -80, WIDTH + 80), y: rand(rng, -80, HEIGHT + 80) };
      if (fairwayDistance(point) > course.fairwayWidth * 0.9 && distance(point, course.pin) > course.greenRadius + 55) break;
    }
    addTree(point, rand(rng, 32, 58), rand(rng, 0.8, 1.35));
  }
}

function addTree(point, height, spread) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(4 * spread, 6 * spread, height, 8),
    createMaterial(0x65402a, 0.8),
  );
  const pos = world(point, height / 2 - 5);
  trunk.position.set(pos.x, pos.y, pos.z);
  trunk.castShadow = true;
  courseGroup.add(trunk);

  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(22 * spread, 54 * spread, 10),
    createMaterial(0x1d5632, 0.92),
  );
  crown.position.set(pos.x, height + 18 * spread, pos.z);
  crown.castShadow = true;
  crown.receiveShadow = true;
  courseGroup.add(crown);
}

function addRoughDetail() {
  const rng = makeRng(`${course.key}:rough`);
  const material = createMaterial(0x426f34, 0.98);
  material.transparent = true;
  material.opacity = 0.55;
  for (let i = 0; i < 90; i += 1) {
    const point = { x: rand(rng, -60, WIDTH + 60), y: rand(rng, -50, HEIGHT + 50) };
    if (fairwayDistance(point) < course.fairwayWidth * 0.72 || distance(point, course.pin) < course.greenRadius + 38) continue;
    const grass = new THREE.Mesh(
      new THREE.ConeGeometry(rand(rng, 2.4, 5.8), rand(rng, 8, 18), 5),
      material,
    );
    const pos = world(point, rand(rng, 5, 9));
    grass.position.set(pos.x, pos.y, pos.z);
    grass.rotation.y = rand(rng, 0, Math.PI * 2);
    grass.castShadow = true;
    courseGroup.add(grass);
  }
}

function createClubButtons() {
  clubButtons.innerHTML = "";
  CLUBS.forEach((club) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = club.label;
    button.dataset.club = club.id;
    button.setAttribute("aria-pressed", club.id === activeClub.id ? "true" : "false");
    button.addEventListener("click", () => {
      if (ballIsMoving() || holed) return;
      activeClub = club;
      updateClubButtons();
      updateShotInfo();
      draw();
    });
    clubButtons.append(button);
  });
}

function updateClubButtons() {
  clubButtons.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.club === activeClub.id ? "true" : "false");
  });
}

function suggestClub() {
  const yards = yardsBetween(ball, course.pin);
  const onGreen = terrainAt(ball) === "green";
  const options = [...CLUBS].reverse();
  const next = onGreen
    ? CLUBS.find((club) => club.id === "putter")
    : options.find((club) => yards >= club.min && yards <= club.carry + club.roll + 30) || CLUBS[0];
  activeClub = next;
  updateClubButtons();
}

function updateStats() {
  dateLabel.textContent = course.key;
  parLabel.textContent = String(course.par);
  strokeLabel.textContent = String(strokes);
  bestLabel.textContent = loadScore(`daily-golf-best:${course.key}`) || "--";
}

function updatePower(value) {
  const rounded = Math.round(value);
  powerMeter.value = rounded;
  powerLabel.textContent = `${rounded}%`;
}

function updateShotInfo() {
  distanceLabel.textContent = `${yardsBetween(ball, course.pin)} yd`;
  lieLabel.textContent = lieName();
  windLabel.textContent = `${course.wind.mph} mph ${windArrow()}`;
}

function windArrow() {
  const angle = Math.atan2(course.wind.y, course.wind.x);
  const directions = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  const index = Math.round(((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
  return directions[index];
}

function resetRound(keepMessage = false) {
  ball = { x: course.tee.x, y: course.tee.y, vx: 0, vy: 0, target: null };
  lastPlayablePosition = { x: ball.x, y: ball.y };
  strokes = 0;
  holed = false;
  aiming = false;
  aimPoint = null;
  activeClub = CLUBS[0];
  updateStats();
  updatePower(0);
  updateClubButtons();
  updateShotInfo();
  setPlayerView();
  if (!keepMessage) message.textContent = "Drag from the ball to shoot. Drag elsewhere to look around.";
  draw();
}

function screenPoint(event) {
  return { x: event.clientX, y: event.clientY };
}

function ballScreenPoint() {
  if (!ballMesh) return null;
  const rect = canvas.getBoundingClientRect();
  const projected = ballMesh.position.clone().project(camera);
  return {
    x: rect.left + ((projected.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - projected.y) / 2) * rect.height,
  };
}

function isNearVisibleBall(point) {
  const ballPoint = ballScreenPoint();
  if (!ballPoint) return false;
  return pointerDistance(point, ballPoint) <= 74;
}

function aimPointFromScreen(point) {
  const pull = {
    x: shotStartClient.x - point.x,
    y: shotStartClient.y - point.y,
  };
  const drag = Math.max(pointerDistance(shotStartClient, point), 1);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  right.y = 0;
  right.normalize();

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();

  const direction = right.multiplyScalar(pull.x).add(forward.multiplyScalar(-pull.y));
  if (direction.lengthSq() < 0.001) {
    return { ...shotStartBall };
  }
  direction.normalize();
  const distancePixels = Math.min(drag, MAX_DRAG) / MAX_DRAG * 170;
  const startWorld = world(shotStartBall, 0);
  const targetWorld = startWorld.addScaledVector(direction, distancePixels * SCALE);
  return {
    x: targetWorld.x / SCALE + WIDTH / 2,
    y: targetWorld.z / SCALE + HEIGHT / 2,
  };
}

function clientPoint(event) {
  return { x: event.clientX, y: event.clientY };
}

function pointerDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function averagePointer() {
  const points = [...activePointers.values()];
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function pinchDistance() {
  const points = [...activePointers.values()];
  return points.length >= 2 ? pointerDistance(points[0], points[1]) : 0;
}

function startNavigation(event) {
  navMode = activePointers.size >= 2 ? "pinch" : "orbit";
  navStart = {
    pointer: activePointers.size >= 2 ? averagePointer() : clientPoint(event),
    mode: cameraState.mode,
    yaw: cameraState.yaw,
    pitch: cameraState.pitch,
    target: { ...cameraState.target },
    zoom: cameraState.zoom,
    pinch: pinchDistance(),
  };
}

function moveNavigation(event) {
  if (!navMode || !navStart) return;

  if (navMode === "pinch" && activePointers.size >= 2) {
    const center = averagePointer();
    const dx = center.x - navStart.pointer.x;
    const dy = center.y - navStart.pointer.y;
    const ratio = pinchDistance() / Math.max(navStart.pinch, 1);
    cameraState.zoom = clamp(navStart.zoom * ratio, 0.72, 2.25);
    cameraState.target.x = clamp(navStart.target.x - dx * 0.7 / cameraState.zoom, -430, 430);
    cameraState.target.z = clamp(navStart.target.z - dy * 0.7 / cameraState.zoom, -300, 300);
    resizeRenderer();
    message.textContent = "Pinch to zoom. Drag to look around.";
    return;
  }

  const point = clientPoint(event);
  const dx = point.x - navStart.pointer.x;
  const dy = point.y - navStart.pointer.y;
  if (navStart.mode === "player") {
    cameraState.yaw = navStart.yaw - dx * 0.006;
    cameraState.pitch = clamp(navStart.pitch + dy * 0.0016, -0.08, 0.24);
    updateCamera();
    message.textContent = "Looking around from the ball. Drag near the ball to shoot.";
    return;
  }

  const orbiting = event.shiftKey || event.altKey || Math.abs(dx) > Math.abs(dy) * 1.15;

  if (orbiting) {
    cameraState.yaw = navStart.yaw - dx * 0.008;
    cameraState.pitch = clamp(navStart.pitch + dy * 0.004, 0.52, 1.12);
  } else {
    cameraState.target.x = clamp(navStart.target.x - dx * 0.78 / cameraState.zoom, -430, 430);
    cameraState.target.z = clamp(navStart.target.z - dy * 0.78 / cameraState.zoom, -300, 300);
  }
  updateCamera();
  message.textContent = "Drag from the ball to shoot. Drag elsewhere to look around.";
}

function zoomCamera(delta) {
  cameraState.zoom = clamp(cameraState.zoom * (delta > 0 ? 0.9 : 1.1), 0.72, 2.25);
  resizeRenderer();
  message.textContent = "Scroll to zoom. Drag the course to change angle.";
}

function ballIsMoving() {
  return Math.hypot(ball.vx, ball.vy) > 0.1;
}

function startAim(event) {
  if (holed || ballIsMoving()) return;
  const point = screenPoint(event);
  activePointers.set(event.pointerId, point);
  if (activePointers.size >= 2) {
    aiming = false;
    startNavigation(event);
    return;
  }
  if (!isNearVisibleBall(point)) {
    startNavigation(event);
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  aiming = true;
  navMode = null;
  shotStartClient = point;
  shotStartBall = { x: ball.x, y: ball.y };
  aimPoint = aimPointFromScreen(point);
  canvas.setPointerCapture(event.pointerId);
  message.textContent = "Pull back from the ball, then release.";
}

function moveAim(event) {
  const point = screenPoint(event);
  activePointers.set(event.pointerId, point);
  if (navMode) {
    moveNavigation(event);
    return;
  }
  if (!aiming) return;
  aimPoint = aimPointFromScreen(point);
  updatePower(clamp(pointerDistance(shotStartClient, point) / MAX_DRAG, 0, 1) * 100);
  draw();
}

function releaseAim(event) {
  const point = screenPoint(event);
  activePointers.delete(event.pointerId);
  if (navMode) {
    if (activePointers.size === 0) {
      navMode = null;
      navStart = null;
    } else {
      startNavigation(event);
    }
    return;
  }
  if (!aiming) return;
  aiming = false;
  aimPoint = aimPointFromScreen(point);
  const drag = Math.min(pointerDistance(shotStartClient, point), MAX_DRAG);
  if (drag > 8) playShot(drag / MAX_DRAG);
  shotStartClient = null;
  shotStartBall = null;
  updatePower(0);
  draw();
}

function playShot(power) {
  const aimAngle = Math.atan2(aimPoint.y - ball.y, aimPoint.x - ball.x);
  const lieFactor = liePowerFactor();
  const windPush = activeClub.id === "putter" ? 0 : course.wind.mph * 0.9;
  const carryPixels = (activeClub.carry * power * lieFactor) / YARDS_PER_PIXEL;
  const rollPixels = (activeClub.roll * (0.55 + power * 0.45) * lieFactor) / YARDS_PER_PIXEL;
  const miss = (1 - activeClub.accuracy) * 34 + (1 - power) * 18;
  const drift = {
    x: course.wind.x * windPush + Math.sin(aimAngle) * miss,
    y: course.wind.y * windPush - Math.cos(aimAngle) * miss,
  };
  const total = carryPixels + rollPixels;
  ball.target = {
    x: clamp(ball.x + Math.cos(aimAngle) * total + drift.x, -32, WIDTH + 32),
    y: clamp(ball.y + Math.sin(aimAngle) * total + drift.y, -32, HEIGHT + 32),
  };
  const speed = activeClub.id === "putter" ? 10 : 18;
  ball.vx = Math.cos(aimAngle) * speed;
  ball.vy = Math.sin(aimAngle) * speed;
  strokes += 1;
  updateStats();
  message.textContent = `${activeClub.label} away.`;
  tick();
}

function tick() {
  cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(() => {
    stepPhysics();
    draw();
    if (ballIsMoving()) {
      tick();
      return;
    }
    settleBall();
  });
}

function stepPhysics() {
  const target = ball.target || ball;
  const dx = target.x - ball.x;
  const dy = target.y - ball.y;
  const remaining = Math.hypot(dx, dy);
  const speed = Math.max(Math.hypot(ball.vx, ball.vy) * 0.965, 0.12);
  const previous = { x: ball.x, y: ball.y };

  if (remaining <= speed) {
    ball.x = target.x;
    ball.y = target.y;
    ball.vx = 0;
    ball.vy = 0;
    ball.target = null;
    return;
  }

  ball.vx = (dx / remaining) * speed;
  ball.vy = (dy / remaining) * speed;
  ball.x += ball.vx;
  ball.y += ball.vy;

  const crossedCup = distancePointToSegment(course.pin, previous, ball) <= CUP_RADIUS * 1.35;
  const cupSpeedLimit = activeClub.id === "putter" ? 11.5 : 8.5;
  const onGreenLine = distance(previous, course.pin) <= course.greenRadius * 1.35 || distance(ball, course.pin) <= course.greenRadius * 1.35;
  if ((crossedCup || distance(ball, course.pin) <= CUP_RADIUS * 1.5) && speed <= cupSpeedLimit && onGreenLine) {
    ball.x = course.pin.x;
    ball.y = course.pin.y;
    ball.vx = 0;
    ball.vy = 0;
    ball.target = null;
    finishHole();
  }
}

function settleBall() {
  if (holed) return;
  const terrain = terrainAt(ball);
  if (terrain === "water" || terrain === "out") {
    ball.x = lastPlayablePosition.x;
    ball.y = lastPlayablePosition.y;
    strokes += 1;
    updateStats();
    updateShotInfo();
    if (cameraState.mode === "player") setPlayerView();
    message.textContent = terrain === "water" ? "Water penalty. Dropped at your last lie." : "Out of bounds. One-stroke penalty.";
    draw();
    return;
  }

  lastPlayablePosition = { x: ball.x, y: ball.y };
  suggestClub();
  updateShotInfo();
  if (cameraState.mode === "player") setPlayerView();
  const lie = lieName().toLowerCase();
  message.textContent = lie === "green" ? "On the green. Time to putt." : `Ball came to rest in the ${lie}.`;
}

function finishHole() {
  if (holed) return;
  holed = true;
  const key = `daily-golf-best:${course.key}`;
  const best = Number(loadScore(key));
  if (!best || strokes < best) {
    saveScore(key, String(strokes));
    message.textContent = `Holed in ${strokes}. New daily best.`;
  } else {
    message.textContent = `Holed in ${strokes}. Daily best: ${best}.`;
  }
  updateStats();
  updateShotInfo();
}

function ballHeight() {
  const terrain = terrainAt(ball);
  if (terrain === "sand") return SURFACE_Y - 0.5 + BALL_WORLD_RADIUS;
  if (terrain === "green") return GREEN_Y + 0.8 + BALL_WORLD_RADIUS;
  if (terrain === "fairway") return SURFACE_Y + 0.8 + BALL_WORLD_RADIUS;
  return 1.2 + BALL_WORLD_RADIUS;
}

function updateBallMesh() {
  const pos = world(ball, ballHeight());
  ballMesh.position.set(pos.x, pos.y, pos.z);
  ballMesh.rotation.x += ball.vy * 0.03;
  ballMesh.rotation.z -= ball.vx * 0.03;
}

function updateAimHelpers() {
  if (!aiming || !aimPoint) {
    aimLine.visible = false;
    aimMarker.visible = false;
    return;
  }

  const drag = Math.min(distance(ball, aimPoint), MAX_DRAG);
  const angle = Math.atan2(aimPoint.y - ball.y, aimPoint.x - ball.x);
  const projectedYards = Math.round((activeClub.carry + activeClub.roll) * (drag / MAX_DRAG) * liePowerFactor());
  const target = {
    x: ball.x + Math.cos(angle) * (projectedYards / YARDS_PER_PIXEL),
    y: ball.y + Math.sin(angle) * (projectedYards / YARDS_PER_PIXEL),
  };
  const start = world(ball, 46);
  const end = world(target, 46);
  aimLine.geometry.setFromPoints([start, end]);
  aimLine.computeLineDistances();
  aimLine.visible = true;
  aimMarker.position.set(end.x, end.y - 8, end.z);
  aimMarker.visible = true;
}

function draw() {
  updateBallMesh();
  updateAimHelpers();
  renderer.render(scene, camera);
}

function renderLoop() {
  renderLoopId = requestAnimationFrame(renderLoop);
  const t = performance.now() * 0.001;
  waterMeshes.forEach((mesh, index) => {
    mesh.position.y += Math.sin(t * 1.6 + index) * 0.006;
    mesh.rotation.z += 0.0008 * (index % 2 === 0 ? 1 : -1);
    if (mesh.material && "opacity" in mesh.material && index > 0) {
      mesh.material.opacity = 0.18 + Math.sin(t * 1.3 + index) * 0.08;
    }
  });
  draw();
}

function bindEvents() {
  canvas.addEventListener("pointerdown", startAim);
  canvas.addEventListener("pointermove", moveAim);
  canvas.addEventListener("pointerup", releaseAim);
  canvas.addEventListener("pointerleave", releaseAim);
  canvas.addEventListener("pointercancel", () => {
    aiming = false;
    navMode = null;
    navStart = null;
    activePointers.clear();
    updatePower(0);
    draw();
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomCamera(event.deltaY);
    },
    { passive: false },
  );

  resetButton.addEventListener("click", () => {
    if (ballIsMoving() || holed) return;
    ball.x = lastPlayablePosition.x;
    ball.y = lastPlayablePosition.y;
    ball.vx = 0;
    ball.vy = 0;
    ball.target = null;
    suggestClub();
    updateShotInfo();
    message.textContent = "Returned to your last lie.";
    draw();
  });

  newRoundButton.addEventListener("click", () => resetRound());

  shareButton.addEventListener("click", async () => {
    const relation = strokes - course.par;
    const scoreText = relation === 0 ? "E" : relation > 0 ? `+${relation}` : String(relation);
    const result = holed ? `${strokes} strokes (${scoreText})` : `${strokes} strokes so far`;
    const text = `Daily Golf ${course.key}: ${result} on a ${course.holeYards} yd par ${course.par}.`;
    try {
      await navigator.clipboard.writeText(text);
      message.textContent = "Result copied. Send it to a friend.";
    } catch {
      message.textContent = text;
    }
  });

  playButton.addEventListener("click", () => {
    introModal.hidden = true;
  });

  introModal.addEventListener("click", (event) => {
    if (event.target === playButton) introModal.hidden = true;
  });

  helpButton.addEventListener("click", () => {
    introModal.hidden = false;
  });

  viewModeButton.addEventListener("click", () => {
    if (cameraState.mode === "player") {
      setBirdView();
      message.textContent = "Bird view. Drag to navigate the hole; scroll or pinch to zoom.";
    } else {
      setPlayerView();
      message.textContent = "Player view. Drag near the ball to shoot.";
    }
  });

  resetViewButton.addEventListener("click", () => {
    setPlayerView();
    message.textContent = "View reset behind the ball.";
  });
}
