# Entorno federado

Dos homeservers que se hablan entre si, para comprobar que RelayKit funciona con gente de servidores distintos.
Solo para desarrollo.

```bash
npm run federation:up
npm run smoke:federation
```

`up.sh` genera la configuracion de cada servidor la primera vez, la deja escuchando federacion por TLS en 8448
con un certificado autofirmado, y crea `alice` en `fed1` y `dave` en `fed2`. Los clientes se conectan a
`http://localhost:8018` y `http://localhost:8019`.

## Por que hace falta configurar tanto

Tres cosas impiden que dos Synapse locales se federen sin tocar nada, y las tres estan resueltas en
`federation.yaml`:

- La federacion viaja por TLS. Se genera un certificado autofirmado y se acepta con
  `federation_verify_certificates: false`.
- Synapse se niega a arrancar con esa opcion si ademas confia en un servidor de claves externo. Los dos
  servidores se piden las claves entre ellos, con `trusted_key_servers: []`.
- Synapse bloquea la federacion hacia direcciones privadas para evitar ataques desde dentro, y la red de
  Docker lo es. Se permite con `ip_range_whitelist`.

Los nombres de servidor coinciden con los de los servicios para que cada uno resuelva al otro por DNS interno.

## Limpiar

```bash
docker compose -f infrastructure/matrix/federation/docker-compose.yml down
rm -rf infrastructure/matrix/federation/data1 infrastructure/matrix/federation/data2
```
