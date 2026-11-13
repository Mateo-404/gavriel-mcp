/** Mensaje para el cliente con el nombre de la cuenta y su dirección (Alt+C). */
export function formatClientMessage(name: string, address: string): string | null {
  const n = name.replace(/\s+/g, ' ').trim();
  const a = address.replace(/\s+/g, ' ').trim();
  if (!n || !a) return null;
  return `Estimado/a cliente: *${n}*\nAlarma de: *${a}*`;
}
