/** Lista de eventos del panel (kanban): /monitoring-panel, sin nada más. */
export function isPanelList(pathname: string): boolean {
  return /^\/monitoring-panel\/?$/.test(pathname);
}

/**
 * Id de la cuenta si estamos en su pantalla de análisis
 * (/monitoring-panel/account-analysis?accountId=…); null en cualquier otra ruta.
 */
export function accountIdFromLocation(pathname: string, search: string): string | null {
  if (!/^\/monitoring-panel\/account-analysis\/?$/.test(pathname)) return null;
  return new URLSearchParams(search).get('accountId') || null;
}
