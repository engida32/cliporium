import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {imageExtension} from './image-utils.js';

const IMAGE_DIRECTORY = 'images';

function byteSize(bytes) {
    const size = bytes.get_size();
    return typeof size === 'bigint' ? Number(size) : size;
}

export class ImageStore {
    constructor({dataHome = GLib.get_user_data_dir()} = {}) {
        this._root = GLib.build_filenamev([dataHome, 'cliporium']);
        this._directory = GLib.build_filenamev([this._root, IMAGE_DIRECTORY]);
    }

    get directory() {
        return this._directory;
    }

    pathFor(blobPath) {
        if (typeof blobPath !== 'string' || !blobPath.startsWith(`${IMAGE_DIRECTORY}/`) ||
            blobPath.includes('..')) {
            throw new Error('invalid image path');
        }
        return GLib.build_filenamev([this._root, blobPath]);
    }

    exists(blobPath) {
        try {
            return GLib.file_test(this.pathFor(blobPath), GLib.FileTest.IS_REGULAR);
        } catch {
            return false;
        }
    }

    _prepare(bytes, mime) {
        const normalizedMime = typeof mime === 'string' ? mime.toLowerCase() : '';
        const extension = imageExtension(normalizedMime);
        if (!extension)
            throw new Error(`unsupported image mime: ${mime}`);

        const glibBytes = bytes instanceof GLib.Bytes ? bytes : GLib.Bytes.new(bytes);
        const size = byteSize(glibBytes);
        if (size <= 0)
            throw new Error('image is empty');

        const sha256 = GLib.compute_checksum_for_bytes(
            GLib.ChecksumType.SHA256,
            glibBytes
        ).toLowerCase();
        const blobPath = `${IMAGE_DIRECTORY}/${sha256}.${extension}`;
        return {
            glibBytes,
            normalizedMime,
            size,
            sha256,
            blobPath,
            path: this.pathFor(blobPath),
        };
    }

    _ensureDirectory() {
        GLib.mkdir_with_parents(this._directory, 0o700);
        GLib.chmod(this._directory, 0o700);
    }

    _result(prepared, created) {
        return {
            sha256: prepared.sha256,
            mime: prepared.normalizedMime,
            byte_size: prepared.size,
            blob_path: prepared.blobPath,
            created,
        };
    }

    save(bytes, mime) {
        const prepared = this._prepare(bytes, mime);
        let created = false;

        if (!this.exists(prepared.blobPath)) {
            try {
                this._ensureDirectory();
                const [ok] = Gio.File.new_for_path(prepared.path).replace_contents(
                    prepared.glibBytes.get_data(),
                    null,
                    false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION,
                    null
                );
                if (!ok)
                    throw new Error('image could not be written');
                GLib.chmod(prepared.path, 0o600);
                created = true;
            } catch (error) {
                throw new Error(`image could not be stored: ${error.message}`);
            }
        } else {
            GLib.chmod(prepared.path, 0o600);
        }

        return this._result(prepared, created);
    }

    saveAsync(bytes, mime) {
        const prepared = this._prepare(bytes, mime);
        if (this.exists(prepared.blobPath)) {
            GLib.chmod(prepared.path, 0o600);
            return Promise.resolve(this._result(prepared, false));
        }

        try {
            this._ensureDirectory();
        } catch (error) {
            return Promise.reject(
                new Error(`image could not be stored: ${error.message}`)
            );
        }

        return new Promise((resolve, reject) => {
            Gio.File.new_for_path(prepared.path).replace_contents_bytes_async(
                prepared.glibBytes,
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null,
                (file, result) => {
                    try {
                        const [ok] = file.replace_contents_finish(result);
                        if (!ok)
                            throw new Error('image could not be written');
                        GLib.chmod(prepared.path, 0o600);
                        resolve(this._result(prepared, true));
                    } catch (error) {
                        reject(
                            new Error(`image could not be stored: ${error.message}`)
                        );
                    }
                }
            );
        });
    }

    load(blobPath) {
        if (!this.exists(blobPath))
            return null;
        const [ok, contents] = Gio.File.new_for_path(
            this.pathFor(blobPath)
        ).load_contents(null);
        if (!ok)
            return null;
        return GLib.Bytes.new(contents);
    }

    delete(blobPath) {
        if (!this.exists(blobPath))
            return false;
        try {
            return Gio.File.new_for_path(this.pathFor(blobPath)).delete(null);
        } catch {
            return false;
        }
    }

    list() {
        if (!GLib.file_test(this._directory, GLib.FileTest.IS_DIR))
            return [];
        const paths = [];
        try {
            const enumerator = Gio.File.new_for_path(
                this._directory
            ).enumerate_children(
                'standard::name,standard::type',
                Gio.FileQueryInfoFlags.NONE,
                null
            );
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                if (info.get_file_type() === Gio.FileType.REGULAR) {
                    paths.push(
                        `${IMAGE_DIRECTORY}/${info.get_name()}`
                    );
                }
            }
            enumerator.close(null);
        } catch {
            return [];
        }
        return paths;
    }

    deleteMany(blobPaths) {
        if (!Array.isArray(blobPaths))
            return;
        for (const blobPath of blobPaths)
            this.delete(blobPath);
    }
}
