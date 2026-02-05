FROM solclash-base

WORKDIR /opt/solclash

COPY apps/tournament/docker/agent/edit-runner.mjs /opt/solclash/edit-runner.mjs

RUN printf '{"name":"solclash-agent","private":true,"type":"module"}' > package.json \
  && npm install @anthropic-ai/claude-agent-sdk \
  && npm install -g @google/gemini-cli @openai/codex
