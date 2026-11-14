import * as THREE from 'three';
import { MATURITY_AGE } from './config.js';
import { WATER_H } from './world.js';
import { clamp } from './rng.js';

const TOOL_KEYS = ['inspect', 'move', 'feed', 'paint-2', 'paint-3', 'paint-0', 'paint-1', 'paint-4', 'paint-5'];

export function setupInput({ renderer, camera, controls, scene, game, actions, state }) {
    const el = renderer.domElement;
    const container = el.parentElement;
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const seaPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_H);
    const tmp = new THREE.Vector3();
    const keys = new Set();

    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.04, 1));
    const hover = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }));
    hover.visible = false;
    scene.add(hover);
    const selBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xf0b04a }));
    selBox.visible = false;
    scene.add(selBox);
    const ringGeo = new THREE.RingGeometry(0.44, 0.54, 40);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xf0b04a, transparent: true, opacity: 0.95, depthWrite: false }));
    ring.renderOrder = 5;
    ring.visible = false;
    scene.add(ring);

    let dragging = null;
    let painting = false;
    let lastPaint = null;
    let hoverTile = null;

    function setRay(e) {
        const r = el.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, camera);
    }

    function pickCreature() {
        const hits = ray.intersectObjects(game.creatures.map(c => c.hit), false);
        return hits.length ? hits[0].object.userData.creature : null;
    }

    function pickTile() {
        const hits = ray.intersectObjects(game.world.meshes, false);
        if (hits.length) return { tile: hits[0].object.userData.tile, point: hits[0].point };
        if (ray.ray.intersectPlane(seaPlane, tmp)) return { tile: game.world.tileAt(tmp.x, tmp.z), point: tmp.clone() };
        return null;
    }

    function paintAt(tile) {
        if (!tile || tile === lastPaint) return;
        lastPaint = tile;
        game.paint(tile, +state.tool.split('-')[1]);
    }

    el.addEventListener('contextmenu', e => e.preventDefault());

    el.addEventListener('pointerdown', e => {
        if (e.button !== 0 || e.shiftKey || !game.world || state.overlay) return;
        setRay(e);
        const tool = state.tool;
        if (tool === 'inspect') {
            const c = pickCreature();
            if (c) { actions.select({ creature: c }); return; }
            const hit = pickTile();
            actions.select(hit && hit.tile ? { tile: hit.tile } : null);
        } else if (tool === 'move') {
            const c = pickCreature();
            if (!c) return;
            dragging = c;
            c.cancelPlans();
            c.dragged = true;
            c.status = 'Being carried';
            container.classList.add('dragging');
            actions.select({ creature: c });
            el.setPointerCapture(e.pointerId);
        } else if (tool === 'feed') {
            const hit = pickTile();
            if (hit && hit.tile) game.feed(hit.tile);
        } else if (tool.startsWith('paint')) {
            painting = true;
            lastPaint = null;
            el.setPointerCapture(e.pointerId);
            const hit = pickTile();
            if (hit) paintAt(hit.tile);
        }
    });

    el.addEventListener('pointermove', e => {
        if (!game.world) return;
        setRay(e);
        const hit = pickTile();
        hoverTile = hit ? hit.tile : null;
        if (dragging && hit) {
            dragging.x = clamp(hit.point.x, 0, game.world.size - 1);
            dragging.z = clamp(hit.point.z, 0, game.world.size - 1);
        }
        if (painting && hit) paintAt(hit.tile);
    });

    const endDrag = () => {
        if (dragging) {
            dragging.dragged = false;
            dragging.cancelPlans();
            dragging.status = 'Looking around';
            dragging = null;
            container.classList.remove('dragging');
        }
        painting = false;
        lastPaint = null;
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    el.addEventListener('pointerleave', () => { hoverTile = null; });

    window.addEventListener('keydown', e => {
        if (e.target instanceof HTMLInputElement) return;
        if (e.key === 'Shift') controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
        if (state.overlay) return;
        const k = e.key.toLowerCase();
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (k >= '1' && k <= '9') actions.setTool(TOOL_KEYS[+k - 1]);
        else if (k === ' ') { e.preventDefault(); actions.togglePause(); }
        else if (k === 'escape') actions.select(null);
        else if (k === 'f') actions.toggleFollow();
        else if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
            e.preventDefault();
            keys.add(k);
        }
    });
    window.addEventListener('keyup', e => {
        if (e.key === 'Shift') controls.mouseButtons.LEFT = null;
        keys.delete(e.key.toLowerCase());
    });
    window.addEventListener('blur', () => {
        keys.clear();
        controls.mouseButtons.LEFT = null;
        endDrag();
    });

    const fwd = new THREE.Vector3();
    const right = new THREE.Vector3();
    const move = new THREE.Vector3();

    function shiftView(v) {
        controls.target.add(v);
        camera.position.add(v);
        const s = game.world.size;
        const cx = clamp(controls.target.x, -2, s + 1), cz = clamp(controls.target.z, -2, s + 1);
        const fix = new THREE.Vector3(cx - controls.target.x, 0, cz - controls.target.z);
        controls.target.add(fix);
        camera.position.add(fix);
    }

    return {
        update(dt) {
            if (!game.world) return;
            if (keys.size) {
                fwd.subVectors(controls.target, camera.position).setY(0).normalize();
                right.crossVectors(fwd, camera.up).normalize();
                move.set(0, 0, 0);
                if (keys.has('w') || keys.has('arrowup')) move.add(fwd);
                if (keys.has('s') || keys.has('arrowdown')) move.sub(fwd);
                if (keys.has('d') || keys.has('arrowright')) move.add(right);
                if (keys.has('a') || keys.has('arrowleft')) move.sub(right);
                if (move.lengthSq() > 0) {
                    move.normalize().multiplyScalar(14 * dt / camera.zoom);
                    shiftView(move);
                    game.follow = false;
                }
            }

            const sel = game.selected;
            const c = sel && sel.creature;
            if (c && !c.dead) {
                ring.visible = true;
                ring.position.set(c.root.position.x, c.root.position.y + 0.03, c.root.position.z);
                ring.scale.setScalar(c.genes.size * (0.45 + 0.55 * Math.min(1, c.age / MATURITY_AGE)) * 1.1);
                ring.rotation.y += dt * 1.5;
                if (game.follow) {
                    move.set(c.x - controls.target.x, 0, c.z - controls.target.z).multiplyScalar(Math.min(1, dt * 4));
                    shiftView(move);
                }
            } else {
                ring.visible = false;
                if (game.follow) game.follow = false;
            }

            if (sel && sel.tile) {
                selBox.visible = true;
                selBox.position.set(sel.tile.x, sel.tile.rh + 0.02, sel.tile.z);
            } else {
                selBox.visible = false;
            }

            const showHover = hoverTile && !dragging && state.tool !== 'move' && !state.overlay;
            hover.visible = !!showHover;
            if (showHover) {
                hover.position.set(hoverTile.x, hoverTile.rh + 0.02, hoverTile.z);
                const color = state.tool.startsWith('paint') ? 0xf0b04a : state.tool === 'feed' ? 0x9bd36e : 0xffffff;
                hover.material.color.setHex(color);
                hover.scale.setScalar(state.tool === 'feed' ? 3 : 1);
                hover.scale.y = 1;
            }
        }
    };
}
