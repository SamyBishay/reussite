#!/bin/sh
# Runs the WebKit e2e tests inside Playwright's official container, for hosts (like Fedora)
# whose system libraries WebKit can't use. Usage: npm run e2e:webkit
# Two workers: more crash WebKit inside the container.
set -e
V=$(node -p "require('@playwright/test/package.json').version")
exec podman run --rm --ipc=host --security-opt label=disable -v "$PWD":/work -w /work \
  mcr.microsoft.com/playwright:v$V-noble npx playwright test --project=webkit --project=iphone --workers=2 "$@"
