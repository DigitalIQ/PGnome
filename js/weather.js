import { WEATHER, WEATHER_ODDS } from './config.js';
import { rand, lerp } from './rng.js';

const FIELDS = ['temp', 'wet', 'growth', 'sight', 'burn', 'light', 'fog', 'rain', 'snow', 'wind'];
const BLEND_TIME = 5;

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
        // Rain turns to snow in winter, snow to rain in summer.
        if (season === 3 && this.key === 'rain') changed = this.set('snow');
        else if (season !== 3 && season !== 2 && this.key === 'snow') changed = this.set('rain');
        else if (season !== 1 && this.key === 'heat') changed = this.set('clear');
        if (this.timer <= 0) {
            changed = this.set(pick(season, this.key));
            this.timer = rand(18, 45) * (this.key === 'storm' ? 0.6 : 1);
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
