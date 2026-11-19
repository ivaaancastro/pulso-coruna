export const es = {
  "app.name": "Pulso A Coruña",
  "map.label": "Mapa 3D de A Coruña: península, bahía y edificios",
  "map.unavailable": "No se pudo cargar el mapa en este dispositivo",
  "clock.label": "Hora actual en A Coruña",
  "pulse.label": "Índice Pulso",
  "pulse.scale": "de 100",
  "pulse.placeholder": "Valor de muestra, sin datos reales",
  "mode.label": "Modo de visualización",
  "mode.view": "Ver",
  "mode.replay": "Reproducir",
  "mode.listen": "Escuchar",
  "mode.soon": "Próximamente",
  "mode.unavailable": "{mode} estará disponible próximamente.",
  "mode.selected": "Modo {mode} activo.",
  "pwa.update": "Hay una versión nueva.",
  "pwa.update.action": "Actualizar",
  "pwa.offline": "Sin conexión. Se muestra lo guardado.",
  "bus.card.region": "Detalle del autobús",
  "bus.card.title": "Línea {line}",
  "bus.card.untitled": "Autobús",
  "bus.card.headsign": "Destino",
  "bus.card.nextStop": "Próxima parada",
  "bus.card.estimated": "Estimado según horario",
  "bus.card.close": "Cerrar",
} as const;

export type MessageKey = keyof typeof es;
export type Messages = Record<MessageKey, string>;
