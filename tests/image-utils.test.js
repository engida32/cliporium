import GLib from 'gi://GLib';

import {
    decodeImage,
    formatBytes,
    imageDimensions,
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
const dimensions = imageDimensions(bytes);
assertEqual(dimensions.width, 2, 'image width is read from the header');
assertEqual(dimensions.height, 2, 'image height is read from the header');
const decoded = decodeImage(bytes);
assertEqual(decoded.width, 2, 'image width is decoded');
assertEqual(decoded.height, 2, 'image height is decoded');

const oversized = new Uint8Array(bytes.get_data());
oversized[16] = 0;
oversized[17] = 0;
oversized[18] = 0x27;
oversized[19] = 0x10;
oversized[20] = 0;
oversized[21] = 0;
oversized[22] = 0x27;
oversized[23] = 0x10;
let oversizedRejected = false;
try {
    decodeImage(GLib.Bytes.new(oversized));
} catch (error) {
    oversizedRejected = error.message.includes('dimension');
}
assert(oversizedRejected, 'oversized image dimensions are rejected before decode');

const jpeg = new Uint8Array(39);
jpeg.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], 0);
jpeg.set([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x20], 20);
const jpegDimensions = imageDimensions(GLib.Bytes.new(jpeg));
assertEqual(jpegDimensions.width, 32, 'jpeg width is read from the SOF marker');
assertEqual(jpegDimensions.height, 16, 'jpeg height is read from the SOF marker');

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
