import * as THREE from 'three';
import { legCount, eyeCount, patternName } from './config.js';
import { mulberry32 } from './rng.js';

// Builds a Nome body from its genes. The torso is a lathe whose profile comes from
// length, plumpness and taper, so no two Nomes share exactly the same silhouette.

const legGeo = new THREE.CylinderGeometry(0.05, 0.045, 1, 6);
legGeo.translate(0, -0.5, 0);
const hornGeo = new THREE.ConeGeometry(1, 1, 6);
hornGeo.translate(0, 0.5, 0);
const tailGeo = new THREE.CylinderGeometry(0.45, 1, 1, 6);
tailGeo.translate(0, 0.5, 0);
const tuftGeo = new THREE.ConeGeometry(1, 1, 5);
tuftGeo.translate(0, 0.5, 0);
const GEO = {
    eye: new THREE.SphereGeometry(1, 12, 8),
    ear: new THREE.ConeGeometry(1, 1, 6),
    ball: new THREE.SphereGeometry(1, 10, 8),
    hit: new THREE.SphereGeometry(0.6, 8, 6)
};
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
const pupilMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
const hornMat = new THREE.MeshStandardMaterial({ color: 0xefe3c4, roughness: 0.6 });
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });

export function baseColor(g) {
    const cold = g.prefTemp < 35;
    return new THREE.Color().setHSL(g.hue / 360, cold ? 0.32 : 0.55, cold ? 0.7 : 0.56);
}

export function accentColor(g) {
    return new THREE.Color().setHSL(g.hue2 / 360, 0.5, g.prefTemp < 35 ? 0.8 : 0.4);
}

// Torso radius along the body, t runs from the rear (0) to the nose (1).
function profile(g) {
    const L = 0.66 * g.bodyLen;
    const R = 0.27 + g.plump * 0.1;
    const e = 0.8 - g.plump * 0.4;
    const bigHead = g.plump < 0.5;
    const r = t => R * Math.pow(Math.max(0, Math.sin(Math.PI * t)), e) * (bigHead ? 0.88 + 0.24 * t : 1.12 - 0.24 * t);
    return { L, R, r, y: R * 0.9 };
}

function skinTexture(g, seed) {
    const W = 128, H = 64;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    const base = '#' + baseColor(g).getHexString();
    const acc = '#' + accentColor(g).getHexString();
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    // u = 0 and u = 1 are the belly, u = 0.5 the back.
    const belly = ctx.createLinearGradient(0, 0, W, 0);
    belly.addColorStop(0, 'rgba(255,255,255,0.32)');
    belly.addColorStop(0.2, 'rgba(255,255,255,0)');
    belly.addColorStop(0.8, 'rgba(255,255,255,0)');
    belly.addColorStop(1, 'rgba(255,255,255,0.32)');
    ctx.fillStyle = belly;
    ctx.fillRect(0, 0, W, H);

    const kind = patternName(g.pattern);
    const rnd = mulberry32(seed);
    ctx.fillStyle = acc;
    if (kind === 'spotted') {
        const n = 6 + Math.floor(rnd() * 8);
        for (let k = 0; k < n; k++) {
            const x = W * (0.2 + rnd() * 0.6), y = H * (0.12 + rnd() * 0.76);
            const rr = 3 + rnd() * 5;
            ctx.beginPath();
            ctx.ellipse(x, y, rr * 1.4, rr, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    } else if (kind === 'striped') {
        const n = 3 + Math.floor((g.pattern - 0.7) * 16);
        for (let k = 0; k < n; k++) {
            const y = H * (0.15 + (k + 0.5) / n * 0.7);
            ctx.fillRect(W * 0.18, y - 2.5, W * 0.64, 5);
        }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

export function describeBody(g) {
    const parts = [`${legCount(g.legs)} legs`];
    const eyes = eyeCount(g.eyes);
    if (eyes !== 2) parts.push(eyes === 1 ? 'one eye' : 'three eyes');
    const kind = patternName(g.pattern);
    if (kind !== 'plain') parts.push(kind);
    if (g.horns > 0.5) parts.push('horned');
    if (g.bodyLen > 1.3) parts.push('long');
    else if (g.bodyLen < 0.9) parts.push('stubby');
    if (g.plump > 0.75) parts.push('round');
    if (g.tail > 0.8) parts.push('long tail');
    return parts.join(' · ');
}

export function buildBody(g, seed) {
    const P = profile(g);
    const limbMat = new THREE.MeshStandardMaterial({ color: baseColor(g), roughness: g.prefTemp < 35 ? 1 : 0.55 });
    const skin = skinTexture(g, seed);
    const skinMat = new THREE.MeshStandardMaterial({ map: skin, roughness: g.prefTemp < 35 ? 1 : 0.55 });
    const root = new THREE.Group();

    // Legs. Two, four or six, spread along the belly.
    const n = legCount(g.legs), pairs = n / 2;
    const legLen = 0.06 + g.speed * 0.07;
    const legs = [];
    for (let p = 0; p < pairs; p++) {
        const z = pairs === 1 ? 0.02 : P.L * 0.28 - (p / (pairs - 1)) * P.L * 0.56;
        for (const side of [-1, 1]) {
            const hip = new THREE.Group();
            hip.position.set(side * P.R * 0.48, legLen + 0.06, z);
            const leg = new THREE.Mesh(legGeo, limbMat);
            leg.scale.set(1 + g.plump * 0.4, legLen + 0.06, 1 + g.plump * 0.4);
            leg.castShadow = true;
            hip.add(leg);
            root.add(hip);
            legs.push({ hip, phase: (side > 0 ? Math.PI : 0) + p * Math.PI });
        }
    }

    const pivot = new THREE.Group();
    pivot.position.y = legLen;
    root.add(pivot);

    // Torso from the lathe profile, laid along +z (the walking direction).
    const pts = [];
    const steps = 14;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        pts.push(new THREE.Vector2(Math.max(0.001, P.r(t)), (t - 0.5) * P.L));
    }
    const torsoGeo = new THREE.LatheGeometry(pts, 18);
    torsoGeo.rotateX(Math.PI / 2);
    const body = new THREE.Mesh(torsoGeo, skinMat);
    body.position.y = P.y;
    body.castShadow = true;
    pivot.add(body);

    const at = t => ({ z: (t - 0.5) * P.L, r: P.r(t) });

    // Eyes. Size follows the sight gene.
    const eyeSize = 0.05 + ((g.sight - 3) / 7) * 0.045;
    const front = at(0.8);
    const eyeSpots = eyeCount(g.eyes) === 1 ? [[0, 1.5]]
        : eyeCount(g.eyes) === 3 ? [[-0.55, 1], [0.55, 1], [0, 0.85]]
            : [[-0.62, 1], [0.62, 1]];
    for (const [sx, sz] of eyeSpots) {
        const eye = new THREE.Mesh(GEO.eye, eyeMat);
        eye.scale.setScalar(eyeSize * (eyeSpots.length === 1 ? 1.5 : 1));
        const up = sx === 0 && eyeSpots.length === 3 ? 0.92 : 0.62;
        eye.position.set(sx * front.r * 0.62, P.y + front.r * up * 0.92, front.z + front.r * 0.5 * sz);
        const pupil = new THREE.Mesh(GEO.eye, pupilMat);
        pupil.scale.setScalar(0.55);
        pupil.position.set(0, 0, 0.6);
        eye.add(pupil);
        pivot.add(eye);
    }

    // Ears: heat lovers grow big ones to shed heat.
    const heat = g.prefTemp / 100;
    const earLen = 0.07 + heat * 0.28, earW = 0.05 + heat * 0.04;
    const earAt = at(0.66);
    for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(GEO.ear, limbMat);
        ear.scale.set(earW, earLen, earW * 0.6);
        ear.position.set(side * earAt.r * 0.5, P.y + earAt.r * 0.8 + earLen * 0.4, earAt.z);
        ear.rotation.z = -side * 0.4;
        ear.castShadow = true;
        pivot.add(ear);
    }

    // Horns grow once the gene passes the middle.
    if (g.horns > 0.5) {
        const hl = 0.06 + (g.horns - 0.5) * 0.5;
        const hornAt = at(0.76);
        for (const side of [-1, 1]) {
            const horn = new THREE.Mesh(hornGeo, hornMat);
            horn.scale.set(0.03 + hl * 0.12, hl, 0.03 + hl * 0.12);
            horn.position.set(side * hornAt.r * 0.28, P.y + hornAt.r * 0.86, hornAt.z);
            horn.rotation.set(0.55, 0, -side * 0.25);
            horn.castShadow = true;
            pivot.add(horn);
        }
    }

    // Cold lovers get a fur tuft on the head.
    if (g.prefTemp < 35) {
        const tuftAt = at(0.58);
        for (let k = -1; k <= 1; k++) {
            const tuft = new THREE.Mesh(tuftGeo, limbMat);
            tuft.scale.set(0.035, 0.09 + (k === 0 ? 0.04 : 0), 0.035);
            tuft.position.set(k * 0.045, P.y + tuftAt.r * 0.88, tuftAt.z - Math.abs(k) * 0.02);
            tuft.rotation.z = -k * 0.35;
            pivot.add(tuft);
        }
    }

    // Tail with a tip that grows with sociability.
    const tail = new THREE.Group();
    const rear = at(0.08);
    tail.position.set(0, P.y + P.R * 0.15, rear.z);
    const tl = 0.05 + g.tail * 0.42;
    const stem = new THREE.Mesh(tailGeo, limbMat);
    stem.scale.set(0.035 + g.plump * 0.015, tl, 0.035 + g.plump * 0.015);
    // Short tails stand up a bit, long ones trail behind.
    const ang = 1.15 + g.tail * 0.45;
    stem.rotation.x = -ang;
    stem.castShadow = true;
    tail.add(stem);
    const tip = new THREE.Mesh(GEO.ball, skinMat);
    tip.scale.setScalar(0.055 + g.sociability * 0.06);
    tip.position.set(0, Math.cos(ang) * tl, -Math.sin(ang) * tl);
    tail.add(tip);
    pivot.add(tail);

    const hit = new THREE.Mesh(GEO.hit, hitMat);
    hit.position.y = 0.35;
    hit.scale.set(1, 1, Math.max(1, g.bodyLen * 0.9));
    root.add(hit);

    return {
        root, pivot, body, legs, tail, hit, legLen, limbMat,
        dispose() {
            torsoGeo.dispose();
            skin.dispose();
            skinMat.dispose();
            limbMat.dispose();
        }
    };
}
