import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const HISTORY_FILE = 'history.json';

export class HistoryStorage {
    constructor({history, onLoaded = () => {}, onWarning = () => {},
        onError = () => {}, onSaved = () => {}}) {
        this._history = history;
        this._onLoaded = onLoaded;
        this._onWarning = onWarning;
        this._onError = onError;
        this._onSaved = onSaved;
        this._path = GLib.build_filenamev([
            GLib.get_user_data_dir(),
            'cliporium',
            HISTORY_FILE,
        ]);
        this._file = Gio.File.new_for_path(this._path);
        this._cancellable = new Gio.Cancellable();
        this._loaded = false;
        this._writing = false;
        this._dirty = false;
        this._destroyed = false;

        const directory = this._file.get_parent();
        try {
            GLib.mkdir_with_parents(directory.get_path(), 0o700);
        } catch (error) {
            this._onError(error);
        }
    }

    get isLoaded() {
        return this._loaded;
    }

    get path() {
        return this._path;
    }

    load() {
        this._file.load_contents_async(this._cancellable, (file, result) => {
            if (this._destroyed)
                return;

            let contents;
            try {
                const [ok, data] = file.load_contents_finish(result);
                if (!ok)
                    throw new Error('history file could not be read');
                contents = data;
            } catch (error) {
                if (error.code === Gio.IOErrorEnum.NOT_FOUND) {
                    this._finishLoad();
                    return;
                }
                this._onError(error);
                this._finishLoad();
                return;
            }

            let raw;
            try {
                raw = JSON.parse(new TextDecoder().decode(contents));
            } catch {
                this._recover(contents, 'unreadable');
                return;
            }

            try {
                const {dropped} = this._history.load(raw);
                this._finishLoad();
                if (dropped > 0) {
                    this._onWarning(
                        `${dropped} invalid or duplicate item(s) were skipped.`
                    );
                    this.scheduleSave();
                }
            } catch {
                this._recover(contents, 'incompatible');
            }
        });
    }

    scheduleSave() {
        if (this._destroyed)
            return;

        this._dirty = true;
        if (!this._loaded || this._writing)
            return;
        this._writeNext();
    }

    destroy() {
        this._destroyed = true;
        this._cancellable.cancel();
    }

    _finishLoad() {
        this._loaded = true;
        this._onLoaded();
    }

    _recover(contents, reason) {
        this._history.clearAll();
        const backupPath = `${this._path}.corrupt-${Date.now()}`;
        const backup = Gio.File.new_for_path(backupPath);
        const bytes = GLib.Bytes.new(contents);

        backup.replace_contents_bytes_async(
            bytes,
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            this._cancellable,
            (file, result) => {
                try {
                    file.replace_contents_finish(result);
                } catch (error) {
                    if (!this._destroyed)
                        this._onError(error);
                }
                if (this._destroyed)
                    return;
                this._onWarning(
                    `History was ${reason}; a copy was saved to ${backupPath} and a new history was started.`
                );
                this._finishLoad();
                this.scheduleSave();
            }
        );
    }

    _writeNext() {
        if (this._destroyed || !this._dirty) {
            this._writing = false;
            return;
        }

        this._dirty = false;
        this._writing = true;
        const json = JSON.stringify(this._history.toJSON(), null, 2);
        const bytes = new TextEncoder().encode(json);

        this._file.replace_contents_bytes_async(
            GLib.Bytes.new(bytes),
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            this._cancellable,
            (file, result) => {
                this._writing = false;
                try {
                    const [ok] = file.replace_contents_finish(result);
                    if (!ok)
                        throw new Error('history file could not be written');
                    if (!this._destroyed)
                        this._onSaved();
                } catch (error) {
                    if (!this._destroyed)
                        this._onError(error);
                }
                if (!this._destroyed && this._dirty)
                    this._writeNext();
            }
        );
    }
}
