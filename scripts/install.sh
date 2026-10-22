#!/usr/bin/env sh
# Instala gavriel (CLI + servidor MCP en un solo ejecutable) en Linux/macOS, sin sudo ni Node.
# Descarga el binario de la última release, verifica su SHA-256 y ejecuta `gavriel install`.
#
#   curl -fsSL https://raw.githubusercontent.com/mateo-404/gavriel-mcp/main/scripts/install.sh | sh
#   curl -fsSL .../install.sh | GAVRIEL_REGISTER=codex,opencode sh
#
# Variables: GAVRIEL_REGISTER (all | desktop,codex,opencode,code), GAVRIEL_INSTALL_DIR, GAVRIEL_BASE_URL,
#            GAVRIEL_UNINSTALL=1
set -eu

BASE_URL="${GAVRIEL_BASE_URL:-https://github.com/mateo-404/gavriel-mcp/releases/latest/download}"

case "$(uname -s)" in
  Linux) PLAT=linux ;;
  Darwin) PLAT=darwin ;;
  *) echo "✘ Sistema no soportado: $(uname -s) (en Windows usá scripts/install.ps1)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64 | amd64) ARCH=x64 ;;
  arm64 | aarch64) ARCH=arm64 ;;
  *) echo "✘ Arquitectura no soportada: $(uname -m)" >&2; exit 1 ;;
esac
NAME="gavriel-$PLAT-$ARCH"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM

echo "› Descargando $NAME…"
curl -fsSL "$BASE_URL/$NAME" -o "$WORK/$NAME"
curl -fsSL "$BASE_URL/$NAME.sha256" -o "$WORK/$NAME.sha256"

EXPECTED="$(cut -d' ' -f1 "$WORK/$NAME.sha256")"
if command -v sha256sum >/dev/null 2>&1; then ACTUAL="$(sha256sum "$WORK/$NAME" | cut -d' ' -f1)"; else ACTUAL="$(shasum -a 256 "$WORK/$NAME" | cut -d' ' -f1)"; fi
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "✘ SHA-256 no coincide (esperado $EXPECTED, obtenido $ACTUAL): no se instala." >&2
  exit 1
fi
echo "✔ SHA-256 verificado"
chmod +x "$WORK/$NAME"

if [ "${GAVRIEL_UNINSTALL:-}" = "1" ]; then
  set -- uninstall --yes
else
  set -- install --yes
  [ -n "${GAVRIEL_REGISTER:-}" ] && set -- "$@" --register "$GAVRIEL_REGISTER"
fi
[ -n "${GAVRIEL_INSTALL_DIR:-}" ] && set -- "$@" --dir "$GAVRIEL_INSTALL_DIR"
"$WORK/$NAME" "$@"
