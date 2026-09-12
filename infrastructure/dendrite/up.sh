#!/bin/sh
# Brings up a homeserver that is not Synapse, so the library can be checked against another make of server.
# Development only.
set -e
cd "$(dirname "$0")"

compose="docker compose -f docker-compose.yml"
mkdir -p data

# Every homeserver signs what it sends with a key of its own. Dendrite brings the tool to make one.
if [ ! -f data/matrix_key.pem ]; then
  $compose run --rm --entrypoint /usr/bin/generate-keys dendrite \
    --private-key /etc/dendrite/keys/matrix_key.pem >/dev/null
fi

$compose up -d

attempt=0
while [ $attempt -lt 60 ]; do
  if curl --fail --silent --max-time 2 http://localhost:8108/_matrix/client/versions >/dev/null; then break; fi
  attempt=$((attempt + 1))
  sleep 2
done
if [ $attempt -ge 60 ]; then
  echo "dendrite did not come up" >&2
  $compose logs --tail 30 dendrite >&2
  exit 1
fi

# The same three accounts the checks expect on Synapse. Dendrite brings its own tool for this. Already being
# there is not a failure.
for person in alice bob carol; do
  $compose exec -T dendrite /usr/bin/create-account \
    -config /etc/dendrite/dendrite.yaml -username "$person" -password "$person-password" >/dev/null 2>&1 || true
done

echo "dendrite ready on http://localhost:8108"
