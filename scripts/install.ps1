<#
.SYNOPSIS
  Instala gavriel (CLI + servidor MCP en un solo ejecutable) en Windows, sin admin ni Node.

.DESCRIPTION
  Descarga gavriel-win32-<arch>.exe de la última release, verifica su SHA-256, lo instala en
  %LOCALAPPDATA%\Programs\Gavriel, lo agrega al PATH del usuario y, opcionalmente, registra el MCP
  en Claude Desktop / Codex / OpenCode.

  Una línea:  irm https://raw.githubusercontent.com/mateo-404/gavriel-mcp/main/scripts/install.ps1 | iex
  Variables:  GAVRIEL_REGISTER (ej: all | desktop,codex,opencode), GAVRIEL_INSTALL_DIR, GAVRIEL_BASE_URL

.PARAMETER Register   Clientes MCP donde registrar (desktop, codex, opencode, code, all). Requiere haber hecho `gavriel login`.
.PARAMETER Dir        Carpeta de instalación.
.PARAMETER BaseUrl    Origen de los binarios (por defecto, la última release de GitHub).
.PARAMETER NoPath     No modificar el PATH.
.PARAMETER Uninstall  Desinstalar en vez de instalar.
#>
[CmdletBinding()]
param(
  [string]$Register = $env:GAVRIEL_REGISTER,
  [string]$Dir = $env:GAVRIEL_INSTALL_DIR,
  [string]$BaseUrl = $(if ($env:GAVRIEL_BASE_URL) { $env:GAVRIEL_BASE_URL } else { 'https://github.com/mateo-404/gavriel-mcp/releases/latest/download' }),
  [switch]$NoPath,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest es mucho más rápido sin la barra

$arch = switch ($env:PROCESSOR_ARCHITECTURE) { 'ARM64' { 'arm64' } default { 'x64' } }
$name = "gavriel-win32-$arch.exe"
$work = Join-Path ([IO.Path]::GetTempPath()) ("gavriel-install-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null

try {
  $exe = Join-Path $work $name
  Write-Host "> Descargando $name..."
  Invoke-WebRequest -Uri "$BaseUrl/$name" -OutFile $exe -UseBasicParsing
  Invoke-WebRequest -Uri "$BaseUrl/$name.sha256" -OutFile "$exe.sha256" -UseBasicParsing

  $expected = ((Get-Content "$exe.sha256" -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 $exe).Hash.ToLowerInvariant()
  if ($expected -ne $actual) { throw "SHA-256 no coincide (esperado $expected, obtenido $actual): no se instala." }
  Write-Host "OK SHA-256 verificado"

  $cliArgs = @(if ($Uninstall) { 'uninstall' } else { 'install' }, '--yes')
  if ($Dir) { $cliArgs += @('--dir', $Dir) }
  if ($NoPath) { $cliArgs += '--no-path' }
  if ($Register -and -not $Uninstall) { $cliArgs += @('--register', $Register) }
  & $exe @cliArgs
  if ($LASTEXITCODE -ne 0) { throw "gavriel termino con codigo $LASTEXITCODE" }
}
finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
