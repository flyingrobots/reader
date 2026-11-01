FROM node:24.18.0@sha256:5711a0d445a1af54af9589066c646df387d1831a608226f4cd694fc59e745059
# Keep a finite copy of the base image's public system configuration so /etc can
# be restored into a small tmpfs while the image root remains read-only.
RUN cp -a /etc /usr/local/share/reader-etc
COPY entrypoint.sh /usr/local/bin/reader-development-entrypoint
ENTRYPOINT ["/bin/sh", "/usr/local/bin/reader-development-entrypoint"]
CMD ["sleep", "infinity"]
