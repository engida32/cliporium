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

export const MAX_IMAGE_DIMENSION = 8192;
export const MAX_IMAGE_PIXELS = 16 * 1024 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readUint32(data, offset) {
    return ((data[offset] << 24) | (data[offset + 1] << 16) |
        (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

function pngDimensions(data) {
    if (data.length < 24)
        return null;
    for (let index = 0; index < PNG_SIGNATURE.length; index++) {
        if (data[index] !== PNG_SIGNATURE[index])
            return null;
    }
    if (String.fromCharCode(...data.slice(12, 16)) !== 'IHDR')
        return null;
    return {
        width: readUint32(data, 16),
        height: readUint32(data, 20),
    };
}

function jpegDimensions(data) {
    if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8)
        return null;

    let offset = 2;
    while (offset + 4 <= data.length) {
        if (data[offset] !== 0xff) {
            offset += 1;
            continue;
        }

        let marker = data[offset + 1];
        while (marker === 0xff && offset + 2 < data.length) {
            offset += 1;
            marker = data[offset + 1];
        }
        offset += 2;

        if (marker === 0xd8 || marker === 0xd9)
            continue;
        if (marker === 0xda)
            break;
        if (offset + 2 > data.length)
            break;

        const length = (data[offset] << 8) | data[offset + 1];
        if (length < 2 || offset + length > data.length)
            break;

        const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3) ||
            (marker >= 0xc5 && marker <= 0xc7) ||
            (marker >= 0xc9 && marker <= 0xcb) ||
            (marker >= 0xcd && marker <= 0xcf);
        if (isStartOfFrame && length >= 7) {
            return {
                width: (data[offset + 5] << 8) | data[offset + 6],
                height: (data[offset + 3] << 8) | data[offset + 4],
            };
        }

        offset += length;
    }

    return null;
}

export function imageDimensions(bytes) {
    const data = bytes.get_data();
    const dimensions = pngDimensions(data) ?? jpegDimensions(data);
    if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0)
        throw new Error('image dimensions could not be read');
    return dimensions;
}

export function decodeImage(bytes, {
    maxDimension = MAX_IMAGE_DIMENSION,
    maxPixels = MAX_IMAGE_PIXELS,
} = {}) {
    const dimensions = imageDimensions(bytes);
    if (dimensions.width > maxDimension ||
        dimensions.height > maxDimension ||
        dimensions.width * dimensions.height > maxPixels) {
        throw new Error('image dimensions exceed the supported limit');
    }

    const stream = Gio.MemoryInputStream.new_from_bytes(bytes);
    const pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
    return {
        width: pixbuf.get_width(),
        height: pixbuf.get_height(),
    };
}
