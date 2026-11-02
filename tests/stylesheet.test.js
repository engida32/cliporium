import GLib from 'gi://GLib';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

const [ok, contents] = GLib.file_get_contents('extension/stylesheet.css');
assert(ok, 'stylesheet can be read');

const css = new TextDecoder().decode(contents);
const sizes = [...css.matchAll(/font-size:\s*([0-9.]+)px/g)]
    .map(match => Number(match[1]));
assert(sizes.length > 0, 'stylesheet contains font-size declarations');

const tooSmall = sizes.filter(size => size < 11);
assert(
    tooSmall.length === 0,
    `stylesheet font sizes below 11px: ${tooSmall.join(', ')}`
);

print('stylesheet tests passed');
