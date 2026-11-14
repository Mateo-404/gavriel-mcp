/**
 * Gavriel escribe unos 440 mensajes de depuración con emoji («🔄 [useMonitoring] Actualización…»,
 * «🔊 [useAudioPermission]…») en cada actualización. Chrome guarda esos mensajes (y los objetos que
 * llevan) en memoria aunque las herramientas de desarrollo estén cerradas, y formatearlos cuesta.
 *
 * Solo se descartan `log`, `info` y `debug` cuyo primer argumento es texto que empieza con un emoji;
 * `warn` y `error` (y cualquier otro log) pasan siempre, para no esconder fallas reales.
 */
export function isDebugNoise(args: readonly unknown[]): boolean {
  const first = args[0];
  return typeof first === 'string' && /^\p{Extended_Pictographic}/u.test(first);
}
