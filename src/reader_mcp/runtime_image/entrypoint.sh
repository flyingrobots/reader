#!/bin/sh
set -eu
# Only the CLI's environment file is writable. Keep the ELF loader's /etc immutable.
[ ! -L /work/system ] || exit 1
/bin/mkdir -p /work/system
[ ! -L /work/system/environment ] || exit 1
: > /work/system/environment
exec "$@"
