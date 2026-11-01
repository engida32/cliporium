import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {History} from '../extension/src/history.js';
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
    if (info.get_name().startsWith('history.json.corrupt-'))
        backupFound = true;
}
assert(backupFound, 'malformed history is backed up');

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

print('storage tests passed');
