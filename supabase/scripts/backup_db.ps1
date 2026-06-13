<#
  ╔════════════════════════════════════════════════════════════════════╗
  ║  backup_db.ps1 — Backup de la base de Hola Express (Supabase)        ║
  ║                                                                      ║
  ║  Genera un dump COMPRIMIDO del schema "public" (todos los datos del  ║
  ║  negocio: ventas, stock, finanzas, productos, RPCs, RLS, etc.) y     ║
  ║  borra automáticamente los backups más viejos que la retención.      ║
  ╚════════════════════════════════════════════════════════════════════╝

  REQUISITOS (una sola vez):

  1) Instalar pg_dump  (viene con PostgreSQL para Windows):
       https://www.postgresql.org/download/windows/
     Si no queda en el PATH, poné la ruta del bin en $PgBin más abajo
     (ej: "C:\Program Files\PostgreSQL\17\bin").

  2) Guardar la connection string de Supabase en una variable de entorno.
     Sacala de:  Dashboard → Database → Connect → "Session pooler" (IPv4, puerto 5432)
     Después corré (una vez), reemplazando los datos:

       setx SUPABASE_DB_URL "postgresql://postgres.[REF]:[PASSWORD]@aws-0-[region].pooler.supabase.com:5432/postgres"

     Cerrá y reabrí la terminal para que tome la variable.
     ⚠️ Usá el "Session pooler", NO el "Transaction pooler" (6543): pg_dump
        necesita sesión completa.

  USO MANUAL:
       powershell -ExecutionPolicy Bypass -File .\backup_db.ps1

  Este archivo NO contiene la contraseña (la lee del entorno), así que es
  seguro versionarlo. Los backups (.dump) NO deben subirse a git.
#>

# ── Configuración (ajustá a gusto) ─────────────────────────────────────
$CarpetaBackups = "C:\Backups\HolaExpress"   # para copia off-site, apuntá esto a tu carpeta de OneDrive/Google Drive
$RetencionDias  = 30                          # borra dumps más viejos que esto
$PgBin          = ""                          # ej: "C:\Program Files\PostgreSQL\17\bin" si pg_dump no está en el PATH
# Para incluir también los logins (auth.users), agregá "--schema=auth" a $args abajo.

# ── No hace falta editar de acá para abajo ─────────────────────────────
$ErrorActionPreference = "Stop"

$ConnString = $env:SUPABASE_DB_URL
if (-not $ConnString) {
  Write-Error "Falta la variable SUPABASE_DB_URL. Seteala con setx (ver encabezado)."
  exit 1
}

$pgDump = if ($PgBin) { Join-Path $PgBin "pg_dump.exe" } else { "pg_dump" }

if (-not (Test-Path $CarpetaBackups)) {
  New-Item -ItemType Directory -Path $CarpetaBackups -Force | Out-Null
}

$fecha   = Get-Date -Format "yyyy-MM-dd_HHmm"
$archivo = Join-Path $CarpetaBackups "hola_express_$fecha.dump"

Write-Host "Generando backup -> $archivo"
& $pgDump $ConnString --no-owner --no-acl --schema=public --format=custom --file=$archivo

if ($LASTEXITCODE -ne 0) {
  Write-Error "pg_dump fallo (codigo $LASTEXITCODE). No se rotaron backups viejos."
  exit $LASTEXITCODE
}

$tam = [math]::Round((Get-Item $archivo).Length / 1MB, 2)
Write-Host "OK - backup de $tam MB creado."

# Rotacion: borra los dumps mas viejos que la retencion
$limite = (Get-Date).AddDays(-$RetencionDias)
Get-ChildItem $CarpetaBackups -Filter "hola_express_*.dump" |
  Where-Object { $_.LastWriteTime -lt $limite } |
  ForEach-Object {
    Write-Host "Borrando backup viejo: $($_.Name)"
    Remove-Item $_.FullName -Force
  }

Write-Host "Listo."
