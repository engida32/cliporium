#!/usr/bin/env python3
"""Validate extension metadata against its GSettings schema."""

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

UUID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*$")
SCHEMA_PATH_PREFIX = "/org/gnome/shell/extensions/"


def validate(root: Path) -> list[str]:
    extension = root / "extension"
    errors: list[str] = []

    try:
        metadata = json.loads((extension / "metadata.json").read_text())
    except (OSError, json.JSONDecodeError) as error:
        return [f"metadata.json is not valid JSON: {error}"]

    for key in ("uuid", "name", "description", "shell-version"):
        if key not in metadata:
            errors.append(f"metadata.json is missing {key}")

    uuid = metadata.get("uuid", "")
    if not isinstance(uuid, str) or not UUID_RE.match(uuid):
        errors.append(f"uuid is not a valid extension id: {uuid!r}")

    name = metadata.get("name", "")
    if not isinstance(name, str) or not name.strip():
        errors.append("name must be a non-empty string")

    description = metadata.get("description", "")
    if not isinstance(description, str) or not description.strip():
        errors.append("description must be a non-empty string")

    shell_versions = metadata.get("shell-version")
    if not isinstance(shell_versions, list) or not shell_versions:
        errors.append("shell-version must be a non-empty list")
    elif not all(isinstance(version, str) and version.strip() for version in shell_versions):
        errors.append("shell-version entries must be non-empty strings")

    if "version" in metadata:
        errors.append("metadata.json must not set version; extensions.gnome.org sets it")

    url = metadata.get("url")
    if url is not None and (not isinstance(url, str) or not url.startswith("https://")):
        errors.append("url must be an https:// URL when present")

    schema_id = metadata.get("settings-schema")
    if not schema_id:
        errors.append("settings-schema is required for this extension")
        return errors

    schema_file = extension / "schemas" / f"{schema_id}.gschema.xml"
    if not schema_file.is_file():
        errors.append(f"schema file does not match settings-schema: {schema_file}")
        return errors

    try:
        tree = ET.parse(schema_file)
    except ET.ParseError as error:
        errors.append(f"schema XML is not valid: {error}")
        return errors

    schema = tree.getroot().find("schema")
    if schema is None:
        errors.append("schema XML has no schema element")
        return errors

    if schema.get("id") != schema_id:
        errors.append(f"schema id {schema.get('id')!r} does not match {schema_id!r}")

    schema_path = schema.get("path", "")
    if not schema_path.startswith(SCHEMA_PATH_PREFIX):
        errors.append(f"schema path must start with {SCHEMA_PATH_PREFIX}: {schema_path!r}")

    for required in ("extension.js", "prefs.js", "stylesheet.css", "LICENSE"):
        if not (extension / required).is_file():
            errors.append(f"missing required extension file: {required}")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    errors = validate(args.root)
    if errors:
        for error in errors:
            print(f"error: {error}", file=sys.stderr)
        return 1
    print("metadata and schema validated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
