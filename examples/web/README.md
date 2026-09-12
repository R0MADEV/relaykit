# Ejemplo Web

Este ejemplo muestra el consumo de RelayKit desde JavaScript/TypeScript sin usar React ni conocer Matrix.

## Ejecucion

Desde la raiz del proyecto:

```bash
npm install
npm run dev --workspace=@relaykit/example-web
```

El ejemplo necesita un Synapse local o cualquier homeserver Matrix compatible. Ver
`infrastructure/matrix/README.md` para levantarlo.

## Como probarlo

1. Abrir `http://localhost:5173` en dos ventanas.
2. En una elegir `alice` y en la otra `bob`. La contrasena se rellena sola.
3. En la ventana de alice, con `@bob:localhost` seleccionado, pulsar "Abrir".
4. Escribir. En la ventana de bob aparece la conversacion con su contador de no leidos.

Interfaz de dos paneles: a la izquierda las conversaciones ordenadas por actividad, con ultimo mensaje, contador
de no leidos y buscador; a la derecha el hilo con estado de cada mensaje, adjuntos con progreso y descarga,
indicador de escritura, historial hacia atras y reintento o cancelacion de los envios fallidos.

"Abrir" usa `conversations.open`, que reutiliza la conversacion directa en vez de crear una nueva cada vez.

## Llamadas y videoconferencia

Hace falta LiveKit ademas de Synapse: `npm run livekit:up` (ver `infrastructure/livekit/README.md`). En
`localhost` la demo ya sabe donde esta; en cualquier otro sitio se le dice con `?conference=<url del servicio>`.

1. Abrir `http://localhost:5173` en **tres** ventanas que no compartan sesion (tres perfiles de Chrome, o
   una normal, una de incognito y otro navegador). Entrar como `alice`, `bob` y `carol`.
2. En la ventana de alice crear una conversacion con los otros dos (o abrir una directa con bob para una
   llamada de dos). Bob y carol aceptan la invitacion.
3. Alice pulsa **Videollamada**. A bob y a carol les suena: **Descolgar**. O, si la llamada ya esta en marcha,
   **Entrar**, que no hace sonar a nadie.
4. Cada ventana pinta una caja por persona, con la propia. Un borde verde marca a quien habla; el candado,
   que lo que va por el servidor va cifrado y el servidor no puede leerlo.
5. **Compartir pantalla** la pone aparte y grande en las demas ventanas. **Colgar** es salirse: la llamada
   sigue para quien quede, y quien se queda solo lo ve y cuelga cuando quiera.

El navegador pedira permiso de camara y microfono a cada ventana; en `localhost` no hace falta https.

## Verificacion manual en navegador

Los tests automaticos cubren el SDK en Node, incluido el storage IndexedDB con un doble. Lo que solo se puede
comprobar en un navegador real:

1. **Sesion y storage.** Conectar con dos usuarios en dos ventanas. Recargar la pagina: el historial debe seguir
   ahi. En DevTools, `Application > IndexedDB > relaykit-app-<usuario>`: los cuerpos de los mensajes deben verse
   cifrados, no en claro.
2. **Mensajes cifrados.** Enviar en ambos sentidos y comprobar que llegan en tiempo real.
3. **Adjuntos.** Enviar un archivo, ver la barra de progreso y descargarlo desde la otra ventana.
4. **Envio sin red.** En DevTools, `Network > Offline`. Enviar un mensaje: debe quedar en `failed`. Volver a
   `Online`: el outbox lo reintenta solo al reconectar. Tambien se puede forzar con "Reintentar" o descartarlo
   con "Cancelar".
5. **Reinicio con envio pendiente.** Estando offline, enviar y recargar la pagina antes de volver a online. El
   mensaje debe reaparecer como pendiente y salir al reconectar.
