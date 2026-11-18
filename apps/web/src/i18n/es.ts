export const es = {
  "app.name": "Pulso A Coruña",
  "map.label": "Mapa de A Coruña (próximamente)",
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
} as const;

export type MessageKey = keyof typeof es;
export type Messages = Record<MessageKey, string>;
