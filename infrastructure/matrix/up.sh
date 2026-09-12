#!/bin/sh
# Brings up the development homeserver and the accounts the checks expect. Development only.
#
# The same script runs here and in continuous integration, because an environment that only one of the two
# sets up is an environment where a failure can hide. The generated configuration is not versioned, so
# everything that has to be true of it is applied here rather than edited by hand.
set -e
cd "$(dirname "$0")"

compose="docker compose -f docker-compose.yml"

if [ ! -f data/homeserver.yaml ]; then
  $compose run --rm synapse generate >/dev/null
fi

# Synapse generates a SQLite configuration, and says itself that SQLite is for testing only. Development that
# does not look like production measures things that happen to nobody, so the block is replaced.
$compose run --rm -T --user root --entrypoint sh synapse -c '
python3 - <<PY
import re
config = open("/data/homeserver.yaml").read()
if "psycopg2" not in config:
    config = re.sub(r"^database:.*?(?=^[a-z_]+:)", """database:
  name: psycopg2
  args:
    user: synapse
    password: synapse
    database: synapse
    host: postgres
    cp_min: 5
    cp_max: 10

""", config, flags=re.S | re.M)
    open("/data/homeserver.yaml", "w").write(config)
PY
'

# A certificate for the https listener. Its own signer, made once and left alone: what is being exercised is
# a client reaching a homeserver over TLS, not who vouched for it.
if [ ! -f data/tls.crt ]; then
  openssl req -x509 -newkey rsa:2048 -keyout data/tls.key -out data/tls.crt \
    -days 365 -nodes -subj "/CN=localhost" >/dev/null 2>&1
  chmod 644 data/tls.key data/tls.crt
fi

# Everything the checks need the homeserver to allow: rate limits, registration, the public room list, the
# user directory and somewhere to relay a call through.
#
# Written between two marks and replaced every time rather than appended once. Appending once meant that
# changing dev.yaml did nothing to an environment that already existed: the change was made, nothing happened,
# and the reason was somewhere nobody was looking.
$compose run --rm -T --user root --entrypoint sh synapse -c '
cat > /tmp/dev.yaml
python3 - <<PY
start, end = "# >>> relaykit", "# <<< relaykit"
config = open("/data/homeserver.yaml").read()
if start in config and end in config:
    config = config[:config.index(start)] + config[config.index(end) + len(end):]
open("/data/homeserver.yaml", "w").write(
    config.rstrip() + "\n\n" + start + "\n" + open("/tmp/dev.yaml").read().rstrip() + "\n" + end + "\n")
PY
' < dev.yaml

$compose up -d

# The configuration lives on a mounted volume, so writing it changes nothing until the homeserver reads it
# again. Without this the settings above are applied and do not take effect, which looks like them not working.
$compose restart synapse >/dev/null

attempt=0
while [ $attempt -lt 60 ]; do
  if curl --fail --silent --max-time 2 http://localhost:8008/_matrix/client/versions >/dev/null; then break; fi
  attempt=$((attempt + 1))
  sleep 2
done
if [ $attempt -ge 60 ]; then
  echo "the homeserver did not come up" >&2
  exit 1
fi

# Three accounts: the third is what the group check needs. Already being there is not a failure.
for person in alice bob carol; do
  $compose exec -T synapse register_new_matrix_user -c /data/homeserver.yaml \
    -u "$person" -p "$person-password" --no-admin http://localhost:8008 >/dev/null 2>&1 || true
done

echo "matrix environment ready"
