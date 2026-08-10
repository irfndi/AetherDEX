#!/bin/sh
# Print the sanitized dev stage name for this machine's user.
# Single source of truth for plan:dev / deploy:dev / destroy:dev / web:deploy:dev
# so the Alchemy stage and the Pages project name never diverge.
set -eu

if [ -z "${USER:-}" ]; then
  echo "USER is not set; cannot derive dev stage name" >&2
  exit 1
fi

printf '%s' "dev_$USER" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9-]/-/g; s/^-+|-+$//g' \
  | cut -c1-44 \
  | sed -E 's/-+$//'
