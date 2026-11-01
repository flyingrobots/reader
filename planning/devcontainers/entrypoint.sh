#!/bin/sh
set -eu
for item in /usr/local/share/reader-etc/* /usr/local/share/reader-etc/.[!.]*; do
  [ -e "$item" ] || [ -L "$item" ] || continue
  case "${item##*/}" in hosts|hostname|resolv.conf) continue ;; esac
  cp -a "$item" /etc/
done
exec "$@"
