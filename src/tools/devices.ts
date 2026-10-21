import type { GavrielClient } from "../gavrielClient.js";
import { ok, buildBody } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { requireConfirm, confirmSchema, seg, destructiveGuard, okOrInput } from "./writeHelpers.js";
import { registerTool, type Role } from "./roles.js";

export function registerDeviceTools(server: McpServer, client: GavrielClient, role: Role): void {
  // --- Brands ---
  registerTool(
    server, role, "full", "create_device_brand",
    {
      title: "Crear marca de dispositivo (ESCRITURA)",
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
      title: "Actualizar marca de dispositivo (ESCRITURA)",
      description: "PATCH /device-brands/{id}. Requiere confirm: true.",
      inputSchema: {
        brandId: z.string(),
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
      title: "Eliminar marca de dispositivo (ESCRITURA)",
      description: "DELETE /device-brands/{id}. Requiere confirm: true.",
      inputSchema: { brandId: z.string(), confirm: confirmSchema },
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
      title: "Crear modelo de dispositivo (ESCRITURA)",
      description: "POST /device-models. Requiere confirm: true.",
      inputSchema: {
        name: z.string().min(1),
        description: z.string().optional(),
        isActive: z.boolean().optional().describe("Default: true"),
        deviceBrandId: z.string().describe("ID de la marca"),
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
      title: "Actualizar modelo de dispositivo (ESCRITURA)",
      description: "PATCH /device-models/{id}. Requiere confirm: true.",
      inputSchema: {
        modelId: z.string(),
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
      title: "Eliminar modelo de dispositivo (ESCRITURA)",
      description: "DELETE /device-models/{id}. Requiere confirm: true.",
      inputSchema: { modelId: z.string(), confirm: confirmSchema },
      annotations: { destructiveHint: true },
    },
    async (args, ctx) => {
      const exec = { tool: "delete_device_model", method: "DELETE", path: `/device-models/${seg(args.modelId)}`, params: {} };
      return requireConfirm(args.confirm, exec, client, () => client.delete(`/device-models/${seg(args.modelId)}`), destructiveGuard("delete_device_model", exec, ctx)).then(okOrInput);
    },
  );

  // --- Devices (per account) ---
  registerTool(
    server, role, "full", "create_device",
    {
      title: "Crear dispositivo en cuenta (ESCRITURA)",
      description: "POST /accounts/{accountId}/devices. Requiere confirm: true.",
      inputSchema: {
        accountId: z.string(),
        serialNumber: z.string().min(1).optional().describe("Omitir si el equipo no tiene serie"),
        deviceBrandId: z.string(),
        deviceModelId: z.string().optional().describe("Omitir si el modelo no existe en el catálogo"),
        chip1: z.string().optional(),
        deviceConnectionTypeId: z.string().optional(),
        alertType: z.string().optional().describe("Sonora | Silenciosa"),
        ownershipType: z.enum(["alquiler", "comodato"]).optional(),
        chip2: z.string().optional(),
        imei: z.string().optional(),
        zoneId: z.string().optional(),
        deviceKindId: z.string().optional(),
        deviceTaxonomyId: z.string().optional(),
        cloudDeviceId: z.string().optional(),
        cloudChannelNo: z.number().int().optional(),
        hppDeviceCategory: z.string().optional(),
        hppDeviceSubCategory: z.string().optional(),
        cloudLiveViewVerification: z.string().optional().describe("Código de verificación live view (se guarda cifrado en Gavriel)"),
        clearCloudLiveViewSecret: z.boolean().optional(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, {
        required: ["deviceBrandId"],
        optional: ["serialNumber", "deviceModelId", "chip1", "deviceConnectionTypeId", "alertType", "ownershipType", "chip2", "imei", "zoneId", "deviceKindId", "deviceTaxonomyId", "cloudDeviceId", "cloudChannelNo", "hppDeviceCategory", "hppDeviceSubCategory", "cloudLiveViewVerification", "clearCloudLiveViewSecret"],
      });
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
      title: "Actualizar dispositivo (ESCRITURA)",
      description: "PATCH /accounts/{accountId}/devices/{deviceId}. Requiere confirm: true.",
      inputSchema: {
        accountId: z.string(),
        deviceId: z.string(),
        serialNumber: z.string().optional(),
        chip1: z.string().optional(),
        deviceConnectionTypeId: z.string().optional(),
        deviceModelId: z.string().optional(),
        clearChip1: z.boolean().optional().describe("true = enviar chip1: null"),
        clearChip2: z.boolean().optional().describe("true = enviar chip2: null"),
        alertType: z.string().optional().describe("Sonora | Silenciosa"),
        ownershipType: z.enum(["alquiler", "comodato"]).optional(),
        chip2: z.string().optional(),
        imei: z.string().optional(),
        zoneId: z.string().optional(),
        deviceKindId: z.string().optional(),
        deviceTaxonomyId: z.string().optional(),
        cloudDeviceId: z.string().optional(),
        cloudChannelNo: z.number().int().optional(),
        hppDeviceCategory: z.string().optional(),
        hppDeviceSubCategory: z.string().optional(),
        cloudLiveViewVerification: z.string().optional().describe("Código de verificación live view (se guarda cifrado en Gavriel)"),
        clearCloudLiveViewSecret: z.boolean().optional(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, {
        optional: ["serialNumber", "chip1", "deviceConnectionTypeId", "deviceModelId", "alertType", "ownershipType", "chip2", "imei", "zoneId", "deviceKindId", "deviceTaxonomyId", "cloudDeviceId", "cloudChannelNo", "hppDeviceCategory", "hppDeviceSubCategory", "cloudLiveViewVerification", "clearCloudLiveViewSecret"],
      });
      if (args.clearChip1) body.chip1 = null;
      if (args.clearChip2) body.chip2 = null;
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
      title: "Eliminar dispositivo (ESCRITURA)",
      description: "DELETE /accounts/{accountId}/devices/{deviceId}. Requiere confirm: true.",
      inputSchema: { accountId: z.string(), deviceId: z.string(), confirm: confirmSchema },
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
      title: "Crear usuario de alarma en cuenta existente (ESCRITURA)",
      description: "POST /account-users. Asigna un usuario de la alarma (código + nombre) a una cuenta que YA existe. Requiere confirm: true.",
      inputSchema: {
        accountId: z.string(),
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
    deviceBrandId: z.string().optional(),
    deviceModelId: z.string().optional(),
  };
  const zoneKeys = Object.keys(zoneFields);

  registerTool(
    server, role, "full", "create_zone",
    {
      title: "Crear zona en cuenta existente (ESCRITURA)",
      description: "POST /zones. Crea una zona en una cuenta que YA existe. Requiere confirm: true.",
      inputSchema: { accountId: z.string(), ...zoneFields, confirm: confirmSchema },
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
      title: "Actualizar zona (ESCRITURA)",
      description: "PATCH /zones/{zoneId}. Requiere confirm: true.",
      inputSchema: {
        zoneId: z.string(),
        code: z.string().optional(),
        name: z.string().optional(),
        ...Object.fromEntries(Object.entries(zoneFields).filter(([k]) => k !== "code" && k !== "name")),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, { optional: zoneKeys });
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
      description: "POST /accounts/{accountId}/devices/hik-cloud-lookup. Devuelve cloudDeviceId, deviceTaxonomyId y categoría HPP. Requiere confirm: true.",
      inputSchema: {
        accountId: z.string(),
        deviceBrandId: z.string(),
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
      ).then(ok);
    },
  );
}
