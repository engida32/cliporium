import GLib from 'gi://GLib';

import {matchesQuery, normalizeQuery} from './search.js';

const FORMAT_VERSION = 2;
const LEGACY_FORMAT_VERSION = 1;
const PREVIEW_LENGTH = 140;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PINNED_ITEMS = 100;
const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_PATH_PREFIX = 'images/';
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function byteLength(text) {
    return new TextEncoder().encode(text).byteLength;
}

function makePreview(text) {
    const firstLine = text.split('\n')[0].trim();
    if (firstLine.length <= PREVIEW_LENGTH)
        return firstLine;
    return `${firstLine.slice(0, PREVIEW_LENGTH)}…`;
}

function validId(candidate) {
    return typeof candidate.id === 'string' && candidate.id.length > 0
        ? candidate.id
        : GLib.uuid_string_random();
}

function createdAtFor(candidate) {
    const createdAt = Number(candidate.created_at);
    return Number.isFinite(createdAt) && createdAt > 0
        ? createdAt
        : Date.now();
}

function normalizeText(candidate, maxBytes) {
    if (typeof candidate.text !== 'string' || candidate.text.trim().length === 0)
        return null;
    if (candidate.pinned !== true && byteLength(candidate.text) > maxBytes)
        return null;

    return {
        id: validId(candidate),
        kind: 'text',
        text: candidate.text,
        preview: typeof candidate.preview === 'string' && candidate.preview.length > 0
            ? candidate.preview
            : makePreview(candidate.text),
        byte_size: byteLength(candidate.text),
        created_at: createdAtFor(candidate),
        pinned: candidate.pinned === true,
        source_app: typeof candidate.source_app === 'string'
            ? candidate.source_app
            : '',
    };
}

function normalizeImage(candidate, maxImageBytes) {
    const mime = typeof candidate.mime === 'string'
        ? candidate.mime.toLowerCase()
        : '';
    if (!mime.startsWith('image/'))
        return null;

    const byteSize = Number(candidate.byte_size);
    if (!Number.isFinite(byteSize) || byteSize <= 0 ||
        (candidate.pinned !== true && byteSize > maxImageBytes))
        return null;

    const blobPath = candidate.blob_path;
    if (typeof blobPath !== 'string' || !blobPath.startsWith(IMAGE_PATH_PREFIX) ||
        blobPath.includes('..')) {
        return null;
    }

    const sha256 = typeof candidate.sha256 === 'string'
        ? candidate.sha256.toLowerCase()
        : '';
    if (!SHA256_PATTERN.test(sha256))
        return null;

    const width = Number(candidate.width);
    const height = Number(candidate.height);
    return {
        id: validId(candidate),
        kind: 'image',
        text: '',
        preview: typeof candidate.preview === 'string' && candidate.preview.length > 0
            ? candidate.preview
            : 'Image',
        byte_size: byteSize,
        created_at: createdAtFor(candidate),
        pinned: candidate.pinned === true,
        source_app: typeof candidate.source_app === 'string'
            ? candidate.source_app
            : '',
        mime,
        blob_path: blobPath,
        sha256,
        width: Number.isInteger(width) && width > 0 ? width : 0,
        height: Number.isInteger(height) && height > 0 ? height : 0,
    };
}

function normalizeItem(candidate, maxBytes, maxImageBytes, version) {
    if (!candidate || typeof candidate !== 'object')
        return null;
    if (candidate.kind === 'image')
        return version >= FORMAT_VERSION
            ? normalizeImage(candidate, maxImageBytes)
            : null;
    if (candidate.kind !== undefined && candidate.kind !== 'text')
        return null;
    return normalizeText(candidate, maxBytes);
}

function itemKey(item) {
    return item.kind === 'image' ? `image:${item.sha256}` : `text:${item.text}`;
}

function compareItems(a, b) {
    if (a.pinned !== b.pinned)
        return a.pinned ? -1 : 1;
    return b.created_at - a.created_at;
}

export class History {
    constructor({limit = 100, maxBytes = 65536,
        maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
        retentionDays = 30} = {}) {
        this._items = [];
        this._removedBlobs = [];
        this._limit = limit;
        this._maxBytes = maxBytes;
        this._maxImageBytes = maxImageBytes;
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
        maxImageBytes = this._maxImageBytes,
        retentionDays = this._retentionDays} = {}) {
        this._limit = limit;
        this._maxBytes = maxBytes;
        this._maxImageBytes = maxImageBytes;
        this._retentionDays = retentionDays;
        this._prune();
    }

    load(raw) {
        if (!raw || typeof raw !== 'object' ||
            (raw.version !== LEGACY_FORMAT_VERSION &&
                raw.version !== FORMAT_VERSION) ||
            !Array.isArray(raw.items)) {
            throw new Error('unsupported history format');
        }

        const seen = new Set();
        const seenIds = new Set();
        const items = [];
        let dropped = 0;
        let pinnedOverLimit = 0;

        for (const candidate of raw.items) {
            const item = normalizeItem(
                candidate,
                this._maxBytes,
                this._maxImageBytes,
                raw.version
            );
            const key = item ? itemKey(item) : null;
            if (!item || seen.has(key)) {
                dropped += 1;
                continue;
            }
            const limit = item.kind === 'image'
                ? this._maxImageBytes
                : this._maxBytes;
            if (item.pinned && item.byte_size > limit)
                pinnedOverLimit += 1;
            seen.add(key);
            if (seenIds.has(item.id))
                item.id = GLib.uuid_string_random();
            seenIds.add(item.id);
            items.push(item);
        }

        this._items = items;
        const pinnedBefore = this._items.filter(item => item.pinned).length;
        this._prune();
        const pinnedDropped = pinnedBefore - this.pinnedCount;
        return {dropped, pinnedDropped, pinnedOverLimit};
    }

    captureText(text, sourceApp = '', now = Date.now()) {
        if (typeof text !== 'string' || text.trim().length === 0)
            return {added: false, reason: 'empty'};

        const size = byteLength(text);
        if (size > this._maxBytes)
            return {added: false, reason: 'too-large', size};

        const existing = this._items.find(
            item => item.kind === 'text' && item.text === text
        );
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

    captureImage(capture, sourceApp = '', now = Date.now()) {
        if (!capture || typeof capture !== 'object')
            return {added: false, reason: 'invalid'};

        const mime = typeof capture.mime === 'string'
            ? capture.mime.toLowerCase()
            : '';
        if (!mime.startsWith('image/'))
            return {added: false, reason: 'invalid'};

        const size = Number(capture.byte_size);
        if (!Number.isFinite(size) || size <= 0)
            return {added: false, reason: 'invalid'};
        if (size > this._maxImageBytes)
            return {added: false, reason: 'too-large', size};

        const blobPath = capture.blob_path;
        if (typeof blobPath !== 'string' ||
            !blobPath.startsWith(IMAGE_PATH_PREFIX) ||
            blobPath.includes('..')) {
            return {added: false, reason: 'invalid'};
        }

        const sha256 = typeof capture.sha256 === 'string'
            ? capture.sha256.toLowerCase()
            : '';
        if (!SHA256_PATTERN.test(sha256))
            return {added: false, reason: 'invalid'};

        const existing = this._items.find(
            item => item.kind === 'image' && item.sha256 === sha256
        );
        if (existing) {
            existing.created_at = now;
            existing.source_app = sourceApp;
            this._sort();
            return {added: false, reason: 'duplicate', item: existing};
        }

        const width = Number(capture.width);
        const height = Number(capture.height);
        const item = {
            id: GLib.uuid_string_random(),
            kind: 'image',
            text: '',
            preview: 'Image',
            byte_size: size,
            created_at: now,
            pinned: false,
            source_app: sourceApp,
            mime,
            blob_path: blobPath,
            sha256,
            width: Number.isInteger(width) && width > 0 ? width : 0,
            height: Number.isInteger(height) && height > 0 ? height : 0,
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
        const [item] = this._items.splice(index, 1);
        this._queueRemoved(item);
        return true;
    }

    clearUnpinned() {
        this._keep(item => item.pinned);
    }

    clearAll() {
        this._keep(() => false);
    }

    drainRemovedBlobs() {
        const blobs = this._removedBlobs;
        this._removedBlobs = [];
        return blobs;
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

    _fits(item) {
        if (item.pinned)
            return true;
        const limit = item.kind === 'image' ? this._maxImageBytes : this._maxBytes;
        return item.byte_size <= limit;
    }

    _queueRemoved(item) {
        if (item?.kind === 'image' && typeof item.blob_path === 'string')
            this._removedBlobs.push(item.blob_path);
    }

    _keep(predicate) {
        const kept = [];
        for (const item of this._items) {
            if (predicate(item))
                kept.push(item);
            else
                this._queueRemoved(item);
        }
        this._items = kept;
    }

    _prune() {
        this._keep(item => this._fits(item));

        if (this._retentionDays > 0) {
            const cutoff = Date.now() - this._retentionDays * DAY_MS;
            this._keep(item => item.pinned || item.created_at >= cutoff);
        }

        const pinned = this._items
            .filter(item => item.pinned)
            .sort(compareItems)
            .slice(0, MAX_PINNED_ITEMS);
        const unpinned = this._items
            .filter(item => !item.pinned)
            .sort(compareItems)
            .slice(0, this._limit);
        const keepIds = new Set([...pinned, ...unpinned].map(item => item.id));
        this._keep(item => keepIds.has(item.id));
        this._sort();
    }
}

export {FORMAT_VERSION, MAX_PINNED_ITEMS};
