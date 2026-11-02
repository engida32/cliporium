import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const HISTORY_FILE = 'history.json';

export class HistoryStorage {
    constructor({history, onLoaded = () => {}, onWarning = () => {},
        onError = () => {}, onSaved = () => {}, imageStore = null,
        dataHome = GLib.get_user_data_dir(),
        retryDelayMs = 5000}) {
        this._history = history;
        this._imageStore = imageStore;
        this._onLoaded = onLoaded;
        this._onWarning = onWarning;
        this._onError = onError;
        this._onSaved = onSaved;
        this._path = GLib.build_filenamev([
            dataHome,
            'cliporium',
            HISTORY_FILE,
        ]);
        this._file = Gio.File.new_for_path(this._path);
        this._cancellable = new Gio.Cancellable();
        this._loaded = false;
        this._writing = false;
        this._dirty = false;
        this._failed = false;
        this._retryTimeout = 0;
        this._retryDelayMs = retryDelayMs;
        this._destroyed = false;

        const directory = this._file.get_parent();
        try {
            GLib.mkdir_with_parents(directory.get_path(), 0o700);
            GLib.chmod(directory.get_path(), 0o700);
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
                const {dropped, pinnedDropped, pinnedOverLimit} =
                    this._history.load(raw);
                const {missing, orphaned} = this._reconcileImages();
                this._finishLoad();
                const notices = [];
                if (dropped > 0)
                    notices.push(`${dropped} invalid or duplicate item(s) were skipped`);
                if (pinnedDropped > 0)
                    notices.push(`${pinnedDropped} pinned item(s) over the ${this._history.maxPinned} limit were skipped`);
                if (pinnedOverLimit > 0)
                    notices.push(`${pinnedOverLimit} pinned item(s) exceed the current size limit and were kept`);
                if (missing > 0)
                    notices.push(`${missing} missing image(s) were skipped`);
                if (orphaned > 0)
                    notices.push(`${orphaned} unreferenced image(s) were removed`);
                if (notices.length > 0) {
                    this._onWarning(`${notices.join('. ')}.`);
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
        this._cancelRetry();
        this._writeNext();
    }

    destroy() {
        this._destroyed = true;
        this._cancelRetry();
        this._cancellable.cancel();
    }

    _cancelRetry() {
        if (!this._retryTimeout)
            return;
        GLib.source_remove(this._retryTimeout);
        this._retryTimeout = 0;
    }

    _scheduleRetry() {
        if (this._retryTimeout || this._destroyed)
            return;
        this._retryTimeout = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            this._retryDelayMs,
            () => {
                this._retryTimeout = 0;
                if (!this._destroyed && this._dirty && !this._writing)
                    this._writeNext();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _reconcileImages() {
        if (!this._imageStore)
            return {missing: 0, orphaned: 0};

        let missing = 0;
        const referenced = new Set();
        for (const item of this._history.getItems()) {
            if (item.kind !== 'image')
                continue;
            if (!this._imageStore.exists(item.blob_path)) {
                this._history.delete(item.id);
                missing += 1;
            } else {
                referenced.add(item.blob_path);
            }
        }

        let orphaned = 0;
        for (const blobPath of this._imageStore.list()) {
            if (referenced.has(blobPath))
                continue;
            if (this._imageStore.delete(blobPath))
                orphaned += 1;
        }
        return {missing, orphaned};
    }

    _finishLoad() {
        if (GLib.file_test(this._path, GLib.FileTest.EXISTS))
            GLib.chmod(this._path, 0o600);
        this._loaded = true;
        this._onLoaded();
    }

    _recover(contents, reason) {
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
                let backupOk = false;
                try {
                    [backupOk] = file.replace_contents_finish(result);
                } catch (error) {
                    if (!this._destroyed)
                        this._onError(error);
                }
                if (this._destroyed)
                    return;
                if (!backupOk) {
                    this._finishLoad();
                    return;
                }
                GLib.chmod(backupPath, 0o600);
                this._history.clearAll();
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
        this._failed = false;
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
                    GLib.chmod(this._path, 0o600);
                    if (this._imageStore)
                        this._imageStore.deleteMany(this._history.drainRemovedBlobs());
                    if (!this._destroyed)
                        this._onSaved();
                } catch (error) {
                    this._dirty = true;
                    this._failed = true;
                    if (!this._destroyed)
                        this._onError(error);
                }
                if (this._destroyed || !this._dirty)
                    return;
                if (this._failed)
                    this._scheduleRetry();
                else
                    this._writeNext();
            }
        );
    }
}
