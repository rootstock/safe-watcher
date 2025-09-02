FROM node:24@sha256:701c8a634cb3ddbc1dc9584725937619716882525356f0989f11816ba3747a22 AS build

# Enable corepack to use yarn@4.6.0
RUN corepack enable

USER node

WORKDIR /home/node/app

COPY --chown=node:node package.json yarn.lock .yarnrc.yml ./
    
RUN yarn install --immutable

COPY --chown=node:node . .

RUN yarn build

FROM node:24@sha256:701c8a634cb3ddbc1dc9584725937619716882525356f0989f11816ba3747a22

# Update packages and install dependencies
RUN apt-get update && \
  apt-get install -y curl jq git xxd && \
  apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy foundry tools
COPY --from=ghcr.io/foundry-rs/foundry:stable /usr/local/bin/chisel /usr/local/bin/chisel
COPY --from=ghcr.io/foundry-rs/foundry:stable /usr/local/bin/cast /usr/local/bin/cast

USER node

WORKDIR /home/node/app

ENV NODE_ENV=production

ARG PACKAGE_VERSION
LABEL org.opencontainers.image.version="${PACKAGE_VERSION}"

COPY --chown=node:node --from=build /home/node/app/dist /home/node/app

COPY --chown=node:node src/safe-hashes/safe_hashes.sh /home/node/app/safe-hashes.sh

CMD ["/home/node/app/index.mjs"]
