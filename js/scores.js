import { SCORE_KEY, MODES } from './config.js';
import { mulberry32 } from './rng.js';
import { cleanRecord } from './validate.js';

const KEEP = 40;
const PRE = ['Mo', 'Ka', 'Lu', 'Tavi', 'Ne', 'Oro', 'Pela', 'Si', 'Wa', 'Zu', 'Iri', 'Bel', 'Quo', 'Ama', 'Fen', 'Ruk'];
const MID = ['ra', 'lo', 'mi', 'ne', 'ku', 'sa', 'ti', 'va', 'do', 'pe', ''];
const END = ['Isle', 'Atoll', 'Key', 'Reef', 'Island', 'Rock', 'Holm', 'Cay'];

// Every seed has a fixed, pronounceable name, so records stay readable.
export function islandName(seed) {
    const r = mulberry32(seed * 31 + 7);
    const p = PRE[Math.floor(r() * PRE.length)], m = MID[Math.floor(r() * MID.length)], e = END[Math.floor(r() * END.length)];
    return `${p}${m} ${e}`;
}

export function scoreOf(r) {
    const bonus = (MODES[r.mode] || MODES.classic).bonus;
    return Math.round((r.years * 25 + r.gen * 15 + r.peak * 2 + r.goals * 40) * bonus);
}

export function loadRecords() {
    try {
        const list = JSON.parse(localStorage.getItem(SCORE_KEY) || '[]');
        return Array.isArray(list) ? list.slice(0, 200).map(cleanRecord).filter(Boolean) : [];
    } catch (e) {
        return [];
    }
}

// Inserts or updates the run and returns its rank overall and on its island (1 = best).
export function submitRecord(entry) {
    entry.score = scoreOf(entry);
    let list = loadRecords().filter(r => r.id !== entry.id);
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    const rank = list.findIndex(r => r.id === entry.id) + 1;
    const islandRank = list.filter(r => r.seed === entry.seed && r.mode === entry.mode).findIndex(r => r.id === entry.id) + 1;
    list = list.slice(0, KEEP);
    try { localStorage.setItem(SCORE_KEY, JSON.stringify(list)); } catch (e) { /* storage blocked */ }
    return { rank, islandRank, score: entry.score, kept: rank <= KEEP };
}

export function clearRecords() {
    try { localStorage.removeItem(SCORE_KEY); } catch (e) { /* storage blocked */ }
}
