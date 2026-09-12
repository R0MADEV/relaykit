#!/bin/sh
# Brings up the two pieces a conference needs. Development only.
set -e
cd "$(dirname "$0")"

docker compose up -d

attempt=0
while [ $attempt -lt 60 ]; do
  if curl --fail --silent --max-time 2 "http://localhost:7880" >/dev/null; then break; fi
  attempt=$((attempt + 1))
  sleep 1
done

# Answering is not the same as being ready to admit anybody: the service that hands out the leave has to be
# up too, and a conference that cannot get a token never starts.
attempt=0
while [ $attempt -lt 60 ]; do
  answered=$(curl --silent --output /dev/null --write-out "%{http_code}" --max-time 2 \
    -X POST -H "Content-Type: application/json" -d '{}' "http://localhost:8091/sfu/get" || true)
  if [ "$answered" != "000" ] && [ -n "$answered" ]; then break; fi
  attempt=$((attempt + 1))
  sleep 1
done

echo "livekit environment ready"
