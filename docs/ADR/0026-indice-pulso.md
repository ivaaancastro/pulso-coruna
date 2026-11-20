# ADR-0026: Índice Pulso — fórmula, pesos y perfil fijo → aprendido

- Fecha: 2026-11-20
- Estado: aceptada

## Contexto

`GET /api/v1/pulse` (M7.2) resume la actividad de la ciudad en un número 0–100. Aún no hay un mes de histórico propio para saber qué es «lo habitual».

## Decisión

Razón por capa `r` = actividad observada / habitual (1 = normal), acotada a [0, 3]; `value = clamp(50 · Σ wᵢrᵢ / Σ wᵢ, 0, 100)` sobre las capas con datos (50 = normal, 100 = el doble). Móviles: entidades en movimiento (≥ 0,5 m/s o sin velocidad); bici: rotación `Σ|Δ bicis|` por 5 min; tiempo/mar/aire: `1 + 0,25 · desviación media` (±0,5 como máximo, para que no dominen). Pesos en `PULSE_WEIGHTS` (JSON validado; defecto bus 1, bici 1, barcos/aviones 0,4, tiempo/aire 0,3, mar 0,2). **Perfil fijo** (`profile:"fixed"`): tabla constante `pico × forma[laborable|sábado|domingo][hora Madrid]`, estimada y no medida; la UI lo etiqueta. **Perfil aprendido** (`"learned"`, no implementado): con ≥ 4 semanas de `*_1m`, el habitual por capa/día-tipo/hora será la mediana de esos tramos (mín. 4 muestras, si no se cae al fijo), recalculada de noche; el contrato no cambia, solo `profile`.

## Alternativas

Z-score contra media/desviación (exige histórico); mapear con `r/(1+r)` (nunca llega a 100, menos legible); sin suavizado (+1; dispara el cociente de madrugada).

## Consecuencias

Los valores iniciales son plausibles, no medidos; el «pico» y las normales ambientales se recalibrarán al pasar a perfil aprendido. Sin festivos: un festivo se compara con un laborable. Cambiar de perfil mueve la serie histórica: la ETag cambia y la caché de ventanas pasadas es de 1 h, no `immutable`.
