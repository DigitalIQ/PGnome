import { GENES, GOALS, BIOMES, MAX_POP } from './config.js';
import { isWalkable } from './world.js';

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

        game.on('log', e => this.addLog(e));
        game.on('goal', g => this.toast('Goal reached', g.label));
        game.on('extinct', () => this.showExtinct());
        game.on('reset', () => {
            $('log').innerHTML = '';
            $('mutation').value = game.mutationRate;
            $('mut-out').textContent = game.mutationRate.toFixed(1);
            $('seed-info').textContent = `Seed ${game.seed}`;
            this.lastHistoryLen = -1;
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

    showStart(hasSave) {
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

        if (g.history.length !== this.lastHistoryLen) {
            this.lastHistoryLen = g.history.length;
            this.drawChart();
        }
        this.poolTimer -= dt;
        if (this.poolTimer <= 0) {
            this.poolTimer = 1;
            this.renderPool();
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
        $('genepool').innerHTML = html;
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
        const genes = Object.entries(GENES).filter(([k]) => k !== 'hue')
            .map(([k, d]) => `<dt>${d.label}</dt><dd>${fmtGene(k, c.genes[k])}</dd>`).join('');
        const bar = (f, label, color) => `<div><div class="bar-label"><span>${label}</span><span data-f="${f}-v"></span></div>
            <div class="bar"><i data-f="${f}" style="background:${color}"></i></div></div>`;
        return `<div class="sel-head"><div class="avatar" style="background:${col}"></div><div>
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
            set('temp', `${Math.round(g.world.climate(t, g.seasonTemp).temp)} here, likes ${Math.round(c.genes.prefTemp)}`);
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
        set('temp', Math.round(g.world.climate(t, g.seasonTemp).temp));
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
