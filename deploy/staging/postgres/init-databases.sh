#!/bin/bash
# Runs once, on the first start of an empty Postgres volume (docker-entrypoint-initdb.d).
# One login role and one database per application, each owned by its own role, so no API can
# read another's tables. Passwords come from the environment (deploy/staging/.env.staging).
# The entrypoint sources this file when it is not executable, so no `set -u` (it would leak into
# the entrypoint's own shell).
set -eo pipefail

for app in core showcase slidesvault; do
  var="$(printf '%s' "$app" | tr '[:lower:]' '[:upper:]')_DB_PASSWORD"
  password="${!var:-}"
  if [ -z "$password" ]; then
    echo "init-databases: $var is not set" >&2
    exit 1
  fi
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
    -v app="$app" -v password="$password" <<'SQL'
CREATE ROLE :"app" LOGIN PASSWORD :'password';
CREATE DATABASE :"app" OWNER :"app";
REVOKE ALL ON DATABASE :"app" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"app" TO :"app";
SQL
  echo "init-databases: database and role \"$app\" created"
done
