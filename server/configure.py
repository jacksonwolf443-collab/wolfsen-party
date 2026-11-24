"""Create a private pair of relay and desktop connection files."""

import argparse
import json
import os
from pathlib import Path
import re
import secrets
from urllib.parse import urlsplit


def origin(value):
    try:
        url = urlsplit(value)
        port = url.port
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Expected an HTTPS root URL") from exc
    if (url.scheme != "https" or not url.hostname
            or not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", url.hostname)
            or url.username is not None or url.password is not None
            or url.path not in ("", "/") or "?" in value or "#" in value
            or port == 0):
        raise argparse.ArgumentTypeError("Expected an HTTPS root URL, such as https://party.example.com")
    result = "https://" + url.hostname
    if port and port != 443:
        result += f":{port}"
    return result


def write_private(path, value):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("url", type=origin)
    parser.add_argument("--output", required=True, type=Path, help="A new directory for the private files")
    args = parser.parse_args()
    try:
        args.output.mkdir(mode=0o700)
        token = secrets.token_urlsafe(32)
        write_private(args.output / "relay.json", {"origin": args.url, "token": token})
        write_private(args.output / "connection.partyserver", {
            "format": "wolfsen-party-server-v1", "url": args.url, "token": token,
        })
    except OSError as exc:
        parser.exit(1, f"Unable to create configuration: {exc}\n")
    print("Created relay.json and connection.partyserver in", args.output)


if __name__ == "__main__":
    main()
