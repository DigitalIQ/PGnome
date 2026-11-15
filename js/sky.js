import * as THREE from 'three';
import { isWalkable } from './world.js';

const HALF = 24, TOP = 16;
const rnd = (a, b) => a + Math.random() * (b - a);

// A cloud of points that wraps around a box centered on the view.
function pointField(scene, n, mat, yMax = TOP) {
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
        pos[i * 3] = rnd(-HALF, HALF);
        pos[i * 3 + 1] = rnd(0, yMax);
        pos[i * 3 + 2] = rnd(-HALF, HALF);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    const obj = new THREE.Points(geo, mat);
    obj.frustumCulled = false;
    obj.renderOrder = 8;
    obj.visible = false;
    scene.add(obj);
    return { obj, pos, n, yMax };
}

function wrap(v) {
    if (v > HALF) return v - HALF * 2;
    if (v < -HALF) return v + HALF * 2;
    return v;
}

// Everything in the sky: rain, snow, hail, dust, leaves, fireflies, clouds,
// rainbow, northern lights and lightning bolts.
export class Sky {
    constructor(scene) {
        this.scene = scene;
        this.time = 0;

        // Rain as short streaks.
        this.RAIN = 2200;
        const rainPos = new Float32Array(this.RAIN * 6);
        this.rainSeed = new Float32Array(this.RAIN * 3);
        for (let i = 0; i < this.RAIN; i++) {
            this.rainSeed[i * 3] = rnd(-HALF, HALF);
            this.rainSeed[i * 3 + 1] = rnd(0, TOP);
            this.rainSeed[i * 3 + 2] = rnd(-HALF, HALF);
        }
        const rg = new THREE.BufferGeometry();
        rg.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
        this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xb9d4e6, transparent: true, opacity: 0.5, depthWrite: false }));
        this.rain.frustumCulled = false;
        this.rain.renderOrder = 8;
        scene.add(this.rain);

        const pts = (color, size, extra = {}) => new THREE.PointsMaterial({ color, size, sizeAttenuation: false, transparent: true, depthWrite: false, ...extra });
        this.snow = pointField(scene, 2000, pts(0xffffff, 3, { opacity: 0.9 }));
        this.hail = pointField(scene, 900, pts(0xf2f8ff, 4.5, { opacity: 0.95 }));
        this.dust = pointField(scene, 1800, pts(0xd8b27a, 2.5, { opacity: 0.7 }), 7);

        // Falling leaves in warm colors.
        this.leaves = pointField(scene, 380, pts(0xffffff, 5, { vertexColors: true, opacity: 0.95 }), 10);
        const lc = new Float32Array(380 * 3), palette = [0xd9783b, 0xe8b23a, 0xb8442e, 0x9a6a2a].map(c => new THREE.Color(c));
        for (let i = 0; i < 380; i++) palette[i % 4].toArray(lc, i * 3);
        this.leaves.obj.geometry.setAttribute('color', new THREE.BufferAttribute(lc, 3));

        // Fireflies glow over the meadows on warm nights.
        this.flies = pointField(scene, 160, pts(0xe6ff8a, 5.5, { blending: THREE.AdditiveBlending, opacity: 0.9 }), 2);
        this.flyBase = new Float32Array(160 * 3);
        this.flyTimer = 0;

        // Clouds made of puffs. They cast moving shadows on the island.
        this.cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, transparent: true, opacity: 0.5, depthWrite: false });
        const puff = new THREE.IcosahedronGeometry(1, 1);
        this.clouds = [];
        for (let i = 0; i < 18; i++) {
            const g = new THREE.Group();
            const n = 3 + Math.floor(Math.random() * 4);
            for (let k = 0; k < n; k++) {
                const m = new THREE.Mesh(puff, this.cloudMat);
                const s = rnd(1.1, 2.3);
                m.scale.set(s * 1.2, s * 0.7, s);
                m.position.set(rnd(-2.2, 2.2), rnd(-0.3, 0.5), rnd(-1.2, 1.2));
                m.castShadow = true;
                m.renderOrder = 9;
                g.add(m);
            }
            g.userData.off = new THREE.Vector3(rnd(-30, 30), rnd(10, 12.5), rnd(-30, 30));
            g.visible = false;
            scene.add(g);
            this.clouds.push(g);
        }

        // Rainbow: seven arcs standing behind the island.
        this.rainbow = new THREE.Group();
        const bands = [0xff4b4b, 0xff9a3c, 0xffe04b, 0x6bd66b, 0x4bb8ff, 0x5a6bff, 0xa65aff];
        this.rainbowMats = bands.map((c, i) => {
            const mat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false });
            const arc = new THREE.Mesh(new THREE.TorusGeometry(17 - i * 0.42, 0.22, 4, 64, Math.PI), mat);
            this.rainbow.add(arc);
            return mat;
        });
        this.rainbow.visible = false;
        scene.add(this.rainbow);

        // Northern lights: glowing ribbons that wave.
        this.aurora = new THREE.Group();
        this.ribbons = [];
        for (let k = 0; k < 3; k++) {
            const geo = new THREE.PlaneGeometry(50, 8, 60, 4);
            const col = new Float32Array(geo.attributes.position.count * 3);
            // Additive blending: black is invisible, so the ribbon fades out at both edges.
            const rows = [new THREE.Color(0x000000), new THREE.Color(k === 1 ? 0x2fd8a0 : 0x2fe070), new THREE.Color(0x3fb0c0),
                new THREE.Color(k === 2 ? 0x8a4fd0 : 0x5a4fc8), new THREE.Color(0x000000)];
            for (let i = 0; i < geo.attributes.position.count; i++) {
                const row = Math.round((geo.attributes.position.getY(i) + 4) / 2);
                rows[Math.max(0, Math.min(4, row))].toArray(col, i * 3);
            }
            geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
            geo.userData.base = geo.attributes.position.array.slice();
            const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false });
            const m = new THREE.Mesh(geo, mat);
            m.position.set(k * 3 - 3, k * 1.6 - 1.6, 0);
            this.aurora.add(m);
            this.ribbons.push(m);
        }
        this.aurora.visible = false;
        scene.add(this.aurora);

        // Lightning bolt.
        this.boltGeo = new THREE.BufferGeometry();
        this.boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(14 * 3), 3));
        this.bolt = new THREE.Line(this.boltGeo, new THREE.LineBasicMaterial({ color: 0xfffbe0, transparent: true, fog: false }));
        this.bolt.frustumCulled = false;
        this.bolt.visible = false;
        this.bolt.renderOrder = 12;
        scene.add(this.bolt);
        this.lastStrike = null;

        this.fogColor = new THREE.Color(0xc9d3da);
        this.dustColor = new THREE.Color(0xc8a46e);
        this.hazeColor = new THREE.Color(0xf2cf9a);
        this.nightFog = new THREE.Color(0x1b2533);
        scene.fog = new THREE.Fog(0xc9d3da, 900, 1000);
        this.tmp = new THREE.Vector3();
        this.up = new THREE.Vector3();
    }

    update(dt, game, center, camera, running) {
        this.time += dt;
        const now = game.weather.now;
        const wind = now.wind || 0;
        const step = running ? dt : 0;
        const night = game.night || 0;
        const season = game.seasonIndex;

        this.updateRain(now, center, step, wind);

        // Snow: slow flakes that sway.
        this.fall(this.snow, Math.min(1, (now.snow || 0) / 1.6), center, step, (p, o) => {
            p[o + 1] -= (1.4 + wind * 1.5) * step;
            p[o] += (Math.sin(this.time * 1.3 + o) * 0.4 + wind * 5) * step;
        });
        // Hail: fast and bright.
        this.fall(this.hail, now.hail || 0, center, step, (p, o) => {
            p[o + 1] -= 24 * step;
        });
        // Dust: streams sideways in a sandstorm.
        this.fall(this.dust, now.dust || 0, center, step, (p, o) => {
            p[o] += (14 + Math.sin(o) * 4) * step;
            p[o + 1] += Math.sin(this.time * 3 + o) * 0.6 * step;
        });
        // Leaves: when it is windy, and in autumn whenever there is wind.
        const leafAmount = Math.max(now.leaves || 0, season === 2 ? 0.35 + wind * 0.6 : 0) * (now.snow ? 0 : 1);
        this.fall(this.leaves, Math.min(1, leafAmount), center, step, (p, o) => {
            p[o + 1] -= 0.9 * step;
            p[o] += (Math.sin(this.time * 2 + o) * 0.8 + 1 + wind * 5) * step;
            p[o + 2] += Math.cos(this.time * 1.7 + o) * 0.6 * step;
        });

        this.updateFlies(game, dt, night, season, now);
        this.updateClouds(now, center, dt, wind, night);
        this.updateBackdrop(now, center, camera, night);
        this.updateBolt(game, dt);
    }

    updateRain(now, center, step, wind) {
        const nRain = Math.floor(this.RAIN * Math.min(1, (now.rain || 0) / 2.6));
        this.rain.visible = nRain > 0;
        if (!nRain) return;
        const p = this.rain.geometry.attributes.position.array, sd = this.rainSeed;
        const fall = 15 * step, drift = wind * 6 * step;
        const sx = 0.06 + wind * 0.25;
        for (let i = 0; i < nRain; i++) {
            let y = sd[i * 3 + 1] - fall;
            let x = sd[i * 3] + drift;
            if (y < 0) { y += TOP; x = rnd(-HALF, HALF); }
            x = wrap(x);
            sd[i * 3] = x;
            sd[i * 3 + 1] = y;
            const z = sd[i * 3 + 2], o = i * 6;
            p[o] = center.x + x; p[o + 1] = y; p[o + 2] = center.z + z;
            p[o + 3] = center.x + x - sx; p[o + 4] = y + 0.55; p[o + 5] = center.z + z;
        }
        this.rain.geometry.setDrawRange(0, nRain * 2);
        this.rain.geometry.attributes.position.needsUpdate = true;
        this.rain.material.opacity = 0.32 + Math.min(0.35, (now.rain || 0) * 0.14);
    }

    fall(field, amount, center, step, move) {
        const n = Math.floor(field.n * Math.min(1, amount));
        field.obj.visible = n > 0;
        if (!n) return;
        const p = field.pos;
        for (let i = 0; i < n; i++) {
            const o = i * 3;
            move(p, o);
            if (p[o + 1] < 0) { p[o + 1] += field.yMax; p[o] = rnd(-HALF, HALF); }
            if (p[o + 1] > field.yMax) p[o + 1] -= field.yMax;
            p[o] = wrap(p[o]);
            p[o + 2] = wrap(p[o + 2]);
        }
        field.obj.position.set(center.x, 0, center.z);
        field.obj.geometry.setDrawRange(0, n);
        field.obj.geometry.attributes.position.needsUpdate = true;
    }

    updateFlies(game, dt, night, season, now) {
        const on = night > 0.4 && (season === 0 || season === 1) && (now.rain || 0) < 0.2 && (now.snow || 0) === 0 && game.world;
        const f = this.flies;
        f.obj.visible = !!on;
        if (!on) { this.flyTimer = 0; return; }
        this.flyTimer -= dt;
        if (this.flyTimer <= 0) {
            this.flyTimer = 8;
            const land = game.world.tiles.filter(t => isWalkable(t) && t.food > 0.2);
            if (!land.length) return;
            for (let i = 0; i < f.n; i++) {
                const t = land[Math.floor(Math.random() * land.length)];
                this.flyBase[i * 3] = t.x + rnd(-0.4, 0.4);
                this.flyBase[i * 3 + 1] = t.rh + rnd(0.3, 1.2);
                this.flyBase[i * 3 + 2] = t.z + rnd(-0.4, 0.4);
            }
        }
        const p = f.pos, b = this.flyBase, tm = this.time;
        for (let i = 0; i < f.n; i++) {
            const o = i * 3;
            p[o] = b[o] + Math.sin(tm * 0.7 + i) * 0.35;
            p[o + 1] = b[o + 1] + Math.sin(tm * 1.3 + i * 2) * 0.15;
            p[o + 2] = b[o + 2] + Math.cos(tm * 0.6 + i * 3) * 0.35;
        }
        f.obj.position.set(0, 0, 0);
        f.obj.geometry.setDrawRange(0, f.n);
        f.obj.geometry.attributes.position.needsUpdate = true;
        f.obj.material.opacity = (0.75 + 0.25 * Math.sin(tm * 5)) * Math.min(1, (night - 0.4) * 3);
    }

    updateClouds(now, center, dt, wind, night) {
        const cover = now.cloud || 0;
        const n = Math.round(this.clouds.length * cover);
        const dark = Math.min(1, (now.rain || 0) * 0.45 + (now.lightning || 0) * 0.4 + (now.hail || 0) * 0.3 + (now.snow || 0) * 0.15);
        this.cloudMat.color.setRGB(1, 1, 1).lerp(new THREE.Color(0x5a6370), dark).multiplyScalar(1 - night * 0.55);
        this.cloudMat.opacity = 0.32 + cover * 0.3;
        const speed = 0.5 + wind * 3.5;
        this.clouds.forEach((g, i) => {
            const off = g.userData.off;
            off.x += speed * dt;
            if (off.x > 32) { off.x -= 64; off.z = rnd(-30, 30); }
            g.position.set(center.x + off.x, off.y, center.z + off.z);
            g.visible = i < n;
        });
    }

    // Rainbow and northern lights hang in the upper part of the view and face the camera,
    // so they stay in the picture however the player turns or zooms.
    updateBackdrop(now, center, camera, night) {
        const up = this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
        const H = camera.top / camera.zoom;
        const rb = now.rainbow || 0;
        this.rainbow.visible = rb > 0.01;
        if (this.rainbow.visible) {
            this.rainbow.position.copy(center).addScaledVector(up, -H * 0.35);
            this.rainbow.quaternion.copy(camera.quaternion);
            this.rainbow.scale.setScalar(H / 14);
            this.rainbowMats.forEach(m => { m.opacity = rb * 0.5 * (1 - night * 0.7); });
        }
        const au = (now.aurora || 0) * (0.3 + 0.7 * night);
        this.aurora.visible = au > 0.01;
        if (this.aurora.visible) {
            this.aurora.position.copy(center).addScaledVector(up, H * 0.84);
            this.aurora.quaternion.copy(camera.quaternion);
            this.aurora.scale.setScalar(H / 14);
            this.ribbons.forEach((m, k) => {
                m.material.opacity = au * 0.38;
                const pos = m.geometry.attributes.position, base = m.geometry.userData.base;
                for (let i = 0; i < pos.count; i++) {
                    const x = base[i * 3];
                    pos.array[i * 3 + 1] = base[i * 3 + 1] + Math.sin(x * 0.12 + this.time + k * 2) * 0.9 + Math.sin(x * 0.05 - this.time * 0.4) * 1.2;
                    pos.array[i * 3 + 2] = Math.sin(x * 0.18 + this.time * 0.6 + k) * 1.5;
                }
                pos.needsUpdate = true;
            });
        }
    }

    updateBolt(game, dt) {
        const s = game.strike;
        if (!s) { this.bolt.visible = false; return; }
        s.age += dt;
        if (s !== this.lastStrike) {
            this.lastStrike = s;
            const p = this.boltGeo.attributes.position.array;
            for (let i = 0; i < 14; i++) {
                const k = i / 13;
                const jitter = i === 0 || i === 13 ? 0 : 0.9 * (1 - k * 0.5);
                p[i * 3] = s.x + rnd(-jitter, jitter);
                p[i * 3 + 1] = s.y + (1 - k) * 15;
                p[i * 3 + 2] = s.z + rnd(-jitter, jitter);
            }
            this.boltGeo.attributes.position.needsUpdate = true;
        }
        this.bolt.visible = s.age < 0.35;
        this.bolt.material.opacity = s.age < 0.1 || (s.age > 0.18 && s.age < 0.26) ? 1 : 0.25;
    }

    // Fog closes in from the far side of the view. Its color follows the weather and the time of day.
    applyFog(scene, now, sky, night) {
        const f = Math.min(1, now.fog || 0);
        scene.fog.near = 400 - f * 372;
        scene.fog.far = 500 - f * 418;
        const tint = (now.dust || 0) > 0.3 ? this.dustColor : (now.haze || 0) > 0.3 ? this.hazeColor : this.fogColor;
        scene.fog.color.copy(sky).lerp(tint, Math.min(1, f * 1.2)).lerp(this.nightFog, night * 0.6);
    }
}
