FROM node:24@sha256:d1db2ecd11f417ab2ff4fef891b4d27194c367d101f9b9cd546a26e424e93d31 AS build

# Enable corepack to use yarn@4.6.0
RUN corepack enable

USER node

WORKDIR /home/node/app

COPY --chown=node:node package.json yarn.lock .yarnrc.yml ./
    
RUN yarn install --immutable

COPY --chown=node:node . .

RUN yarn build

FROM alpine:3.22@sha256:8a1f59ffb675680d47db6337b49d22281a139e9d709335b492be023728e11715 AS foundry-build

# Update packages and install dependencies
RUN apk --no-cache add curl git bash

ARG BIN_URL="https://raw.githubusercontent.com/foundry-rs/foundry/master/foundryup/foundryup"
ARG BIN_DIR=/root/.foundry/bin
ARG BIN_PATH=$BIN_DIR/foundryup

# Configure directory for install (replacing foundry install script)
RUN mkdir -p $BIN_DIR && \
    curl -sSf -L $BIN_URL -o $BIN_PATH && \
    chmod +x $BIN_PATH

# Installing foundry
RUN $BIN_PATH --platform alpine

FROM node:24-alpine@sha256:7aaba6b13a55a1d78411a1162c1994428ed039c6bbef7b1d9859c25ada1d7cc5

# Update packages and install dependencies
RUN apk --no-cache add curl jq xxd bash ncurses

# Copy foundry tools
COPY --from=foundry-build /root/.foundry/bin/chisel /usr/local/bin/chisel
COPY --from=foundry-build /root/.foundry/bin/cast /usr/local/bin/cast

USER node

WORKDIR /home/node/app

ENV NODE_ENV=production

ARG PACKAGE_VERSION
LABEL org.opencontainers.image.version="${PACKAGE_VERSION}"

COPY --chown=node:node --from=build /home/node/app/dist /home/node/app

COPY --chown=node:node src/safe-hashes/safe_hashes.sh /home/node/app/safe-hashes.sh

CMD ["/home/node/app/index.mjs"]
