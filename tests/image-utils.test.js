import GLib from 'gi://GLib';

import {
    decodeImage,
    formatBytes,
    imageExtension,
    imageMimeLabel,
} from '../extension/src/image-utils.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected)
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAAMIM////ZwAAHu8E/KPItPcAAAAASUVORK5CYII=';
const bytes = GLib.Bytes.new(GLib.base64_decode(PNG_B64));
const decoded = decodeImage(bytes);
assertEqual(decoded.width, 2, 'image width is decoded');
assertEqual(decoded.height, 2, 'image height is decoded');

assertEqual(imageExtension('image/png'), 'png', 'png extension');
assertEqual(imageExtension('image/jpeg'), 'jpg', 'jpeg extension');
assertEqual(imageExtension('text/plain'), null, 'text has no image extension');
assertEqual(imageMimeLabel('image/png'), 'PNG', 'png label');
assertEqual(imageMimeLabel('image/jpeg'), 'JPEG', 'jpeg label');

assertEqual(formatBytes(512), '512 B', 'bytes below one kibibyte');
assertEqual(formatBytes(2048), '2.0 KB', 'kilobytes');
assertEqual(formatBytes(12 * 1024 * 1024), '12 MB', 'megabytes');

let rejected = false;
try {
    decodeImage(GLib.Bytes.new(new TextEncoder().encode('not an image')));
} catch {
    rejected = true;
}
assert(rejected, 'invalid image bytes are rejected');

print('image utils tests passed');
