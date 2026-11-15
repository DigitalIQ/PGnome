import { GENES, BIOMES, WEATHER, YEAR_LENGTH, MODES, FOODS, HAWK_GENES, LURKER_GENES, PROWLER_GENES, DISASTERS, legCount, eyeCount, patternName } from './config.js';
import { STAT_GENES } from './game.js';
import { scoreOf } from './scores.js';

// The statistics window. It reads either the running game or an archived run from the
// record board (see runs.js). Both offer the same fields. Nothing here changes the game,
// except the "show me" buttons on the notables tab of the running game.

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString('en-US');
const pct = (a, b) => (b ? Math.round(a / b * 100) : 0) + '%';
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const TABS = [['overview', 'Overview'], ['population', 'Population'], ['genes', 'Genes'], ['body', 'Body'], ['food', 'Food'], ['dangers', 'Dangers'], ['deaths', 'Deaths'], ['world', 'World'], ['notables', 'Notables']];

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

// The record holders on the notables tab: title, value to compare, direction, text.
export const NOTABLES = [
    ['Oldest', c => c.age, 1, c => `${Math.round(c.age)}s old`],
    ['Most children', c => c.children, 1, c => `${c.children} children`],
    ['Newest generation', c => c.generation, 1, c => `generation ${c.generation}`],
    ['Biggest', c => c.genes.size, 1, c => geneText('size', c.genes.size)],
    ['Smallest', c => c.genes.size, -1, c => geneText('size', c.genes.size)],
    ['Fastest', c => c.genes.speed, 1, c => `speed ${geneText('speed', c.genes.speed)}`],
    ['Sharpest eyes', c => c.genes.sight, 1, c => `sight ${geneText('sight', c.genes.sight)}`],
    ['Best swimmer', c => c.genes.webbing + c.genes.lungs * 0.5, 1, c => `webbed feet ${geneText('webbing', c.genes.webbing)}, lungs ${geneText('lungs', c.genes.lungs)}`],
    ['Most nocturnal', c => c.genes.nocturnal, 1, c => `night life ${geneText('nocturnal', c.genes.nocturnal)}`],
    ['Furriest', c => c.genes.fur, 1, c => `fur ${geneText('fur', c.genes.fur)}`],
    ['Most curious', c => c.genes.curiosity, 1, c => `curiosity ${geneText('curiosity', c.genes.curiosity)}`],
    ['Most loyal to its island', c => c.genes.homing, 1, c => `island loyalty ${geneText('homing', c.genes.homing)}`],
    ['Most poison-proof', c => c.genes.toxinRes, 1, c => `tolerance ${geneText('toxinRes', c.genes.toxinRes)}`],
    ['Most alert', c => c.genes.vigilance, 1, c => `alertness ${geneText('vigilance', c.genes.vigilance)}`],
    ['Best digger', c => c.genes.claws, 1, c => `claws ${geneText('claws', c.genes.claws)}`],
    ['Busiest builder', c => c.genes.builder, 1, c => `building drive ${geneText('builder', c.genes.builder)}`],
    ['Longest life ahead', c => c.t.lifespan - c.age, 1, c => `${Math.round(c.t.lifespan - c.age)}s left`]
];

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

    // source is the running game, or an archived run opened from the record board.
    show(source = null) {
        this.source = source;
        if (source && !TABS.some(([k]) => k === this.tab)) this.tab = 'overview';
        $('stats').classList.remove('hidden');
        this.render();
    }

    get g() { return this.source || this.game; }

    hide() {
        $('stats').classList.add('hidden');
    }

    render() {
        document.querySelectorAll('#stats-tabs .tab').forEach(b => {
            const on = b.dataset.tab === this.tab;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on);
        });
        const g = this.g;
        $('stats-sub').textContent = `${g.islandName} · ${(MODES[g.mode] || MODES.classic).name} · seed ${g.seed} · year ${g.year}, ${g.seasonName.toLowerCase()}`
            + (g.archived ? ` · saved run from ${new Date(g.savedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}${g.ended ? ', died out' : ''}` : '');
        $('stats-title').textContent = g.archived ? 'Run statistics' : 'Statistics';
        this.charts = [];
        $('stats-body').innerHTML = this[this.tab]();
        $('stats-body').scrollTop = 0;
        this.drawCharts();
    }

    // ---------- Tabs ----------

    overview() {
        const g = this.g, s = g.stats;
        // An archived run shows how many were alive when it was saved.
        const n = g.archived ? (g.ended ? 0 : g.sampleOf || g.creatures.length) : g.creatures.length;
        const years = Math.max(1 / 4, g.time / YEAR_LENGTH);
        const avgAge = g.creatures.length ? g.creatures.reduce((a, c) => a + c.age, 0) / g.creatures.length : 0;
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
            tile('caught by predators', fmt(s.hawk.catches + s.lurker.catches + s.prowler.catches), `${fmt(s.hawk.catches)} hawks, ${fmt(s.lurker.catches)} lurkers, ${fmt(s.prowler.catches)} prowlers`),
            tile('species now', fmt(g.species.filter(sp => sp.n >= 4).length || 1), `${fmt(s.speciesSeen || 1)} so far`),
            tile('poisoned', fmt(s.poison.cases), `${fmt(s.poison.spat)} times spat out`),
            tile('disasters', fmt(s.disasters.length)),
            tile('crowding stress', Math.round((g.meanStress || 0) * 100) + '%', `${fmt(s.fights || 0)} fights over food`),
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
        const g = this.g, h = g.longHistory;
        if (h.length < 2) return '<p class="hint">Long-term charts build up from a sample every 10 seconds. Come back in a moment.</p>';
        const where = g.whereNomesLive(), n = g.creatures.length;
        const counts = g.biomeCounts();
        this.addChart('Nomes alive', h.map(p => [p.t, p.pop]), SERIES.green);
        this.addChart('Living on other islands', h.map(p => [p.t, p.sat ?? 0]), SERIES.aqua);
        this.addChart('On the far and remote islands', h.map(p => [p.t, (p.far ?? 0) + (p.rem ?? 0)]), SERIES.blue);
        this.addChart('Land tiles', h.map(p => [p.t, p.land]), SERIES.blue);
        this.addChart('Hawks hunting', h.map(p => [p.t, p.hawks ?? 0]), SERIES.orange);
        this.addChart('Lurkers', h.map(p => [p.t, p.lurkers ?? 0]), SERIES.yellow);
        this.addChart('Crowding stress (%)', h.map(p => [p.t, Math.round((p.stress ?? 0) * 100)]), SERIES.red);
        this.addChart('Prowlers', h.map(p => [p.t, p.prowlers ?? 0]), SERIES.magenta);
        this.addChart('Species', h.map(p => [p.t, p.species ?? 1]), SERIES.violet);
        const charts = this.charts.map((c, i) => `<figure class="st-chart"><figcaption>${esc(c.title)}<span data-now="${i}"></span></figcaption>
            <div class="st-canvas"><canvas data-chart="${i}"></canvas><div class="st-tip" data-tip="${i}"></div></div></figure>`).join('');
        const whereBars = bars([
            { label: 'Main island', value: where.main },
            { label: 'Near islands', value: where.near ?? where.satellite, title: 'Behind a shallow strait every swimmer crosses' },
            { label: 'Far island', value: where.far ?? 0, title: 'Behind a deep strait. Only strong swimmers with good lungs cross' },
            { label: 'Remote island', value: where.remote ?? 0, title: 'Out in deep sea. Only driftwood or a falling sea brings Nomes here' },
            { label: 'New land', value: where.other ?? 0, title: 'Land from lava, or pieces split off by an earthquake' },
            { label: 'In the water', value: where.water }
        ], SERIES.aqua, n);
        const biomeBars = bars(BIOMES.map((b, i) => ({ label: b.name, value: counts[i] })).filter(r => r.label !== 'Water'), SERIES.green, n);
        const spBars = bars(g.species.filter(sp => sp.n > 0).map(sp => ({ label: sp.name, value: sp.n, title: `${sp.name}: ${sp.n} Nomes, since year ${sp.since}${sp.from ? `, split from the ${sp.from}` : ''}` })), SERIES.violet);
        return `${section('Species', spBars, 'Nomes that can still have young together form one species. Populations whose genes or colors drift too far apart split into new ones.')}
            ${section('Over time', `<div class="st-charts">${charts}</div>`, 'Each chart has its own scale. Hover a chart to read exact values.')}
            <div class="st-cols">${section('Where they live', whereBars)}${section('Ground under their feet', biomeBars)}</div>`;
    }

    genes() {
        const g = this.g, h = g.longHistory, n = g.creatures.length;
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
        const sample = g.sampleOf ? ` Based on ${g.creatures.length} of ${g.sampleOf} Nomes saved with this run.` : '';
        return section('Every gene', `<div class="st-gene-head"><span>Gene</span><span>Spread today</span><span>Average over time</span><span>Average now</span></div>${rows}`,
            'Spread: how many Nomes sit at each value from low (left) to high (right). The line shows how the average moved since the island began. The arrow compares today with the first sample.' + sample);
    }

    body() {
        const g = this.g, n = g.creatures.length;
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
            { label: 'Deep-water swimmers', value: count(c => c.t.swimmer && c.t.swimmer <= 0.09), title: 'Feet and lungs good enough for the deep strait to the far island' },
            { label: 'Loyal to their island', value: count(c => c.genes.homing > 0.6), title: 'Island loyalty over 60%' },
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
        const g = this.g, s = g.stats;
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
        const g = this.g, s = g.stats, h = g.longHistory, st = g.worldNow();
        const wt = Object.values(s.weather).reduce((a, b) => a + b, 0) || 1;
        const weather = Object.entries(s.weather).sort((a, b) => b[1] - a[1])
            .map(([k, v]) => ({ label: WEATHER[k] ? WEATHER[k].name : k, value: v, text: v >= 60 ? `${(v / 60).toFixed(1)} min` : `${Math.round(v)} s` }));
        const food = s.food;
        const lastH = h[h.length - 1];
        const foodBars = bars([
            { label: 'Burrows now', value: lastH ? lastH.burrows || 0 : 0, noShare: true },
            { label: 'Fires burned out', value: s.burned, noShare: true },
            { label: 'Lightning strikes', value: s.strikes, noShare: true }
        ], SERIES.green);
        const lands = h.map(p => p.land);
        const tiles = [
            tile('land tiles now', fmt(st.land), lands.length ? `range ${fmt(Math.min(...lands))} to ${fmt(Math.max(...lands))}` : ''),
            tile('islands', fmt(st.islands)),
            tile('highest point', st.peak.toFixed(1)),
            tile('deepest water', (st.deep * 10).toFixed(1)),
            tile('sea level', `${st.sea >= 0.36 ? '+' : ''}${Math.round((st.sea - 0.36) * 100)}`),
            tile('seabed washed out', fmt(st.scoured || 0), 'tiles where grazing deepened the water'),
            tile('swept out on driftwood', fmt((s.drift && s.drift.out) || 0), `${fmt((s.drift && s.drift.landed) || 0)} reached another island`),
            tile('hawk dives', fmt(s.hawk.dives), `${pct(s.hawk.catches, s.hawk.dives)} successful`),
            tile('escaped hawks', fmt(s.hawk.escapes)),
            tile('burrows dug', fmt(s.work.burrows)),
            tile('dams finished', fmt(s.work.dams), 'tiles of new land'),
            tile('tiles planted', fmt(s.work.planted)),
            tile('marshes drained', fmt(s.work.drained))
        ].join('');
        return `<div class="st-tiles">${tiles}</div>
            <div class="st-cols">${section('Weather so far', weather.length ? bars(weather, SERIES.blue, wt) : '<p class="hint">No weather yet.</p>')}
            ${section('Marks on the land', foodBars, 'Burrows shelter from hawks, hail and cold. Fire turns forest into fertile meadow.')}</div>`;
    }

    food() {
        const g = this.g, s = g.stats, h = g.longHistory, f = s.food;
        const eaten = Object.keys(FOODS).map(k => ({ label: FOODS[k].name, value: (f[k] || 0) + (k === 'greens' ? f.plants || 0 : 0) }));
        const { avail, tox, toxic } = g.foodNow();
        const availBars = bars(Object.keys(avail).map(k => ({ label: FOODS[k].name, value: avail[k], text: avail[k].toFixed(1) })), SERIES.aqua);
        const n = g.creatures.length;
        const resAvg = n ? g.creatures.reduce((a, c) => a + c.genes.toxinRes, 0) / n : 0;
        const palAvg = n ? g.creatures.reduce((a, c) => a + c.genes.palate, 0) / n : 0;
        if (h.length >= 2) {
            this.addChart('Plant poison (average)', h.map(p => [p.t, Math.round((p.tox ?? 0) * 100)]), SERIES.violet);
            const ri = Object.keys(GENES).filter(k => k !== 'hue' && k !== 'hue2').indexOf('toxinRes');
            this.addChart('Nome poison tolerance (average)', h.map(p => [p.t, Math.round(((p.g && p.g[ri]) ?? 0) * 100)]), SERIES.magenta);
        }
        const charts = this.charts.map((c, i) => `<figure class="st-chart"><figcaption>${esc(c.title)}<span data-now="${i}"></span></figcaption>
            <div class="st-canvas"><canvas data-chart="${i}"></canvas><div class="st-tip" data-tip="${i}"></div></div></figure>`).join('');
        const tiles = [
            tile('plant poison now', Math.round(tox * 100) + '%', `${fmt(toxic)} tiles with warning colors`),
            tile('poison tolerance', Math.round(resAvg * 100) + '%', 'Nome average'),
            tile('taste', Math.round(palAvg * 100) + '%', 'Nome average'),
            tile('poisoned', fmt(s.poison.cases)),
            tile('spat out', fmt(s.poison.spat)),
            tile('times you fed', fmt(f.fed))
        ].join('');
        return `<div class="st-tiles">${tiles}</div>
            ${charts ? section('The poison race', `<div class="st-charts">${charts}</div>`, 'Plants that get eaten turn bitter. Nomes answer with tolerance or taste. Poison costs plants growth, so it fades where nobody grazes.') : ''}
            <div class="st-cols">${section('What the Nomes ate', bars(eaten, SERIES.green), 'In food units, since the start.')}
            ${section('Food on the island now', availBars, 'Fruit grows in summer, nuts in autumn and last into winter, mushrooms after rain. Roots need claws.')}</div>`;
    }

    dangers() {
        const g = this.g, s = g.stats, h = g.longHistory;
        const hk = Object.keys(HAWK_GENES), lk = Object.keys(LURKER_GENES);
        const now = (list, table) => {
            if (!list.length) return '<p class="hint">None right now.</p>';
            return bars(Object.entries(table).map(([k, d]) => {
                const v = list.reduce((a, p) => a + p.genes[k], 0) / list.length;
                return { label: d.label, value: (v - d.min) / (d.max - d.min) * 100, text: d.max === 1 ? Math.round(v * 100) + '%' : v >= 100 ? Math.round(v) + 's' : v.toFixed(2), noShare: true };
            }), SERIES.orange, null, 100);
        };
        const hawks = g.hawks.filter(x => !x.leaving), lurkers = g.lurkers, prowlers = g.prowlers;
        const pk = Object.keys(PROWLER_GENES);
        if (h.length >= 2) {
            // Only samples with predators alive; values as 0 to 100 of each gene range.
            const series = (key, table, keys, k) => {
                const d = table[k], i = keys.indexOf(k);
                return h.filter(p => p[key]).map(p => [p.t, Math.round((p[key][i] - d.min) / (d.max - d.min) * 100)]);
            };
            const add = (title, pts, color) => { if (pts.length >= 2) this.addChart(title, pts, color); };
            add('Hawk night hunting', series('hg', HAWK_GENES, hk, 'night'), SERIES.violet);
            add('Hawk dive speed', series('hg', HAWK_GENES, hk, 'dive'), SERIES.orange);
            add('Hawk stealth', series('hg', HAWK_GENES, hk, 'stealth'), SERIES.blue);
            add('Hawk size', series('hg', HAWK_GENES, hk, 'size'), SERIES.aqua);
            add('Lurker camouflage', series('lg', LURKER_GENES, lk, 'camo'), SERIES.yellow);
            add('Lurker venom', series('lg', LURKER_GENES, lk, 'venom'), SERIES.magenta);
            add('Prowler sprint speed', series('pg', PROWLER_GENES, pk, 'speed'), SERIES.red);
            add('Prowler nose', series('pg', PROWLER_GENES, pk, 'scent'), SERIES.green);
        }
        const charts = this.charts.map((c, i) => `<figure class="st-chart"><figcaption>${esc(c.title)}<span data-now="${i}"></span></figcaption>
            <div class="st-canvas"><canvas data-chart="${i}"></canvas><div class="st-tip" data-tip="${i}"></div></div></figure>`).join('');
        const tiles = [
            tile('hawks now', fmt(hawks.length), `${fmt(s.hawk.born)} born, ${fmt(s.hawk.died)} died`),
            tile('hawk dives', fmt(s.hawk.dives), `${pct(s.hawk.catches, s.hawk.dives)} successful`),
            tile('lurkers now', fmt(lurkers.length), `${fmt(s.lurker.born)} born, ${fmt(s.lurker.died)} died`),
            tile('lurker strikes', fmt(s.lurker.strikes), `${pct(s.lurker.catches, s.lurker.strikes)} successful`),
            tile('prowlers now', fmt(prowlers.length), `${fmt(s.prowler.born)} born, ${fmt(s.prowler.died)} died`),
            tile('prowler chases', fmt(s.prowler.chases), `${pct(s.prowler.catches, s.prowler.chases)} successful, ${fmt(s.prowler.escapes)} outrun`),
            tile('alarm calls', fmt(s.alarms || 0)),
            tile('plague cases', fmt(s.plague.cases)),
            tile('land made by lava', fmt(s.landMade || 0))
        ].join('');
        const ds = s.disasters.slice().reverse();
        const list = ds.length ? `<table class="st-table"><thead><tr><th>Year</th><th>Disaster</th><th>Nomes before</th><th>A minute later</th></tr></thead><tbody>
            ${ds.map(e => `<tr><td>${e.y}</td><td>${esc(DISASTERS[e.kind].name)}</td><td>${fmt(e.before)}</td><td>${e.after == null ? '...' : fmt(e.after)}</td></tr>`).join('')}</tbody></table>`
            : '<p class="hint">No disaster yet. You can unleash one in the settings under World.</p>';
        return `<div class="st-tiles">${tiles}</div>
            ${charts ? section('How the hunters evolve', `<div class="st-charts">${charts}</div>`, 'Predators that hunt well raise young and pass on their genes. 0 to 100 of each gene range.') : ''}
            <div class="st-cols">${section('Hawk genes now', now(hawks, HAWK_GENES))}${section('Lurker genes now', now(lurkers, LURKER_GENES))}</div>
            <div class="st-cols">${section('Prowler genes now', now(prowlers, PROWLER_GENES))}</div>
            ${section('Disasters', list)}`;
    }

    notables() {
        const g = this.g, list = g.creatures;
        if (!list.length) return '<p class="hint">No Nomes alive.</p>';
        const best = (f, dir = 1) => list.reduce((a, c) => (f(c) * dir > f(a) * dir ? c : a), list[0]);
        const items = NOTABLES.map(([title, f, dir, val]) => [title, best(f, dir), val]);
        const card = ([title, c, val]) => {
            const inner = `<i style="background:#${c.color.getHexString()}"></i>
                <span><small>${esc(title)}</small><b>${esc(c.name)}</b><em>${esc(val(c))}</em></span>`;
            return g.archived ? `<div class="st-notable">${inner}</div>`
                : `<button class="st-notable" data-nome="${c.id}" title="Show ${esc(c.name)} on the island">${inner}</button>`;
        };
        return `<div class="st-notables">${items.map(card).join('')}</div>
            <p class="hint">${g.archived ? 'The Nomes as they were when this run was last saved.' : 'Click a Nome to find it on the island.'}</p>`;
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
