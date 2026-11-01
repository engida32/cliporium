import GLib from 'gi://GLib';

import {matchesQuery, normalizeQuery} from './search.js';

const FORMAT_VERSION = 1;
const PREVIEW_LENGTH = 140;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PINNED_ITEMS = 100;

function byteLength(text) {
    return new TextEncoder().encode(text).byteLength;
}

function makePreview(text) {
    const firstLine = text.split('\n')[0].trim();
    if (firstLine.length <= PREVIEW_LENGTH)
        return firstLine;
    return `${firstLine.slice(0, PREVIEW_LENGTH)}…`;
}

function normalizeItem(candidate, maxBytes) {
    if (!candidate || typeof candidate !== 'object')
        return null;
    if (candidate.kind !== undefined && candidate.kind !== 'text')
        return null;
    if (typeof candidate.text !== 'string' || candidate.text.trim().length === 0)
        return null;
    if (byteLength(candidate.text) > maxBytes)
        return null;

    const createdAt = Number(candidate.created_at);
    const pinned = candidate.pinned === true;
    return {
        id: typeof candidate.id === 'string' && candidate.id.length > 0
            ? candidate.id
            : GLib.uuid_string_random(),
        kind: 'text',
        text: candidate.text,
        preview: typeof candidate.preview === 'string' && candidate.preview.length > 0
            ? candidate.preview
            : makePreview(candidate.text),
        byte_size: byteLength(candidate.text),
        created_at: Number.isFinite(createdAt) && createdAt > 0
            ? createdAt
            : Date.now(),
        pinned,
        source_app: typeof candidate.source_app === 'string'
            ? candidate.source_app
            : '',
    };
}

function compareItems(a, b) {
    if (a.pinned !== b.pinned)
        return a.pinned ? -1 : 1;
    return b.created_at - a.created_at;
}

export class History {
    constructor({limit = 100, maxBytes = 65536, retentionDays = 30} = {}) {
        this._items = [];
        this._limit = limit;
        this._maxBytes = maxBytes;
        this._retentionDays = retentionDays;
    }

    get size() {
        return this._items.length;
    }

    get pinnedCount() {
        return this._items.filter(item => item.pinned).length;
    }

    get maxPinned() {
        return MAX_PINNED_ITEMS;
    }

    setOptions({limit = this._limit, maxBytes = this._maxBytes,
        retentionDays = this._retentionDays} = {}) {
        this._limit = limit;
        this._maxBytes = maxBytes;
        this._retentionDays = retentionDays;
        this._prune();
    }

    load(raw) {
        if (!raw || typeof raw !== 'object' ||
            raw.version !== FORMAT_VERSION || !Array.isArray(raw.items))
            throw new Error('unsupported history format');

        const seen = new Set();
        const seenIds = new Set();
        const items = [];
        let dropped = 0;

        for (const candidate of raw.items) {
            const item = normalizeItem(candidate, this._maxBytes);
            if (!item || seen.has(item.text)) {
                dropped += 1;
                continue;
            }
            seen.add(item.text);
            if (seenIds.has(item.id))
                item.id = GLib.uuid_string_random();
            seenIds.add(item.id);
            items.push(item);
        }

        this._items = items;
        const pinnedBefore = this._items.filter(item => item.pinned).length;
        this._prune();
        const pinnedDropped = pinnedBefore - this.pinnedCount;
        return {dropped, pinnedDropped};
    }

    captureText(text, sourceApp = '', now = Date.now()) {
        if (typeof text !== 'string' || text.trim().length === 0)
            return {added: false, reason: 'empty'};

        const size = byteLength(text);
        if (size > this._maxBytes)
            return {added: false, reason: 'too-large', size};

        const existing = this._items.find(item => item.text === text);
        if (existing) {
            existing.created_at = now;
            existing.source_app = sourceApp;
            existing.preview = makePreview(text);
            this._sort();
            return {added: false, reason: 'duplicate', item: existing};
        }

        const item = {
            id: GLib.uuid_string_random(),
            kind: 'text',
            text,
            preview: makePreview(text),
            byte_size: size,
            created_at: now,
            pinned: false,
            source_app: sourceApp,
        };
        this._items.push(item);
        this._prune();
        return {added: true, item};
    }

    setPinned(id, pinned) {
        const item = this._items.find(candidate => candidate.id === id);
        if (!item)
            return false;
        if (pinned && !item.pinned && this.pinnedCount >= MAX_PINNED_ITEMS)
            return false;
        item.pinned = Boolean(pinned);
        this._prune();
        return true;
    }

    delete(id) {
        const index = this._items.findIndex(item => item.id === id);
        if (index < 0)
            return false;
        this._items.splice(index, 1);
        return true;
    }

    clearUnpinned() {
        this._items = this._items.filter(item => item.pinned);
    }

    clearAll() {
        this._items = [];
    }

    getItem(id) {
        return this._items.find(item => item.id === id) ?? null;
    }

    getItems(query = '') {
        const normalized = normalizeQuery(query);
        return this._items
            .filter(item => matchesQuery(item, normalized))
            .map(item => ({...item}));
    }

    toJSON() {
        return {version: FORMAT_VERSION, items: this._items};
    }

    _sort() {
        this._items.sort(compareItems);
    }

    _prune() {
        this._items = this._items.filter(
            item => item.pinned || item.byte_size <= this._maxBytes
        );

        if (this._retentionDays > 0) {
            const cutoff = Date.now() - this._retentionDays * DAY_MS;
            this._items = this._items.filter(item => item.pinned || item.created_at >= cutoff);
        }

        const pinned = this._items
            .filter(item => item.pinned)
            .sort(compareItems)
            .slice(0, MAX_PINNED_ITEMS);
        const unpinned = this._items
            .filter(item => !item.pinned)
            .sort(compareItems)
            .slice(0, this._limit);
        this._items = [...pinned, ...unpinned];
        this._sort();
    }
}

export {FORMAT_VERSION, MAX_PINNED_ITEMS};
