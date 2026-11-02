import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';

export const IMAGE_MIMES = [
    'image/png',
    'image/jpeg',
];

const MIME_EXTENSIONS = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
};

const MIME_LABELS = {
    'image/png': 'PNG',
    'image/jpeg': 'JPEG',
};

export function imageExtension(mime) {
    return MIME_EXTENSIONS[mime] ?? null;
}

export function imageMimeLabel(mime) {
    return MIME_LABELS[mime] ?? 'Image';
}

export function formatBytes(size) {
    const bytes = Number(size);
    if (!Number.isFinite(bytes) || bytes < 0)
        return '';
    if (bytes < 1024)
        return `${Math.round(bytes)} B`;

    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = units[0];
    for (let index = 1; index < units.length && value >= 1024; index++) {
        value /= 1024;
        unit = units[index];
    }
    const rounded = value >= 10 ? Math.round(value) : value.toFixed(1);
    return `${rounded} ${unit}`;
}

export function decodeImage(bytes) {
    const stream = Gio.MemoryInputStream.new_from_bytes(bytes);
    const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
    return {
        width: pixbuf.get_width(),
        height: pixbuf.get_height(),
    };
}
