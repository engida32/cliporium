import GLib from 'gi://GLib';

import {ClipboardReader} from '../extension/src/clipboard.js';
import {decodeImage} from '../extension/src/image-utils.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected)
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAAMIM////ZwAAHu8E/KPItPcAAAAASUVORK5CYII=';
const png = GLib.base64_decode(PNG_B64);

let imageSource = null;
const fake = {
    get_content(_type, mime, callback) {
        if (mime !== 'image/png') {
            callback(null, null);
            return;
        }
        imageSource = GLib.Bytes.new(png);
        callback(null, imageSource);
    },
};

const reader = new ClipboardReader(fake);
const image = await reader.readImage(1024 * 1024);
assert(image.bytes, 'image bytes are returned');
assert(image.bytes !== imageSource,
    'clipboard bytes are copied out of the callback');
assertEqual(image.mime, 'image/png', 'image mime is preserved');
const dimensions = decodeImage(image.bytes);
assertEqual(dimensions.width, 2, 'copied image width is decoded');
assertEqual(dimensions.height, 2, 'copied image height is decoded');

const textFake = {
    get_content(_type, mime, callback) {
        if (mime === 'text/plain;charset=utf-8')
            callback(null, GLib.Bytes.new(new TextEncoder().encode('hello')));
        else
            callback(null, null);
    },
};
const textReader = new ClipboardReader(textFake);
const text = await textReader.readText(1024);
assertEqual(text.text, 'hello', 'text is decoded');
assertEqual(text.tooLarge, false, 'text is not oversized');

const binaryTextFake = {
    get_content(_type, mime, callback) {
        if (mime === 'text/plain;charset=utf-8')
            callback(null, GLib.Bytes.new(png));
        else
            callback(null, null);
    },
};
const binaryTextReader = new ClipboardReader(binaryTextFake);
const binaryText = await binaryTextReader.readText(1024);
assertEqual(binaryText.text, null, 'binary image data is not stored as text');
assertEqual(binaryText.tooLarge, false, 'binary text is not oversized');

print('clipboard tests passed');
