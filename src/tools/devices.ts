import type { GavrielClient } from "../gavrielClient.js";
import { ok, err, buildBody, wrapReadOnly } from "./shared.js";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { requireConfirm, confirmSchema } from "./writeHelpers.js";
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
        { tool: "update_device_brand", method: "PATCH", path: `/device-brands/${args.brandId}`, params: body },
        client,
        () => client.patch(`/device-brands/${args.brandId}`, body),
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
    async (args) => {
      return requireConfirm(
        args.confirm,
        { tool: "delete_device_brand", method: "DELETE", path: `/device-brands/${args.brandId}`, params: {} },
        client,
        () => client.delete(`/device-brands/${args.brandId}`),
      ).then(ok);
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
        { tool: "update_device_model", method: "PATCH", path: `/device-models/${args.modelId}`, params: body },
        client,
        () => client.patch(`/device-models/${args.modelId}`, body),
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
    async (args) => {
      return requireConfirm(
        args.confirm,
        { tool: "delete_device_model", method: "DELETE", path: `/device-models/${args.modelId}`, params: {} },
        client,
        () => client.delete(`/device-models/${args.modelId}`),
      ).then(ok);
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
        serialNumber: z.string().min(1),
        deviceBrandId: z.string(),
        deviceModelId: z.string(),
        chip1: z.string().optional(),
        deviceConnectionTypeId: z.string().optional(),
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, {
        required: ["serialNumber", "deviceBrandId", "deviceModelId"],
        optional: ["chip1", "deviceConnectionTypeId"],
      });
      return requireConfirm(
        args.confirm,
        { tool: "create_device", method: "POST", path: `/accounts/${args.accountId}/devices`, params: body },
        client,
        () => client.post(`/accounts/${args.accountId}/devices`, body),
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
        confirm: confirmSchema,
      },
    },
    async (args) => {
      const body = buildBody(args as Record<string, unknown>, {
        optional: ["serialNumber", "chip1", "deviceConnectionTypeId"],
      });
      return requireConfirm(
        args.confirm,
        { tool: "update_device", method: "PATCH", path: `/accounts/${args.accountId}/devices/${args.deviceId}`, params: body },
        client,
        () => client.patch(`/accounts/${args.accountId}/devices/${args.deviceId}`, body),
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
    async (args) => {
      return requireConfirm(
        args.confirm,
        { tool: "delete_device", method: "DELETE", path: `/accounts/${args.accountId}/devices/${args.deviceId}`, params: {} },
        client,
        () => client.delete(`/accounts/${args.accountId}/devices/${args.deviceId}`),
      ).then(ok);
    },
  );
}
