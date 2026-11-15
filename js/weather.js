import { WEATHER, WEATHER_ODDS } from './config.js';
import { rand, lerp } from './rng.js';

const FIELDS = ['temp', 'wet', 'growth', 'sight', 'burn', 'light', 'fog', 'cloud', 'rain', 'snow', 'hail', 'dust',
    'wind', 'leaves', 'flood', 'lightning', 'haze', 'frost', 'rainbow', 'aurora', 'mood'];
const BLEND_TIME = 5;
const WET = ['drizzle', 'rain', 'downpour', 'storm'];

function pick(season, not) {
    const odds = Object.entries(WEATHER_ODDS[season]).filter(([k]) => k !== not);
    const total = odds.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    for (const [k, w] of odds) {
        r -= w;
        if (r <= 0) return k;
    }
    return odds[0][0];
}

// Weather that does not fit the season turns into something that does.
function fit(key, season) {
    if (season === 3 && WET.includes(key) && key !== 'storm') return key === 'downpour' ? 'blizzard' : 'snow';
    if (season !== 3 && (key === 'aurora')) return 'clear';
    if (season !== 3 && season !== 2 && (key === 'snow' || key === 'blizzard')) return 'rain';
    if (season !== 1 && (key === 'heat' || key === 'sandstorm')) return season === 3 ? 'frost' : 'clear';
    if (season === 1 && key === 'frost') return 'clear';
    return key;
}

// Weather runs as a chain of spells. Each spell lasts a while and blends into the next.
export class Weather {
    constructor(saved) {
        this.key = saved?.key && WEATHER[saved.key] ? saved.key : 'clear';
        this.prev = this.key;
        this.timer = saved?.timer ?? rand(20, 40);
        this.blend = 1;
        this.now = {};
        this.mix();
    }

    get name() { return WEATHER[this.key].name; }

    // Returns the new weather key when the weather changes, otherwise null.
    update(dt, season) {
        this.timer -= dt;
        let changed = null;
        const fitted = fit(this.key, season);
        if (fitted !== this.key) changed = this.set(fitted);
        if (this.timer <= 0) {
            const after = WET.includes(this.key) && Math.random() < 0.4 && season !== 3 ? 'rainbow' : fit(pick(season, this.key), season);
            changed = this.set(after) || changed;
            const short = { storm: 0.6, rainbow: 0.45, downpour: 0.6, hail: 0.5, blizzard: 0.7 }[this.key] || 1;
            // Summer and winter weather holds longer, spring and autumn change often.
            const steady = season === 1 || season === 3 ? 1.25 : 0.8;
            this.timer = rand(18, 45) * short * steady;
        }
        if (this.blend < 1) this.blend = Math.min(1, this.blend + dt / BLEND_TIME);
        this.mix();
        return changed;
    }

    set(key) {
        if (key === this.key) return null;
        this.prev = this.key;
        this.key = key;
        this.blend = 0;
        return key;
    }

    mix() {
        const a = WEATHER[this.prev], b = WEATHER[this.key];
        for (const f of FIELDS) this.now[f] = lerp(a[f] ?? 0, b[f] ?? 0, this.blend);
    }

    serialize() {
        return { key: this.key, timer: Math.round(this.timer * 10) / 10 };
    }
}
