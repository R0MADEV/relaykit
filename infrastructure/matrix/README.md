# Entorno Matrix local

Este entorno levanta un Synapse real para probar RelayKit localmente. Es solo para desarrollo y usa el almacenamiento
por defecto del contenedor.

La configuracion local aumenta los limites de login para facilitar pruebas repetidas. No reutilizar esta configuracion
en produccion.

## Preparar el homeserver

Desde la raiz de RelayKit:

```bash
docker compose -f infrastructure/matrix/docker-compose.yml run --rm synapse generate
```

Los limites de peticiones por defecto rechazan la cantidad de salas y mensajes que crean los tests. Tras generar
la configuracion, subirlos:

El fichero generado pertenece al usuario del contenedor, asi que se escribe desde dentro:

```bash
docker compose -f infrastructure/matrix/docker-compose.yml run --rm -T --user root \
  --entrypoint sh synapse -c \
  'grep -q rc_room_creation /data/homeserver.yaml || cat >> /data/homeserver.yaml' \
  < infrastructure/matrix/dev-rate-limits.yaml
```

## Arrancar Synapse

```bash
docker compose -f infrastructure/matrix/docker-compose.yml up -d
```

Comprobar que responde:

```bash
curl http://localhost:8008/_matrix/client/versions
```

Con los usuarios de desarrollo creados, ejecutar el smoke check:

```bash
npm run smoke:matrix
```

Para probar el flujo completo del SDK contra Synapse:

```bash
npm run smoke:relaykit
```

Para probar la recuperacion E2EE entre dos dispositivos del mismo usuario:

```bash
npm run smoke:recovery
```

Para probar la verificacion SAS entre dos dispositivos:

```bash
npm run smoke:verification
```

Se pueden usar otros usuarios mediante `MATRIX_USER_A`, `MATRIX_PASSWORD_A`, `MATRIX_USER_B` y `MATRIX_PASSWORD_B`.

## Crear usuarios

Ejecutar el comando dos veces para crear dos usuarios de prueba:

```bash
docker compose -f infrastructure/matrix/docker-compose.yml exec synapse \
  register_new_matrix_user \
  -c /data/homeserver.yaml \
  http://localhost:8008
```

Usar, por ejemplo, `alice` y `bob` con el dominio `localhost`.

## Ejecutar el ejemplo Web

Desde otra terminal:

```bash
npm install
npm run dev --workspace=@relaykit/example-web
```

Abrir dos sesiones del navegador con usuarios diferentes y utilizar:

```text
http://localhost:5173
```

## Detener el entorno

```bash
docker compose -f infrastructure/matrix/docker-compose.yml down
```

Para borrar completamente los datos locales, eliminar manualmente `infrastructure/matrix/data/`.
