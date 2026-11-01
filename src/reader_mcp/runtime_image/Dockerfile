FROM node:24.18.0@sha256:5711a0d445a1af54af9589066c646df387d1831a608226f4cd694fc59e745059 AS node
FROM python:3.12-bookworm@sha256:14a4933e6cef421424f7a66d89a3f4eafcbd0d90e0a822251f298e05132dc735
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && cp -a /etc /usr/local/share/reader-etc
COPY entrypoint.sh /usr/local/bin/reader-development-entrypoint
ENTRYPOINT ["/bin/sh", "/usr/local/bin/reader-development-entrypoint"]
CMD ["sleep", "infinity"]
