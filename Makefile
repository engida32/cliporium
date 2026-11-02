SHELL_UUID := cliporium@engida32.github.io
PACK := dist/$(SHELL_UUID).shell-extension.zip

.PHONY: pack install uninstall test clean-install check

pack:
	mkdir -p dist
	gnome-extensions pack --force \
		--extra-source=src \
		--extra-source=LICENSE \
		--schema=schemas/org.gnome.shell.extensions.cliporium.gschema.xml \
		--out-dir=dist extension

install: pack
	gnome-extensions install --force $(PACK)
	gnome-extensions enable $(SHELL_UUID)

uninstall:
	-gnome-extensions disable $(SHELL_UUID)
	gnome-extensions uninstall $(SHELL_UUID)

test:
	python3 scripts/validate-metadata.py
	gjs -m tests/history.test.js
	gjs -m tests/storage.test.js
	gjs -m tests/display.test.js
	gjs -m tests/clipboard.test.js
	gjs -m tests/copy-payload.test.js
	gjs -m tests/image-store.test.js
	gjs -m tests/image-utils.test.js
	gjs -m tests/stylesheet.test.js
	for file in extension/extension.js extension/prefs.js extension/src/*.js; do \
		node --input-type=module --check < "$$file"; \
	done

clean-install: pack
	bash tests/headless-clean-install-probe.sh

check: pack test
	cargo fmt --all --check
	cargo clippy --workspace --all-targets -- -D warnings
	dbus-run-session -- cargo test --workspace
	@if gnome-shell --version | grep -q 'GNOME Shell 50'; then \
		bash tests/headless-toolbar-probe.sh; \
		bash tests/headless-pinned-probe.sh; \
		bash tests/headless-image-probe.sh; \
		CLIPORIUM_TEXT_SCALE=2.0 bash tests/headless-toolbar-probe.sh; \
		bash tests/headless-clean-install-probe.sh; \
	else \
		echo "Skipping headless probes: GNOME Shell 50 is required"; \
	fi
