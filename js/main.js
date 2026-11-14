import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { setupInput } from './input.js';
import { SIM_STEP } from './config.js';
import { randomSeed, clamp } from './rng.js';

const container = document.getElementById('game');

let renderer;
try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (e) {
    document.body.innerHTML = '<p style="padding:24px">PGNome needs WebGL. Please try a current browser.</p>';
    throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1f5a80);

const VIEW = 13;
const aspect = () => window.innerWidth / window.innerHeight;
const camera = new THREE.OrthographicCamera(-VIEW * aspect(), VIEW * aspect(), VIEW, -VIEW, -800, 1500);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
controls.minZoom = 0.5;
controls.maxZoom = 4;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = 1.2;
controls.screenSpacePanning = false;
controls.zoomSpeed = 1.2;

const hemi = new THREE.HemisphereLight(0xdfeaf5, 0x40503c, 1.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 120;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);

const game = new Game(scene);
const state = { tool: 'inspect', overlay: true };

const summerSun = new THREE.Color(0xffe6bf), winterSun = new THREE.Color(0xdde7ff);
const summerSky = new THREE.Color(0xe4eef5), winterSky = new THREE.Color(0xc9d6e6);

function frameCamera() {
    const c = game.world.center;
    controls.target.set(c, 0.8, c);
    camera.position.set(c + 30, 30, c + 30);
    camera.zoom = window.innerWidth < 900 ? Math.max(0.5, Math.min(0.8, aspect())) : 0.9;
    camera.updateProjectionMatrix();
    sun.position.set(c + 16, 30, c + 6);
    sun.target.position.set(c, 0, c);
    controls.update();
}

function applyEnvironment() {
    if (!game.world) return;
    const t = game.seasonTemp;
    const snow = clamp((-t - 9) / 12, 0, 1) * 0.72;
    const ice = clamp((-t - 14) / 10, 0, 1) * 0.35;
    game.world.applySeason(snow, ice);
    scene.background.copy(game.world.materials[0].color);
    const warm = clamp((t + 24) / 42, 0, 1);
    sun.color.copy(winterSun).lerp(summerSun, warm);
    sun.intensity = 1.9 + warm * 0.6;
    hemi.color.copy(winterSky).lerp(summerSky, warm);
}

function parseSeed(text) {
    const s = String(text || '').trim();
    if (!s) return randomSeed();
    if (/^\d+$/.test(s)) return +s % 1e9;
    let h = 0;
    for (const ch of s) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
    return h % 1e9;
}

const actions = {
    setTool(tool) {
        state.tool = tool;
        ui.setTool(tool);
    },
    setSpeed(v) {
        if (v === 0) game.paused = true;
        else { game.paused = false; game.speed = v; }
        ui.setSpeed(game.paused, game.speed);
    },
    togglePause() {
        if (game.extinct) return;
        game.paused = !game.paused;
        ui.setSpeed(game.paused, game.speed);
    },
    spawnPair() {
        if (!game.world) return;
        const sel = game.selected;
        const at = sel && sel.tile ? sel.tile : controls.target;
        game.spawnFounders(2, at.x, at.z);
        game.log('Two wild Nomes join the island.', 'world');
    },
    showStart() {
        game.save();
        state.overlay = true;
        ui.showStart(!!Game.loadSaved());
    },
    newWorld(seedText) {
        game.newWorld(parseSeed(seedText));
        start();
    },
    continueSaved() {
        const data = Game.loadSaved();
        if (!data) { actions.newWorld(''); return; }
        game.load(data);
        start();
    },
    reseed() {
        game.extinct = false;
        game.spawnFounders(8);
        game.log('Eight wild Nomes wash ashore.', 'world');
        start(false);
    },
    select(sel) {
        game.selected = sel;
        if (!sel || !sel.creature) game.follow = false;
        ui.renderSelection(true);
    },
    toggleFollow() {
        const c = game.selected && game.selected.creature;
        game.follow = !!c && !c.dead && !game.follow;
    }
};

function start(reframe = true) {
    if (reframe) frameCamera();
    state.overlay = false;
    game.paused = false;
    game.speed = game.speed || 1;
    ui.hideOverlays();
    ui.setSpeed(game.paused, game.speed);
}

const ui = new UI(game, actions);
const input = setupInput({ renderer, camera, controls, scene, game, actions, state });
ui.setTool(state.tool);

window.addEventListener('resize', () => {
    camera.left = -VIEW * aspect();
    camera.right = VIEW * aspect();
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
window.addEventListener('beforeunload', () => game.save());
document.addEventListener('visibilitychange', () => { if (document.hidden) game.save(); });

// A world is generated behind the start screen so the island is visible right away.
const saved = Game.loadSaved();
if (saved) game.load(saved);
else game.newWorld(randomSeed());
frameCamera();
ui.showStart(!!saved);

let acc = 0, last = performance.now(), uiTimer = 0, plantTimer = 0, saveTimer = 0;
function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (game.world && !game.paused && !state.overlay) {
        acc += dt * game.speed;
        let steps = 0;
        while (acc >= SIM_STEP && steps < 40) {
            game.step(SIM_STEP);
            acc -= SIM_STEP;
            steps++;
        }
        if (steps >= 40) acc = 0;
    }
    game.animate(dt);
    plantTimer -= dt;
    if (plantTimer <= 0 && game.world) {
        plantTimer = 0.25;
        game.world.updatePlants();
    }
    applyEnvironment();
    input.update(dt);
    controls.update();
    renderer.render(scene, camera);
    uiTimer -= dt;
    if (uiTimer <= 0) {
        uiTimer = 0.25;
        ui.update(0.25);
    }
    saveTimer += dt;
    if (saveTimer > 20) {
        saveTimer = 0;
        if (!state.overlay) game.save();
    }
}
requestAnimationFrame(frame);

// Handy for debugging in the console.
window.pgnome = { game, actions, camera, controls };
