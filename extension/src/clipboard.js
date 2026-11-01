import GLib from 'gi://GLib';
import St from 'gi://St';

const TEXT_MIMES = [
    'text/plain;charset=utf-8',
    'UTF8_STRING',
    'text/plain',
    'STRING',
];
const READ_TIMEOUT_MS = 500;

export class ClipboardReader {
    constructor() {
        this._clipboard = St.Clipboard.get_default();
    }

    async readText(maxBytes) {
        let tooLarge = false;
        for (const mime of TEXT_MIMES) {
            const result = await this._readMime(mime, maxBytes);
            if (result.tooLarge) {
                tooLarge = true;
                continue;
            }
            if (result.text)
                return {text: result.text, tooLarge: false};
        }
        return {text: null, tooLarge};
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
                    finish({text: null, tooLarge: false});
                    return GLib.SOURCE_REMOVE;
                }
            );

            try {
                this._clipboard.get_content(
                    St.ClipboardType.CLIPBOARD,
                    mime,
                    (_clipboard, bytes) => {
                        if (settled || !bytes) {
                            finish({text: null, tooLarge: false});
                            return;
                        }

                        try {
                            const size = bytes.get_size();
                            if (typeof size === 'bigint') {
                                if (size > BigInt(maxBytes)) {
                                    finish({text: null, tooLarge: true});
                                    return;
                                }
                            } else if (!Number.isFinite(size) || size > maxBytes) {
                                finish({text: null, tooLarge: true});
                                return;
                            }
                            if (size <= 0) {
                                finish({text: null, tooLarge: false});
                                return;
                            }

                            const data = bytes.get_data();
                            if (!data || data.length === 0) {
                                finish({text: null, tooLarge: false});
                                return;
                            }
                            finish({
                                text: new TextDecoder().decode(data),
                                tooLarge: false,
                            });
                        } catch {
                            finish({text: null, tooLarge: false});
                        }
                    }
                );
            } catch {
                finish({text: null, tooLarge: false});
            }
        });
    }
}
