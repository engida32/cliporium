import {History, MAX_PINNED_ITEMS} from '../extension/src/history.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected)
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

const history = new History({limit: 3, maxBytes: 1024, retentionDays: 30});
const base = Date.now() - 10000;

assertEqual(history.captureText('').reason, 'empty', 'empty text is skipped');
assertEqual(history.captureText('   ').reason, 'empty', 'blank text is skipped');
assertEqual(history.captureText('x'.repeat(1025)).reason, 'too-large',
    'oversized text is skipped');

let result = history.captureText('alpha', 'app-one', base + 1000);
assert(result.added, 'first text is added');
result = history.captureText('alpha', 'app-two', base + 2000);
assertEqual(result.reason, 'duplicate', 'duplicate text is detected');
assertEqual(history.size, 1, 'duplicate does not add an item');
assertEqual(history.getItem(result.item.id).source_app, 'app-two',
    'duplicate refreshes metadata');

history.captureText('beta', 'app', base + 3000);
history.captureText('gamma', 'app', base + 4000);
history.captureText('delta', 'app', base + 5000);
assertEqual(history.size, 3, 'history limit is enforced');
assertEqual(history.getItems()[0].text, 'delta', 'newest item sorts first');

const beta = history.getItems().find(item => item.text === 'beta');
history.setPinned(beta.id, true);
assert(history.getItem(beta.id).pinned, 'item can be pinned');
history.captureText('epsilon', 'app', base + 6000);
history.captureText('zeta', 'app', base + 7000);
assert(history.getItem(beta.id) !== null, 'pinned item survives trimming');
assertEqual(history.size, 4, 'pinned items do not consume the unpinned limit');

const pinned = history.getItems().find(item => item.pinned);
assertEqual(history.getItems()[0].id, pinned.id, 'pinned items sort first');

assertEqual(history.getItems('EPS').length, 1, 'search is case-insensitive');
assertEqual(history.getItems('ta').length, 3, 'search matches substrings');
assertEqual(history.getItems('missing').length, 0, 'search can return nothing');

assert(history.delete(beta.id), 'delete removes an item');
assertEqual(history.getItem(beta.id), null, 'deleted item is gone');

history.clearUnpinned();
assertEqual(history.size, 0, 'clear unpinned removes all unpinned items');

history.captureText('one', 'app', base + 8000);
history.setPinned(history.getItems()[0].id, true);
history.captureText('two', 'app', base + 9000);
history.clearAll();
assertEqual(history.size, 0, 'clear all removes pinned items too');

const loaded = new History({limit: 10, maxBytes: 1024, retentionDays: 0});
const loadedResult = loaded.load({
    version: 1,
    items: [
        {text: 'valid', kind: 'text', created_at: 1000},
        {text: 'valid', kind: 'text', created_at: 2000},
        {text: 'image', kind: 'image', created_at: 3000},
        {text: '', kind: 'text', created_at: 4000},
        {text: 'bad-created', kind: 'text', created_at: 'nope'},
    ],
});
assertEqual(loaded.size, 2, 'invalid and duplicate loaded items are skipped');
assert(loadedResult.dropped >= 2, 'dropped count is reported');
assert(loaded.getItems().some(item => item.text === 'valid'),
    'valid items survive loading');

let rejected = false;
try {
    loaded.load({version: 99, items: []});
} catch {
    rejected = true;
}
assert(rejected, 'unsupported history format is rejected');

const retained = new History({limit: 10, maxBytes: 1024, retentionDays: 1});
retained.load({
    version: 1,
    items: [
        {text: 'old', kind: 'text', created_at: 1},
        {text: 'new', kind: 'text', created_at: Date.now()},
    ],
});
assertEqual(retained.size, 1, 'retention removes old unpinned items');
assertEqual(retained.getItems()[0].text, 'new', 'retention keeps recent items');


const duplicateIds = new History({limit: 10, maxBytes: 1024, retentionDays: 0});
duplicateIds.load({
    version: 1,
    items: [
        {id: 'same', text: 'first', kind: 'text', created_at: 1000},
        {id: 'same', text: 'second', kind: 'text', created_at: 2000},
    ],
});
assertEqual(duplicateIds.size, 2, 'duplicate ids do not drop valid text');
const first = duplicateIds.getItems().find(item => item.text === 'first');
const second = duplicateIds.getItems().find(item => item.text === 'second');
assert(first.id !== second.id, 'duplicate ids are regenerated on load');
assert(duplicateIds.delete(first.id), 'selected duplicate-id item can be deleted');
assertEqual(duplicateIds.getItem(second.id)?.text, 'second',
    'deleting one duplicate id leaves the other item');

const pinCap = new History({limit: 500, maxBytes: 1024, retentionDays: 0});
for (let index = 0; index < MAX_PINNED_ITEMS + 1; index++)
    pinCap.captureText(`pin-${index}`, '', base + index);
for (const item of pinCap.getItems())
    pinCap.setPinned(item.id, true);
assertEqual(pinCap.pinnedCount, MAX_PINNED_ITEMS, 'pinned count is capped');
const extraPin = pinCap.getItems().find(item => !item.pinned);
assert(extraPin, 'one unpinned item remains after the cap is reached');
assertEqual(pinCap.setPinned(extraPin.id, true), false)
assertEqual(pinCap.pinnedCount, MAX_PINNED_ITEMS, 'pinning past the cap is rejected');

const loadedPins = new History({limit: 500, maxBytes: 1024, retentionDays: 0});
const pinLoad = loadedPins.load({
    version: 1,
    items: Array.from({length: MAX_PINNED_ITEMS + 2}, (_, index) => ({
        id: `pinned-${index}`,
        text: `pinned-${index}`,
        kind: 'text',
        created_at: base + index,
        pinned: true,
    })),
});
assertEqual(loadedPins.size, MAX_PINNED_ITEMS, 'loaded pins are capped');
assertEqual(pinLoad.pinnedDropped, 2, 'loaded excess pins are reported');
assert(!loadedPins.getItems().some(item => item.text === 'pinned-0'),
    'oldest excess pinned item is dropped');
assert(loadedPins.getItems().some(item => item.text === `pinned-${MAX_PINNED_ITEMS + 1}`),
    'newest pinned item is kept');


const imageHistory = new History({
    limit: 10,
    maxBytes: 1024,
    maxImageBytes: 4096,
    retentionDays: 0,
});
const imageA = {
    sha256: 'a'.repeat(64),
    mime: 'image/png',
    byte_size: 512,
    blob_path: `images/${'a'.repeat(64)}.png`,
    width: 64,
    height: 48,
};
let imageResult = imageHistory.captureImage(imageA, 'app-one', base + 1000);
assert(imageResult.added, 'first image is added');
assertEqual(imageResult.item.kind, 'image', 'image kind is stored');
assertEqual(imageResult.item.text, '', 'image has no text payload');
assertEqual(imageResult.item.preview, 'Image', 'image preview is set');
assertEqual(imageResult.item.width, 64, 'image width is stored');
assertEqual(imageResult.item.height, 48, 'image height is stored');
assertEqual(imageHistory.getItems('png').length, 1, 'search matches image mime');

imageResult = imageHistory.captureImage(imageA, 'app-two', base + 2000);
assertEqual(imageResult.reason, 'duplicate', 'duplicate image is detected');
assertEqual(imageHistory.size, 1, 'duplicate image does not add an item');
assertEqual(imageHistory.getItem(imageResult.item.id).source_app, 'app-two',
    'duplicate image refreshes metadata');

assertEqual(imageHistory.captureImage({...imageA, sha256: 'b'.repeat(64),
    blob_path: `images/${'b'.repeat(64)}.png`, byte_size: 4097},
'app', base + 3000).reason, 'too-large', 'oversized image is skipped');
assertEqual(imageHistory.captureImage({...imageA, mime: 'text/plain'},
    'app', base + 3000).reason, 'invalid', 'non-image mime is skipped');
assertEqual(imageHistory.captureImage({...imageA, blob_path: ''},
    'app', base + 3000).reason, 'invalid', 'image without a blob path is skipped');
assertEqual(imageHistory.captureImage({...imageA, sha256: 'nope'},
    'app', base + 3000).reason, 'invalid', 'image without a hash is skipped');

const imageId = imageHistory.getItems()[0].id;
assert(imageHistory.setPinned(imageId, true), 'image can be pinned');
assert(imageHistory.delete(imageId), 'image can be deleted');
assertEqual(imageHistory.drainRemovedBlobs().length, 1,
    'deleting an image queues its blob for cleanup');

const loadedImages = new History({
    limit: 10,
    maxBytes: 1024,
    maxImageBytes: 4096,
    retentionDays: 0,
});
loadedImages.load({
    version: 2,
    items: [{
        id: 'loaded-image',
        kind: 'image',
        mime: 'image/png',
        byte_size: 100,
        blob_path: `images/${'c'.repeat(64)}.png`,
        sha256: 'c'.repeat(64),
        width: 10,
        height: 20,
        created_at: base + 1000,
        preview: 'Image',
    }],
});
assertEqual(loadedImages.size, 1, 'version 2 image items load');
assertEqual(loadedImages.getItems()[0].kind, 'image', 'loaded image keeps its kind');
assertEqual(loadedImages.getItems()[0].width, 10, 'loaded image keeps its width');

const oversizedPins = new History({
    limit: 10,
    maxBytes: 4,
    maxImageBytes: 8,
    retentionDays: 0,
});
const oversizedPinLoad = oversizedPins.load({
    version: 2,
    items: [
        {
            id: 'oversized-pinned-text',
            kind: 'text',
            text: 'pinned text',
            created_at: base + 1000,
            pinned: true,
        },
        {
            id: 'oversized-pinned-image',
            kind: 'image',
            mime: 'image/png',
            byte_size: 100,
            blob_path: `images/${'f'.repeat(64)}.png`,
            sha256: 'f'.repeat(64),
            width: 10,
            height: 20,
            created_at: base + 2000,
            pinned: true,
        },
    ],
});
assertEqual(oversizedPins.size, 2,
    'oversized pinned items are preserved on load');
assertEqual(oversizedPinLoad.dropped, 0,
    'preserved oversized pins are not counted as dropped');
assertEqual(oversizedPinLoad.pinnedOverLimit, 2,
    'oversized pinned items are reported separately');
assert(oversizedPins.getItems().every(item => item.pinned),
    'oversized loaded items stay pinned');

const pruneImages = new History({
    limit: 1,
    maxBytes: 1024,
    maxImageBytes: 4096,
    retentionDays: 0,
});
pruneImages.captureText('text', '', base + 1000);
pruneImages.captureImage({...imageA}, '', base + 2000);
pruneImages.captureImage({...imageA, sha256: 'd'.repeat(64),
    blob_path: `images/${'d'.repeat(64)}.png`}, '', base + 3000);
assertEqual(pruneImages.size, 1, 'image history limit is enforced');
assertEqual(pruneImages.drainRemovedBlobs().length, 1,
    'pruning an image queues its blob for cleanup');

assertEqual(loadedImages.toJSON().version, 2, 'history serializes as version 2');

print('history tests passed');
