#!/bin/sh
# Brings up two federated homeservers for the federation smoke check. Development only.
set -e
cd "$(dirname "$0")"

for server in fed1 fed2; do
  if [ ! -f "data${server#fed}/homeserver.yaml" ]; then
    docker compose run --rm "$server" generate >/dev/null
    # The generated listeners are replaced by ones that also serve federation over TLS.
    docker compose run --rm -T --user root --entrypoint sh "$server" -c '
      python3 - <<PY
import re
config = open("/data/homeserver.yaml").read()
config = re.sub(r"^listeners:.*?(?=^[a-z_]+:)", "", config, flags=re.S | re.M)
open("/data/homeserver.yaml", "w").write(config)
PY
      cat >> /data/homeserver.yaml
      openssl req -x509 -newkey rsa:2048 -keyout /data/tls.key -out /data/tls.crt \
        -days 365 -nodes -subj "/CN=$(grep "^server_name:" /data/homeserver.yaml | cut -d" " -f2)" 2>/dev/null
      chmod 644 /data/tls.key /data/tls.crt
    ' < federation.yaml
    docker compose run --rm -T --user root --entrypoint sh "$server" -c \
      'grep -q rc_room_creation /data/homeserver.yaml || cat >> /data/homeserver.yaml' < ../dev-rate-limits.yaml
  fi
done

docker compose up -d
for port in 8018 8019; do
  attempt=0
  while [ $attempt -lt 60 ]; do
    if curl --fail --silent --max-time 2 "http://localhost:$port/_matrix/client/versions" >/dev/null; then break; fi
    attempt=$((attempt + 1))
    sleep 1
  done
done

docker compose exec -T fed1 register_new_matrix_user -c /data/homeserver.yaml -u alice -p alice-password --no-admin http://localhost:8008 >/dev/null 2>&1 || true
docker compose exec -T fed2 register_new_matrix_user -c /data/homeserver.yaml -u dave -p dave-password --no-admin http://localhost:8008 >/dev/null 2>&1 || true
echo "federation environment ready"
