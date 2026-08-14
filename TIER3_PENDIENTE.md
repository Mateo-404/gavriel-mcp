# Tier 3 — Endpoints inventariados y NO implementados

Inventario de endpoints del bundle de `app.gavriel.com.ar` que se **documentan
pero no se implementan** en esta fase. Criterio: DELETE, gestión de
usuarios/roles/permisos, activación/desactivación de monitoreo, configuración
de facturación/órdenes, catálogos globales y operaciones de archivos.

Nada de esta tabla se implementa sin instrucción explícita posterior.

## Borrados (DELETE)

| Método | Path | Qué hace |
|---|---|---|
| DELETE | `/tickets/{id}` | Elimina ticket |
| DELETE | `/activities/{id}` | Elimina actividad (más abajo: restore/soft-delete) |
| DELETE | `/account-contacts/{id}` | Elimina contacto de cuenta |
| DELETE | `/account-users/{id}` | Quita usuario de cuenta |
| DELETE | `/accounts/{id}/devices/{id}` | Elimina dispositivo de la cuenta |
| DELETE | `/accounts/{id}/devices/{id}/accesses/{id}` | Elimina acceso de dispositivo |
| DELETE | `/accounts/{id}/devices/{id}/hpp-preview-sessions` | Cierra sesiones de preview |
| DELETE | `/zones/{id}` | Elimina zona |
| DELETE | `/partitions/{id}` y `/partitions/{id}/{contacts,users,zones}/{id}` | Elimina partición / asociaciones |
| DELETE | `/connections/{id}` | Elimina conexión |
| DELETE | `/bridges/{id}` | Elimina bridge |
| DELETE | `/companies/{id}`, `/companies/{id}/integration-credentials/{id}`, `/companies/{id}/non-working-days/{id}` | Elimina empresa / credencial / día no laboral |
| DELETE | `/users/{id}`, `/users/{id}/non-working-days/{id}` | Elimina usuario / día no laboral |
| DELETE | `/events-types/{id}`, `/events-codes/{id}`, `/events-formats/{id}`, `/events-types/{id}/codes/{id}` | Elimina catálogo de eventos |
| DELETE | `/device-brands/{id}`, `/device-models/{id}`, `/device-connection-types/{id}` | Elimina catálogo de dispositivos |
| DELETE | `/protocols/{id}`, `/intervention-categories/{id}`, `/jurisdictions/{id}` | Elimina catálogo |
| DELETE | `/useful-contacts/{id}` | Elimina contacto útil |
| DELETE | `/files/{id}` | Elimina archivo |
| DELETE | `/integrations/hpp-media/sessions/{id}` | Cierra sesión HPP |
| DELETE | `/services/{id}` | Elimina servicio |

## Gestión de usuarios, roles y permisos

| Método | Path | Qué hace | Riesgo |
|---|---|---|---|
| POST | `/users` | Crea usuario (password, roleId) | Alta de usuario |
| PATCH | `/users/{id}` | Modifica usuario (email, password, blocked, roleId, empresas) | Permisos/estado |
| POST | `/users/{id}/reset-otp` | Deshabilita el 2FA de un usuario | Seguridad |
| POST | `/auth/register` | Registro | Alta de usuario |
| POST | `/auth/2fa/setup`, `/auth/2fa/enable`, `/auth/2fa/disable` | Gestión de 2FA | Seguridad |
| POST | `/account-users` | Vincula usuario a cuenta con rol (`operator`/`owner`) | Roles |
| PATCH | `/account-users/{id}` | Cambia rol/descripción de usuario de cuenta | Roles |
| GET | `/roles` | (sí se implementó como lectura: `list_roles`) | — |

## Monitoreo: alta/baja y activación de infraestructura

| Método | Path | Qué hace | Riesgo |
|---|---|---|---|
| POST | `/accounts/{id}/devices` | Da de alta un dispositivo de monitoreo | Afecta qué se monitorea |
| PATCH | `/accounts/{id}/devices/{id}` | Edita dispositivo (serial, chips, alertType, ownership) | Afecta monitoreo |
| POST | `/accounts/{id}/devices/{id}/accesses` | Alta de acceso a dispositivo | Credenciales de dispositivo |
| PATCH | `/accounts/{id}/devices/{id}/accesses/{id}` | Edita acceso | Credenciales de dispositivo |
| POST | `/accounts/{id}/devices/hik-cloud-lookup` | Lookup de dispositivo Hikvision | Solo consulta, pero es POST |
| POST | `/accounts/{id}/devices/{id}/hpp-preview-session` | Inicia preview HLS | Sesión de vídeo |
| POST | `/accounts/{id}/devices/{id}/cloud-live-view-verification-*` | Verificación de live view | Sesión de vídeo |
| POST | `/accounts/{id}/partitions` | Crea partición (estructura de zonas monitoreadas) | Config. monitoreo |
| PUT | `/partitions/{id}` | Edita partición (zonas/usuarios/contactos asociados) | Config. monitoreo |
| POST | `/partitions/{id}/{zones,users,contacts}` | Asocia elemento a partición | Config. monitoreo |
| POST | `/zones` | Crea zona (sensorType, zoneType, device...) | Config. monitoreo |
| PATCH | `/zones/{id}` | Edita zona | Config. monitoreo |
| PATCH | `/bridges/{id}` | Edita bridge (ip, httpPort, token) | Infraestructura |
| PATCH | `/bridges/toggle-activation/{id}` | Activa/desactiva bridge | **Infraestructura crítica** |
| POST | `/bridges/{id}/restart` | Reinicia bridge | **Infraestructura crítica** |
| POST | `/bridges/{id}/cleanup` | Limpia disco del bridge | Operación destructiva |
| PATCH | `/connections/{id}` | Edita conexión (ip, port, activated, heartbeat, formats, bridge, protocol) | **Config. de recepción de alarmas** |

## Facturación / órdenes (CMS legado)

| Método | Path | Qué hace |
|---|---|---|
| POST | `/orders` | Crea orden de servicio/facturación |
| PUT | `/orders/{id}` | Edita orden |
| POST | `/orders-products` | Asocia producto a orden |
| PUT | `/orders-products/{id}` | Edita producto de orden |
| POST | `/posts` | Comentario en orden |

## Catálogos globales (configuración admin)

| Método | Path | Qué hace |
|---|---|---|
| POST/PATCH/DELETE | `/device-brands`, `/device-models`, `/device-connection-types` | CRUD de marcas/modelos/tipos |
| POST/PATCH/DELETE | `/events-types`, `/events-codes`, `/events-formats` | CRUD de catálogo de eventos |
| POST | `/events-types/{id}/codes` | Agrega código a tipo de evento |
| PATCH/DELETE | `/protocols`, `/intervention-categories` | CRUD de protocolos/categorías |
| PATCH | `/intervention-categories/{id}/deactivate` | Desactiva categoría |
| PATCH/DELETE | `/jurisdictions` | CRUD de jurisdicciones |
| PATCH | `/file-storage/{id}` | Asocia archivo a entidad |
| POST | `/files/upload`, `/files/upload-url`, `/files/confirm-upload` | Subida de archivos |

## Empresas (configuración)

| Método | Path | Qué hace | Riesgo |
|---|---|---|---|
| POST | `/companies` | Crea empresa (is_technical/is_monitoring) | Afecta empresas que monitorean |
| PATCH | `/companies/{id}` | Edita empresa (incluye flags de monitoreo) | Afecta monitoreo |
| POST/PATCH/DELETE | `/companies/{id}/integration-credentials...` | Credenciales de integración Hik/Dahua | Credenciales externas |

## Actividades: variantes de borrado/telemetría

| Método | Path | Qué hace |
|---|---|---|
| PATCH | `/activities/{id}/restore` | Restaura actividad borrada |
| PATCH | `/activities/{id}/soft-delete` | Borrado lógico de actividad |
| POST | `/activities/upload-file` | Adjunta archivos a una actividad |

## Baja valor (telemetría de clicks, decidir si vale la pena)

| Método | Path | Qué hace |
|---|---|---|
| POST | `/accounts/{id}/contact` | Registra click de llamada/WhatsApp a un contacto |
| POST | `/accounts/{id}/contact-email` | Registra click de email a un contacto |

## Bulk de eventos — NO confirmado

`mark_events_processed` marca N eventos con N `PATCH /events/{id}` seriales
(la cola del cliente ya serializa). No se encontró un endpoint bulk de
eventos (`/events/bulk`, `/events/process`, etc.) en el inventario del bundle
ni en la documentación disponible en este entorno. **No se implementa por
adivinación** (regla AGENTS 4). Si al acceder al bundle del frontend aparece
el endpoint, reemplazar el loop serial por una sola llamada.
