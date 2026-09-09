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
