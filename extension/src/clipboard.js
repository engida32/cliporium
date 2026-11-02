import GLib from 'gi://GLib';

import {IMAGE_MIMES} from './image-utils.js';

const TEXT_MIMES = [
    'text/plain;charset=utf-8',
    'UTF8_STRING',
    'text/plain',
    'STRING',
];
const READ_TIMEOUT_MS = 500;

export class ClipboardReader {
    constructor(clipboard, clipboardType = 1) {
        if (!clipboard)
            throw new Error('clipboard is required');
        this._clipboard = clipboard;
        this._clipboardType = clipboardType;
    }

    async readText(maxBytes) {
        let tooLarge = false;
        for (const mime of TEXT_MIMES) {
            const result = await this._readMime(mime, maxBytes);
            if (result.tooLarge) {
                tooLarge = true;
                continue;
            }
            if (result.bytes) {
                try {
                    const text = new TextDecoder('utf-8', {fatal: true})
                        .decode(result.bytes.get_data());
                    return {text, tooLarge: false};
                } catch {
                    continue;
                }
            }
        }
        return {text: null, tooLarge};
    }

    async readImage(maxBytes) {
        let tooLarge = false;
        for (const mime of IMAGE_MIMES) {
            const result = await this._readMime(mime, maxBytes);
            if (result.tooLarge) {
                tooLarge = true;
                continue;
            }
            if (result.bytes) {
                return {
                    bytes: result.bytes,
                    mime,
                    tooLarge: false,
                };
            }
        }
        return {bytes: null, mime: null, tooLarge};
    }

    _readMime(mime, maxBytes) {
        return new Promise(resolve => {
            let settled = false;
            let timeoutId = 0;

            const finish = result => {
                if (settled)
                    return;
                settled = true;
                if (timeoutId) {
                    GLib.source_remove(timeoutId);
                    timeoutId = 0;
                }
                resolve(result);
            };

            timeoutId = GLib.timeout_add(
                GLib.PRIORITY_DEFAULT,
                READ_TIMEOUT_MS,
                () => {
                    timeoutId = 0;
                    finish({bytes: null, tooLarge: false});
                    return GLib.SOURCE_REMOVE;
                }
            );

            try {
                this._clipboard.get_content(
                    this._clipboardType,
                    mime,
                    (_clipboard, bytes) => {
                        if (settled || !bytes) {
                            finish({bytes: null, tooLarge: false});
                            return;
                        }

                        try {
                            const size = bytes.get_size();
                            if (typeof size === 'bigint') {
                                if (size > BigInt(maxBytes)) {
                                    finish({bytes: null, tooLarge: true});
                                    return;
                                }
                            } else if (!Number.isFinite(size) || size > maxBytes) {
                                finish({bytes: null, tooLarge: true});
                                return;
                            }
                            if (size <= 0) {
                                finish({bytes: null, tooLarge: false});
                                return;
                            }

                            const data = bytes.get_data();
                            if (!data || data.length === 0) {
                                finish({bytes: null, tooLarge: false});
                                return;
                            }
                            finish({
                                bytes: GLib.Bytes.new(data.slice()),
                                tooLarge: false,
                            });
                        } catch {
                            finish({bytes: null, tooLarge: false});
                        }
                    }
                );
            } catch {
                finish({bytes: null, tooLarge: false});
            }
        });
    }
}
