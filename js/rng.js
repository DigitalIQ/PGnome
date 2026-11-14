export function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function randomSeed() {
    return Math.floor(Math.random() * 1e9);
}

// Smooth value noise with fractal octaves, deterministic per seed.
export function makeNoise(seed) {
    const rand = mulberry32(seed);
    const N = 256;
    const grid = new Float32Array(N * N);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    const at = (x, y) => grid[((y & (N - 1)) * N) + (x & (N - 1))];
    const fade = t => t * t * (3 - 2 * t);

    function value(x, y) {
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const fx = fade(x - x0), fy = fade(y - y0);
        const a = at(x0, y0), b = at(x0 + 1, y0);
        const c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
        return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
    }

    return function fbm(x, y, octaves = 4) {
        let sum = 0, amp = 1, freq = 1, norm = 0;
        for (let o = 0; o < octaves; o++) {
            sum += value(x * freq, y * freq) * amp;
            norm += amp;
            amp *= 0.5;
            freq *= 2;
        }
        return sum / norm;
    };
}

export function gauss() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const rand = (min, max) => Math.random() * (max - min) + min;
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const lerp = (a, b, t) => a + (b - a) * t;

const SYL_A = ['pi', 'no', 'ka', 'mu', 'zi', 'lo', 'be', 'ta', 'ru', 'fi', 'go', 'ne', 'sa', 'wu', 'ki', 'do'];
const SYL_B = ['bo', 'mi', 'ra', 'tu', 'lin', 'po', 'ki', 'sel', 'na', 'ro', 'fu', 'dle', 'mo', 'zi'];
export function randomName() {
    const a = SYL_A[Math.floor(Math.random() * SYL_A.length)];
    const b = SYL_B[Math.floor(Math.random() * SYL_B.length)];
    const n = a + b;
    return n.charAt(0).toUpperCase() + n.slice(1);
}
