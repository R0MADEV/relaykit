# Plan de implementación

## Definición del MVP

Una aplicación web externa puede restaurar una sesión, mostrar un timeline persistente, enviar y recibir mensajes
cifrados, sobrevivir a una desconexión, poner en cola un mensaje offline, reintentarlo y reiniciar sin perder la
sesión ni el estado criptográfico.

## Estado actual

Ya está implementado:

- contratos públicos TypeScript
- `MessagingClient`
- adapters Matrix e in-memory
- login, logout y restauración de sesión
- sync y reconexión
- conversaciones, invitaciones y unión a rooms
- rooms cifrados por defecto
- mensajes en tiempo real
- timeline y paginación
- local echo y outbox persistente
- transaction IDs y retry con backoff
- deduplicación de eventos
- IndexedDB cifrado para mensajes y outbox
- estado básico de dispositivos y crypto
- estado básico de key backup
- recovery E2EE: setup de cross-signing, secret storage y backup, y restore con recovery key
- verificación interactiva SAS entre dispositivos
- adjuntos con progreso, cifrado de contenido, outbox y descarga
- conversaciones directas sin duplicados y búsqueda local de conversaciones y mensajes
- purge del storage local en logout
- cancelación y límite de intentos en el outbox
- edición, eliminación y reacciones
- receipts de lectura enviados y recibidos
- typing y presencia, salientes y recibidos
- redactions y ediciones remotas persistidas
- outbox crash-safe con recuperación tras reinicio
- smoke checks contra Synapse real
- ejemplo Web vanilla y comprobacion automatica en Electron

El MVP todavía no está listo para producción. El siguiente bloque es:

```text
E2EE recovery y verificación interactiva
→ eventos remotos completos
→ tests unitarios e integración
→ API review y release alpha
```

## Fase 0: contratos

- Definir modelos públicos y tipos de error.
- Definir el ciclo de vida de `MessagingClient`.
- Definir eventos tipados y comportamiento de desuscripción.
- Definir estados de entrega de mensajes.
- Definir interfaces de sesión y almacenamiento.
- Añadir un adaptador falso en memoria para tests de contrato.

Entregable: contrato de API independiente de Matrix.

## Fase 1: adaptador Matrix

- Crear el proyecto TypeScript y los límites de paquetes.
- Integrar `matrix-js-sdk`.
- Implementar restauración de sesión y logout.
- Implementar sync inicial y reconexión.
- Mapear rooms a conversaciones.
- Mapear eventos Matrix a eventos del SDK.

Entregable: el cliente puede conectar y observar conversaciones sin importar tipos de Matrix.

## Fase 2: vertical de chat

- Listar conversaciones.
- Cargar un timeline.
- Enviar y recibir mensajes de texto.
- Implementar local echo.
- Exponer el estado de conexión y sincronización.
- Añadir una aplicación de ejemplo mínima.

Entregable: dos usuarios pueden conversar usando únicamente la API pública del SDK.

## Fase 3: persistencia y offline

- Persistir sesión, timeline y estado de sincronización.
- Añadir registros del outbox.
- Añadir transaction IDs y deduplicación.
- Añadir reintentos con backoff limitado.
- Recuperar mensajes pendientes después de reiniciar.
- Añadir paginación.

Entregable: el cliente sigue siendo útil durante desconexiones y reinicios.

## Fase 4: E2EE

- Persistir de forma segura el crypto store de Matrix.
- Soportar rooms y mensajes cifrados.
- Exponer el estado de dispositivos y verificación sin exponer claves privadas.
- Gestionar eventos que no se puedan descifrar explícitamente.
- Documentar las responsabilidades de backup y recuperación.

Entregable: una conversación cifrada funciona entre dos dispositivos.

## Fase 5: multimedia

- Subir y descargar adjuntos.
- Añadir progreso y reintentos.
- Añadir thumbnails y cache local.

Entregable: imágenes y documentos funcionan sin exponer MXC URLs en la API normal.

## Fase 6: Electron

- Reutilizar el paquete web en el renderer.
- Añadir un adaptador de almacenamiento seguro cuando sea necesario.
- Añadir notificaciones e integración con el ciclo de vida.
- Añadir un preload bridge seguro.

Entregable: la misma API headless funciona en Electron.

## Fase 7: paquetes para frameworks

Solo después de estabilizar la API headless:

- `@relaykit/react`
- `@relaykit/vue`
- `@relaykit/web-components`

Estos paquetes contienen bindings y helpers de UI, no lógica de Matrix.

## Roadmap posterior

- Control Plane opcional para identidad y multi-tenancy
- despliegues Matrix gestionados
- despliegues dedicados por tenant
- adaptador Rust y `matrix-rust-sdk` para Native
- bindings para Swift y Kotlin
- administración empresarial y auditoría

## Fuera del MVP

- implementar el protocolo Matrix
- criptografía propia
- crear un homeserver nuevo
- crear un Control Plane SaaS
- billing
- clientes móviles nativos
- suite completa de moderación y compliance
- microservicios
- Rust/WASM

## Criterios de calidad

- Los tests de API pública utilizan el adaptador falso.
- Los tests del adaptador se ejecutan contra un homeserver Matrix desechable.
- Los tests de E2EE cubren dos usuarios y dos dispositivos.
- Los tests offline cubren local echo, reintentos, entregas duplicadas y reinicio.
- Los ejemplos de navegador y Electron consumen únicamente la API pública del SDK.
- Ningún tipo público importa tipos de `matrix-js-sdk`.
