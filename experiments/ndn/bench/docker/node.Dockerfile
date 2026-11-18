# Node side of the E4 bench (producer, HTTP gateways, agents). Node 24 LTS pinned by digest, plus
# iproute2 (tc netem) and procps. The repository is bind-mounted at /repo; nothing is copied in.
FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
RUN apt-get update \
  && apt-get install -y --no-install-recommends iproute2 procps \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
CMD ["sleep", "infinity"]
