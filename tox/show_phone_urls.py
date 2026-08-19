#!/usr/bin/env python
"""Compatibility helper that prints the single supported local startup URL."""

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))

import desktop_config


def print_local_url():
    url = f"http://127.0.0.1:{desktop_config.PORT}/"
    print("TOX local startup URL")
    print("=" * 24)
    print(f"Open: {url}")
    print(f"API health: {url}api/health/")
    print()
    print("Network and phone links are disabled by design.")


if __name__ == "__main__":
    print_local_url()
