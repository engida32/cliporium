import GLib from 'gi://GLib';
import {History} from '../extension/src/history.js';

function now() { return GLib.get_monotonic_time() / 1000; }
function makeRaw(n) {
    const t = Date.now();
    const items = [];
    for (let i = 0; i < n; i++) {
        const text = `item ${String(i).padStart(4, '0')} ${'x'.repeat(20 + (i % 80))} needle${i % 7}`;
        items.push({id: `id-${i}`, kind: 'text', text, preview: text.slice(0, 140), created_at: t - i * 1000, pinned: i % 10 === 0, source_app: 'bench'});
    }
    return {version: 1, items};
}
function bench(label, fn, rounds = 20) {
    const times = [];
    for (let i = 0; i < rounds; i++) {
        const t0 = now();
        fn();
        times.push(now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    const p95 = times[Math.floor(times.length * 0.95)];
    print(`${label}: median=${median.toFixed(3)}ms p95=${p95.toFixed(3)}ms`);
}
for (const n of [193, 500]) {
    const raw = makeRaw(n);
    const h = new History({limit: n, maxBytes: 65536, retentionDays: 0});
    bench(`load ${n}`, () => { h.load(raw); });
    const h2 = new History({limit: n, maxBytes: 65536, retentionDays: 0});
    h2.load(raw);
    bench(`getItems all ${n}`, () => { h2.getItems(''); });
    bench(`getItems needle ${n}`, () => { h2.getItems('needle3'); });
    bench(`capture duplicate ${n}`, () => { h2.captureText(raw.items[Math.floor(n/2)].text, 'bench'); });
    bench(`capture new ${n}`, (() => { let k = 0; return () => { h2.captureText(`new ${n} ${k++} unique`, 'bench'); }; })());
    bench(`toJSON pretty ${n}`, () => { JSON.stringify(h2.toJSON(), null, 2); });
    bench(`toJSON compact ${n}`, () => { JSON.stringify(h2.toJSON()); });
    print(`size ${n}: ${h2.size} items`);
}
