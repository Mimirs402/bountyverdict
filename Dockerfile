FROM node:22.23.1-alpine3.24@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2

LABEL org.opencontainers.image.source="https://github.com/Mimirs402/bountyverdict" \
      org.opencontainers.image.description="Credential-free stdio bridge to the hosted BountyVerdict MCP server"

WORKDIR /opt/bountyverdict-bridge

COPY glama/package.json glama/package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

USER node

ENTRYPOINT ["./node_modules/.bin/mcp-remote", "https://bountyverdict-agent-production.mimirslab.workers.dev/mcp?source=glama-release", "--transport", "http-only", "--silent"]
