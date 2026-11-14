import * as THREE from 'three';

// Small speech-bubble icons drawn once on canvases and shared by all Nomes.

function bubble(draw, bg = '#fffaf0') {
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath(); g.arc(48, 52, 38, 0, Math.PI * 2); g.fill();
    g.fillStyle = bg;
    g.beginPath(); g.arc(48, 46, 38, 0, Math.PI * 2); g.fill();
    g.save();
    g.translate(48, 46);
    draw(g);
    g.restore();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function heartPath(g, s) {
    g.beginPath();
    g.moveTo(0, s * 0.35);
    g.bezierCurveTo(-s * 1.1, -s * 0.35, -s * 0.45, -s * 1.05, 0, -s * 0.45);
    g.bezierCurveTo(s * 0.45, -s * 1.05, s * 1.1, -s * 0.35, 0, s * 0.35);
    g.closePath();
}

const draws = {
    love: g => { g.fillStyle = '#e2506d'; heartPath(g, 26); g.translate(0, 4); g.fill(); },
    hungry: g => {
        g.fillStyle = '#d9822b';
        g.beginPath(); g.arc(0, 4, 16, 0, Math.PI); g.fill();
        g.fillRect(-20, 2, 40, 5);
        g.strokeStyle = '#d9822b'; g.lineWidth = 5; g.lineCap = 'round';
        g.beginPath(); g.moveTo(-6, -8); g.lineTo(-6, -20); g.moveTo(6, -8); g.lineTo(6, -20); g.stroke();
    },
    cold: g => {
        g.strokeStyle = '#3d8fd1'; g.lineWidth = 5; g.lineCap = 'round';
        for (let k = 0; k < 3; k++) {
            g.save(); g.rotate(k * Math.PI / 3);
            g.beginPath(); g.moveTo(0, -22); g.lineTo(0, 22);
            g.moveTo(-7, -16); g.lineTo(0, -10); g.lineTo(7, -16);
            g.moveTo(-7, 16); g.lineTo(0, 10); g.lineTo(7, 16);
            g.stroke(); g.restore();
        }
    },
    hot: g => {
        g.fillStyle = '#e9a12c';
        g.beginPath(); g.arc(0, 0, 11, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#e9a12c'; g.lineWidth = 4; g.lineCap = 'round';
        for (let k = 0; k < 8; k++) {
            g.save(); g.rotate(k * Math.PI / 4);
            g.beginPath(); g.moveTo(0, -16); g.lineTo(0, -24); g.stroke(); g.restore();
        }
    },
    sick: g => {
        g.fillStyle = '#7a9a3a';
        g.fillRect(-6, -22, 12, 44);
        g.fillRect(-22, -6, 44, 12);
    },
    sleep: g => {
        g.fillStyle = '#5b6fb5';
        g.font = 'bold 34px Figtree, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('z', -8, 6);
        g.font = 'bold 22px Figtree, sans-serif';
        g.fillText('z', 12, -12);
    }
};

let cache = null;

export function emoteMaterials() {
    if (cache) return cache;
    cache = {};
    for (const [k, draw] of Object.entries(draws)) {
        cache[k] = new THREE.SpriteMaterial({ map: bubble(draw), depthTest: false, transparent: true });
    }
    return cache;
}

let sparkTex = null;
export function sparkTexture() {
    if (sparkTex) return sparkTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    sparkTex = new THREE.CanvasTexture(c);
    return sparkTex;
}

let heartTex = null;
export function heartTexture() {
    if (heartTex) return heartTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.translate(32, 36);
    g.fillStyle = '#ff6b8a';
    heartPath(g, 22);
    g.fill();
    heartTex = new THREE.CanvasTexture(c);
    heartTex.colorSpace = THREE.SRGBColorSpace;
    return heartTex;
}
