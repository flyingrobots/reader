#!/bin/sh
set -eu
for item in /usr/local/share/reader-etc/* /usr/local/share/reader-etc/.[!.]*; do
  [ -e "$item" ] || [ -L "$item" ] || continue
  case "${item##*/}" in hosts|hostname|resolv.conf) continue ;; esac
  # The managed runtime drops capabilities. Restore public config without requiring chown.
  cp -R -P --preserve=mode,timestamps "$item" /etc/
done
exec "$@"
