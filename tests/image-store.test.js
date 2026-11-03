import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ImageStore} from '../extension/src/image-store.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected)
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

function fileMode(path) {
    const info = Gio.File.new_for_path(path).query_info(
        'unix::mode',
        Gio.FileQueryInfoFlags.NONE,
        null
    );
    return info.get_attribute_uint32('unix::mode') & 0o777;
}

function waitFor(promise) {
    const loop = GLib.MainLoop.new(null, false);
    let value;
    let error;
    promise.then(result => {
        value = result;
        loop.quit();
    }, failure => {
        error = failure;
        loop.quit();
    });
    loop.run();
    if (error)
        throw error;
    return value;
}

const root = GLib.dir_make_tmp('cliporium-images-XXXXXX');
const store = new ImageStore({dataHome: root});
const bytes = new TextEncoder().encode('not a real png, but stable bytes');

const saved = store.save(bytes, 'image/png');
assertEqual(saved.mime, 'image/png', 'image mime is kept');
assertEqual(saved.byte_size, bytes.byteLength, 'image size is reported');
assert(saved.sha256.length === 64, 'image sha256 is computed');
assertEqual(saved.blob_path, `images/${saved.sha256}.png`,
    'image path is content addressed');
assert(store.exists(saved.blob_path), 'saved image exists');
assertEqual(fileMode(store.pathFor(saved.blob_path)), 0o600,
    'saved image is private');

const loaded = waitFor(store.loadAsync(saved.blob_path));
assert(loaded, 'saved image can be loaded');
assertEqual(new TextDecoder().decode(loaded.get_data()), new TextDecoder().decode(bytes),
    'loaded image bytes match');
assertEqual(waitFor(store.loadAsync('images/missing.png')), null,
    'missing image loads as null');

const again = store.save(bytes, 'image/png');
assertEqual(again.blob_path, saved.blob_path, 'duplicate bytes reuse the same path');

const asyncBytes = new TextEncoder().encode('async image bytes');
const asyncSaved = waitFor(store.saveAsync(asyncBytes, 'image/png'));
assertEqual(asyncSaved.mime, 'image/png', 'async image mime is kept');
assertEqual(asyncSaved.byte_size, asyncBytes.byteLength, 'async image size is reported');
assertEqual(asyncSaved.created, true, 'async image is created');
assert(store.exists(asyncSaved.blob_path), 'async image exists');
assertEqual(fileMode(store.pathFor(asyncSaved.blob_path)), 0o600,
    'async image is private');
const asyncAgain = waitFor(store.saveAsync(asyncBytes, 'image/png'));
assertEqual(asyncAgain.created, false, 'duplicate async image is not recreated');

let rejected = false;
try {
    store.save(bytes, 'text/plain');
} catch {
    rejected = true;
}
assert(rejected, 'non-image mime is rejected');

const jpeg = store.save(new TextEncoder().encode('jpeg bytes'), 'image/jpeg');
assert(store.list().includes(saved.blob_path), 'list includes png image');
assert(store.list().includes(jpeg.blob_path), 'list includes jpeg image');

assert(store.delete(saved.blob_path), 'image can be deleted');
assert(!store.exists(saved.blob_path), 'deleted image is gone');
assertEqual(store.delete(saved.blob_path), false, 'deleting a missing image is safe');

print('image store tests passed');
