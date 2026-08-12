// Probe que corre en un proceso hijo separado para testear src/secrets.ts
// (ver scripts/selfcheck.mjs) con distintas combinaciones de PATH / env /
// archivos legacy. Hace falta un proceso nuevo por escenario porque
// hasSecretTool() cachea el resultado a nivel de módulo (secretToolChecked):
// dentro de un mismo proceso no se puede alternar disponibilidad de keyring.
import {
  resolvePassword,
  readTrustedToken,
  saveTrustedToken,
  clearTrustedToken,
} from "../../dist/secrets.js";

const [mode, email] = process.argv.slice(2);
let result;
switch (mode) {
  case "password":
    result = resolvePassword();
    break;
  case "token":
    result = readTrustedToken(email);
    break;
  case "save-token":
    saveTrustedToken(email, process.env.PROBE_TOKEN_VALUE ?? "");
    result = "saved";
    break;
  case "clear-token":
    clearTrustedToken(email);
    result = "cleared";
    break;
  default:
    throw new Error(`modo desconocido: ${mode}`);
}
process.stdout.write(JSON.stringify({ result }));
