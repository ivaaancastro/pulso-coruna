/** Pentatónica menor de La: intervalos en semitonos sobre la tónica. */
export const PENTATONIC = [0, 3, 5, 7, 10] as const;
/** La3 (MIDI 57): tónica de la escala. */
export const ROOT_MIDI = 57;

/** Grado de la escala (puede ser negativo o mayor que 4: salta de octava) → nota MIDI. */
export function degreeToMidi(degree: number): number {
  const d = Math.trunc(degree);
  const octave = Math.floor(d / PENTATONIC.length);
  const index = d - octave * PENTATONIC.length;
  return ROOT_MIDI + octave * 12 + (PENTATONIC[index] ?? 0);
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function degreeToHz(degree: number): number {
  return midiToHz(degreeToMidi(degree));
}

/** ¿La nota MIDI pertenece a la escala (en cualquier octava)? */
export function isInScale(midi: number): boolean {
  const pc = (((midi - ROOT_MIDI) % 12) + 12) % 12;
  return (PENTATONIC as readonly number[]).includes(pc);
}

/** ¿La frecuencia es (con tolerancia) una nota de la escala? */
export function hzInScale(hz: number): boolean {
  const midi = 69 + 12 * Math.log2(hz / 440);
  return Math.abs(midi - Math.round(midi)) < 1e-6 && isInScale(Math.round(midi));
}
