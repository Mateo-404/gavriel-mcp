import type { GavrielClient } from "../gavrielClient.js";
import { z } from "zod";
import { idSchema } from "./shared.js";
import type { McpServer } from "@modelcontextprotocol/server";
import { requireConfirm, confirmSchema, runBatch, destructiveGuard, okOrInput, seg } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

const FIELDS = [
  "serialNumber", "deviceModelId", "deviceBrandId", "deviceConnectionTypeId", "deviceKindId", "zoneId",
  "chip1", "chip2", "imei", "alertType", "ownershipType", "cloudDeviceId", "deviceTaxonomyId",
] as const;

const deviceItem = z.object({
  serialNumber: z.string().min(1).optional().describe("Clave de match con los dispositivos existentes de la cuenta"),
  deviceModelId: idSchema.optional(),
  deviceBrandId: idSchema.optional().describe("Requerido para crear"),
  deviceConnectionTypeId: idSchema.optional(),
  deviceKindId: idSchema.optional(),
  zoneId: idSchema.optional(),
  chip1: z.string().optional(),
  chip2: z.string().optional(),
  imei: z.string().optional(),
  alertType: z.string().optional().describe("Sonora | Silenciosa"),
  ownershipType: z.enum(["alquiler", "comodato"]).optional(),
  cloudDeviceId: idSchema.optional(),
  deviceTaxonomyId: idSchema.optional(),
});

type Dev = Record<string, unknown>;
const pick = (d: Dev): Dev => Object.fromEntries(FIELDS.filter((k) => d[k] !== undefined).map((k) => [k, d[k]]));
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

export interface DevicePlan {
  creates: Dev[];
  updates: Array<{ id: string; serialNumber?: string; body: Dev }>;
  noops: number;
  errors: string[];
}

/** Diff puro: match por serialNumber; sin serie, por (modelo+zona) entre los existentes sin serie. */
export function planDevices(existing: Dev[], items: Dev[]): DevicePlan {
  const plan: DevicePlan = { creates: [], updates: [], noops: 0, errors: [] };
  const used = new Set<string>();
  const seen = new Set<string>();
  for (const [i, raw] of items.entries()) {
    const body = pick(raw);
    const serial = str(body.serialNumber);
    if (serial) {
      if (seen.has(serial)) { plan.errors.push(`devices[${i}]: serialNumber duplicado en el lote (${serial})`); continue; }
      seen.add(serial);
    }
    const match = existing.find((e) => {
      const id = str(e.id);
      if (used.has(id)) return false;
      return serial
        ? str(e.serialNumber) === serial
        : !str(e.serialNumber) && !!body.deviceModelId && str(e.deviceModelId) === str(body.deviceModelId) && str(e.zoneId) === str(body.zoneId);
    });
    if (!match) {
      if (!body.deviceBrandId) { plan.errors.push(`devices[${i}]: deviceBrandId es requerido para crear`); continue; }
      plan.creates.push(body);
      continue;
    }
    used.add(str(match.id));
    const diff = Object.fromEntries(Object.entries(body).filter(([k, v]) => str(match[k]) !== str(v)));
    if (Object.keys(diff).length === 0) plan.noops++;
    else plan.updates.push({ id: str(match.id), serialNumber: serial || undefined, body: diff });
  }
  return plan;
}

export function registerDeviceBatchTools(server: McpServer, client: GavrielClient, role: Role): void {
  registerTool(
    server, role, "full", "bulk_upsert_account_devices",
    {
      title: "Alta/actualización masiva de dispositivos de una cuenta",
      description:
        "Carga repetible de dispositivos de UNA cuenta (máx 50): lee GET /accounts/{id}/devices, crea (POST) los que no existen " +
        "y actualiza (PATCH, solo campos que cambian) los que coinciden por serialNumber; sin serie matchea por modelo+zona. " +
        "Idempotente: volver a correrlo no duplica. Sin confirm devuelve UN preview de toda la cuenta (cantidades y cuerpos), sin escribir. " +
        "Con confirm ejecuta y devuelve { summary, results }. Requiere confirm: true.",
      inputSchema: {
        accountId: idSchema,
        devices: z.array(deviceItem).min(1).max(50).describe("Dispositivos deseados (máx 50)"),
        confirm: confirmSchema,
      },
      annotations: { idempotentHint: true },
    },
    async (args, ctx) => {
      const base = `/accounts/${seg(args.accountId)}/devices`;
      const res = await client.get(base, undefined, { signal: ctx.mcpReq.signal });
      if (res.status >= 400) return { isError: true, content: [{ type: "text", text: `GET ${base} -> ${res.status}` }] };
      const existing = (Array.isArray(res.data) ? res.data : (res.data as { data?: unknown[] })?.data ?? []) as Dev[];
      const plan = planDevices(existing, args.devices as Dev[]);
      if (plan.errors.length) {
        return { isError: true, content: [{ type: "text", text: `Lote inválido, no se escribe nada: ${plan.errors.join("; ")}` }] };
      }
      const exec = {
        tool: "bulk_upsert_account_devices",
        method: "POST/PATCH",
        path: `${base} (${plan.creates.length} altas, ${plan.updates.length} cambios, ${plan.noops} sin cambios)`,
        params: { accountId: args.accountId, creates: plan.creates, updates: plan.updates, noops: plan.noops },
      };
      return requireConfirm(args.confirm, exec, client, async () => {
        const report = await runBatch(
          [
            ...plan.creates.map((b, i) => ({ id: `create:${str(b.serialNumber) || `#${i + 1}`}`, run: (s?: AbortSignal) => client.post(base, b, s) })),
            ...plan.updates.map((u) => ({ id: `update:${u.id}`, run: (s?: AbortSignal) => client.patch(`${base}/${seg(u.id)}`, u.body, s) })),
          ],
          ctx,
        );
        return { status: 200, data: report };
      }, destructiveGuard("bulk_upsert_account_devices", exec, ctx)).then(okOrInput);
    },
  );
}
