// --- CONFIG & UTILS ---
const MAP_SIZE = 30;
const TILE_SIZE = 1;

const BIOMES = {
    WATER: { id: 'water', name: 'Water', color: 0x3b82f6, moisture: 100, temp: 40, light: 80, height: 0.2 },
    SAND: { id: 'sand', name: 'Sand', color: 0xfcd34d, moisture: 10, temp: 80, light: 100, height: 0.8 },
    GRASS: { id: 'grass', name: 'Meadow', color: 0x4ade80, moisture: 50, temp: 60, light: 90, height: 1.0 },
    MUD: { id: 'mud', name: 'Mud', color: 0x78350f, moisture: 80, temp: 50, light: 80, height: 0.9 },
    FOREST: { id: 'forest', name: 'Forest', color: 0x064e3b, moisture: 60, temp: 50, light: 30, height: 1.5 },
    ROCK: { id: 'rock', name: 'Rock', color: 0x64748b, moisture: 20, temp: 40, light: 90, height: 2.5 }
};

const STAT_COLORS = {
    hunger: '#ef4444',
    happiness: '#eab308',
    arousal: '#ec4899',
    energy: '#3b82f6'
};

function randomRange(min, max) { return Math.random() * (max - min) + min; }
function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }
function noise2D(x, y) { return Math.sin(x * 0.3) * Math.cos(y * 0.3) * 0.5 + 0.5; }

// --- GAME STATE ---
let scene, camera, renderer, orbitControls, raycaster, mouse;
let world = [];
let tileMeshes = [];
let creatures = [];
let foods = [];
let selectedTool = 'inspect';
let selectedEntity = null; // {type: 'creature'|'tile', obj: ...}
let draggedCreature = null;
let lastTime = 0;
let generation = 1;

// --- INITIALIZATION ---
function init() {
    const container = document.getElementById('game-container');
    
    // Setup Three.js
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090e17);
    
    // Isometric Orthographic Camera
    const aspect = window.innerWidth / window.innerHeight;
    const d = 15;
    camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 1000);
    camera.position.set(20, 20, 20); // Looking from top-right corner
    camera.lookAt(MAP_SIZE/2, 0, MAP_SIZE/2);
    
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    
    // Controls
    orbitControls = new THREE.OrbitControls(camera, renderer.domElement);
    orbitControls.target.set(MAP_SIZE/2, 0, MAP_SIZE/2);
    orbitControls.enableRotate = true; // Allow user to rotate the isometric view!
    orbitControls.maxPolarAngle = Math.PI / 2 - 0.1; // Don't go below ground
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(MAP_SIZE, 30, MAP_SIZE/2);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.left = -MAP_SIZE;
    dirLight.shadow.camera.right = MAP_SIZE;
    dirLight.shadow.camera.top = MAP_SIZE;
    dirLight.shadow.camera.bottom = -MAP_SIZE;
    scene.add(dirLight);

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    window.addEventListener('resize', onWindowResize);
    
    generateWorld();
    
    setupTools();
    document.getElementById('btn-spawn').addEventListener('click', () => {
        spawnCreature(Math.floor(MAP_SIZE/2), Math.floor(MAP_SIZE/2));
        spawnCreature(Math.floor(MAP_SIZE/2), Math.floor(MAP_SIZE/2));
    });
    
    setupInput();
    
    for(let i=0; i<8; i++) {
        spawnCreature(randomRange(5, MAP_SIZE-5), randomRange(5, MAP_SIZE-5));
    }
    
    requestAnimationFrame(gameLoop);
}

function onWindowResize() {
    const aspect = window.innerWidth / window.innerHeight;
    const d = 15;
    camera.left = -d * aspect;
    camera.right = d * aspect;
    camera.top = d;
    camera.bottom = -d;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- WORLD GENERATION ---
const tileGeometry = new THREE.BoxGeometry(1, 1, 1);
// Move geometry origin to bottom so scaling Y doesn't shift the base
tileGeometry.translate(0, 0.5, 0);

function generateWorld() {
    for (let x = 0; x < MAP_SIZE; x++) {
        world[x] = [];
        tileMeshes[x] = [];
        for (let z = 0; z < MAP_SIZE; z++) {
            let n = noise2D(x, z);
            let nMoist = noise2D(x + 100, z + 100);
            
            let type = BIOMES.GRASS;
            let elev = Math.floor(n * 4);
            
            if (elev === 0) type = BIOMES.WATER;
            else if (elev === 1) type = nMoist > 0.6 ? BIOMES.MUD : BIOMES.SAND;
            else if (elev === 2) type = nMoist > 0.6 ? BIOMES.FOREST : BIOMES.GRASS;
            else type = BIOMES.ROCK;
            
            world[x][z] = { x: x, z: z, biome: type };
            
            let material = new THREE.MeshStandardMaterial({ color: type.color, roughness: 0.8 });
            if (type === BIOMES.WATER) {
                material.transparent = true;
                material.opacity = 0.8;
                material.roughness = 0.1;
                material.metalness = 0.5;
            }
            
            let mesh = new THREE.Mesh(tileGeometry, material);
            mesh.position.set(x, 0, z);
            mesh.scale.y = type.height;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData = { isTile: true, x: x, z: z };
            
            scene.add(mesh);
            tileMeshes[x][z] = mesh;
        }
    }
}

// --- GENETICS & CREATURES ---
const creatureMaterials = {};

class Creature {
    constructor(x, z, parents = null) {
        this.id = Math.random().toString(36).substr(2, 9);
        this.x = x;
        this.z = z;
        this.target = null;
        
        // State
        this.hunger = 100;
        this.happiness = 50;
        this.arousal = 0;
        this.energy = 100;
        this.state = 'idle';
        
        // Genetics
        if (parents) {
            this.genes = this.mixGenes(parents[0].genes, parents[1].genes);
            generation = Math.max(generation, parents[0].generation + 1, parents[1].generation + 1);
            this.generation = Math.max(parents[0].generation, parents[1].generation) + 1;
        } else {
            this.genes = this.randomGenes();
            this.generation = 1;
        }
        
        this.buildMesh();
    }
    
    randomGenes() {
        return {
            hue: Math.floor(randomRange(0, 360)),
            saturation: Math.floor(randomRange(50, 100)),
            lightness: Math.floor(randomRange(40, 70)),
            prefMoisture: randomRange(0, 100),
            prefTemp: randomRange(0, 100),
            prefLight: randomRange(0, 100),
            sociability: randomRange(0, 100),
            speed: randomRange(0.5, 2.5),
            metabolism: randomRange(0.5, 1.5),
            size: randomRange(0.6, 1.2)
        };
    }
    
    mixGenes(g1, g2) {
        let child = {};
        for (let key in g1) {
            let val = Math.random() > 0.5 ? g1[key] : g2[key];
            if (key === 'hue') {
                val += randomRange(-20, 20);
                if(val < 0) val += 360;
                if(val > 360) val -= 360;
            } else {
                val += randomRange(-10, 10);
            }
            child[key] = clamp(val, 0, key === 'speed' || key === 'size' || key === 'metabolism' ? 5 : 100);
        }
        return child;
    }
    
    buildMesh() {
        this.meshGroup = new THREE.Group();
        this.meshGroup.userData = { isCreature: true, obj: this };
        
        let color = new THREE.Color(`hsl(${this.genes.hue}, ${this.genes.saturation}%, ${this.genes.lightness}%)`);
        let mat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.5, metalness: 0.1 });
        
        // Base shape depends on preferences
        let bodyGeo;
        if (this.genes.prefTemp < 40) {
            bodyGeo = new THREE.DodecahedronGeometry(0.4 * this.genes.size); // Cold lovers are blocky/chunky
        } else if (this.genes.prefMoisture > 70) {
            bodyGeo = new THREE.SphereGeometry(0.4 * this.genes.size, 16, 16); // Water lovers are smooth
        } else {
            bodyGeo = new THREE.CylinderGeometry(0.3 * this.genes.size, 0.4 * this.genes.size, 0.6 * this.genes.size, 8); // Normal
        }
        
        this.bodyMesh = new THREE.Mesh(bodyGeo, mat);
        this.bodyMesh.position.y = 0.4 * this.genes.size;
        this.bodyMesh.castShadow = true;
        this.bodyMesh.receiveShadow = true;
        this.meshGroup.add(this.bodyMesh);
        
        // Add features based on skills/likes
        if (this.genes.speed > 1.5) {
            // Fast creatures get a streamlined fin or wings
            let wingGeo = new THREE.ConeGeometry(0.1, 0.5, 4);
            wingGeo.rotateX(Math.PI/2);
            let wing = new THREE.Mesh(wingGeo, mat);
            wing.position.set(0, 0.5 * this.genes.size, -0.3);
            this.meshGroup.add(wing);
        }
        
        // Eyes based on sociability
        let eyeSize = this.genes.sociability > 70 ? 0.12 : 0.06;
        let eyeGeo = new THREE.SphereGeometry(eyeSize, 8, 8);
        let eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        let pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
        
        let leye = new THREE.Mesh(eyeGeo, eyeMat);
        leye.position.set(-0.15, 0.5 * this.genes.size, 0.3 * this.genes.size);
        let lpupil = new THREE.Mesh(new THREE.SphereGeometry(eyeSize*0.5, 8, 8), pupilMat);
        lpupil.position.set(0, 0, eyeSize*0.8);
        leye.add(lpupil);
        this.meshGroup.add(leye);
        
        let reye = leye.clone();
        reye.position.set(0.15, 0.5 * this.genes.size, 0.3 * this.genes.size);
        this.meshGroup.add(reye);
        
        // Emotion Sprite
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        this.emotionCtx = canvas.getContext('2d');
        const tex = new THREE.CanvasTexture(canvas);
        const spriteMat = new THREE.SpriteMaterial({ map: tex });
        this.emotionSprite = new THREE.Sprite(spriteMat);
        this.emotionSprite.position.y = 1.2 * this.genes.size;
        this.emotionSprite.scale.set(0.8, 0.8, 1);
        this.meshGroup.add(this.emotionSprite);
        
        // Selection Ring
        const ringGeo = new THREE.RingGeometry(0.5 * this.genes.size, 0.6 * this.genes.size, 16);
        ringGeo.rotateX(-Math.PI/2);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0 });
        this.selectionRing = new THREE.Mesh(ringGeo, ringMat);
        this.selectionRing.position.y = 0.05;
        this.meshGroup.add(this.selectionRing);
        
        scene.add(this.meshGroup);
    }
    
    updateEmotion() {
        this.emotionCtx.clearRect(0,0,64,64);
        this.emotionCtx.font = '40px Arial';
        this.emotionCtx.textAlign = 'center';
        if (this.state === 'sleeping') {
            this.emotionCtx.fillText('💤', 32, 48);
        } else if (this.happiness < 30) {
            this.emotionCtx.fillText('😢', 32, 48);
        } else if (this.arousal > 80) {
            this.emotionCtx.fillText('❤️', 32, 48);
        }
        this.emotionSprite.material.map.needsUpdate = true;
    }
    
    update(dt) {
        if (this === draggedCreature) {
            this.meshGroup.position.set(this.x, 3, this.z); // Lifted up when dragged
            return;
        }

        let tx = Math.floor(clamp(this.x, 0, MAP_SIZE-1));
        let tz = Math.floor(clamp(this.z, 0, MAP_SIZE-1));
        let tile = world[tx] && world[tx][tz];
        
        if (!tile) return;
        
        let groundHeight = tile.biome.height;
        this.meshGroup.position.set(this.x, groundHeight, this.z);

        this.hunger -= 2 * this.genes.metabolism * dt;
        this.energy -= 1 * dt;
        
        let envScore = 100;
        envScore -= Math.abs(tile.biome.moisture - this.genes.prefMoisture) * 0.3;
        envScore -= Math.abs(tile.biome.temp - this.genes.prefTemp) * 0.3;
        envScore -= Math.abs(tile.biome.light - this.genes.prefLight) * 0.3;
        
        let nearby = creatures.filter(c => c !== this && Math.hypot(c.x - this.x, c.z - this.z) < 5);
        if (this.genes.sociability > 50 && nearby.length === 0) envScore -= 20;
        if (this.genes.sociability < 30 && nearby.length > 2) envScore -= 20;
        
        this.happiness += (envScore - this.happiness) * dt * 0.5;
        this.happiness = clamp(this.happiness, 0, 100);
        
        if (this.happiness > 70 && this.hunger > 60) this.arousal += 5 * dt;
        else this.arousal -= 2 * dt;
        
        this.arousal = clamp(this.arousal, 0, 100);
        this.hunger = clamp(this.hunger, 0, 100);
        this.energy = clamp(this.energy, 0, 100);

        if (this.energy < 20 || this.state === 'sleeping') {
            this.state = 'sleeping';
            this.energy += 15 * dt;
            if (this.energy > 90) this.state = 'idle';
            this.updateEmotion();
            return;
        }

        if (this.target) {
            let dx = this.target.x - this.x;
            let dz = this.target.z - this.z;
            let dist = Math.hypot(dx, dz);
            
            if (dist < 0.1) {
                this.x = this.target.x;
                this.z = this.target.z;
                this.target = null;
                this.state = 'idle';
            } else {
                this.x += (dx / dist) * this.genes.speed * dt;
                this.z += (dz / dist) * this.genes.speed * dt;
                this.state = 'moving';
                
                // Rotation towards target
                let angle = Math.atan2(dx, dz);
                this.meshGroup.rotation.y = angle;
                
                // Bouncing animation
                this.bodyMesh.position.y = 0.4 * this.genes.size + Math.abs(Math.sin(Date.now() * 0.01 * this.genes.speed)) * 0.3;
            }
        } else {
            this.bodyMesh.position.y = 0.4 * this.genes.size; // Reset bounce
            
            if (this.hunger < 40) {
                let bestFood = null;
                let minDist = Infinity;
                foods.forEach(f => {
                    let d = Math.hypot(f.x - this.x, f.z - this.z);
                    if (d < 5 && d < minDist) { minDist = d; bestFood = f; }
                });
                if (bestFood) this.target = { x: bestFood.x, z: bestFood.z };
                else this.wander();
            } else if (this.arousal > 80) {
                let mate = creatures.find(c => c !== this && c.arousal > 80 && Math.hypot(c.x - this.x, c.z - this.z) < 6);
                if (mate) {
                    this.target = { x: mate.x, z: mate.z };
                    if (Math.hypot(mate.x - this.x, mate.z - this.z) < 0.5) {
                        this.arousal = 0; mate.arousal = 0;
                        this.energy -= 30; mate.energy -= 30;
                        
                        // Heart Animation using Tween
                        new TWEEN.Tween(this.meshGroup.scale)
                            .to({ x: 1.5, y: 1.5, z: 1.5 }, 300)
                            .yoyo(true).repeat(1)
                            .start();
                            
                        let cx = (this.x + mate.x) / 2;
                        let cz = (this.z + mate.z) / 2;
                        let child = new Creature(cx, cz, [this, mate]);
                        creatures.push(child);
                        updateStatsUI();
                    }
                } else {
                    this.wander();
                }
            } else if (Math.random() < 0.02) {
                let searchX = clamp(Math.floor(this.x + randomRange(-3, 3)), 0, MAP_SIZE-1);
                let searchZ = clamp(Math.floor(this.z + randomRange(-3, 3)), 0, MAP_SIZE-1);
                this.target = { x: searchX, z: searchZ };
            }
        }
        
        if (this.hunger < 80) {
            for (let i = foods.length - 1; i >= 0; i--) {
                let f = foods[i];
                if (Math.hypot(f.x - this.x, f.z - this.z) < 0.5) {
                    this.hunger += 30;
                    scene.remove(f.mesh);
                    foods.splice(i, 1);
                    break;
                }
            }
        }
        
        this.updateEmotion();
        
        // Highlight logic
        if (selectedEntity && selectedEntity.type === 'creature' && selectedEntity.obj === this) {
            this.selectionRing.material.opacity = 0.8;
            this.selectionRing.rotation.z += 2 * dt;
        } else {
            this.selectionRing.material.opacity = 0;
        }
    }
    
    wander() {
        this.target = {
            x: clamp(this.x + randomRange(-2, 2), 0, MAP_SIZE - 1),
            z: clamp(this.z + randomRange(-2, 2), 0, MAP_SIZE - 1)
        };
    }
}

// --- FOOD ---
const appleGeo = new THREE.SphereGeometry(0.15, 8, 8);
const appleMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.2 });

function spawnFood(x, z) {
    let tx = Math.floor(clamp(x, 0, MAP_SIZE-1));
    let tz = Math.floor(clamp(z, 0, MAP_SIZE-1));
    let elev = world[tx][tz].biome.height;
    
    let mesh = new THREE.Mesh(appleGeo, appleMat);
    mesh.position.set(x, elev + 0.15, z);
    mesh.castShadow = true;
    scene.add(mesh);
    foods.push({ x, z, mesh });
}

// --- ENGINE ---
function gameLoop(timestamp) {
    requestAnimationFrame(gameLoop);
    
    let dt = (timestamp - lastTime) / 1000;
    if (dt > 0.1) dt = 0.1;
    lastTime = timestamp;

    TWEEN.update(timestamp);
    orbitControls.update();

    // World evolution
    if (Math.random() < 0.1 * dt) {
        let x = Math.floor(randomRange(0, MAP_SIZE));
        let z = Math.floor(randomRange(0, MAP_SIZE));
        let keys = Object.keys(BIOMES);
        let randomBiome = BIOMES[keys[Math.floor(randomRange(0, keys.length))]];
        
        world[x][z].biome = randomBiome;
        let mesh = tileMeshes[x][z];
        
        // Tween the transition for beauty!
        mesh.material.color.setHex(randomBiome.color);
        if (randomBiome === BIOMES.WATER) {
            mesh.material.transparent = true;
            mesh.material.opacity = 0.8;
            mesh.material.metalness = 0.5;
        } else {
            mesh.material.transparent = false;
            mesh.material.opacity = 1;
            mesh.material.metalness = 0.1;
        }
        
        new TWEEN.Tween(mesh.scale)
            .to({ y: randomBiome.height }, 1000)
            .easing(TWEEN.Easing.Quadratic.Out)
            .start();
    }

    creatures.forEach(c => c.update(dt));

    renderer.render(scene, camera);
    updateStatsUI();
}

// --- INPUT & TOOLS ---
function setupTools() {
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedTool = btn.dataset.tool;
            orbitControls.enabled = (selectedTool === 'inspect'); // Only allow drag camera if inspecting, otherwise it interferes with dragging creatures
        });
    });
}

function getIntersect(e) {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    
    // Check creatures first
    let creatureMeshes = creatures.map(c => c.meshGroup);
    let intersects = raycaster.intersectObjects(creatureMeshes, true);
    if (intersects.length > 0) {
        // Find the root group
        let obj = intersects[0].object;
        while(obj.parent && !obj.userData.isCreature) obj = obj.parent;
        if (obj.userData.isCreature) {
            return { type: 'creature', obj: obj.userData.obj };
        }
    }
    
    // Check tiles
    let flatTiles = [];
    for(let i=0; i<MAP_SIZE; i++) flatTiles.push(...tileMeshes[i]);
    
    intersects = raycaster.intersectObjects(flatTiles);
    if (intersects.length > 0) {
        let mesh = intersects[0].object;
        return { type: 'tile', obj: world[mesh.userData.x][mesh.userData.z], point: intersects[0].point };
    }
    
    return null;
}

function setupInput() {
    const container = renderer.domElement;
    
    // Highlight logic for tiles
    let highlightMesh = new THREE.Mesh(
        new THREE.BoxGeometry(1.05, 0.1, 1.05),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 })
    );
    scene.add(highlightMesh);
    highlightMesh.visible = false;

    container.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // Only left click
        
        let hit = getIntersect(e);
        
        if (selectedTool === 'inspect') {
            if (hit) {
                selectedEntity = hit;
                showInfoPanel();
            } else {
                selectedEntity = null;
                document.getElementById('info-panel').classList.add('hidden');
            }
        } else if (selectedTool === 'move') {
            if (hit && hit.type === 'creature') {
                draggedCreature = hit.obj;
                selectedEntity = hit;
                showInfoPanel();
                orbitControls.enabled = false;
            }
        } else if (selectedTool === 'feed') {
            if (hit && hit.type === 'tile') {
                spawnFood(hit.point.x, hit.point.z);
            }
        } else if (selectedTool.startsWith('terraform-')) {
            if (hit && hit.type === 'tile') {
                let biomeKey = selectedTool.split('-')[1].toUpperCase();
                let x = hit.obj.x;
                let z = hit.obj.z;
                if (BIOMES[biomeKey]) {
                    world[x][z].biome = BIOMES[biomeKey];
                    let mesh = tileMeshes[x][z];
                    mesh.material.color.setHex(BIOMES[biomeKey].color);
                    new TWEEN.Tween(mesh.scale)
                        .to({ y: BIOMES[biomeKey].height }, 500)
                        .easing(TWEEN.Easing.Bounce.Out)
                        .start();
                }
            }
        }
    });

    container.addEventListener('mousemove', (e) => {
        let hit = getIntersect(e);
        
        // Tile highlight
        if (hit && hit.type === 'tile' && selectedEntity?.obj === hit.obj) {
            highlightMesh.visible = true;
            highlightMesh.position.set(hit.obj.x, hit.obj.biome.height + 0.05, hit.obj.z);
        } else {
            highlightMesh.visible = false;
        }

        if (draggedCreature && hit && hit.type === 'tile') {
            draggedCreature.x = clamp(hit.point.x, 0, MAP_SIZE-1);
            draggedCreature.z = clamp(hit.point.z, 0, MAP_SIZE-1);
        }
    });

    container.addEventListener('mouseup', (e) => {
        if (draggedCreature) {
            draggedCreature.state = 'idle';
            draggedCreature.target = null;
            draggedCreature = null;
            if (selectedTool === 'inspect') orbitControls.enabled = true;
        }
    });
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
        let colHtml = `hsl(${c.genes.hue}, ${c.genes.saturation}%, ${c.genes.lightness}%)`;
        content.innerHTML = `
            <div class="creature-preview" style="background: ${colHtml}"></div>
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
            <div class="info-row"><span class="info-label">Speed:</span> <span class="info-value">${c.genes.speed.toFixed(1)}</span></div>
            <div class="info-row"><span class="info-label">Size:</span> <span class="info-value">${c.genes.size.toFixed(2)}x</span></div>
        `;
    } else if (selectedEntity.type === 'tile') {
        let t = selectedEntity.obj;
        let hexColor = '#' + t.biome.color.toString(16).padStart(6, '0');
        content.innerHTML = `
            <h4 style="text-align:center; margin-top:0; color: ${hexColor}">${t.biome.name} Tile</h4>
            <p style="text-align:center; font-size: 0.8rem; color: #94a3b8">(${t.x}, ${t.z})</p>
            <div class="tool-separator"></div>
            <div class="info-row"><span class="info-label">Elevation:</span> <span class="info-value">${t.biome.height.toFixed(1)}</span></div>
            <div class="info-row"><span class="info-label">Moisture:</span> <span class="info-value">${t.biome.moisture}</span></div>
            <div class="info-row"><span class="info-label">Temp:</span> <span class="info-value">${t.biome.temp}</span></div>
            <div class="info-row"><span class="info-label">Light:</span> <span class="info-value">${t.biome.light}</span></div>
        `;
    }
}

function updateStatsUI() {
    document.getElementById('stat-pop').innerText = creatures.length;
    document.getElementById('stat-gen').innerText = generation;
    
    if (selectedEntity && selectedEntity.type === 'creature' && document.getElementById('info-panel').classList.contains('hidden') === false) {
        showInfoPanel();
    }
}

// Start
init();
