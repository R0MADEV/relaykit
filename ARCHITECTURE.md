# Arquitectura

## Decisión

RelayKit utiliza una arquitectura modular por capacidades, con un coordinador de estado y puertos y adaptadores
selectivos. No es una plantilla hexagonal completa.

La arquitectura hexagonal es útil en los límites donde realmente varían las implementaciones, como Matrix,
almacenamiento y servicios nativos. Aplicarla a todos los módulos añadiría interfaces e indirección antes de validar
los contratos del producto.

## Por qué esta arquitectura

RelayKit es principalmente un runtime de cliente, no un backend con un dominio empresarial complejo. Su problema
central es coordinar comandos, estado local, sincronización, eventos y efectos externos.

Por eso la arquitectura recomendada es:

```text
Modulos por capacidad
        +
Estado local centralizado
        +
Flujo unidireccional
        +
Puertos solo para efectos externos
```

Esto evita dos extremos:

- Un cliente acoplado directamente a `matrix-js-sdk`.
- Una arquitectura hexagonal con interfaces artificiales para cada clase y función.

## Estructura de codigo

La estructura debe crecer por capacidades, no por una jerarquía de capas excesivamente profunda:

```text
packages/
├── core/
│   └── src/
│       ├── client/       # fachada publica y ciclo de vida
│       ├── conversations/
│       ├── messages/
│       ├── session/
│       ├── runtime/      # estado, sync y coordinacion
│       ├── events/
│       ├── ports/        # contratos de efectos externos
│       ├── errors/
│       └── index.ts
│
├── matrix-js/
│   └── src/              # adaptador concreto Matrix
│
├── storage-browser/
│   └── src/              # persistencia del navegador
│
└── electron/
    └── src/              # adaptadores nativos opcionales
```

Los modulos de capacidad contienen sus modelos, comandos y reglas pequeñas. No deben importar Matrix, APIs del
navegador ni Electron.

## Dependencias permitidas

```text
Public API
    -> capacidades y runtime
    -> puertos

Adaptadores
    -> puertos
    -> dependencias externas
```

El core nunca importa:

- `matrix-js-sdk`
- `window`, `document` o IndexedDB directamente
- Electron
- React, Vue u otro framework

Los adaptadores pueden importar el core y sus contratos, pero el core no conoce sus implementaciones.

## Reglas de simplicidad

- No usar singletons ni estado mutable global.
- Preferir instancias con dependencias explicitas.
- Usar `for` cuando una transformacion y un filtrado juntos oculten la logica.
- No usar `useCallback` ni `useMemo` sin una medicion que justifique su necesidad.
- Extraer un helper cuando una clase supere 200 lineas o mezcle responsabilidades.
- Preferir tipos simples y evitar aserciones de tipo.

## Flujo de una operacion

```text
API publica
    -> comando
    -> coordinador
    -> actualizacion optimista del estado
    -> puerto externo
    -> confirmacion o error
    -> estado final
    -> evento tipado
```

No se debe implementar un bus de eventos como fuente de verdad. El estado persistido y el estado observable son la
fuente principal; los eventos notifican cambios.

## Puertos reales

Solo se crean puertos para dependencias que cambian por entorno o por plataforma:

- `MessagingAdapter`: Matrix o fake de desarrollo.
- `Storage`: memoria, navegador o Electron.
- `SecureStore`: credenciales y crypto store cuando el entorno lo requiera.
- `Clock` e `IdGenerator`: determinismo y testabilidad.

No se crean puertos para cada servicio interno del core.

## Runtime

```text
Aplicación consumidora
        |
        v
@relaykit/web
        |
        v
API pública
        |
        v
Coordinador del cliente
  |       |        |
  v       v        v
Estado  Outbox  Flujo de eventos
  |       |        |
  +-------+--------+
          |
          v
    Adaptador Matrix
          |
          v
   matrix-js-sdk
          |
          v
   Homeserver Matrix
```

## Módulos

### API pública

API estable para los consumidores:

- `MessagingClient`
- autenticación y restauración de sesión
- conversaciones
- mensajes
- multimedia
- eventos tipados
- ciclo de vida

No debe exponer tipos de Matrix.

### Coordinador del cliente

Coordina comandos, consultas, actualizaciones de sincronización, persistencia, transiciones del outbox y ciclo de
vida. Es la capa de aplicación del SDK, pero debe seguir siendo un coordinador pequeño y no una colección de servicios
distribuidos.

### Modelos de dominio

Utiliza conceptos del SDK como `Conversation`, `Message`, `User` y `MessageStatus`. Los IDs de Matrix son metadatos
internos de transporte y no son necesarios en la API habitual.

### Adaptador Matrix

Traduce las operaciones públicas a `matrix-js-sdk` y convierte los eventos Matrix en modelos del SDK. Este es el
principal límite de adaptación.

### Adaptador de almacenamiento

Proporciona almacenamiento en memoria para tests y persistencia para el navegador. La implementación se selecciona
según el entorno. El SDK debe reutilizar las capacidades de persistencia de `matrix-js-sdk` cuando cubran el estado de
Matrix, evitando mantener innecesariamente una segunda fuente de verdad.

### Límite criptográfico

RelayKit delega la criptografía en Matrix. Las claves privadas y el crypto store deben permanecer protegidos por el
runtime del cliente. El SDK nunca implementa criptografía propia.

## Web y Electron

```text
Browser renderer   -> @relaykit/web -> almacenamiento del navegador
Electron renderer  -> @relaykit/web -> preload bridge cuando sea necesario
Electron main      -> almacenamiento seguro, notificaciones y servicios nativos
```

Electron debe utilizar `contextIsolation: true` y `nodeIntegration: false`. Las operaciones privilegiadas deben pasar
por una API estrecha y validada en preload.

## Límite con el backend

```text
Frontend del cliente
  -> RelayKit -> APIs de cliente Matrix

Backend del cliente
  -> autenticación de la aplicación
  -> provisioning de usuarios y rooms
  -> autorización empresarial
  -> APIs administrativas de Matrix
```

La primera versión de RelayKit no incluye un Control Plane SaaS. Un producto gestionado futuro podrá añadirlo sin
cambiar los contratos del cliente.

## Semántica de mensajes

`send()` crea un mensaje local y devuelve su identidad local. La entrega se observa mediante transiciones de estado:

```text
queued -> sending -> sent
                    |
                    +-> failed
```

La implementación debe proporcionar transaction IDs, deduplicación, procesamiento ordenado del outbox por
conversación y recuperación después de reiniciar.

## Límites de seguridad

- Las credenciales administrativas de Matrix permanecen en el backend del cliente.
- El almacenamiento del navegador no debe contener secretos administrativos sin proteger.
- Las credenciales de acceso y renovación se gestionan según el modo de sesión elegido.
- El material privado de E2EE permanece en el cliente.
- Los métodos IPC de Electron son explícitos y están validados.
- Los permisos empresariales que Matrix no representa deben aplicarse en el backend del cliente.
