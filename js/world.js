import * as THREE from 'three';
import { MAP_SIZE, BIOMES, B } from './config.js';
import { makeNoise, mulberry32, clamp } from './rng.js';

export const WATER_H = 0.3;
const tileGeo = new THREE.BoxGeometry(1, 1, 1);
tileGeo.translate(0, 0.5, 0);

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const dryColor = new THREE.Color(0x9a8a4e);
const lushColor = new THREE.Color(0x4f9e35);
const berryColor = new THREE.Color(0xe8c547);
const tmpC = new THREE.Color();

export function isWalkable(t) {
    return !!t && BIOMES[t.biome].walkable;
}

export class World {
    constructor(scene, seed, saved = null) {
        this.scene = scene;
        this.seed = seed;
        this.size = saved ? Math.round(Math.sqrt(saved.length)) : MAP_SIZE;
        this.tiles = [];
        this.meshes = [];
        this.animating = new Set();
        this.group = new THREE.Group();
        scene.add(this.group);

        this.baseColors = BIOMES.map(b => new THREE.Color(b.color));
        this.snowColor = new THREE.Color(0xeef3f6);
        this.iceColor = new THREE.Color(0xb7d3e3);
        this.materials = BIOMES.map((b, i) => new THREE.MeshStandardMaterial({
            color: b.color,
            roughness: i === B.WATER ? 0.35 : 0.92,
            metalness: 0
        }));

        if (saved) this.restore(saved);
        else this.generate();

        const n = this.size * this.size;
        this.bfsDist = new Int16Array(n);
        this.bfsPrev = new Int32Array(n);
        this.bfsStamp = new Uint32Array(n);
        this.bfsGen = 0;
        this.bfsQueue = new Int32Array(n);

        this.buildMeshes();
        this.buildDecor();
    }

    idx(x, z) { return z * this.size + x; }

    get(x, z) {
        if (x < 0 || z < 0 || x >= this.size || z >= this.size) return null;
        return this.tiles[z * this.size + x];
    }

    tileAt(px, pz) {
        return this.get(Math.round(px), Math.round(pz));
    }

    get center() { return (this.size - 1) / 2; }

    generate() {
        const elevation = makeNoise(this.seed);
        const wetness = makeNoise(this.seed + 7919);
        const rand = mulberry32(this.seed + 17);
        const s = this.size, c = (s - 1) / 2;
        for (let z = 0; z < s; z++) {
            for (let x = 0; x < s; x++) {
                const nx = x / s, nz = z / s;
                const dx = (x - c) / c, dz = (z - c) / c;
                const d = Math.sqrt(dx * dx + dz * dz);
                const e = elevation(nx * 3.4, nz * 3.4, 4) * 0.95 + 0.11 - Math.pow(d, 2.6) * 0.45;
                const m = wetness(nx * 3 + 40, nz * 3 + 40, 3);

                let biome = B.MEADOW;
                if (e < 0.36) biome = B.WATER;
                else if (e < 0.4) biome = B.SAND;
                else if (e > 0.7) biome = B.ROCK;
                else if (m > 0.6 && e < 0.52) biome = B.MARSH;
                else if (m > 0.53) biome = B.FOREST;
                else if (m < 0.36) biome = B.SAND;

                let height = WATER_H;
                if (biome !== B.WATER) {
                    height = 0.55 + Math.round((e - 0.36) * 12) * 0.25;
                    if (biome === B.ROCK) height += 0.25;
                }
                const food = BIOMES[biome].food * (0.5 + rand() * 0.5);
                this.tiles.push({ i: this.tiles.length, x, z, biome, height, rh: height, food, jitter: rand() });
            }
        }
    }

    restore(saved) {
        const rand = mulberry32(this.seed + 17);
        saved.forEach(([biome, height, food], i) => {
            const x = i % this.size, z = Math.floor(i / this.size);
            this.tiles.push({ i, x, z, biome, height, rh: height, food, jitter: rand() });
        });
    }

    serialize() {
        return this.tiles.map(t => [t.biome, Math.round(t.height * 100) / 100, Math.round(t.food * 100) / 100]);
    }

    buildMeshes() {
        for (const t of this.tiles) {
            const mesh = new THREE.Mesh(tileGeo, this.materials[t.biome]);
            mesh.position.set(t.x, 0, t.z);
            mesh.scale.y = t.rh;
            mesh.castShadow = t.biome !== B.WATER;
            mesh.receiveShadow = true;
            // Water tiles stay invisible: the sea plane draws them, but they still catch clicks.
            mesh.visible = t.biome !== B.WATER;
            mesh.userData.tile = t;
            this.group.add(mesh);
            this.meshes[t.i] = mesh;
        }

        // The sea around the island shares the water material, so lakes and sea read as one.
        const sea = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), this.materials[B.WATER]);
        sea.rotation.x = -Math.PI / 2;
        sea.position.set(this.center, WATER_H, this.center);
        sea.receiveShadow = false;
        this.group.add(sea);
        this.sea = sea;
    }

    buildDecor() {
        const n = this.tiles.length;
        const trunkGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.3, 6);
        trunkGeo.translate(0, 0.15, 0);
        const crownGeo = new THREE.ConeGeometry(0.28, 0.7, 7);
        crownGeo.translate(0, 0.6, 0);
        const rockGeo = new THREE.DodecahedronGeometry(0.2, 0);
        rockGeo.translate(0, 0.08, 0);
        const bushGeo = new THREE.IcosahedronGeometry(0.22, 0);
        bushGeo.translate(0, 0.12, 0);

        this.crownMat = new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 0.85, flatShading: true });
        this.crownBase = new THREE.Color(0x2f6b34);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 });
        const rockMat = new THREE.MeshStandardMaterial({ color: 0x777b80, roughness: 1, flatShading: true });
        const bushMat = new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true });

        const make = (geo, mat) => {
            const im = new THREE.InstancedMesh(geo, mat, n);
            im.castShadow = true;
            im.receiveShadow = true;
            im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            for (let i = 0; i < n; i++) im.setMatrixAt(i, HIDDEN);
            this.group.add(im);
            return im;
        };
        this.trunks = make(trunkGeo, trunkMat);
        this.crowns = make(crownGeo, this.crownMat);
        this.rocks = make(rockGeo, rockMat);
        this.bushes = make(bushGeo, bushMat);
        for (let i = 0; i < n; i++) this.bushes.setColorAt(i, lushColor);

        for (const t of this.tiles) this.updateDecor(t);
        this.updatePlants();
    }

    updateDecor(t) {
        const j = t.jitter;
        const top = t.rh;
        if (t.biome === B.FOREST) {
            const s = 0.8 + j * 0.5;
            tmpP.set(t.x + (j - 0.5) * 0.3, top, t.z + (0.5 - j) * 0.2);
            tmpQ.setFromAxisAngle(UP, j * 6.28);
            tmpS.set(s, s, s);
            tmpM.compose(tmpP, tmpQ, tmpS);
            this.trunks.setMatrixAt(t.i, tmpM);
            this.crowns.setMatrixAt(t.i, tmpM);
        } else {
            this.trunks.setMatrixAt(t.i, HIDDEN);
            this.crowns.setMatrixAt(t.i, HIDDEN);
        }
        if (t.biome === B.ROCK && j > 0.3) {
            const s = 0.7 + j * 0.9;
            tmpP.set(t.x + (0.5 - j) * 0.4, top, t.z + (j - 0.5) * 0.4);
            tmpQ.setFromAxisAngle(UP, j * 12.0);
            tmpS.set(s, s * 0.8, s);
            tmpM.compose(tmpP, tmpQ, tmpS);
            this.rocks.setMatrixAt(t.i, tmpM);
        } else {
            this.rocks.setMatrixAt(t.i, HIDDEN);
        }
        this.trunks.instanceMatrix.needsUpdate = true;
        this.crowns.instanceMatrix.needsUpdate = true;
        this.rocks.instanceMatrix.needsUpdate = true;
        this.setBush(t);
        this.bushes.instanceMatrix.needsUpdate = true;
    }

    setBush(t) {
        const cap = BIOMES[t.biome].food;
        if (cap <= 0 || t.food < 0.04) {
            this.bushes.setMatrixAt(t.i, HIDDEN);
            return;
        }
        const full = clamp(t.food / Math.max(cap, 0.3), 0, 2.2);
        const s = 0.35 + Math.min(full, 1) * 0.75 + Math.max(0, full - 1) * 0.35;
        const off = t.biome === B.FOREST ? 0.28 : 0.12;
        tmpP.set(t.x + (0.5 - t.jitter) * off * 2, t.rh, t.z + off);
        tmpQ.setFromAxisAngle(UP, t.jitter * 9);
        tmpS.set(s, s * 0.85, s);
        tmpM.compose(tmpP, tmpQ, tmpS);
        this.bushes.setMatrixAt(t.i, tmpM);
        tmpC.copy(dryColor).lerp(lushColor, Math.min(full, 1));
        if (full > 1) tmpC.lerp(berryColor, Math.min(1, (full - 1) * 0.8));
        this.bushes.setColorAt(t.i, tmpC);
    }

    updatePlants() {
        for (const t of this.tiles) this.setBush(t);
        this.bushes.instanceMatrix.needsUpdate = true;
        if (this.bushes.instanceColor) this.bushes.instanceColor.needsUpdate = true;
    }

    grow(dt, growth) {
        for (const t of this.tiles) {
            const b = BIOMES[t.biome];
            if (t.food < b.food) {
                t.food = Math.min(b.food, t.food + b.food * b.regrow * growth * dt + 0.0004 * growth * dt);
            } else if (t.food > b.food) {
                t.food -= (t.food - b.food) * 0.015 * dt;
            }
        }
    }

    climate(t, seasonTemp) {
        const b = BIOMES[t.biome];
        return { temp: b.temp - (t.height - 0.8) * 8 + seasonTemp, moisture: b.moisture };
    }

    setBiome(t, biome) {
        if (!t || t.biome === biome) return false;
        const prev = t.biome;
        t.biome = biome;
        if (biome === B.WATER) t.height = WATER_H;
        else if (prev === B.WATER) t.height = 0.8;
        if (biome === B.ROCK) t.height = Math.min(t.height + 0.5, 3.3);
        else if (prev === B.ROCK) t.height = Math.max(0.8, t.height - 0.5);
        t.food = Math.min(t.food, BIOMES[biome].food * 0.3);
        const mesh = this.meshes[t.i];
        mesh.material = this.materials[biome];
        mesh.castShadow = biome !== B.WATER;
        if (biome !== B.WATER) mesh.visible = true;
        this.animating.add(t);
        this.updateDecor(t);
        return true;
    }

    feed(t) {
        if (!isWalkable(t)) return false;
        for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
                const n = this.get(t.x + dx, t.z + dz);
                if (!isWalkable(n)) continue;
                const add = dx === 0 && dz === 0 ? 1.4 : 0.5;
                n.food = Math.min(2.5, n.food + add);
                this.setBush(n);
            }
        }
        this.bushes.instanceMatrix.needsUpdate = true;
        if (this.bushes.instanceColor) this.bushes.instanceColor.needsUpdate = true;
        return true;
    }

    animate(dt) {
        for (const t of this.animating) {
            const diff = t.height - t.rh;
            if (Math.abs(diff) < 0.01) {
                t.rh = t.height;
                this.animating.delete(t);
                if (t.biome === B.WATER) this.meshes[t.i].visible = false;
            } else {
                t.rh += diff * Math.min(1, dt * 7);
            }
            this.meshes[t.i].scale.y = t.rh;
            this.updateDecor(t);
        }
    }

    applySeason(snow, ice) {
        BIOMES.forEach((b, i) => {
            const target = i === B.WATER ? this.iceColor : this.snowColor;
            const amount = i === B.WATER ? ice : snow * b.snow;
            this.materials[i].color.copy(this.baseColors[i]).lerp(target, amount);
        });
        this.crownMat.color.copy(this.crownBase).lerp(this.snowColor, snow * 0.55);
    }

    // Breadth-first search over walkable tiles. The start tile may be water,
    // so a Nome dropped into a lake can still find the shore.
    bfs(start, maxDepth) {
        const gen = ++this.bfsGen;
        const q = this.bfsQueue;
        let head = 0, tail = 0;
        q[tail++] = start.i;
        this.bfsStamp[start.i] = gen;
        this.bfsDist[start.i] = 0;
        this.bfsPrev[start.i] = -1;
        const s = this.size;
        while (head < tail) {
            const i = q[head++];
            const d = this.bfsDist[i];
            if (d >= maxDepth) continue;
            const x = i % s, z = (i - x) / s;
            for (let k = 0; k < 8; k++) {
                const dx = DIRS[k][0], dz = DIRS[k][1];
                const nx = x + dx, nz = z + dz;
                if (nx < 0 || nz < 0 || nx >= s || nz >= s) continue;
                const ni = nz * s + nx;
                if (this.bfsStamp[ni] === gen) continue;
                if (!BIOMES[this.tiles[ni].biome].walkable) continue;
                if (dx !== 0 && dz !== 0) {
                    if (!BIOMES[this.tiles[z * s + nx].biome].walkable || !BIOMES[this.tiles[nz * s + x].biome].walkable) continue;
                }
                this.bfsStamp[ni] = gen;
                this.bfsDist[ni] = d + 1;
                this.bfsPrev[ni] = i;
                q[tail++] = ni;
            }
        }
        return q.subarray(0, tail);
    }

    reached(i) { return this.bfsStamp[i] === this.bfsGen; }

    pathTo(i) {
        const path = [];
        while (i !== -1 && this.bfsPrev[i] !== -1) {
            path.push(this.tiles[i]);
            i = this.bfsPrev[i];
        }
        return path.reverse();
    }

    dispose() {
        this.scene.remove(this.group);
        this.group.traverse(o => {
            if (o.isInstancedMesh) o.dispose();
            if (o.geometry && o.geometry !== tileGeo) o.geometry.dispose();
        });
        this.materials.forEach(m => m.dispose());
        this.crownMat.dispose();
    }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
