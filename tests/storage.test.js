import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {History, MAX_PINNED_ITEMS} from '../extension/src/history.js';
import {ImageStore} from '../extension/src/image-store.js';
import {HistoryStorage} from '../extension/src/storage.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected)
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

function writeText(path, text) {
    const file = Gio.File.new_for_path(path);
    const bytes = new TextEncoder().encode(text);
    const [ok] = file.replace_contents(
        bytes,
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        null
    );
    assert(ok, `could not write ${path}`);
}

function historyPathFor(directory) {
    return GLib.build_filenamev([directory, 'history.json']);
}

function fileMode(path) {
    const info = Gio.File.new_for_path(path).query_info(
        'unix::mode',
        Gio.FileQueryInfoFlags.NONE,
        null
    );
    return info.get_attribute_uint32('unix::mode') & 0o777;
}

function readText(path) {
    const file = Gio.File.new_for_path(path);
    const [ok, contents] = file.load_contents(null);
    assert(ok, `could not read ${path}`);
    return new TextDecoder().decode(contents);
}

const root = GLib.dir_make_tmp('cliporium-storage-XXXXXX');
GLib.setenv('XDG_DATA_HOME', root, true);

const history = new History({limit: 10, maxBytes: 1024, retentionDays: 30});
const storage = new HistoryStorage({history});
const directory = GLib.build_filenamev([root, 'cliporium']);
const historyPath = GLib.build_filenamev([directory, 'history.json']);
writeText(historyPath, '{not json');

let loaded = 0;
let warning = '';
const loop = GLib.MainLoop.new(null, false);
const recoverStorage = new HistoryStorage({
    history,
    onLoaded: () => {
        loaded += 1;
        loop.quit();
    },
    onWarning: message => {
        warning = message;
    },
});
recoverStorage.load();
loop.run();

assertEqual(loaded, 1, 'malformed history still finishes loading');
assertEqual(history.size, 0, 'malformed history starts empty');
assert(warning.includes('unreadable'), 'malformed history reports a warning');

const enumerator = Gio.File.new_for_path(directory).enumerate_children(
    'standard::name',
    Gio.FileQueryInfoFlags.NONE,
    null
);
let backupFound = false;
for (let info = enumerator.next_file(null); info !== null;
    info = enumerator.next_file(null)) {
    if (!info.get_name().startsWith('history.json.corrupt-'))
        continue;
    backupFound = true;
    assertEqual(fileMode(GLib.build_filenamev([directory, info.get_name()])), 0o600,
        'corrupt history backup is private');
}
assert(backupFound, 'malformed history is backed up');
assertEqual(fileMode(directory), 0o700, 'history directory is private');

const validHistory = new History({limit: 10, maxBytes: 1024, retentionDays: 30});
writeText(historyPath, JSON.stringify({
    version: 1,
    items: [{text: 'alpha', kind: 'text', created_at: Date.now()}],
}));

let validLoaded = false;
let saved = false;
const validLoop = GLib.MainLoop.new(null, false);
const validStorage = new HistoryStorage({
    history: validHistory,
    onLoaded: () => {
        validLoaded = true;
        validHistory.captureText('beta');
        validStorage.scheduleSave();
    },
    onSaved: () => {
        saved = true;
        validLoop.quit();
    },
});
validStorage.load();
validLoop.run();

assert(validLoaded, 'valid history loads');
assert(saved, 'history saves through a temporary file');
assertEqual(validHistory.size, 2, 'loaded item and new capture are present');
assert(readText(historyPath).includes('beta'), 'saved file contains the new item');
assertEqual(fileMode(historyPath), 0o600, 'history file is private');

const pinRoot = GLib.dir_make_tmp('cliporium-pin-limit-XXXXXX');
GLib.setenv('XDG_DATA_HOME', pinRoot, true);
const pinDirectory = GLib.build_filenamev([pinRoot, 'cliporium']);
GLib.mkdir_with_parents(pinDirectory, 0o700);
const pinPath = GLib.build_filenamev([pinDirectory, 'history.json']);
writeText(pinPath, JSON.stringify({
    version: 1,
    items: Array.from({length: MAX_PINNED_ITEMS + 2}, (_, index) => ({
        id: `pin-${index}`,
        text: `pin-${index}`,
        kind: 'text',
        created_at: Date.now() + index,
        pinned: true,
    })),
}));
const pinHistory = new History({limit: 500, maxBytes: 1024, retentionDays: 30});
let pinLoaded = false;
let pinWarning = '';
const pinLoop = GLib.MainLoop.new(null, false);
const pinStorage = new HistoryStorage({
    history: pinHistory,
    dataHome: pinRoot,
    onLoaded: () => {
        pinLoaded = true;
        pinLoop.quit();
    },
    onWarning: message => {
        pinWarning = message;
    },
});
pinStorage.load();
pinLoop.run();
assert(pinLoaded, 'pinned-limit history loads');
assertEqual(pinHistory.size, MAX_PINNED_ITEMS, 'loaded pinned items are capped');
assert(pinWarning.includes('pinned'), 'loaded excess pinned items are reported');
pinStorage.destroy();
GLib.setenv('XDG_DATA_HOME', root, true);

const failureRoot = GLib.dir_make_tmp('cliporium-save-fail-XXXXXX');
GLib.setenv('XDG_DATA_HOME', failureRoot, true);
const failureDirectory = GLib.build_filenamev([failureRoot, 'cliporium']);
const failureHistory = new History({limit: 10, maxBytes: 1024, retentionDays: 30});
let failureLoaded = false;
let failureSaved = 0;
let failureError = false;
const failureLoop = GLib.MainLoop.new(null, false);
const failureStorage = new HistoryStorage({
    history: failureHistory,
    dataHome: failureRoot,
    retryDelayMs: 50,
    onLoaded: () => {
        failureLoaded = true;
    },
    onError: () => {
        failureError = true;
    },
    onSaved: () => {
        failureSaved += 1;
    },
});
failureStorage.load();
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
    assert(failureLoaded, 'failure test history loads');
    GLib.chmod(failureDirectory, 0o500);
    failureHistory.captureText('pending item');
    failureStorage.scheduleSave();
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
        assert(failureError, 'failed save reports an error');
        assertEqual(failureStorage._dirty, true, 'failed save keeps the history dirty');
        assertEqual(failureSaved, 0, 'failed save does not report success');
        GLib.chmod(failureDirectory, 0o700);
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            assert(failureSaved > 0, 'a delayed retry saves after permissions return');
            assert(readText(historyPathFor(failureDirectory)).includes('pending item'),
                'retry persists the pending item');
            failureStorage.destroy();
            GLib.setenv('XDG_DATA_HOME', root, true);
            failureLoop.quit();
            return GLib.SOURCE_REMOVE;
        });
        return GLib.SOURCE_REMOVE;
    });
    return GLib.SOURCE_REMOVE;
});
failureLoop.run();

const recoveryRoot = GLib.dir_make_tmp('cliporium-recovery-fail-XXXXXX');
GLib.setenv('XDG_DATA_HOME', recoveryRoot, true);
const recoveryDirectory = GLib.build_filenamev([recoveryRoot, 'cliporium']);
GLib.mkdir_with_parents(recoveryDirectory, 0o700);
const recoveryPath = GLib.build_filenamev([recoveryDirectory, 'history.json']);
writeText(recoveryPath, '{not json');
const fixedNow = 1700000000000;
const realNow = Date.now;
Date.now = () => fixedNow;
GLib.mkdir_with_parents(`${recoveryPath}.corrupt-${fixedNow}`, 0o700);

let recoveryLoaded = false;
let recoveryWarning = '';
let recoveryError = false;
const recoveryHistory = new History({limit: 10, maxBytes: 1024, retentionDays: 30});
const recoveryLoop = GLib.MainLoop.new(null, false);
const recoveryStorage = new HistoryStorage({
    history: recoveryHistory,
    dataHome: recoveryRoot,
    onLoaded: () => {
        recoveryLoaded = true;
        recoveryLoop.quit();
    },
    onWarning: message => {
        recoveryWarning = message;
    },
    onError: () => {
        recoveryError = true;
    },
});
recoveryStorage.load();
recoveryLoop.run();
Date.now = realNow;

assert(recoveryLoaded, 'failed recovery backup still finishes loading');
assert(recoveryError, 'failed recovery backup reports an error');
assert(!recoveryWarning.includes('a copy was saved'),
    'failed recovery backup does not claim a copy was saved');
assertEqual(readText(recoveryPath), '{not json',
    'failed recovery backup leaves the corrupt original intact');
recoveryStorage.destroy();
GLib.setenv('XDG_DATA_HOME', root, true);


const missingRoot = GLib.dir_make_tmp('cliporium-missing-image-XXXXXX');
const missingStore = new ImageStore({dataHome: missingRoot});
const missingHistory = new History({
    limit: 10,
    maxBytes: 1024,
    maxImageBytes: 4096,
    retentionDays: 30,
});
const missingDirectory = GLib.build_filenamev([missingRoot, 'cliporium']);
GLib.mkdir_with_parents(missingDirectory, 0o700);
writeText(historyPathFor(missingDirectory), JSON.stringify({
    version: 2,
    items: [{
        id: 'missing-image',
        kind: 'image',
        mime: 'image/png',
        byte_size: 100,
        blob_path: `images/${'e'.repeat(64)}.png`,
        sha256: 'e'.repeat(64),
        width: 10,
        height: 10,
        created_at: Date.now(),
        preview: 'Image',
    }],
}));
let missingLoaded = false;
let missingWarning = '';
const missingLoop = GLib.MainLoop.new(null, false);
const missingStorage = new HistoryStorage({
    history: missingHistory,
    dataHome: missingRoot,
    imageStore: missingStore,
    onLoaded: () => {
        missingLoaded = true;
        missingLoop.quit();
    },
    onWarning: message => {
        missingWarning = message;
    },
});
missingStorage.load();
missingLoop.run();
assert(missingLoaded, 'missing-image history loads');
assertEqual(missingHistory.size, 0, 'missing image item is dropped');
assert(missingWarning.includes('missing image'), 'missing image is reported');
missingStorage.destroy();

const oversizedRoot = GLib.dir_make_tmp('cliporium-oversized-pinned-image-XXXXXX');
const oversizedStore = new ImageStore({dataHome: oversizedRoot});
const oversizedSaved = oversizedStore.save(
    new TextEncoder().encode('pinned image bytes larger than the configured limit'),
    'image/png'
);
const oversizedDirectory = GLib.build_filenamev([oversizedRoot, 'cliporium']);
GLib.mkdir_with_parents(oversizedDirectory, 0o700);
writeText(historyPathFor(oversizedDirectory), JSON.stringify({
    version: 2,
    items: [{
        id: 'oversized-pinned-image',
        kind: 'image',
        mime: 'image/png',
        byte_size: oversizedSaved.byte_size,
        blob_path: oversizedSaved.blob_path,
        sha256: oversizedSaved.sha256,
        width: 10,
        height: 10,
        created_at: Date.now(),
        pinned: true,
        preview: 'Image',
    }],
}));
const oversizedHistory = new History({
    limit: 10,
    maxBytes: 1024,
    maxImageBytes: 8,
    retentionDays: 30,
});
let oversizedLoaded = false;
let oversizedWarning = '';
const oversizedLoop = GLib.MainLoop.new(null, false);
const oversizedStorage = new HistoryStorage({
    history: oversizedHistory,
    dataHome: oversizedRoot,
    imageStore: oversizedStore,
    onLoaded: () => {
        oversizedLoaded = true;
        oversizedLoop.quit();
    },
    onWarning: message => {
        oversizedWarning = message;
    },
});
oversizedStorage.load();
oversizedLoop.run();
assert(oversizedLoaded, 'oversized pinned image history loads');
assertEqual(oversizedHistory.size, 1,
    'oversized pinned image is kept on load');
assert(oversizedHistory.getItems()[0].pinned,
    'oversized loaded image stays pinned');
assert(oversizedStore.exists(oversizedSaved.blob_path),
    'oversized pinned image blob is kept on load');
assert(oversizedWarning.includes('pinned'),
    'oversized pinned image is reported');
oversizedStorage.destroy();

const cleanupRoot = GLib.dir_make_tmp('cliporium-image-cleanup-XXXXXX');
const cleanupStore = new ImageStore({dataHome: cleanupRoot});
const cleanupSaved = cleanupStore.save(
    new TextEncoder().encode('delete me after the history save'),
    'image/png'
);
const cleanupHistory = new History({
    limit: 10,
    maxBytes: 1024,
    maxImageBytes: 4096,
    retentionDays: 30,
});
cleanupHistory.captureImage(cleanupSaved, '', Date.now());
let cleanupSavedFired = false;
const cleanupLoop = GLib.MainLoop.new(null, false);
const cleanupStorage = new HistoryStorage({
    history: cleanupHistory,
    dataHome: cleanupRoot,
    imageStore: cleanupStore,
    onLoaded: () => {
        const item = cleanupHistory.getItems()[0];
        assert(item, 'cleanup image is loaded');
        cleanupHistory.delete(item.id);
        cleanupStorage.scheduleSave();
    },
    onSaved: () => {
        cleanupSavedFired = true;
        assert(!cleanupStore.exists(cleanupSaved.blob_path),
            'deleted image blob is removed after the history save');
        cleanupStorage.destroy();
        cleanupLoop.quit();
    },
});
cleanupStorage.load();
cleanupLoop.run();
assert(cleanupSavedFired, 'cleanup save completes');


const orphanRoot = GLib.dir_make_tmp('cliporium-orphan-image-XXXXXX');
const orphanStore = new ImageStore({dataHome: orphanRoot});
const orphanSaved = orphanStore.save(
    new TextEncoder().encode('orphan image bytes'),
    'image/png'
);
const orphanDirectory = GLib.build_filenamev([orphanRoot, 'cliporium']);
GLib.mkdir_with_parents(orphanDirectory, 0o700);
writeText(historyPathFor(orphanDirectory), JSON.stringify({
    version: 2,
    items: [{
        id: 'text-only',
        kind: 'text',
        text: 'no images here',
        created_at: Date.now(),
    }],
}));
const orphanHistory = new History({
    limit: 10,
    maxBytes: 1024,
    maxImageBytes: 4096,
    retentionDays: 30,
});
let orphanLoaded = false;
const orphanLoop = GLib.MainLoop.new(null, false);
const orphanStorage = new HistoryStorage({
    history: orphanHistory,
    dataHome: orphanRoot,
    imageStore: orphanStore,
    onLoaded: () => {
        orphanLoaded = true;
        orphanLoop.quit();
    },
});
orphanStorage.load();
orphanLoop.run();
assert(orphanLoaded, 'orphan cleanup history loads');
assert(!orphanStore.exists(orphanSaved.blob_path),
    'unreferenced image blob is removed on load');
orphanStorage.destroy();

print('storage tests passed');
