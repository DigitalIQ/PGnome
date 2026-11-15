import { GENES, BIOMES, WEATHER, YEAR_LENGTH, MODES, legCount, eyeCount, patternName } from './config.js';
import { STAT_GENES } from './game.js';
import { isWalkable } from './world.js';
import { scoreOf } from './scores.js';

// The statistics window. Everything here is read from the game; nothing changes it,
// except the "show me" buttons on the notables tab.

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString('en-US');
const pct = (a, b) => (b ? Math.round(a / b * 100) : 0) + '%';
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const TABS = [['overview', 'Overview'], ['population', 'Population'], ['genes', 'Genes'], ['body', 'Body'], ['deaths', 'Deaths'], ['world', 'World'], ['notables', 'Notables']];

// Dark-mode categorical steps, validated against the card surface #142628.
const SERIES = { blue: '#3987e5', orange: '#d95926', aqua: '#199e70', yellow: '#c98500', magenta: '#d55181', green: '#0ca30c', violet: '#9085e9', red: '#e66767' };

function geneText(k, v) {
    const d = GENES[k];
    if (k === 'legs') return legCount(v) + ' legs';
    if (k === 'eyes') return eyeCount(v) + (eyeCount(v) === 1 ? ' eye' : ' eyes');
    if (k === 'size' || k === 'bodyLen') return v.toFixed(2) + 'x';
    if (k === 'speed') return v.toFixed(2);
    if (k === 'sight') return v.toFixed(1);
    if (k === 'lifespan') return Math.round(v) + 's';
    if (d.max === 1) return Math.round(v * 100) + '%';
    return String(Math.round(v));
}

function avgText(k, v) {
    // Averages of discrete genes read better as numbers than as a rounded count.
    if (k === 'legs') return (v < 0.3 ? 2 : v < 0.78 ? 4 : 6) + ' legs (avg ' + Math.round(v * 100) + '%)';
    if (k === 'eyes') return Math.round(v * 100) + '%';
    return geneText(k, v);
}

function tile(label, value, sub = '') {
    return `<div class="st-tile"><b>${value}</b><span>${esc(label)}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
}

// Horizontal bars: one hue, labels in text color, value on the right.
function bars(rows, color = SERIES.blue, total = null, scaleTo = null) {
    const max = scaleTo || Math.max(1, ...rows.map(r => r.value));
    const sum = total ?? rows.reduce((s, r) => s + r.value, 0);
    return `<div class="st-bars">${rows.map(r => `
        <div class="st-bar" title="${esc(r.title || `${r.label}: ${r.text ?? fmt(r.value)}`)}">
            <span class="st-bar-label">${esc(r.label)}</span>
            <span class="st-bar-track"><i style="width:${(r.value / max * 100).toFixed(1)}%;background:${color}"></i></span>
            <span class="st-bar-value">${r.text ?? fmt(r.value)}<small>${r.noShare ? '' : pct(r.value, sum)}</small></span>
        </div>`).join('')}</div>`;
}

function section(title, body, hint = '') {
    return `<section class="st-section"><h3>${esc(title)}</h3>${hint ? `<p class="hint">${hint}</p>` : ''}${body}</section>`;
}

export class StatsView {
    constructor(game, actions) {
        this.game = game;
        this.actions = actions;
        this.tab = 'overview';
        this.charts = [];
        $('stats-tabs').innerHTML = TABS.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}">${l}</button>`).join('');
        $('stats-tabs').addEventListener('click', e => {
            const b = e.target.closest('[data-tab]');
            if (b) { this.tab = b.dataset.tab; this.render(); }
        });
        $('stats-body').addEventListener('click', e => {
            const b = e.target.closest('[data-nome]');
            if (b) this.actions.showNome(+b.dataset.nome);
        });
        $('stats-close').addEventListener('click', () => actions.closeStats());
        $('stats').addEventListener('click', e => { if (e.target.id === 'stats') actions.closeStats(); });
        window.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !$('stats').classList.contains('hidden')) actions.closeStats();
        });
        window.addEventListener('resize', () => { if (!$('stats').classList.contains('hidden')) this.drawCharts(); });
    }

    show() {
        $('stats').classList.remove('hidden');
        this.render();
    }

    hide() {
        $('stats').classList.add('hidden');
    }

    render() {
        document.querySelectorAll('#stats-tabs .tab').forEach(b => {
            const on = b.dataset.tab === this.tab;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on);
        });
        const g = this.game;
        $('stats-sub').textContent = `${g.islandName} · ${(MODES[g.mode] || MODES.classic).name} · seed ${g.seed} · year ${g.year}, ${g.seasonName.toLowerCase()}`;
        this.charts = [];
        $('stats-body').innerHTML = this[this.tab]();
        $('stats-body').scrollTop = 0;
        this.drawCharts();
    }

    // ---------- Tabs ----------

    overview() {
        const g = this.game, s = g.stats, n = g.creatures.length;
        const years = Math.max(1 / 4, g.time / YEAR_LENGTH);
        const avgAge = n ? g.creatures.reduce((a, c) => a + c.age, 0) / n : 0;
        const deathAge = s.deathAge.n ? s.deathAge.sum / s.deathAge.n : 0;
        const run = g.run ? scoreOf({ mode: g.mode, years: (g.time - g.run.start) / YEAR_LENGTH, gen: s.maxGen, peak: g.runPeak || 0, goals: Object.keys(g.goals).length }) : 0;
        const tiles = [
            tile('alive now', fmt(n), `peak ${fmt(s.peakPop)}`),
            tile('generations', fmt(s.maxGen)),
            tile('born', fmt(s.births), `${fmt(s.births / years)} per year`),
            tile('died', fmt(s.deaths), `${fmt(s.deaths / years)} per year`),
            tile('twin births', fmt(s.twins)),
            tile('average age now', Math.round(avgAge) + 's'),
            tile('average age at death', Math.round(deathAge) + 's'),
            tile('caught by hawks', fmt(s.hawk.catches), `${fmt(s.hawk.dives)} dives`),
            tile('lightning strikes', fmt(s.strikes), s.burned ? `${fmt(s.burned)} forests burned` : ''),
            tile('goals reached', `${Object.keys(g.goals).length}`),
            tile('score this run', fmt(run)),
            tile('time on the island', `${Math.floor(g.time / 60)} min`, `${years.toFixed(1)} years`)
        ].join('');
        const ys = s.years.slice(-12).reverse();
        const table = ys.length ? `<table class="st-table"><thead><tr><th>Year</th><th>Born</th><th>Died</th><th>Lowest</th><th>Highest</th></tr></thead><tbody>
            ${ys.map(e => `<tr><td>${e.y}</td><td>${fmt(e.births)}</td><td>${fmt(e.deaths)}</td><td>${fmt(e.low)}</td><td>${fmt(e.peak)}</td></tr>`).join('')}</tbody></table>`
            : '<p class="hint">The year table fills as time passes.</p>';
        return `<div class="st-tiles">${tiles}</div>${section('Year by year', table, 'The last 12 years, newest first.')}`;
    }

    population() {
        const g = this.game, h = g.longHistory;
        if (h.length < 2) return '<p class="hint">Long-term charts build up from a sample every 10 seconds. Come back in a moment.</p>';
        const where = g.whereNomesLive(), n = g.creatures.length;
        const counts = BIOMES.map(() => 0);
        for (const c of g.creatures) { const t = g.world.tileAt(c.x, c.z); if (t) counts[t.biome]++; }
        this.addChart('Nomes alive', h.map(p => [p.t, p.pop]), SERIES.green);
        this.addChart('Living on other islands', h.map(p => [p.t, p.sat ?? 0]), SERIES.aqua);
        this.addChart('Land tiles', h.map(p => [p.t, p.land]), SERIES.blue);
        this.addChart('Hawks hunting', h.map(p => [p.t, p.hawks ?? 0]), SERIES.orange);
        const charts = this.charts.map((c, i) => `<figure class="st-chart"><figcaption>${esc(c.title)}<span data-now="${i}"></span></figcaption>
            <div class="st-canvas"><canvas data-chart="${i}"></canvas><div class="st-tip" data-tip="${i}"></div></div></figure>`).join('');
        const whereBars = bars([
            { label: 'Main island', value: where.main }, { label: 'Other islands', value: where.satellite }, { label: 'In the water', value: where.water }
        ], SERIES.aqua, n);
        const biomeBars = bars(BIOMES.map((b, i) => ({ label: b.name, value: counts[i] })).filter(r => r.label !== 'Water'), SERIES.green, n);
        return `${section('Over time', `<div class="st-charts">${charts}</div>`, 'Each chart has its own scale. Hover a chart to read exact values.')}
            <div class="st-cols">${section('Where they live', whereBars)}${section('Ground under their feet', biomeBars)}</div>`;
    }

    genes() {
        const g = this.game, h = g.longHistory, n = g.creatures.length;
        if (!n) return '<p class="hint">No Nomes alive.</p>';
        const rows = STAT_GENES.map((k, gi) => {
            const d = GENES[k];
            const bins = new Array(12).fill(0);
            let sum = 0;
            for (const c of g.creatures) {
                const v = c.genes[k];
                sum += v;
                bins[Math.min(11, Math.floor((v - d.min) / (d.max - d.min) * 12))]++;
            }
            const avg = sum / n;
            const maxBin = Math.max(1, ...bins);
            const first = h.find(p => p.g && p.g[gi] != null);
            const start = first ? first.g[gi] : avg;
            const delta = (avg - start) / (d.max - d.min);
            const arrow = Math.abs(delta) < 0.02 ? '<i class="flat">steady</i>' : delta > 0 ? `<i class="up">&#9650; ${Math.round(delta * 100)}%</i>` : `<i class="down">&#9660; ${Math.round(-delta * 100)}%</i>`;
            this.addSpark(h.map(p => [p.t, p.g ? p.g[gi] : null]), d.min, d.max);
            const hist = bins.map((b, i) => {
                const lo = d.min + (d.max - d.min) * i / 12, hi = d.min + (d.max - d.min) * (i + 1) / 12;
                return `<i style="height:${Math.max(b ? 8 : 0, b / maxBin * 100).toFixed(0)}%" title="${esc(geneText(k, lo))} to ${esc(geneText(k, hi))}: ${b} Nomes"></i>`;
            }).join('');
            return `<div class="st-gene">
                <div class="st-gene-name" title="${esc(d.effect || '')}"><b>${esc(d.label)}</b><small>${esc(d.effect || '')}</small></div>
                <div class="st-hist" aria-label="Distribution of ${esc(d.label)}">${hist}</div>
                <div class="st-spark"><canvas data-spark="${this.charts.length - 1}"></canvas></div>
                <div class="st-gene-now"><b>${esc(avgText(k, avg))}</b>${arrow}</div>
            </div>`;
        }).join('');
        return section('Every gene', `<div class="st-gene-head"><span>Gene</span><span>Spread today</span><span>Average over time</span><span>Average now</span></div>${rows}`,
            'Spread: how many Nomes sit at each value from low (left) to high (right). The line shows how the average moved since the island began. The arrow compares today with the first sample.');
    }

    body() {
        const g = this.game, n = g.creatures.length;
        if (!n) return '<p class="hint">No Nomes alive.</p>';
        const count = f => g.creatures.filter(f).length;
        const legs = [2, 4, 6].map(k => ({ label: `${k} legs`, value: count(c => legCount(c.genes.legs) === k) }));
        const eyes = [1, 2, 3].map(k => ({ label: k === 1 ? '1 eye' : `${k} eyes`, value: count(c => eyeCount(c.genes.eyes) === k) }));
        const pats = ['plain', 'spotted', 'striped'].map(k => ({ label: cap(k), value: count(c => patternName(c.genes.pattern) === k) }));
        const horns = [
            { label: 'No horns', value: count(c => c.genes.horns <= 0.5) },
            { label: 'Small horns', value: count(c => c.genes.horns > 0.5 && c.genes.horns <= 0.8) },
            { label: 'Big horns', value: count(c => c.genes.horns > 0.8) }
        ];
        const special = [
            { label: 'Swimmers', value: count(c => c.t.swimmer), title: 'Webbed feet over 45%: can cross shallow water' },
            { label: 'Night walkers', value: count(c => c.genes.nocturnal > 0.5), title: 'Night life over 50%' },
            { label: 'Furry', value: count(c => c.genes.fur > 0.6) },
            { label: 'With feelers', value: count(c => c.genes.curiosity > 0.5) },
            { label: 'With a crest', value: count(c => c.genes.pickiness > 0.6) },
            { label: 'Long bodies', value: count(c => c.genes.bodyLen > 1.3) },
            { label: 'Round bodies', value: count(c => c.genes.plump > 0.75) }
        ].map(r => ({ ...r, text: `${fmt(r.value)} of ${fmt(n)}`, noShare: true }));
        const plans = Object.keys(g.stats.plans).sort().map(k => `${k} legs`).join(', ');
        return `<div class="st-cols">${section('Legs', bars(legs, SERIES.violet, n))}${section('Eyes', bars(eyes, SERIES.violet, n))}</div>
            <div class="st-cols">${section('Pattern', bars(pats, SERIES.magenta, n))}${section('Horns', bars(horns, SERIES.magenta, n))}</div>
            ${section('Special traits', bars(special, SERIES.aqua, null, n))}
            <p class="hint">Body plans seen on this island so far: ${esc(plans || 'none yet')}.</p>`;
    }

    deaths() {
        const g = this.game, s = g.stats;
        if (!s.deaths) return '<p class="hint">No Nome has died yet.</p>';
        const causes = Object.entries(s.causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: cap(k), value: v }));
        const ys = s.years.slice(-16);
        const maxY = Math.max(1, ...ys.map(e => Math.max(e.births, e.deaths)));
        const cols = ys.map(e => `<div class="st-col" title="Year ${e.y}: ${e.births} born, ${e.deaths} died">
            <div class="st-col-bars"><i class="b" style="height:${(e.births / maxY * 100).toFixed(0)}%"></i><i class="d" style="height:${(e.deaths / maxY * 100).toFixed(0)}%"></i></div>
            <span>${e.y}</span></div>`).join('');
        const legend = `<div class="st-legend"><span><i style="background:${SERIES.green}"></i>Born</span><span><i style="background:${SERIES.red}"></i>Died</span></div>`;
        return `${section('Causes of death', bars(causes, SERIES.red), `${fmt(s.deaths)} deaths in total. Average age at death: ${Math.round(s.deathAge.sum / Math.max(1, s.deathAge.n))}s.`)}
            ${section('Born and died per year', legend + `<div class="st-cols-chart">${cols}</div>`, 'Hover a year for exact numbers.')}`;
    }

    world() {
        const g = this.game, s = g.stats, h = g.longHistory, st = g.world.stats();
        const wt = Object.values(s.weather).reduce((a, b) => a + b, 0) || 1;
        const weather = Object.entries(s.weather).sort((a, b) => b[1] - a[1])
            .map(([k, v]) => ({ label: WEATHER[k] ? WEATHER[k].name : k, value: v, text: v >= 60 ? `${(v / 60).toFixed(1)} min` : `${Math.round(v)} s` }));
        const food = s.food;
        const foodBars = bars([
            { label: 'Plants', value: food.plants },
            { label: 'Seaweed', value: food.seaweed },
            { label: 'Moonflower nectar', value: food.nectar }
        ], SERIES.green);
        const lands = h.map(p => p.land);
        const isl = g.world.islands();
        const tiles = [
            tile('land tiles now', fmt(st.land), lands.length ? `range ${fmt(Math.min(...lands))} to ${fmt(Math.max(...lands))}` : ''),
            tile('islands', fmt(isl.count)),
            tile('highest point', st.peak.toFixed(1)),
            tile('deepest water', (st.deep * 10).toFixed(1)),
            tile('sea level', `${g.world.seaNow >= 0.36 ? '+' : ''}${Math.round((g.world.seaNow - 0.36) * 100)}`),
            tile('hawk dives', fmt(s.hawk.dives), `${pct(s.hawk.catches, s.hawk.dives)} successful`),
            tile('escaped hawks', fmt(s.hawk.escapes)),
            tile('times you fed', fmt(food.fed))
        ].join('');
        return `<div class="st-tiles">${tiles}</div>
            <div class="st-cols">${section('Weather so far', weather.length ? bars(weather, SERIES.blue, wt) : '<p class="hint">No weather yet.</p>')}
            ${section('What the Nomes ate', foodBars, 'In food units. Plants grow on land, seaweed in shallow water, nectar only at night.')}</div>`;
    }

    notables() {
        const g = this.game, list = g.creatures;
        if (!list.length) return '<p class="hint">No Nomes alive.</p>';
        const best = (f, dir = 1) => list.reduce((a, c) => (f(c) * dir > f(a) * dir ? c : a), list[0]);
        const items = [
            ['Oldest', best(c => c.age), c => `${Math.round(c.age)}s old`],
            ['Most children', best(c => c.children), c => `${c.children} children`],
            ['Newest generation', best(c => c.generation), c => `generation ${c.generation}`],
            ['Biggest', best(c => c.genes.size), c => geneText('size', c.genes.size)],
            ['Smallest', best(c => c.genes.size, -1), c => geneText('size', c.genes.size)],
            ['Fastest', best(c => c.genes.speed), c => `speed ${geneText('speed', c.genes.speed)}`],
            ['Sharpest eyes', best(c => c.genes.sight), c => `sight ${geneText('sight', c.genes.sight)}`],
            ['Best swimmer', best(c => c.genes.webbing), c => `webbed feet ${geneText('webbing', c.genes.webbing)}`],
            ['Most nocturnal', best(c => c.genes.nocturnal), c => `night life ${geneText('nocturnal', c.genes.nocturnal)}`],
            ['Furriest', best(c => c.genes.fur), c => `fur ${geneText('fur', c.genes.fur)}`],
            ['Most curious', best(c => c.genes.curiosity), c => `curiosity ${geneText('curiosity', c.genes.curiosity)}`],
            ['Longest life ahead', best(c => c.t.lifespan - c.age), c => `${Math.round(c.t.lifespan - c.age)}s left`]
        ];
        return `<div class="st-notables">${items.map(([title, c, val]) => `
            <button class="st-notable" data-nome="${c.id}" title="Show ${esc(c.name)} on the island">
                <i style="background:#${c.color.getHexString()}"></i>
                <span><small>${esc(title)}</small><b>${esc(c.name)}</b><em>${esc(val(c))}</em></span>
            </button>`).join('')}</div><p class="hint">Click a Nome to find it on the island.</p>`;
    }

    // ---------- Charts ----------

    addChart(title, points, color) {
        this.charts.push({ type: 'line', title, points, color });
    }

    addSpark(points, min, max) {
        this.charts.push({ type: 'spark', points, min, max });
    }

    drawCharts() {
        this.charts.forEach((c, i) => {
            const cv = document.querySelector(c.type === 'line' ? `canvas[data-chart="${i}"]` : `canvas[data-spark="${i}"]`);
            if (!cv) return;
            if (c.type === 'line') this.drawLine(cv, c, i);
            else this.drawSpark(cv, c);
        });
    }

    prep(cv) {
        const r = cv.getBoundingClientRect();
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        cv.width = Math.max(1, Math.round(r.width * dpr));
        cv.height = Math.max(1, Math.round(r.height * dpr));
        const ctx = cv.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { ctx, W: r.width, H: r.height };
    }

    drawLine(cv, c, i) {
        const { ctx, W, H } = this.prep(cv);
        const pts = c.points.filter(p => p[1] != null);
        if (pts.length < 2) return;
        const padL = 34, padR = 8, padT = 8, padB = 18;
        const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
        const vmax = Math.max(1, ...pts.map(p => p[1]));
        const top = Math.ceil(vmax / Math.pow(10, Math.floor(Math.log10(vmax)))) * Math.pow(10, Math.floor(Math.log10(vmax)));
        const x = t => padL + (t - t0) / Math.max(1, t1 - t0) * (W - padL - padR);
        const y = v => padT + (1 - v / top) * (H - padT - padB);
        const ink = 'rgba(236,228,208,0.55)', grid = 'rgba(236,228,208,0.08)';
        ctx.font = '11px Figtree, sans-serif';
        ctx.fillStyle = ink;
        ctx.strokeStyle = grid;
        ctx.lineWidth = 1;
        for (const v of [0, top / 2, top]) {
            ctx.beginPath();
            ctx.moveTo(padL, y(v));
            ctx.lineTo(W - padR, y(v));
            ctx.stroke();
            ctx.textAlign = 'right';
            ctx.fillText(fmt(v), padL - 6, y(v) + 4);
        }
        // Year ticks along the bottom.
        ctx.textAlign = 'center';
        const y0 = Math.ceil(t0 / YEAR_LENGTH), y1 = Math.floor(t1 / YEAR_LENGTH);
        const stepY = Math.max(1, Math.ceil((y1 - y0 + 1) / 8));
        for (let yr = y0; yr <= y1; yr += stepY) {
            const xx = x(yr * YEAR_LENGTH);
            ctx.fillText('Y' + (yr + 1), xx, H - 4);
            ctx.beginPath();
            ctx.moveTo(xx, padT);
            ctx.lineTo(xx, H - padB);
            ctx.stroke();
        }
        ctx.beginPath();
        pts.forEach((p, k) => (k ? ctx.lineTo : ctx.moveTo).call(ctx, x(p[0]), y(p[1])));
        ctx.strokeStyle = c.color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();
        const last = pts[pts.length - 1];
        const now = document.querySelector(`[data-now="${i}"]`);
        if (now) now.textContent = fmt(last[1]) + ' now';

        // Crosshair and tooltip.
        const tip = document.querySelector(`[data-tip="${i}"]`);
        cv.onpointermove = e => {
            const r = cv.getBoundingClientRect();
            const mx = e.clientX - r.left;
            let bestK = 0, bd = Infinity;
            pts.forEach((p, k) => { const d = Math.abs(x(p[0]) - mx); if (d < bd) { bd = d; bestK = k; } });
            const p = pts[bestK];
            this.drawLine(cv, c, i);
            const ctx2 = cv.getContext('2d');
            ctx2.strokeStyle = 'rgba(236,228,208,0.35)';
            ctx2.lineWidth = 1;
            ctx2.beginPath();
            ctx2.moveTo(x(p[0]), padT);
            ctx2.lineTo(x(p[0]), H - padB);
            ctx2.stroke();
            ctx2.fillStyle = c.color;
            ctx2.strokeStyle = '#142628';
            ctx2.lineWidth = 2;
            ctx2.beginPath();
            ctx2.arc(x(p[0]), y(p[1]), 4, 0, Math.PI * 2);
            ctx2.fill();
            ctx2.stroke();
            const yr = Math.floor(p[0] / YEAR_LENGTH) + 1;
            const season = ['spring', 'summer', 'autumn', 'winter'][Math.floor((p[0] % YEAR_LENGTH) / YEAR_LENGTH * 4)];
            tip.innerHTML = `<b>${fmt(p[1])}</b> ${esc(c.title.toLowerCase())}<br><small>year ${yr}, ${season}</small>`;
            tip.style.display = 'block';
            const left = Math.min(Math.max(0, x(p[0]) + 10), W - tip.offsetWidth);
            tip.style.left = left + 'px';
            tip.style.top = '4px';
        };
        cv.onpointerleave = () => { tip.style.display = 'none'; this.drawLine(cv, c, i); };
    }

    drawSpark(cv, c) {
        const { ctx, W, H } = this.prep(cv);
        const pts = c.points.filter(p => p[1] != null);
        ctx.strokeStyle = 'rgba(236,228,208,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, H / 2);
        ctx.lineTo(W, H / 2);
        ctx.stroke();
        if (pts.length < 2) return;
        const t0 = pts[0][0], t1 = pts[pts.length - 1][0];
        const x = t => 2 + (t - t0) / Math.max(1, t1 - t0) * (W - 4);
        // Zoom in on the movement, but never closer than 15% of the gene's range.
        const vals = pts.map(p => p[1]);
        const lo = Math.min(...vals), hi = Math.max(...vals), mid = (lo + hi) / 2;
        const span = Math.max(hi - lo, (c.max - c.min) * 0.15) * 1.15;
        const y = v => 3 + (1 - (v - (mid - span / 2)) / span) * (H - 6);
        ctx.beginPath();
        pts.forEach((p, k) => (k ? ctx.lineTo : ctx.moveTo).call(ctx, x(p[0]), y(p[1])));
        ctx.strokeStyle = SERIES.blue;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();
    }
}
