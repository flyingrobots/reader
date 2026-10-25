#!/usr/bin/env python3
"""Launch Reader web against the existing private-vault binding."""
import argparse
from reader_paths import paths


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--participant', default='You')
    args = parser.parse_args()
    _, vault = paths()
    from reader_mcp.web import serve_web
    serve_web(vault, args.port, args.participant)


if __name__ == '__main__':
    main()
