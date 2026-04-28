// --- CONFIG & UTILS ---
const MAP_SIZE = 30;
const TILE_W = 64;
const TILE_H = 32;
const ELEVATION_STEP = 10;

const BIOMES = {
    WATER: { id: 'water', name: 'Water', top: '#3b82f6', left: '#2563eb', right: '#1d4ed8', moisture: 100, temp: 40, light: 80, height: 0 },
    SAND: { id: 'sand', name: 'Sand', top: '#fcd34d', left: '#fbbf24', right: '#f59e0b', moisture: 10, temp: 80, light: 100, height: 1 },
    GRASS: { id: 'grass', name: 'Meadow', top: '#4ade80', left: '#22c55e', right: '#16a34a', moisture: 50, temp: 60, light: 90, height: 2 },
    MUD: { id: 'mud', name: 'Mud', top: '#92400e', left: '#78350f', right: '#451a03', moisture: 80, temp: 50, light: 80, height: 1 },
    FOREST: { id: 'forest', name: 'Forest', top: '#059669', left: '#047857', right: '#065f46', moisture: 60, temp: 50, light: 30, height: 2 },
    ROCK: { id: 'rock', name: 'Rock', top: '#94a3b8', left: '#64748b', right: '#475569', moisture: 20, temp: 40, light: 90, height: 4 }
};

const STAT_COLORS = {
    hunger: '#ef4444',
    happiness: '#eab308',
    arousal: '#ec4899',
    energy: '#3b82f6'
};

function randomRange(min, max) {
    return Math.random() * (max - min) + min;
}

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

// Simple noise for map generation
function noise2D(x, y) {
    return Math.sin(x * 0.3) * Math.cos(y * 0.3) * 0.5 + 0.5;
}

// --- GAME STATE ---
let canvas, ctx;
let camera = { x: 0, y: 0, zoom: 1 };
let world = [];
let creatures = [];
let foods = [];
let selectedTool = 'inspect';
let selectedEntity = null; // Can be a creature or a tile {type: 'creature', obj: ...}
let draggedCreature = null;
let lastTime = 0;
let generation = 1;

// --- INITIALIZATION ---
function init() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Center camera
    camera.x = 0;
    camera.y = -MAP_SIZE * TILE_H / 2 + window.innerHeight / 2;

    generateWorld();

    // Setup UI
    setupTools();
    document.getElementById('btn-spawn').addEventListener('click', () => {
        spawnCreature(Math.floor(MAP_SIZE / 2), Math.floor(MAP_SIZE / 2));
        spawnCreature(Math.floor(MAP_SIZE / 2), Math.floor(MAP_SIZE / 2));
    });

    // Setup Input
    setupInput();

    // Initial Spawn
    for (let i = 0; i < 5; i++) {
        spawnCreature(Math.floor(randomRange(5, MAP_SIZE - 5)), Math.floor(randomRange(5, MAP_SIZE - 5)));
    }

    requestAnimationFrame(gameLoop);
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

// --- WORLD GENERATION ---
function generateWorld() {
    world = [];
    for (let x = 0; x < MAP_SIZE; x++) {
        world[x] = [];
        for (let y = 0; y < MAP_SIZE; y++) {
            let n = noise2D(x, y);
            let nMoist = noise2D(x + 100, y + 100);

            let type = BIOMES.GRASS;
            let elevation = Math.floor(n * 4);

            if (elevation === 0) type = BIOMES.WATER;
            else if (elevation === 1) type = nMoist > 0.6 ? BIOMES.MUD : BIOMES.SAND;
            else if (elevation === 2) type = nMoist > 0.6 ? BIOMES.FOREST : BIOMES.GRASS;
            else type = BIOMES.ROCK;

            world[x][y] = {
                x: x,
                y: y,
                elevation: elevation,
                biome: type,
                food: 0
            };
        }
    }
}

// --- GENETICS & CREATURES ---
class Creature {
    constructor(x, y, parents = null) {
        this.id = Math.random().toString(36).substr(2, 9);
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.target = null;

        // State
        this.hunger = 100;
        this.happiness = 50;
        this.arousal = 0;
        this.energy = 100;
        this.age = 0;
        this.state = 'idle'; // idle, moving, eating, sleeping, mating

        // Genetics
        if (parents) {
            this.genes = this.mixGenes(parents[0].genes, parents[1].genes);
            generation = Math.max(generation, parents[0].generation + 1, parents[1].generation + 1);
            this.generation = Math.max(parents[0].generation, parents[1].generation) + 1;
        } else {
            this.genes = this.randomGenes();
            this.generation = 1;
        }

        this.color = `hsl(${this.genes.hue}, ${this.genes.saturation}%, ${this.genes.lightness}%)`;
    }

    randomGenes() {
        return {
            hue: Math.floor(randomRange(0, 360)),
            saturation: Math.floor(randomRange(50, 100)),
            lightness: Math.floor(randomRange(40, 70)),
            prefMoisture: randomRange(0, 100),
            prefTemp: randomRange(0, 100),
            prefLight: randomRange(0, 100),
            sociability: randomRange(0, 100), // How much they want to be near others
            speed: randomRange(0.5, 2.0),
            metabolism: randomRange(0.5, 1.5),
            size: randomRange(0.8, 1.5)
        };
    }

    mixGenes(g1, g2) {
        let child = {};
        for (let key in g1) {
            // 50% chance from either parent, plus slight mutation
            let val = Math.random() > 0.5 ? g1[key] : g2[key];
            if (key === 'hue') {
                val += randomRange(-20, 20);
                if (val < 0) val += 360;
                if (val > 360) val -= 360;
            } else {
                val += randomRange(-10, 10);
            }
            child[key] = clamp(val, 0, key === 'speed' || key === 'size' || key === 'metabolism' ? 5 : 100);
        }
        return child;
    }

    update(dt) {
        this.age += dt;

        // Get current tile
        let tx = Math.floor(clamp(this.x, 0, MAP_SIZE - 1));
        let ty = Math.floor(clamp(this.y, 0, MAP_SIZE - 1));
        let tile = world[tx] && world[tx][ty];

        if (!tile) return;

        // Stat drain
        this.hunger -= 2 * this.genes.metabolism * dt;
        this.energy -= 1 * dt;

        // Calculate environment happiness
        let envScore = 100;
        envScore -= Math.abs(tile.biome.moisture - this.genes.prefMoisture) * 0.3;
        envScore -= Math.abs(tile.biome.temp - this.genes.prefTemp) * 0.3;
        envScore -= Math.abs(tile.biome.light - this.genes.prefLight) * 0.3;

        // Sociability
        let nearby = creatures.filter(c => c !== this && Math.hypot(c.x - this.x, c.y - this.y) < 5);
        if (this.genes.sociability > 50 && nearby.length === 0) envScore -= 20;
        if (this.genes.sociability < 30 && nearby.length > 2) envScore -= 20;

        this.happiness += (envScore - this.happiness) * dt * 0.5;
        this.happiness = clamp(this.happiness, 0, 100);

        // Arousal increases if happy and full
        if (this.happiness > 70 && this.hunger > 60) {
            this.arousal += 5 * dt;
        } else {
            this.arousal -= 2 * dt;
        }
        this.arousal = clamp(this.arousal, 0, 100);
        this.hunger = clamp(this.hunger, 0, 100);
        this.energy = clamp(this.energy, 0, 100);

        // Sleep
        if (this.energy < 20 || this.state === 'sleeping') {
            this.state = 'sleeping';
            this.energy += 15 * dt;
            if (this.energy > 90) this.state = 'idle';
            return; // Don't move while sleeping
        }

        // Behavior / AI
        if (this.target) {
            let dx = this.target.x - this.x;
            let dy = this.target.y - this.y;
            let dist = Math.hypot(dx, dy);

            if (dist < 0.1) {
                this.x = this.target.x;
                this.y = this.target.y;
                this.target = null;
                this.state = 'idle';
            } else {
                this.x += (dx / dist) * this.genes.speed * dt;
                this.y += (dy / dist) * this.genes.speed * dt;
                this.state = 'moving';
            }
        } else {
            // Find a target
            if (this.hunger < 40) {
                // Find food
                let bestFood = null;
                let minDist = Infinity;
                foods.forEach(f => {
                    let d = Math.hypot(f.x - this.x, f.y - this.y);
                    if (d < 5 && d < minDist) { minDist = d; bestFood = f; }
                });
                if (bestFood) {
                    this.target = { x: bestFood.x, y: bestFood.y };
                } else {
                    this.wander();
                }
            } else if (this.arousal > 80) {
                // Find mate
                let mate = creatures.find(c => c !== this && c.arousal > 80 && Math.hypot(c.x - this.x, c.y - this.y) < 6);
                if (mate) {
                    this.target = { x: mate.x, y: mate.y };
                    // If very close, mate!
                    if (Math.hypot(mate.x - this.x, mate.y - this.y) < 0.5) {
                        this.arousal = 0;
                        mate.arousal = 0;
                        this.energy -= 30;
                        mate.energy -= 30;
                        // Spawn child
                        let cx = (this.x + mate.x) / 2;
                        let cy = (this.y + mate.y) / 2;
                        let child = new Creature(cx, cy, [this, mate]);
                        creatures.push(child);

                        // Particle effect or UI update
                        updateStatsUI();
                    }
                } else {
                    this.wander();
                }
            } else if (Math.random() < 0.02) {
                // Find better environment
                let searchX = clamp(Math.floor(this.x + randomRange(-3, 3)), 0, MAP_SIZE - 1);
                let searchY = clamp(Math.floor(this.y + randomRange(-3, 3)), 0, MAP_SIZE - 1);
                this.target = { x: searchX, y: searchY };
            }
        }

        // Consume food if on it and hungry
        if (this.hunger < 80) {
            for (let i = foods.length - 1; i >= 0; i--) {
                let f = foods[i];
                if (Math.hypot(f.x - this.x, f.y - this.y) < 0.5) {
                    this.hunger += 30;
                    foods.splice(i, 1);
                    break;
                }
            }
        }
    }

    wander() {
        this.target = {
            x: clamp(this.x + randomRange(-2, 2), 0, MAP_SIZE - 1),
            y: clamp(this.y + randomRange(-2, 2), 0, MAP_SIZE - 1)
        };
    }
}

// --- ENGINE & RENDER ---
function mapToIso(mx, my, elevation = 0) {
    const sx = (mx - my) * (TILE_W / 2);
    const sy = (mx + my) * (TILE_H / 2) - (elevation * ELEVATION_STEP);
    return { x: sx, y: sy };
}

// Very basic screen to map estimation for flat clicking
function screenToMap(sx, sy) {
    // Reverse iso transform assuming elevation 0
    // sy = (mx + my) * TILE_H / 2
    // sx = (mx - my) * TILE_W / 2
    let mapY = (sy / (TILE_H / 2) - sx / (TILE_W / 2)) / 2;
    let mapX = (sy / (TILE_H / 2) + sx / (TILE_W / 2)) / 2;
    return { x: mapX, y: mapY };
}

function drawTile(x, y, tile) {
    const { x: sx, y: sy } = mapToIso(x, y, tile.elevation);
    const halfW = TILE_W / 2;
    const halfH = TILE_H / 2;
    const height = tile.elevation * ELEVATION_STEP;
    const baseH = 10; // base thickness of a tile

    // Top face
    ctx.fillStyle = tile.biome.top;
    ctx.beginPath();
    ctx.moveTo(sx, sy - halfH);
    ctx.lineTo(sx + halfW, sy);
    ctx.lineTo(sx, sy + halfH);
    ctx.lineTo(sx - halfW, sy);
    ctx.closePath();
    ctx.fill();

    // Left face
    ctx.fillStyle = tile.biome.left;
    ctx.beginPath();
    ctx.moveTo(sx - halfW, sy);
    ctx.lineTo(sx, sy + halfH);
    ctx.lineTo(sx, sy + halfH + baseH);
    ctx.lineTo(sx - halfW, sy + baseH);
    ctx.closePath();
    ctx.fill();

    // Right face
    ctx.fillStyle = tile.biome.right;
    ctx.beginPath();
    ctx.moveTo(sx + halfW, sy);
    ctx.lineTo(sx, sy + halfH);
    ctx.lineTo(sx, sy + halfH + baseH);
    ctx.lineTo(sx + halfW, sy + baseH);
    ctx.closePath();
    ctx.fill();

    // Highlight if selected
    if (selectedEntity && selectedEntity.type === 'tile' && selectedEntity.obj === tile) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy - halfH);
        ctx.lineTo(sx + halfW, sy);
        ctx.lineTo(sx, sy + halfH);
        ctx.lineTo(sx - halfW, sy);
        ctx.closePath();
        ctx.stroke();
    }
}

function drawCreature(c) {
    let tileX = Math.floor(clamp(c.x, 0, MAP_SIZE - 1));
    let tileY = Math.floor(clamp(c.y, 0, MAP_SIZE - 1));
    let elevation = world[tileX] ? (world[tileX][tileY] ? world[tileX][tileY].elevation : 0) : 0;

    let bounce = 0;
    if (c.state === 'moving') bounce = Math.abs(Math.sin(Date.now() * 0.01 * c.genes.speed)) * 5;
    if (c === draggedCreature) { bounce = 20; elevation += 2; }

    const { x: sx, y: sy } = mapToIso(c.x, c.y, elevation);

    let drawY = sy - bounce;
    let size = 10 * c.genes.size;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(sx, sy, size, size / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.arc(sx, drawY - size, size, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = c.state === 'sleeping' ? '#555' : 'white';
    ctx.beginPath();
    ctx.arc(sx - size * 0.3, drawY - size * 1.2, size * 0.2, 0, Math.PI * 2);
    ctx.arc(sx + size * 0.3, drawY - size * 1.2, size * 0.2, 0, Math.PI * 2);
    ctx.fill();

    if (c.state !== 'sleeping') {
        ctx.fillStyle = 'black';
        ctx.beginPath();
        ctx.arc(sx - size * 0.3, drawY - size * 1.2, size * 0.1, 0, Math.PI * 2);
        ctx.arc(sx + size * 0.3, drawY - size * 1.2, size * 0.1, 0, Math.PI * 2);
        ctx.fill();
    }

    // Emotion indicator
    if (c.happiness < 30) {
        ctx.fillStyle = '#ef4444'; // sad
        ctx.font = '12px Arial';
        ctx.fillText('😢', sx - 6, drawY - size * 2.5);
    } else if (c.arousal > 80) {
        ctx.fillStyle = '#ec4899'; // love
        ctx.font = '12px Arial';
        ctx.fillText('❤️', sx - 6, drawY - size * 2.5);
    }

    // Selection Ring
    if (selectedEntity && selectedEntity.type === 'creature' && selectedEntity.obj === c) {
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(sx, sy, size * 1.5, size * 0.75, 0, 0, Math.PI * 2);
        ctx.stroke();
    }
}

function drawFood(f) {
    let tileX = Math.floor(clamp(f.x, 0, MAP_SIZE - 1));
    let tileY = Math.floor(clamp(f.y, 0, MAP_SIZE - 1));
    let elevation = world[tileX] ? (world[tileX][tileY] ? world[tileX][tileY].elevation : 0) : 0;

    const { x: sx, y: sy } = mapToIso(f.x, f.y, elevation);

    ctx.fillStyle = '#ef4444'; // Apple red
    ctx.beginPath();
    ctx.arc(sx, sy - 5, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#22c55e'; // Leaf green
    ctx.beginPath();
    ctx.arc(sx + 2, sy - 9, 2, 0, Math.PI * 2);
    ctx.fill();
}

function gameLoop(timestamp) {
    let dt = (timestamp - lastTime) / 1000;
    if (dt > 0.1) dt = 0.1; // Cap delta
    lastTime = timestamp;

    // Update
    creatures.forEach(c => {
        if (c !== draggedCreature) c.update(dt);
    });

    // Remove dead (optional, if we want them to die, but user said infinite life)
    // We keep them alive infinitely as requested.

    // World evolution: occasional tile change
    if (Math.random() < 0.1 * dt) {
        let x = Math.floor(randomRange(0, MAP_SIZE));
        let y = Math.floor(randomRange(0, MAP_SIZE));
        let biomesKeys = Object.keys(BIOMES);
        let randomBiome = BIOMES[biomesKeys[Math.floor(randomRange(0, biomesKeys.length))]];
        world[x][y].biome = randomBiome;
        world[x][y].elevation = randomBiome.height;
    }

    // Render
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-color');
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2 + camera.x, camera.y);
    ctx.scale(camera.zoom, camera.zoom);

    // Painter's Algorithm: Draw from back to front
    // Iterate x and y such that x+y is increasing
    let renderList = [];

    for (let x = 0; x < MAP_SIZE; x++) {
        for (let y = 0; y < MAP_SIZE; y++) {
            renderList.push({ type: 'tile', order: x + y, obj: world[x][y] });
        }
    }

    creatures.forEach(c => {
        renderList.push({ type: 'creature', order: c.x + c.y, obj: c });
    });

    foods.forEach(f => {
        renderList.push({ type: 'food', order: f.x + f.y, obj: f });
    });

    renderList.sort((a, b) => a.order - b.order);

    renderList.forEach(item => {
        if (item.type === 'tile') drawTile(item.obj.x, item.obj.y, item.obj);
        else if (item.type === 'creature') drawCreature(item.obj);
        else if (item.type === 'food') drawFood(item.obj);
    });

    ctx.restore();

    // UI Updates
    updateStatsUI();

    requestAnimationFrame(gameLoop);
}

// --- INPUT & TOOLS ---
let isDraggingCamera = false;
let lastMouse = { x: 0, y: 0 };

function setupTools() {
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedTool = btn.dataset.tool;
        });
    });
}

function getMapPosFromEvent(e) {
    let rect = canvas.getBoundingClientRect();
    let mouseX = e.clientX - rect.left;
    let mouseY = e.clientY - rect.top;

    let adjX = (mouseX - canvas.width / 2 - camera.x) / camera.zoom;
    let adjY = (mouseY - camera.y) / camera.zoom;

    // We need to account for elevation, but for simplicity we do a flat check, 
    // then refine by checking tiles back to front if needed.
    let { x: mapX, y: mapY } = screenToMap(adjX, adjY);

    // Refine: check rendered tiles backwards for precise polygon collision
    // (Skipping for brevity, flat projection works okay-ish for a simple game)

    return { mx: mapX, my: mapY, adjX, adjY };
}

function setupInput() {
    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 2 || e.button === 1) { // Right or Middle click to drag camera
            isDraggingCamera = true;
            lastMouse = { x: e.clientX, y: e.clientY };
            return;
        }

        let { mx, my, adjX, adjY } = getMapPosFromEvent(e);

        // Find clicked creature
        let clickedCreature = null;
        for (let c of creatures) {
            let cx = Math.floor(clamp(c.x, 0, MAP_SIZE - 1));
            let cy = Math.floor(clamp(c.y, 0, MAP_SIZE - 1));
            let elevation = world[cx] ? (world[cx][cy] ? world[cx][cy].elevation : 0) : 0;
            const { x: sx, y: sy } = mapToIso(c.x, c.y, elevation);
            let dist = Math.hypot(adjX - sx, adjY - (sy - 10 * c.genes.size)); // approximate center
            if (dist < 20 * c.genes.size) {
                clickedCreature = c;
                break;
            }
        }

        if (selectedTool === 'inspect') {
            if (clickedCreature) {
                selectedEntity = { type: 'creature', obj: clickedCreature };
                showInfoPanel();
            } else {
                let tx = Math.floor(mx + 0.5);
                let ty = Math.floor(my + 0.5);
                if (tx >= 0 && tx < MAP_SIZE && ty >= 0 && ty < MAP_SIZE) {
                    selectedEntity = { type: 'tile', obj: world[tx][ty] };
                    showInfoPanel();
                } else {
                    selectedEntity = null;
                    document.getElementById('info-panel').classList.add('hidden');
                }
            }
        } else if (selectedTool === 'move') {
            if (clickedCreature) {
                draggedCreature = clickedCreature;
                selectedEntity = { type: 'creature', obj: clickedCreature };
                showInfoPanel();
            }
        } else if (selectedTool === 'feed') {
            foods.push({ x: mx, y: my });
        } else if (selectedTool.startsWith('terraform-')) {
            let biomeKey = selectedTool.split('-')[1].toUpperCase();
            let tx = Math.floor(mx + 0.5);
            let ty = Math.floor(my + 0.5);
            if (tx >= 0 && tx < MAP_SIZE && ty >= 0 && ty < MAP_SIZE && BIOMES[biomeKey]) {
                world[tx][ty].biome = BIOMES[biomeKey];
                world[tx][ty].elevation = BIOMES[biomeKey].height;
            }
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        if (isDraggingCamera) {
            camera.x += e.clientX - lastMouse.x;
            camera.y += e.clientY - lastMouse.y;
            lastMouse = { x: e.clientX, y: e.clientY };
        }

        if (draggedCreature) {
            let { mx, my } = getMapPosFromEvent(e);
            draggedCreature.x = clamp(mx, 0, MAP_SIZE - 1);
            draggedCreature.y = clamp(my, 0, MAP_SIZE - 1);
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        isDraggingCamera = false;
        if (draggedCreature) {
            draggedCreature.state = 'idle';
            draggedCreature.target = null;
            draggedCreature = null;
        }
    });

    canvas.addEventListener('wheel', (e) => {
        if (e.deltaY < 0) camera.zoom *= 1.1;
        else camera.zoom *= 0.9;
        camera.zoom = clamp(camera.zoom, 0.2, 3);
    });

    // Prevent context menu
    canvas.addEventListener('contextmenu', e => e.preventDefault());
}

function spawnCreature(x, y) {
    creatures.push(new Creature(x, y));
}

// --- UI UPDATES ---
function createStatBar(label, value, colorKey) {
    let color = STAT_COLORS[colorKey] || '#ccc';
    return `
        <div class="info-row">
            <div class="info-label"><span>${label}</span> <span class="info-value">${Math.round(value)}%</span></div>
            <div class="stat-bar-container">
                <div class="stat-bar" style="width: ${value}%; background: ${color}"></div>
            </div>
        </div>
    `;
}

function showInfoPanel() {
    const panel = document.getElementById('info-panel');
    const content = document.getElementById('info-content');
    panel.classList.remove('hidden');

    if (!selectedEntity) return;

    if (selectedEntity.type === 'creature') {
        let c = selectedEntity.obj;
        content.innerHTML = `
            <div class="creature-preview" style="background: ${c.color}"></div>
            <h4 style="text-align:center; margin-top:0;">Generation ${c.generation}</h4>
            <div class="tool-separator"></div>
            ${createStatBar('Happiness', c.happiness, 'happiness')}
            ${createStatBar('Hunger', c.hunger, 'hunger')}
            ${createStatBar('Energy', c.energy, 'energy')}
            ${createStatBar('Arousal', c.arousal, 'arousal')}
            <div class="tool-separator"></div>
            <h4>Genetics</h4>
            <div class="info-row"><span class="info-label">Pref Moisture:</span> <span class="info-value">${Math.round(c.genes.prefMoisture)}</span></div>
            <div class="info-row"><span class="info-label">Pref Temp:</span> <span class="info-value">${Math.round(c.genes.prefTemp)}</span></div>
            <div class="info-row"><span class="info-label">Sociability:</span> <span class="info-value">${Math.round(c.genes.sociability)}</span></div>
            <div class="info-row"><span class="info-label">Size:</span> <span class="info-value">${c.genes.size.toFixed(2)}x</span></div>
        `;
    } else if (selectedEntity.type === 'tile') {
        let t = selectedEntity.obj;
        content.innerHTML = `
            <h4 style="text-align:center; margin-top:0; color: ${t.biome.top}">${t.biome.name} Tile</h4>
            <p style="text-align:center; font-size: 0.8rem; color: #94a3b8">(${t.x}, ${t.y})</p>
            <div class="tool-separator"></div>
            <div class="info-row"><span class="info-label">Elevation:</span> <span class="info-value">${t.elevation}</span></div>
            <div class="info-row"><span class="info-label">Moisture:</span> <span class="info-value">${t.biome.moisture}</span></div>
            <div class="info-row"><span class="info-label">Temp:</span> <span class="info-value">${t.biome.temp}</span></div>
            <div class="info-row"><span class="info-label">Light:</span> <span class="info-value">${t.biome.light}</span></div>
        `;
    }
}

function updateStatsUI() {
    document.getElementById('stat-pop').innerText = creatures.length;
    document.getElementById('stat-gen').innerText = generation;

    // Update active info panel if needed
    if (selectedEntity && selectedEntity.type === 'creature' && document.getElementById('info-panel').classList.contains('hidden') === false) {
        showInfoPanel(); // Re-render stats
    }
}

// Start
init();
