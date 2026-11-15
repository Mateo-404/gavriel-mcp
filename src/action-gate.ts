/**
 * El botón de la extensión (y su ícono en color) solo está activo en los sitios donde la extensión trabaja:
 * Gavriel y las pestañas de música. En cualquier otro sitio Chrome lo muestra en gris y sin ventana.
 * Chrome lo decide solo con reglas declarativas: no hace falta leer las pestañas ni pedir permiso extra de sitios.
 */
export const ACTIVE_HOSTS = ['app.gavriel.com.ar', 'open.spotify.com', 'music.youtube.com'] as const;

type DeclarativeContent = typeof chrome.declarativeContent;

/** Reglas: «mostrar la acción» solo cuando la página es https y su host está en la lista. */
export function buildGateRules(dc: Pick<DeclarativeContent, 'PageStateMatcher' | 'ShowAction'>): chrome.events.Rule[] {
  return [
    {
      conditions: ACTIVE_HOSTS.map((host) => new dc.PageStateMatcher({ pageUrl: { hostEquals: host, schemes: ['https'] } })),
      actions: [new dc.ShowAction()],
    },
  ];
}

export function installActionGate(api: Pick<typeof chrome, 'action' | 'declarativeContent'> & { runtime?: Pick<typeof chrome.runtime, 'onInstalled'> } | undefined = globalThis.chrome): void {
  // Firefox no tiene declarativeContent: ahí el botón queda siempre activo
  if (!api?.declarativeContent?.onPageChanged || !api.action?.disable) return;
  // Desactivado en todas partes; las reglas lo activan en los sitios de la lista (esto no se conserva entre sesiones)
  void Promise.resolve(api.action.disable()).catch(() => {});
  const apply = (): void => {
    api.declarativeContent.onPageChanged.removeRules(undefined, () => {
      api.declarativeContent.onPageChanged.addRules(buildGateRules(api.declarativeContent));
    });
  };
  api.runtime?.onInstalled.addListener(apply);
  apply();
}
