import { GENES, GOALS, BIOMES, MAX_POP, MODES, legCount, eyeCount, patternName } from './config.js';
import { isWalkable } from './world.js';
import { loadRecords } from './scores.js';
import { storedRunIds } from './runs.js';
import { describeBody, accentColor } from './body.js';

const WEATHER_ICONS = {
    clear: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    cloudy: '<path d="M7 18h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 18z"/>',
    rain: '<path d="M7 14h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 14z"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/>',
    storm: '<path d="M7 13h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 13z"/><path d="M13 13l-3 4.5h4l-3 4.5"/>',
    fog: '<path d="M4 9h16M3 13h18M5 17h14"/>',
    heat: '<circle cx="12" cy="12" r="5.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/><path d="M10 12h4" />',
    snow: '<path d="M7 13h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 13z"/><path d="M8 17v.01M12 19v.01M16 17v.01M10 21v.01M14 21v.01"/>',
    windy: '<path d="M3 9h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 17h7"/>',
    drizzle: '<path d="%C"/><path d="M9 17v1M13 18v1M17 17v1"/>',
    downpour: '<path d="%C"/><path d="M7 16l-1.5 5M11 16l-1.5 5M15 16l-1.5 5M19 16l-1.5 5"/>',
    hail: '<path d="%C"/><circle cx="8" cy="18" r="1.2"/><circle cx="12.5" cy="20" r="1.2"/><circle cx="16.5" cy="17.5" r="1.2"/>',
    sandstorm: '<path d="M3 8h13M5 12h16M3 16h12M8 20h9"/><circle cx="18.5" cy="8" r="1"/>',
    blizzard: '<path d="%C"/><path d="M6 17l3 1M11 19l3 1M16 16l3 1M8 21v.01M14 22v.01"/>',
    frost: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2 3-2M9 20l3-2 3 2"/>',
    rainbow: '<path d="M2 18a10 10 0 0 1 20 0M5.5 18a6.5 6.5 0 0 1 13 0M9 18a3 3 0 0 1 6 0"/>',
    aurora: '<path d="M3 16c3-8 5 4 9-4s6 3 9-5M3 20c3-6 6 2 9-3s6 2 9-3"/>'
};
for (const k in WEATHER_ICONS) WEATHER_ICONS[k] = WEATHER_ICONS[k].replace('%C', 'M7 13h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 13z');
const WEATHER_HINTS = {
    clear: 'Normal growth', cloudy: 'Mild', rain: 'Plants grow fast', storm: 'Seek forests',
    fog: 'Few eyes, little sight', heat: 'Plants dry out', snow: 'Fur pays off',
    windy: 'Small Nomes struggle', drizzle: 'Plants like it', downpour: 'The sea rises', hail: 'Hide in forests',
    sandstorm: 'Hard to see', blizzard: 'Huddle or freeze', frost: 'Nothing grows', rainbow: 'Spirits lifted',
    aurora: 'Spirits lifted'
};

function bodyGeneText(k, v) {
    if (k === 'legs') return legCount(v);
    if (k === 'eyes') return eyeCount(v);
    if (k === 'pattern') return patternName(v);
    if (k === 'horns') return v > 0.5 ? (v > 0.8 ? 'big' : 'small') : 'none';
    if (k === 'bodyLen') return v.toFixed(2) + 'x';
    return Math.round(v * 100) + '%';
}

const $ = id => document.getElementById(id);
const SEASON_COLORS = ['#9bd36e', '#f0b04a', '#d9783b', '#6fb3e0'];
const POOL_KEYS = Object.keys(GENES).filter(k => k !== 'hue' && k !== 'hue2');

function fmtGene(k, v) {
    if (GENES[k] && GENES[k].body) return bodyGeneText(k, v);
    if (k === 'pigment') return (v < 0.35 ? 'dark ' : v > 0.65 ? 'light ' : 'medium ') + Math.round(v * 100) + '%';
    if (GENES[k] && GENES[k].max === 1) return Math.round(v * 100) + '%';
    if (k === 'size') return v.toFixed(2) + 'x';
    if (k === 'speed') return v.toFixed(2);
    if (k === 'sight') return v.toFixed(1);
    if (k === 'sociability') return Math.round(v * 100) + '%';
    if (k === 'lifespan') return Math.round(v) + 's';
    return Math.round(v);
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class UI {
    constructor(game, actions) {
        this.game = game;
        this.actions = actions;
        this.selKey = null;
        this.lastHistoryLen = -1;
        this.poolTimer = 0;
        this.bind();
    }

    bind() {
        const { game, actions } = this;
        document.querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => actions.setTool(b.dataset.tool)));
        document.querySelectorAll('.speed button').forEach(b => b.addEventListener('click', () => actions.setSpeed(+b.dataset.speed)));
        $('mutation').addEventListener('input', e => {
            game.mutationRate = +e.target.value;
            $('mut-out').textContent = game.mutationRate.toFixed(1);
        });
        $('btn-spawn').addEventListener('click', () => actions.spawnPair());
        $('hawks').addEventListener('change', e => {
            game.hawksOn = e.target.checked;
            game.hawkTimer = 0;
        });
        $('disasters').addEventListener('change', e => { game.disastersOn = e.target.checked; });
        $('btn-disaster').addEventListener('click', () => {
            if (!game.world || game.extinct) return;
            if (!game.disasters.trigger($('disaster-kind').value)) this.toast('Nothing happens', 'The island has nothing for this disaster right now.');
        });
        $('btn-new').addEventListener('click', () => actions.showStart());
        $('sel-close').addEventListener('click', () => actions.select(null));
        $('btn-panel').addEventListener('click', () => $('right').classList.toggle('open'));
        $('btn-start').addEventListener('click', () => actions.newWorld($('seed-input').value));
        $('btn-continue').addEventListener('click', () => actions.continueSaved());
        $('btn-reseed').addEventListener('click', () => actions.reseed());
        $('btn-new2').addEventListener('click', () => actions.showStart());
        $('seed-input').addEventListener('keydown', e => { if (e.key === 'Enter') actions.newWorld(e.target.value); });
        document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => actions.setMode(b.dataset.mode)));
        $('btn-records').addEventListener('click', () => actions.showRecords());
        $('btn-stats').addEventListener('click', () => actions.showStats());
        $('btn-settings').addEventListener('click', () => this.openSettings());
        $('btn-all-records').addEventListener('click', () => actions.showRecords());
        $('records-close').addEventListener('click', () => actions.closeRecords());
        $('records').addEventListener('click', e => { if (e.target.id === 'records') actions.closeRecords(); });
        document.querySelectorAll('#records .tab').forEach(b => b.addEventListener('click', () => {
            this.recordScope = b.dataset.scope;
            this.renderRecords();
        }));
        window.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !$('records').classList.contains('hidden')) actions.closeRecords();
        });
        this.recordScope = 'all';
        this.weatherKey = null;

        game.on('log', e => this.addLog(e));
        game.on('goal', g => this.toast('Goal reached', g.label));
        game.on('extinct', () => this.showExtinct());
        game.on('disaster', k => this.toast('Disaster', { quake: 'Earthquake', volcano: 'Volcano eruption', tsunami: 'Tsunami', wildfire: 'Wildfire', plague: 'Plague' }[k]));
        game.on('reset', () => {
            $('log').innerHTML = '';
            $('mutation').value = game.mutationRate;
            $('hawks').checked = game.hawksOn;
            $('disasters').checked = game.disastersOn;
            $('mut-out').textContent = game.mutationRate.toFixed(1);
            $('seed-info').textContent = `Seed ${game.seed}`;
            this.lastHistoryLen = -1;
            this.islandPrev = null;
            this.weatherKey = null;
            this.renderGoals();
            this.renderSelection(true);
            this.update(1);
        });
    }

    // Opens the world settings in the side panel and scrolls them into view.
    openSettings() {
        const d = $('world-settings');
        const right = $('right');
        const shown = d.open && (right.classList.contains('open') || getComputedStyle($('world-panel')).display !== 'none');
        if (shown && d.dataset.byButton) {
            d.open = false;
            delete d.dataset.byButton;
            right.classList.remove('open');
            return;
        }
        right.classList.add('open');
        d.open = true;
        d.dataset.byButton = '1';
        d.scrollIntoView({ block: 'start' });
        d.classList.remove('flash');
        void d.offsetWidth;
        d.classList.add('flash');
    }

    setTool(tool) {
        document.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
        $('game').dataset.tool = tool;
    }

    setSpeed(paused, speed) {
        document.querySelectorAll('.speed button').forEach(b => {
            const v = +b.dataset.speed;
            b.classList.toggle('active', paused ? v === 0 : v === speed);
        });
    }

    setMode(mode) {
        document.querySelectorAll('.mode').forEach(b => {
            const on = b.dataset.mode === mode;
            b.classList.toggle('active', on);
            b.setAttribute('aria-checked', on);
        });
    }

    // ---------- Records ----------

    recordRows(list, limit, highlight) {
        if (!list.length) return '<p class="hint">No records yet. Keep a population alive for a while.</p>';
        const date = ts => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
        // Runs with saved statistics get a button. The run being played shows live numbers.
        const runs = storedRunIds();
        const live = this.game.run && this.game.world && !this.game.extinct ? this.game.run.id : null;
        const statBtn = r => (runs.has(r.id) || r.id === live
            ? `<button class="icon-btn rec-stats" data-run="${esc(r.id)}" title="Statistics of this run" aria-label="Statistics of ${esc(r.name)}"><svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg></button>`
            : '<span class="rec-stats none" title="No statistics saved for this run"></span>');
        return `<ol class="records">${list.slice(0, limit).map((r, i) => `
            <li class="${r.id === highlight ? 'me' : ''}">
                <span class="rk">${i + 1}</span>
                <span class="nm"><b>${esc(r.name)}</b><small>${r.mode === 'living' ? 'Living' : 'Classic'} · ${date(r.date)}${r.ended ? '' : ' · alive'}</small></span>
                <span class="st"><small>${r.years.toFixed(1)} y · gen ${r.gen} · peak ${r.peak}</small></span>
                <span class="sc">${r.score}</span>
                ${statBtn(r)}
            </li>`).join('')}</ol>`;
    }

    renderRecords() {
        const g = this.game;
        let list = loadRecords();
        if (this.recordScope === 'island') list = list.filter(r => r.seed === g.seed);
        document.querySelectorAll('#records .tab').forEach(b => b.classList.toggle('active', b.dataset.scope === this.recordScope));
        document.querySelector('#records .tab[data-scope="island"]').textContent = g.seed != null ? g.islandName : 'This island';
        $('records-list').innerHTML = this.recordRows(list, 15, g.run && g.run.id);
    }

    showRecords() {
        this.renderRecords();
        $('records').classList.remove('hidden');
    }

    hideRecords() {
        $('records').classList.add('hidden');
    }

    showStart(hasSave) {
        $('start-records').innerHTML = this.recordRows(loadRecords(), 3, null);
        $('btn-continue').classList.toggle('hidden', !hasSave);
        $('start').classList.remove('hidden');
        $('extinct').classList.add('hidden');
        setTimeout(() => (hasSave ? $('btn-continue') : $('btn-start')).focus(), 50);
    }

    hideOverlays() {
        $('start').classList.add('hidden');
        $('extinct').classList.add('hidden');
    }

    showExtinct() {
        const g = this.game;
        const top = Object.entries(g.stats.causes).sort((a, b) => b[1] - a[1])[0];
        $('extinct-text').textContent = `Your Nomes lasted until year ${g.year}, reached generation ${g.stats.maxGen} and peaked at ${g.stats.peakPop}. `
            + (top ? `Most common end: ${top[0]}.` : '');
        const rec = g.lastRecord;
        $('extinct-score').innerHTML = rec ? `<b>${rec.score}</b><span>points on ${esc(rec.entry.name)}</span>
            <small>${rec.islandRank === 1 ? 'Best run on this island.' : `Rank ${rec.islandRank} on this island.`} ${rec.kept ? `Rank ${rec.rank} overall.` : ''}</small>` : '';
        setTimeout(() => $('extinct').classList.remove('hidden'), 1400);
    }

    // ---------- Periodic update ----------

    update(dt) {
        const g = this.game;
        if (!g.world) return;
        $('season-name').textContent = g.seasonName;
        $('year').textContent = `Year ${g.year} · ${g.night > 0.5 ? 'night' : g.sunHeight < 0.25 ? (g.dayPhase < 0.5 ? 'dawn' : 'dusk') : 'day'}`;
        const ring = $('season-ring');
        ring.style.strokeDashoffset = (94.25 * (1 - g.seasonProgress)).toFixed(2);
        ring.style.stroke = SEASON_COLORS[g.seasonIndex];

        $('stat-pop').textContent = g.creatures.length;
        $('stat-gen').textContent = g.stats.maxGen;
        $('stat-births').textContent = g.stats.births;
        $('stat-deaths').textContent = g.stats.deaths;
        $('stat-pop').style.color = g.creatures.length >= MAX_POP ? 'var(--accent)' : '';

        const wk = g.weather.key;
        if (wk !== this.weatherKey) {
            this.weatherKey = wk;
            $('weather-icon').innerHTML = WEATHER_ICONS[wk];
            $('weather-name').textContent = g.weather.name;
            $('weather-hint').textContent = WEATHER_HINTS[wk];
            document.querySelector('.weather').dataset.w = wk;
        }

        // The history is capped, so its length stops changing. Redraw on the newest sample instead.
        const lastT = g.history.length ? g.history[g.history.length - 1].t : -1;
        if (lastT !== this.lastHistoryLen) {
            this.lastHistoryLen = lastT;
            this.drawChart();
        }
        this.poolTimer -= dt;
        if (this.poolTimer <= 0) {
            this.poolTimer = 1;
            this.renderPool();
            this.renderIsland();
        }
        this.renderSelection(false);
    }

    drawChart() {
        const cv = $('chart'), ctx = cv.getContext('2d');
        const W = cv.width, H = cv.height, pad = 6;
        ctx.clearRect(0, 0, W, H);
        const h = this.game.history;
        if (h.length < 2) {
            ctx.fillStyle = 'rgba(236,228,208,0.35)';
            ctx.font = '22px Figtree, sans-serif';
            ctx.fillText('Population graph starts in a moment', 12, H / 2 + 8);
            return;
        }
        const max = Math.max(10, ...h.map(p => p.pop));
        const step = (W - pad * 2) / (h.length - 1);
        for (let i = 0; i < h.length - 1; i++) {
            ctx.fillStyle = SEASON_COLORS[h[i].s] + '1c';
            ctx.fillRect(pad + i * step, 0, step + 1, H);
        }
        const y = v => H - pad - (v / max) * (H - pad * 2 - 14);
        ctx.beginPath();
        h.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, pad + i * step, y(p.pop)));
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#9bd36e';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.lineTo(pad + (h.length - 1) * step, H);
        ctx.lineTo(pad, H);
        ctx.closePath();
        ctx.fillStyle = 'rgba(155,211,110,0.15)';
        ctx.fill();
        ctx.fillStyle = 'rgba(236,228,208,0.6)';
        ctx.font = '600 20px Figtree, sans-serif';
        ctx.fillText(`peak ${max}`, W - 110, 20);
    }

    renderPool() {
        const g = this.game;
        const pool = g.genePool();
        const n = g.creatures.length;
        let html = '';
        for (const k of POOL_KEYS) {
            const def = GENES[k], p = pool[k];
            const pct = v => ((v - def.min) / (def.max - def.min)) * 100;
            const left = n ? pct(p.min) : 0, width = n ? Math.max(1.5, pct(p.max) - pct(p.min)) : 0;
            html += `<div class="gene"><div class="gene-label"><span>${def.label}</span><span>${n ? fmtGene(k, p.avg) : '-'}</span></div>
                <div class="gene-track${k === 'prefTemp' ? ' temp' : ''}"><div class="gene-range" style="left:${left}%;width:${width}%"></div>
                ${n ? `<div class="gene-avg" style="left:${pct(p.avg)}%"></div>` : ''}</div></div>`;
        }
        if (n) {
            const legs = { 2: 0, 4: 0, 6: 0 }, pats = { plain: 0, spotted: 0, striped: 0 };
            let horned = 0;
            for (const c of g.creatures) {
                legs[legCount(c.genes.legs)]++;
                pats[patternName(c.genes.pattern)]++;
                if (c.genes.horns > 0.5) horned++;
            }
            const pct = v => Math.round(v / n * 100) + '%';
            html += `<div class="plans"><span>Body plans</span>
                <p>${Object.entries(legs).filter(([, v]) => v).map(([k, v]) => `${k} legs ${pct(v)}`).join(' · ')}</p>
                <p>${Object.entries(pats).filter(([, v]) => v).map(([k, v]) => `${k} ${pct(v)}`).join(' · ')}${horned ? ` · horned ${pct(horned)}` : ''}</p></div>`;
        }
        $('genepool').innerHTML = html;
    }

    renderIsland() {
        const g = this.game, st = g.world.stats();
        const prev = this.islandPrev;
        if (!prev || g.time - prev.t > 20 || g.time < prev.t) this.islandPrev = { ...st, t: g.time };
        const arrow = (a, b, eps) => !g.world.living || !prev ? '' : a > b + eps ? ' <i class="up">&#9650;</i>' : a < b - eps ? ' <i class="down">&#9660;</i>' : '';
        const p = this.islandPrev;
        const sea = g.world.living ? `<div><b>${g.world.seaNow >= 0.36 ? '+' : ''}${Math.round((g.world.seaNow - 0.36) * 100)}</b><span>sea level</span></div>` : '';
        $('island-row').innerHTML = `<div><b>${st.land}${arrow(st.land, p.land, 2)}</b><span>land tiles</span></div>
            <div><b>${st.peak.toFixed(1)}${arrow(st.peak, p.peak, 0.1)}</b><span>highest</span></div>
            <div><b>${(st.deep * 10).toFixed(1)}${arrow(st.deep, p.deep, 0.01)}</b><span>deepest</span></div>${sea}
            <div><b>${g.hawks.filter(h => !h.leaving && !h.away).length}</b><span>hawks</span></div>
            <div><b>${g.lurkers.length}</b><span>lurkers</span></div>
            <div><b>${g.prowlers.length}</b><span>prowlers</span></div>
            <div><b>${g.species.filter(s => s.n >= 4).length || 1}</b><span>species</span></div>`;
        $('island-row').classList.toggle('living', g.world.living);
    }

    renderGoals() {
        const g = this.game;
        $('goals').innerHTML = GOALS.map(goal => `<li class="${g.goals[goal.id] ? 'done' : ''}">${goal.label}</li>`).join('');
        $('goal-count').textContent = `${Object.keys(g.goals).length}/${GOALS.length}`;
    }

    // ---------- Selection panel ----------

    renderSelection(force) {
        const sel = this.game.selected;
        const panel = $('selection');
        if (!sel) {
            panel.classList.add('hidden');
            this.selKey = null;
            return;
        }
        panel.classList.remove('hidden');
        const key = sel.creature ? 'c' + sel.creature.id + (sel.creature.dead ? 'd' : '') : 't' + sel.tile.i + '-' + sel.tile.biome;
        if (force || key !== this.selKey) {
            this.selKey = key;
            $('sel-body').innerHTML = sel.creature ? this.creatureHtml(sel.creature) : this.tileHtml(sel.tile);
            const follow = $('sel-follow');
            if (follow) follow.addEventListener('click', () => this.actions.toggleFollow());
        }
        if (sel.creature) this.fillCreature(sel.creature);
        else this.fillTile(sel.tile);
    }

    creatureHtml(c) {
        const col = '#' + c.color.getHexString();
        const col2 = '#' + accentColor(c.genes).getHexString();
        const row = ([k, d]) => `<dt title="${esc(d.effect || '')}">${d.label}</dt><dd title="${esc(d.effect || '')}">${fmtGene(k, c.genes[k])}</dd>`;
        const genes = Object.entries(GENES).filter(([k, d]) => k !== 'hue' && !d.body).map(row).join('');
        const body = Object.entries(GENES).filter(([k, d]) => d.body && k !== 'hue2').map(row).join('');
        const bar = (f, label, color) => `<div><div class="bar-label"><span>${label}</span><span data-f="${f}-v"></span></div>
            <div class="bar"><i data-f="${f}" style="background:${color}"></i></div></div>`;
        return `<div class="sel-head"><div class="avatar" style="background:radial-gradient(circle at 70% 30%, ${col2} 0 22%, transparent 24%), ${col}"></div><div>
                <h3>${esc(c.name)}</h3><p data-f="sub"></p></div></div>
            <p class="status${c.dead ? ' dead' : ''}" data-f="status"></p>
            ${c.dead ? '' : `<div class="bars">${bar('energy', 'Food', '#f0b04a')}${bar('health', 'Health', '#e2506d')}${bar('mood', 'Comfort', '#9bd36e')}</div>`}
            <dl class="kv">
                <dt>Parents</dt><dd>${c.parents ? c.parents.map(esc).join(' & ') : 'wild'}</dd>
                <dt>Children</dt><dd data-f="children"></dd>
                <dt>Species</dt><dd data-f="species"></dd>
                <dt>Ground</dt><dd data-f="ground"></dd>
                <dt>Temperature</dt><dd data-f="temp"></dd>
                <dt>Sees now</dt><dd data-f="sight"></dd>
                <dt>Stomach</dt><dd>${Math.round(c.maxEnergy)}</dd>
                <dt>Grown up at</dt><dd>${Math.round(c.maturity)}s</dd>
                <dt>Lives up to</dt><dd>${Math.round(c.t.lifespan)}s</dd>
            </dl>
            <h2 style="margin-top:12px">Genes</h2>
            <dl class="kv">${genes}</dl>
            <h2 style="margin-top:12px">Body <small>${esc(describeBody(c.genes))}</small></h2>
            <dl class="kv">${body}</dl>
            <p class="hint">Every gene helps somewhere and costs something. Hover a gene to see how.</p>
            ${c.dead ? '' : `<div class="sel-actions"><button class="btn small ghost" id="sel-follow">Follow (F)</button></div>`}`;
    }

    fillCreature(c) {
        const body = $('sel-body');
        const set = (f, v) => { const el = body.querySelector(`[data-f="${f}"]`); if (el && el.textContent !== String(v)) el.textContent = v; };
        const w = (f, v) => {
            const el = body.querySelector(`[data-f="${f}"]`);
            if (el) el.style.width = Math.max(0, Math.min(100, v)) + '%';
            set(f + '-v', Math.round(v));
        };
        set('sub', `Generation ${c.generation} · ${c.lifeStage} · age ${Math.floor(c.age)}`);
        const sp = this.game.species.find(s => s.id === c.speciesId);
        set('species', sp ? `${sp.name} (${sp.n})` : '-');
        const left = c.busyLeft;
        const ill = c.plague > 0 ? ' · has the plague' : c.poison > 0.2 ? ' · poisoned' : '';
        set('status', c.dead ? `${c.cause.charAt(0).toUpperCase() + c.cause.slice(1)}.`
            : c.status + (left > 0.4 ? ` (${Math.ceil(left)}s)` : '') + ill + (c.ready && c.action !== 'mate' ? ' · ready for a partner' : ''));
        w('energy', c.energy / c.maxEnergy * 100);
        set('sight', `${c.sightNow.toFixed(1)} of ${c.genes.sight.toFixed(1)}${c.t.swimmer ? ' · swims' : ''}`);
        w('health', c.health);
        w('mood', c.mood);
        set('children', c.children);
        const g = this.game, t = g.world.tileAt(c.x, c.z);
        if (t) {
            set('ground', BIOMES[t.biome].name);
            set('temp', `${Math.round(g.climate(t).temp)} here, likes ${Math.round(c.genes.prefTemp)}`);
        }
        const follow = $('sel-follow');
        if (follow) follow.classList.toggle('on', g.follow);
    }

    tileHtml(t) {
        const b = BIOMES[t.biome];
        const col = '#' + b.color.toString(16).padStart(6, '0');
        return `<div class="sel-head"><div class="avatar" style="background:${col};border-radius:10px"></div><div>
                <h3>${b.name}</h3><p>Tile ${t.x}, ${t.z}</p></div></div>
            <dl class="kv">
                <dt>Temperature now</dt><dd data-f="temp"></dd>
                <dt>Moisture</dt><dd>${b.moisture}</dd>
                <dt>Food</dt><dd data-f="food"></dd>
                <dt>Poison</dt><dd data-f="tox"></dd>
                <dt>Soil</dt><dd data-f="soil"></dd>
                <dt>Height</dt><dd data-f="height"></dd>
                <dt>Walking</dt><dd>${isWalkable(t) ? Math.round(b.speed * 100) + '% speed' : 'impossible'}</dd>
                <dt>Nomes here</dt><dd data-f="here"></dd>
            </dl>`;
    }

    fillTile(t) {
        const g = this.game, body = $('sel-body');
        const set = (f, v) => { const el = body.querySelector(`[data-f="${f}"]`); if (el && el.textContent !== String(v)) el.textContent = v; };
        set('temp', Math.round(g.climate(t).temp));
        const cap = g.world.capFor(t), bloom = g.world.bloom[t.i];
        const extra = [['fruit', t.fruit], ['nuts', t.nuts], ['mushrooms', t.shroom], ['roots', t.roots]].filter(([, v]) => v > 0.03).map(([k, v]) => `${v.toFixed(2)} ${k}`);
        set('food', [(cap ? `${t.food.toFixed(2)} / ${cap.toFixed(2)} ${t.biome === 0 ? 'seaweed' : 'greens'}` : ''), ...extra, bloom > 0.04 ? `${bloom.toFixed(2)} moonflowers` : ''].filter(Boolean).join(', ') || 'none');
        set('tox', t.biome === 0 ? 'none' : `${Math.round(t.tox * 100)}%${t.tox > 0.35 ? ', warning colors' : ''}`);
        const marks = [t.lava > 0 ? `lava, cools in ${Math.ceil(t.lava)}s` : '', t.fire > 0 ? 'on fire' : '', t.burrow > 0.15 ? 'burrow' : '', t.trail > 0.18 ? `trail ${Math.round(t.trail * 100)}%` : '',
            t.fert > 0.05 ? `fertile ${Math.round(t.fert * 100)}%` : '', t.work > 0.02 ? `${t.biome === 0 ? 'dam' : 'work'} ${Math.round(t.work * 100)}%` : ''].filter(Boolean);
        set('soil', marks.join(', ') || 'plain');
        set('height', t.height.toFixed(2));
        set('here', g.creatures.filter(c => g.world.tileAt(c.x, c.z) === t).length);
    }

    // ---------- Log and toasts ----------

    addLog(e) {
        const box = $('log');
        const el = document.createElement('div');
        el.className = 'log-line ' + e.kind;
        el.textContent = e.text;
        box.appendChild(el);
        while (box.children.length > 4) box.firstChild.remove();
        setTimeout(() => el.classList.add('fade'), 7000);
        setTimeout(() => el.remove(), 8000);
    }

    toast(title, text) {
        const el = document.createElement('div');
        el.className = 'toast';
        el.innerHTML = `<small>${esc(title)}</small>${esc(text)}`;
        $('toasts').appendChild(el);
        this.renderGoals();
        setTimeout(() => el.classList.add('out'), 4200);
        setTimeout(() => el.remove(), 4900);
    }
}
