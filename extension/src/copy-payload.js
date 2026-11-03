import GLib from 'gi://GLib';

export const TEXT_MIME = 'text/plain;charset=utf-8';

export async function payloadForItem(item, imageStore) {
    if (!item)
        return null;
    if (item.kind === 'image') {
        if (!imageStore || typeof imageStore.loadAsync !== 'function')
            return null;
        const bytes = await imageStore.loadAsync(item.blob_path);
        if (!bytes)
            return null;
        return {
            mime: typeof item.mime === 'string' && item.mime.length > 0
                ? item.mime
                : 'image/png',
            bytes,
        };
    }
    return {
        mime: TEXT_MIME,
        bytes: GLib.Bytes.new(new TextEncoder().encode(item.text ?? '')),
    };
}
