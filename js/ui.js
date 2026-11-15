import { GENES, GOALS, BIOMES, MAX_POP, MODES, legCount, eyeCount, patternName } from './config.js';
import { isWalkable } from './world.js';
import { loadRecords } from './scores.js';
import { describeBody, accentColor } from './body.js';

const WEATHER_ICONS = {
    clear: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    cloudy: '<path d="M7 18h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 18z"/>',
    rain: '<path d="M7 14h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 14z"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/>',
    storm: '<path d="M7 13h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 13z"/><path d="M13 13l-3 4.5h4l-3 4.5"/>',
    fog: '<path d="M4 9h16M3 13h18M5 17h14"/>',
    heat: '<circle cx="12" cy="12" r="5.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/><path d="M10 12h4" />',
    snow: '<path d="M7 13h10a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.3A3.4 3.4 0 0 0 7 13z"/><path d="M8 17v.01M12 19v.01M16 17v.01M10 21v.01M14 21v.01"/>'
};
const WEATHER_HINTS = {
    clear: 'Normal growth', cloudy: 'Mild', rain: 'Plants grow fast', storm: 'Seek forests',
    fog: 'Nomes see little', heat: 'Plants dry out', snow: 'Very cold'
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
const POOL_KEYS = ['size', 'speed', 'sight', 'prefTemp', 'prefMoisture', 'sociability', 'lifespan'];

function fmtGene(k, v) {
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
        game.on('reset', () => {
            $('log').innerHTML = '';
            $('mutation').value = game.mutationRate;
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
        return `<ol class="records">${list.slice(0, limit).map((r, i) => `
            <li class="${r.id === highlight ? 'me' : ''}">
                <span class="rk">${i + 1}</span>
                <span class="nm"><b>${esc(r.name)}</b><small>${r.mode === 'living' ? 'Living' : 'Classic'} · ${date(r.date)}${r.ended ? '' : ' · alive'}</small></span>
                <span class="st"><small>${r.years.toFixed(1)} y · gen ${r.gen} · peak ${r.peak}</small></span>
                <span class="sc">${r.score}</span>
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
        $('year').textContent = `Year ${g.year}`;
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

        if (g.history.length !== this.lastHistoryLen) {
            this.lastHistoryLen = g.history.length;
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
        if (this.game.world.living && h.some(p => p.land)) {
            const lands = h.map(p => p.land || 0);
            const lmin = Math.min(...lands), lmax = Math.max(...lands, lmin + 20);
            const ly = v => H - pad - ((v - lmin) / (lmax - lmin)) * (H - pad * 2 - 14);
            ctx.beginPath();
            h.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, pad + i * step, ly(p.land || lmin)));
            ctx.setLineDash([8, 6]);
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(111,179,224,0.85)';
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(111,179,224,0.85)';
            ctx.font = '600 20px Figtree, sans-serif';
            ctx.fillText('land', 12, 20);
        }
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
            <div><b>${(st.deep * 10).toFixed(1)}${arrow(st.deep, p.deep, 0.01)}</b><span>deepest</span></div>${sea}`;
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
        const genes = Object.entries(GENES).filter(([k, d]) => k !== 'hue' && !d.body)
            .map(([k, d]) => `<dt>${d.label}</dt><dd>${fmtGene(k, c.genes[k])}</dd>`).join('');
        const body = Object.entries(GENES).filter(([k, d]) => d.body && k !== 'hue2')
            .map(([k, d]) => `<dt>${d.label}</dt><dd>${bodyGeneText(k, c.genes[k])}</dd>`).join('');
        const bar = (f, label, color) => `<div><div class="bar-label"><span>${label}</span><span data-f="${f}-v"></span></div>
            <div class="bar"><i data-f="${f}" style="background:${color}"></i></div></div>`;
        return `<div class="sel-head"><div class="avatar" style="background:radial-gradient(circle at 70% 30%, ${col2} 0 22%, transparent 24%), ${col}"></div><div>
                <h3>${esc(c.name)}</h3><p data-f="sub"></p></div></div>
            <p class="status${c.dead ? ' dead' : ''}" data-f="status"></p>
            ${c.dead ? '' : `<div class="bars">${bar('energy', 'Food', '#f0b04a')}${bar('health', 'Health', '#e2506d')}${bar('mood', 'Comfort', '#9bd36e')}</div>`}
            <dl class="kv">
                <dt>Parents</dt><dd>${c.parents ? c.parents.map(esc).join(' & ') : 'wild'}</dd>
                <dt>Children</dt><dd data-f="children"></dd>
                <dt>Ground</dt><dd data-f="ground"></dd>
                <dt>Temperature</dt><dd data-f="temp"></dd>
            </dl>
            <h2 style="margin-top:12px">Genes</h2>
            <dl class="kv">${genes}</dl>
            <h2 style="margin-top:12px">Body <small>${esc(describeBody(c.genes))}</small></h2>
            <dl class="kv">${body}</dl>
            <p class="hint">Legs help on rough ground and cost a little energy. The rest only changes looks.</p>
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
        set('status', c.dead ? `${c.cause.charAt(0).toUpperCase() + c.cause.slice(1)}.` : c.status + (c.ready && c.action !== 'mate' ? ' · ready for a partner' : ''));
        w('energy', c.energy);
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
                <dt>Height</dt><dd data-f="height"></dd>
                <dt>Walking</dt><dd>${isWalkable(t) ? Math.round(b.speed * 100) + '% speed' : 'impossible'}</dd>
                <dt>Nomes here</dt><dd data-f="here"></dd>
            </dl>`;
    }

    fillTile(t) {
        const g = this.game, body = $('sel-body');
        const set = (f, v) => { const el = body.querySelector(`[data-f="${f}"]`); if (el && el.textContent !== String(v)) el.textContent = v; };
        set('temp', Math.round(g.climate(t).temp));
        set('food', BIOMES[t.biome].food ? `${t.food.toFixed(2)} / ${BIOMES[t.biome].food}` : 'none');
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
