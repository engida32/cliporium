import {
    formatRelativeTime,
    iconForItem,
    iconForText,
    metaForItem,
    prettyAppName,
    titleForItem,
} from '../extension/src/display.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected)
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

const now = new Date('2026-11-01T12:00:00Z').getTime();
assertEqual(formatRelativeTime(now - 1000, now), 'Just now', 'recent time');
assertEqual(formatRelativeTime(now - 5 * 60 * 1000, now), '5 mins ago',
    'minutes time');
assertEqual(formatRelativeTime(now - 3 * 60 * 60 * 1000, now), '3 hrs ago',
    'hours time');
assertEqual(formatRelativeTime(now - 2 * 24 * 60 * 60 * 1000, now), '2 days ago',
    'days time');
assert(formatRelativeTime(now - 30 * 24 * 60 * 60 * 1000, now).length > 0,
    'older times render a date');
assertEqual(formatRelativeTime('nope', now), 'Unknown time', 'invalid time');

assertEqual(iconForText('https://example.com'), 'web-browser-symbolic',
    'URL icon');
assertEqual(iconForText('www.example.com'), 'web-browser-symbolic',
    'www URL icon');
assertEqual(iconForText('git status'), 'utilities-terminal-symbolic',
    'command icon');
assertEqual(iconForText('sudo apt update'), 'utilities-terminal-symbolic',
    'sudo command icon');
assertEqual(iconForText('person@example.com'), 'mail-unread-symbolic',
    'email icon');
assertEqual(iconForText('https://user@example.com'), 'web-browser-symbolic',
    'URL with user info is not an email');
assertEqual(iconForText('if you want to keep this as prose'),
    'text-x-generic-symbolic', 'prose starting with if is not code');
assertEqual(iconForText('const value = 1;'), 'applications-development-symbolic',
    'code icon');
assertEqual(iconForText('plain notes'), 'text-x-generic-symbolic', 'text icon');

assertEqual(titleForItem({preview: '  hello\nworld  '}), 'hello',
    'title uses the first non-empty line');
assertEqual(titleForItem({preview: '', text: '\n  spaced  text  '}), 'spaced text',
    'title falls back to text');
assertEqual(titleForItem({text: '   '}), 'Empty clip', 'empty title fallback');
assertEqual(titleForItem({text: 'first\r\nsecond'}), 'first',
    'title handles CRLF input');

assertEqual(prettyAppName('org.gnome.Nautilus.desktop'), 'Nautilus',
    'desktop app name is shortened');
assertEqual(prettyAppName('firefox'), 'firefox', 'plain app name is kept');
assertEqual(prettyAppName(''), '', 'empty app name is empty');

const meta = metaForItem({
    created_at: now - 3 * 60 * 1000,
    source_app: 'org.gnome.Nautilus.desktop',
    pinned: true,
}, now);
assert(meta.includes('3 mins ago'), 'meta includes relative time');
assert(meta.includes('Nautilus'), 'meta includes app name');
assert(meta.includes('Pinned'), 'meta includes pin state');


assertEqual(iconForItem({kind: 'image', mime: 'image/png'}),
    'image-x-generic-symbolic', 'image icon');
assertEqual(iconForItem({kind: 'text', text: 'https://example.com'}),
    'web-browser-symbolic', 'text icon through item helper');

assertEqual(titleForItem({kind: 'image', preview: 'Image'}), 'Image',
    'image title');
assertEqual(titleForItem({kind: 'image'}), 'Image', 'image title fallback');

const imageMeta = metaForItem({
    kind: 'image',
    mime: 'image/png',
    width: 640,
    height: 480,
    byte_size: 2048,
    created_at: now - 3 * 60 * 1000,
    source_app: 'org.gnome.Screenshot.desktop',
    pinned: false,
}, now);
assert(imageMeta.includes('PNG'), 'image meta includes mime label');
assert(imageMeta.includes('640 × 480'), 'image meta includes dimensions');
assert(imageMeta.includes('2.0 KB'), 'image meta includes size');
assert(imageMeta.includes('3 mins ago'), 'image meta includes relative time');

print('display tests passed');
