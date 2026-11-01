import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {History, MAX_PINNED_ITEMS} from '../extension/src/history.js';
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

print('storage tests passed');
