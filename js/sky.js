import * as THREE from 'three';

const RAIN = 1600, SNOW = 1400, HALF = 24, TOP = 16;

// Rain streaks, snowflakes and fog. Reads the blended weather from the game.
export class Sky {
    constructor(scene) {
        this.scene = scene;
        this.center = new THREE.Vector3();

        const rainPos = new Float32Array(RAIN * 6);
        this.rainSeed = new Float32Array(RAIN * 3);
        for (let i = 0; i < RAIN; i++) {
            this.rainSeed[i * 3] = (Math.random() * 2 - 1) * HALF;
            this.rainSeed[i * 3 + 1] = Math.random() * TOP;
            this.rainSeed[i * 3 + 2] = (Math.random() * 2 - 1) * HALF;
        }
        const rg = new THREE.BufferGeometry();
        rg.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
        this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xb9d4e6, transparent: true, opacity: 0.5, depthWrite: false }));
        this.rain.frustumCulled = false;
        this.rain.renderOrder = 8;
        scene.add(this.rain);

        const snowPos = new Float32Array(SNOW * 3);
        for (let i = 0; i < SNOW; i++) {
            snowPos[i * 3] = (Math.random() * 2 - 1) * HALF;
            snowPos[i * 3 + 1] = Math.random() * TOP;
            snowPos[i * 3 + 2] = (Math.random() * 2 - 1) * HALF;
        }
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.BufferAttribute(snowPos, 3).setUsage(THREE.DynamicDrawUsage));
        this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false }));
        this.snow.frustumCulled = false;
        this.snow.renderOrder = 8;
        scene.add(this.snow);

        this.fogColor = new THREE.Color(0xc9d3da);
        scene.fog = new THREE.Fog(0xc9d3da, 900, 1000);
        this.time = 0;
    }

    update(dt, now, center, running) {
        this.time += dt;
        this.center.copy(center);
        const wind = now.wind || 0;
        const step = running ? dt : 0;

        // Rain: falling streaks, slanted by the wind.
        const nRain = Math.floor(RAIN * Math.min(1, (now.rain || 0) / 1.8));
        this.rain.visible = nRain > 0;
        if (nRain > 0) {
            const p = this.rain.geometry.attributes.position.array, sd = this.rainSeed;
            const fall = 15 * step, drift = wind * 6 * step;
            const sx = 0.06 + wind * 0.25;
            for (let i = 0; i < nRain; i++) {
                let y = sd[i * 3 + 1] - fall;
                let x = sd[i * 3] + drift;
                if (y < 0) { y += TOP; x = (Math.random() * 2 - 1) * HALF; }
                if (x > HALF) x -= HALF * 2;
                sd[i * 3] = x;
                sd[i * 3 + 1] = y;
                const z = sd[i * 3 + 2];
                const o = i * 6;
                p[o] = center.x + x; p[o + 1] = y; p[o + 2] = center.z + z;
                p[o + 3] = center.x + x - sx; p[o + 4] = y + 0.55; p[o + 5] = center.z + z;
            }
            this.rain.geometry.setDrawRange(0, nRain * 2);
            this.rain.geometry.attributes.position.needsUpdate = true;
            this.rain.material.opacity = 0.35 + Math.min(0.3, (now.rain || 0) * 0.15);
        }

        // Snow: slow flakes that sway.
        const nSnow = Math.floor(SNOW * Math.min(1, now.snow || 0));
        this.snow.visible = nSnow > 0;
        if (nSnow > 0) {
            const p = this.snow.geometry.attributes.position.array;
            for (let i = 0; i < nSnow; i++) {
                const o = i * 3;
                p[o + 1] -= 1.4 * step;
                p[o] += Math.sin(this.time * 1.3 + i) * 0.4 * step + wind * 2 * step;
                if (p[o + 1] < 0) { p[o + 1] += TOP; p[o] = (Math.random() * 2 - 1) * HALF; }
                if (p[o] > HALF) p[o] -= HALF * 2;
            }
            this.snow.position.set(center.x, 0, center.z);
            this.snow.geometry.setDrawRange(0, nSnow);
            this.snow.geometry.attributes.position.needsUpdate = true;
        }
    }

    // Fog closes in from the far side of the view. The camera sits about 52 units away.
    applyFog(scene, amount, sky) {
        const f = Math.min(1, amount);
        scene.fog.near = 400 - f * 372;
        scene.fog.far = 500 - f * 418;
        scene.fog.color.copy(sky).lerp(this.fogColor, Math.min(1, f * 1.2));
    }
}
