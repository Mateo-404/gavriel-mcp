import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, buildBody, idSchema } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { requireConfirm, confirmSchema, seg, destructiveGuard, okOrInput } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

export function registerDeviceTools(server: McpServer, client: GavrielClient, role: Role): void {
  // --- Brands ---
  registerTool(
    server, role, "full", "create_device_brand",
    {
      title: "Crear marca de dispositivo",
      description: "POST /device-brands. Requiere confirm: true.",
      inputSchema: {
        name: z.string().min(1),
        description: z.string().optional(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, { required: ["name"], optional: ["description"] });
      return requireConfirm(
        args.confirm,
        { tool: "create_device_brand", method: "POST", path: "/device-brands", params: body },
        client,
        () => client.post("/device-brands", body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "update_device_brand",
    {
      title: "Actualizar marca de dispositivo",
      description: "PATCH /device-brands/{id}. Requiere confirm: true.",
      inputSchema: {
        brandId: idSchema,
        name: z.string().optional(),
        description: z.string().optional(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, { optional: ["name", "description"] });
      return requireConfirm(
        args.confirm,
        { tool: "update_device_brand", method: "PATCH", path: `/device-brands/${seg(args.brandId)}`, params: body },
        client,
        () => client.patch(`/device-brands/${seg(args.brandId)}`, body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "delete_device_brand",
    {
      title: "Eliminar marca de dispositivo",
      description: "DELETE /device-brands/{id}. Requiere confirm: true.",
      inputSchema: { brandId: idSchema, confirm: confirmSchema },
      annotations: { destructiveHint: true },
    },
    async (args, ctx) => {
      const exec = { tool: "delete_device_brand", method: "DELETE", path: `/device-brands/${seg(args.brandId)}`, params: {} };
      return requireConfirm(args.confirm, exec, client, () => client.delete(`/device-brands/${seg(args.brandId)}`), destructiveGuard("delete_device_brand", exec, ctx)).then(okOrInput);
    },
  );

  // --- Models ---
  registerTool(
    server, role, "full", "create_device_model",
    {
      title: "Crear modelo de dispositivo",
      description: "POST /device-models. Requiere confirm: true.",
      inputSchema: {
        name: z.string().min(1),
        description: z.string().optional(),
        isActive: z.boolean().optional().describe("Default: true"),
        deviceBrandId: idSchema.describe("ID de la marca"),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, {
        required: ["name", "deviceBrandId"],
        optional: ["description", "isActive"],
      });
      return requireConfirm(
        args.confirm,
        { tool: "create_device_model", method: "POST", path: "/device-models", params: body },
        client,
        () => client.post("/device-models", body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "update_device_model",
    {
      title: "Actualizar modelo de dispositivo",
      description: "PATCH /device-models/{id}. Requiere confirm: true.",
      inputSchema: {
        modelId: idSchema,
        name: z.string().optional(),
        description: z.string().optional(),
        isActive: z.boolean().optional(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, { optional: ["name", "description", "isActive"] });
      return requireConfirm(
        args.confirm,
        { tool: "update_device_model", method: "PATCH", path: `/device-models/${seg(args.modelId)}`, params: body },
        client,
        () => client.patch(`/device-models/${seg(args.modelId)}`, body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "delete_device_model",
    {
      title: "Eliminar modelo de dispositivo",
      description: "DELETE /device-models/{id}. Requiere confirm: true.",
      inputSchema: { modelId: idSchema, confirm: confirmSchema },
      annotations: { destructiveHint: true },
    },
    async (args, ctx) => {
      const exec = { tool: "delete_device_model", method: "DELETE", path: `/device-models/${seg(args.modelId)}`, params: {} };
      return requireConfirm(args.confirm, exec, client, () => client.delete(`/device-models/${seg(args.modelId)}`), destructiveGuard("delete_device_model", exec, ctx)).then(okOrInput);
    },
  );

  // --- Devices (per account) ---
  const deviceFields = {
    serialNumber: z.string().min(1).optional().describe("Omitir si el equipo no tiene serie (sirenas, controles)"),
    zoneId: idSchema.optional().describe("Vincula el equipo a una zona"),
    deviceModelId: idSchema.optional().describe("Omitir si el modelo no existe en el catálogo"),
    deviceConnectionTypeId: idSchema.optional(),
    deviceKindId: idSchema.optional(),
    alertType: z.enum(["Sonora", "Silenciosa"]).optional(),
    ownershipType: z.enum(["alquiler", "comodato"]).optional(),
    chip1: z.string().optional(),
    chip2: z.string().optional(),
    imei: z.string().optional(),
    moduleBrand: z.string().optional(),
    moduleModel: z.string().optional(),
    cloudDeviceId: idSchema.optional(),
    hctCameraResourceId: z.string().optional(),
    cloudChannelNo: z.number().int().optional(),
    deviceTaxonomyId: idSchema.optional(),
    hppDeviceCategory: z.string().optional(),
    hppDeviceSubCategory: z.string().optional(),
    cloudLiveViewVerification: z.string().optional().describe("SECRETO: código de verificación de cámara/DVR (cifrado en Gavriel; se oculta en preview y logs)"),
    clearCloudLiveViewSecret: z.boolean().optional().describe("true = borrar el código guardado"),
  };
  const deviceKeys = Object.keys(deviceFields);
  // Campos que clear[] puede poner en null (el secreto se borra con clearCloudLiveViewSecret).
  const deviceClearable = deviceKeys.filter((k) => k !== "cloudLiveViewVerification" && k !== "clearCloudLiveViewSecret");

  /** Valida clear[] contra la whitelist; devuelve el error o null. */
  const checkClear = (clear: string[] | undefined, allowed: readonly string[]) => {
    const bad = (clear ?? []).filter((k) => !allowed.includes(k));
    return bad.length ? err(`clear: campos no permitidos: ${bad.join(", ")}. Permitidos: ${allowed.join(", ")}`) : null;
  };
  const clearField = z.array(z.string()).optional().describe('Nombres de campos a vaciar (se envían como null), p.ej. ["chip2"]. Solo campos editables de la tool.');

  registerTool(
    server, role, "full", "create_device",
    {
      title: "Crear dispositivo en cuenta",
      description: "POST /accounts/{accountId}/devices. Usar cuando haya que dar de alta un equipo (panel, sirena, cámara, DVR) en una cuenta. Solo deviceBrandId es obligatorio: serialNumber y deviceModelId son opcionales (accesorios sin serie). No usar para editar un equipo existente (update_device). cloudLiveViewVerification es secreto y se oculta en preview/logs. Requiere confirm: true.",
      inputSchema: { accountId: idSchema, deviceBrandId: idSchema, ...deviceFields, confirm: confirmSchema },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, { required: ["deviceBrandId"], optional: deviceKeys });
      return requireConfirm(
        args.confirm,
        { tool: "create_device", method: "POST", path: `/accounts/${seg(args.accountId)}/devices`, params: body },
        client,
        () => client.post(`/accounts/${seg(args.accountId)}/devices`, body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "update_device",
    {
      title: "Actualizar dispositivo",
      description: 'PATCH /accounts/{accountId}/devices/{deviceId}. Usar cuando haya que cambiar o vaciar campos de un equipo existente (serie, modelo, chips, zona, datos nube). Para vaciar un campo usar clear: ["chip2"] (envía null); el secreto live view se borra con clearCloudLiveViewSecret. No usar para crear (create_device) ni borrar (delete_device). Requiere confirm: true.',
      inputSchema: {
        accountId: idSchema,
        deviceId: idSchema,
        ...deviceFields,
        clear: clearField,
        clearChip1: z.boolean().optional().describe('Obsoleto: usar clear:["chip1"]'),
        clearChip2: z.boolean().optional().describe('Obsoleto: usar clear:["chip2"]'),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const clear = [...(args.clear ?? []), ...(args.clearChip1 ? ["chip1"] : []), ...(args.clearChip2 ? ["chip2"] : [])];
      const bad = checkClear(clear, deviceClearable);
      if (bad) return bad;
      const body = buildBody({ ...args, ...Object.fromEntries(clear.map((k) => [k, null])) } as Record<string, unknown>, { optional: deviceKeys, nullable: clear });
      return requireConfirm(
        args.confirm,
        { tool: "update_device", method: "PATCH", path: `/accounts/${seg(args.accountId)}/devices/${seg(args.deviceId)}`, params: body },
        client,
        () => client.patch(`/accounts/${seg(args.accountId)}/devices/${seg(args.deviceId)}`, body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "delete_device",
    {
      title: "Eliminar dispositivo",
      description: "DELETE /accounts/{accountId}/devices/{deviceId}. Requiere confirm: true.",
      inputSchema: { accountId: idSchema, deviceId: idSchema, confirm: confirmSchema },
      annotations: { destructiveHint: true },
    },
    async (args, ctx) => {
      const exec = { tool: "delete_device", method: "DELETE", path: `/accounts/${seg(args.accountId)}/devices/${seg(args.deviceId)}`, params: {} };
      return requireConfirm(args.confirm, exec, client, () => client.delete(`/accounts/${seg(args.accountId)}/devices/${seg(args.deviceId)}`), destructiveGuard("delete_device", exec, ctx)).then(okOrInput);
    },
  );

  registerTool(
    server, role, "full", "create_account_user",
    {
      title: "Crear usuario de alarma en cuenta existente",
      description: "POST /account-users. Asigna un usuario de la alarma (código + nombre) a una cuenta que YA existe. Requiere confirm: true.",
      inputSchema: {
        accountId: idSchema,
        code: z.string().min(1).describe("Número/código del usuario en el panel"),
        name: z.string().min(1),
        description: z.string().optional(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, {
        required: ["accountId", "code", "name"],
        optional: ["description"],
      });
      return requireConfirm(
        args.confirm,
        { tool: "create_account_user", method: "POST", path: "/account-users", params: body },
        client,
        () => client.post("/account-users", body),
      ).then(ok);
    },
  );

  const zoneFields = {
    code: z.string().min(1).describe("Número de zona"),
    name: z.string().min(1),
    sensorType: z.string().optional(),
    zoneType: z.string().optional(),
    connectionType: z.string().optional(),
    serialNumber: z.string().optional(),
    alertType: z.string().optional().describe("Sonora | Silenciosa"),
    deviceBrandId: idSchema.optional(),
    deviceModelId: idSchema.optional(),
  };
  const zoneKeys = Object.keys(zoneFields);

  registerTool(
    server, role, "full", "create_zone",
    {
      title: "Crear zona en cuenta existente",
      description: "POST /zones. Usar cuando haya que crear una zona en una cuenta que YA existe, opcionalmente con su equipo (serialNumber, deviceBrandId, deviceModelId). No usar para cuentas nuevas. Requiere confirm: true.",
      inputSchema: { accountId: idSchema, ...zoneFields, confirm: confirmSchema },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, { required: ["accountId", "code", "name"], optional: zoneKeys.filter((k) => k !== "code" && k !== "name") });
      return requireConfirm(
        args.confirm,
        { tool: "create_zone", method: "POST", path: "/zones", params: body },
        client,
        () => client.post("/zones", body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "update_zone",
    {
      title: "Actualizar zona",
      description: "PATCH /zones/{zoneId}. Usar cuando haya que editar una zona o vincularle un equipo (serialNumber, deviceBrandId, deviceModelId); clear:[...] vacía campos (null). No usar para crear zonas (create_zone). Requiere confirm: true.",
      inputSchema: {
        zoneId: idSchema,
        code: z.string().optional(),
        name: z.string().optional(),
        ...Object.fromEntries(Object.entries(zoneFields).filter(([k]) => k !== "code" && k !== "name")),
        clear: clearField,
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const bad = checkClear(args.clear, zoneKeys.filter((k) => k !== "code" && k !== "name"));
      if (bad) return bad;
      const clear = args.clear ?? [];
      const body = buildBody({ ...args, ...Object.fromEntries(clear.map((k) => [k, null])) } as Record<string, unknown>, { optional: zoneKeys, nullable: clear });
      return requireConfirm(
        args.confirm,
        { tool: "update_zone", method: "PATCH", path: `/zones/${seg(args.zoneId)}`, params: body },
        client,
        () => client.patch(`/zones/${seg(args.zoneId)}`, body),
      ).then(ok);
    },
  );

  registerTool(
    server, role, "full", "hik_cloud_lookup",
    {
      title: "Lookup nube Hikvision por serie (consulta)",
      description: "POST /accounts/{accountId}/devices/hik-cloud-lookup. Usar cuando haya que obtener cloudDeviceId, deviceTaxonomyId y categoría HPP de un equipo Hikvision por serie. Es un POST que consulta Hik-Partner Pro (efecto de solo lectura, pero llama a un servicio externo). Si la respuesta no trae deviceTaxonomyId se agrega `warnings`. No usar para modificar equipos. Requiere confirm: true.",
      inputSchema: {
        accountId: idSchema,
        deviceBrandId: idSchema,
        serialNumber: z.string().min(1),
        confirm: confirmSchema,
      },
      annotations: { idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, { required: ["deviceBrandId", "serialNumber"] });
      const path = `/accounts/${seg(args.accountId)}/devices/hik-cloud-lookup`;
      return requireConfirm(
        args.confirm,
        { tool: "hik_cloud_lookup", method: "POST", path, params: body },
        client,
        () => client.post(path, body),
      ).then((r) => ok(withTaxonomyWarning(r)));
    },
  );
}

/** Lookup encontrado pero sin deviceTaxonomyId: avisa (issue #31, faltan taxonomías en el catálogo del backend). */
export function withTaxonomyWarning(r: unknown): unknown {
  const res = r as { data?: Record<string, unknown> } | null;
  const d = res?.data;
  if (!d || typeof d !== "object" || d.found !== true || d.deviceTaxonomyId) return r;
  const warnings = [
    `La taxonomía no existe en el catálogo (categoría: ${d.deviceCategory ?? "?"}, subcategoría: ${d.deviceSubCategory ?? "?"}). ` +
    "Consultar list_catalog kind device-taxonomies y usar una taxonomía genérica de la categoría; hppDeviceCategory/hppDeviceSubCategory se pueden enviar igual.",
  ];
  return { ...res, warnings };
}
