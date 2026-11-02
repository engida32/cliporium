import GLib from 'gi://GLib';

import {payloadForItem, TEXT_MIME} from '../extension/src/copy-payload.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected)
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

const textPayload = payloadForItem({kind: 'text', text: 'hello'}, null);
assertEqual(textPayload.mime, TEXT_MIME, 'text copy uses the text mime');
assertEqual(new TextDecoder().decode(textPayload.bytes.get_data()), 'hello',
    'text copy uses the item text');

const imageBytes = GLib.Bytes.new(new TextEncoder().encode('image bytes'));
const imageStore = {
    load: path => path === 'images/a.png' ? imageBytes : null,
};
const imagePayload = payloadForItem({
    kind: 'image',
    mime: 'image/png',
    blob_path: 'images/a.png',
}, imageStore);
assertEqual(imagePayload.mime, 'image/png', 'image copy uses the image mime');
assertEqual(new TextDecoder().decode(imagePayload.bytes.get_data()), 'image bytes',
    'image copy uses the stored bytes');

assertEqual(payloadForItem({
    kind: 'image',
    mime: 'image/png',
    blob_path: 'images/missing.png',
}, imageStore), null, 'missing image has no payload');

print('copy payload tests passed');
