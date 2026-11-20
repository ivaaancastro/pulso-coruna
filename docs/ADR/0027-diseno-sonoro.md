# ADR-0027: diseño sonoro de «Escuchar» (Web Audio nativo)

- Fecha: 2026-11-20
- Estado: aceptada

## Contexto

M7.1 sonifica las capas. Sin librerías de audio (presupuesto diferido 560 KB, casi lleno) ni dependencias nuevas.

## Decisión

Web Audio nativo en un chunk propio, cargado al activar «Escuchar». Pentatónica menor de La, corcheas a 90 bpm, ≤ 16 voces (2 continuas + 14 con robo por prioridad/antigüedad). Timbre por capa: bus agudo corto, bici percusión suave, mar drone según marea, viento ruido filtrado, aire/barcos/aviones acentos escasos. Salida: ganancia maestra con tope 0,5 + `DynamicsCompressor`; envolventes con rampas. Interruptor independiente del modo (suena en Ahora y Reproducir), apagado y solo de sesión.

## Consecuencias

Sin sonido real en CI: lo cubren el núcleo puro y un `AudioContext` simulado. iOS Safari exige gesto y `resume()`. Subir el tope de voces cuesta CPU en móvil.
