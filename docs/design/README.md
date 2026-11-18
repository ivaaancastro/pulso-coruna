# Dirección de arte (brief para M1.6)

Norte: **cinematográfica nocturna**. A Coruña vista desde arriba de noche: fondo casi negro, el mar como masa profunda, los datos como luz. Todo lo que se mueve se lee a primera vista; todo lo que no se mueve se queda atrás.

## Principios

1. **El mar es el protagonista.** Costa, bahía y Torre de Hércules definen la composición; la ciudad se recorta contra el Atlántico.
2. **Luz con significado.** Solo brilla lo que es dato. El mapa base no compite (luminancia baja, sin etiquetas salvo al interactuar).
3. **Movimiento físico.** Curvas de aceleración suaves, nada lineal ni rebotes de juguete; la cámara se mueve como un dron, no como un mapa.
4. **Poco texto, muy bien puesto.** Una familia tipográfica con carácter, cifras tabulares, tamaños grandes para hora e índice.
5. **Silencio por defecto.** Sonido apagado, interfaz que se retira cuando no se usa.

## Qué hay que decidir en M1.6 (lo aprueba el humano)

- [ ] Moodboard (10–15 referencias) en `docs/design/moodboard.md`.
- [ ] Paleta: fondo, agua, tierra, edificios, una tonalidad por capa; contraste AA para UI; apta para daltonismo.
- [ ] Tipografía (licencia libre, autoalojada, subset): display para cifras y texto de UI.
- [ ] Principios de movimiento: duraciones, curvas, cómo entran y salen las capas.
- [ ] Guion de la intro (≤ 4 s) y de la demo de 15 s.
- [ ] Postprocesado: ¿bloom sutil? Solo si cabe en el presupuesto de fotograma.
- [ ] Tokens en `docs/design/tokens.md` (colores, tipografía, espaciados, radios, duraciones), que M2.4 traslada a CSS.

## Herramientas

- Skill `frontend-design` para proponer dirección y componentes sin caer en plantillas.
- Skill `design-review` para revisar cada PR de UI contra este documento.
