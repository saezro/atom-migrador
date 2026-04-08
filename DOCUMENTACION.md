# Migrador Dropbox → Google Shared Drive

Herramienta de escritorio (PowerShell + WinForms) para migrar archivos de Dropbox a Google Shared Drives usando **rclone** como motor de transferencia.

---

## Requisitos

| Componente | Notas |
|---|---|
| Windows 10/11 | Probado en Win 11 |
| PowerShell 5.1+ | Incluido en Windows |
| rclone | Se instala automáticamente desde la app |

---

## Cómo ejecutar

```bat
powershell -ExecutionPolicy Bypass -File .\Migrar-GUI.ps1
```

O simplemente doble clic en **`Abrir-Migrador.bat`**.

---

## Estructura de archivos

```
Migrador/
├── Migrar-GUI.ps1          # Aplicación principal
├── Abrir-Migrador.bat      # Lanzador
├── envMigracion.json       # Config guardada (auto-generada)
└── logs_YYYYMMDD_HHMMSS/   # Carpetas de log por sesión (auto-generadas)
    └── mig_HHmmss.log
```

---

## Flujo de uso

### Página 0 — Requisitos
- Detecta si rclone está instalado.
- Si no está, lo instala vía `winget` o descarga directa desde `rclone.org`.
- Muestra la versión detectada.

### Página 1 — Cuentas
1. **Conectar Dropbox**: lanza `rclone authorize dropbox` en segundo plano, abre el navegador, espera a que el usuario autorice y guarda el token automáticamente.
2. **Conectar Google Drive**: ídem con `rclone authorize drive`.
3. **Verificar conexiones**: comprueba que ambos remotes existen en la config de rclone.

### Página 2 — Migrar
- Navegar la estructura de carpetas de Dropbox (origen).
- Seleccionar una Shared Drive de Google (destino).
- Configurar subcarpeta de destino, banda ancha y número de transferencias paralelas.
- Opción de **dry-run** (simulación sin mover nada).
- Iniciar / Detener migración con log en tiempo real y estadísticas.

---

## Arquitectura interna

### Estado global `$G`
```powershell
$G = @{
    RemoteDB  = "dropbox"   # nombre del remote rclone para Dropbox
    RemoteGD  = "gdrive"    # nombre del remote rclone para Google Drive
    CarpOrig  = ""          # carpeta origen seleccionada en Dropbox
    DriveID   = ""          # ID de la Shared Drive destino
    DriveNom  = ""          # nombre display de la Shared Drive
    Drives    = @()         # lista de Shared Drives disponibles
    PilaDB    = Stack       # historial de navegación en Dropbox
    RutaDB    = ""          # ruta actual en el explorador Dropbox
    Proc      = $null       # proceso rclone sync en curso
    RcPath    = ""          # ruta al ejecutable rclone
    LogDir    = "..."       # directorio de logs de esta sesión
    EnvFile   = "..."       # ruta al JSON de config guardada
}
```

### Funciones principales

| Función | Descripción |
|---|---|
| `FindRC` | Busca rclone en PATH, carpeta del script y rutas comunes |
| `RC` | Wrapper para ejecutar rclone con los args dados |
| `GetRemotes` | Lista los remotes configurados en rclone |
| `GetDBFolders` | Lista subcarpetas de una ruta en Dropbox |
| `GetDrives` | Lista las Shared Drives de la cuenta de Google |
| `LoadDB` | Carga el explorador de carpetas de Dropbox |
| `SaveEnv` | Guarda `RemoteDB` y `RemoteGD` en `envMigracion.json` |
| `LoadEnv` | Carga config guardada al iniciar |
| `StartOAuth` | Ejecuta el flujo OAuth para Dropbox o Google Drive |
| `CheckReady` | Habilita el botón de migración cuando hay origen y destino |
| `UpdStats` | Parsea líneas de log de rclone y actualiza las tarjetas de stats |

### Paleta de colores

| Variable | Color | Uso |
|---|---|---|
| `$C0` | `#0C0C10` | Fondo principal |
| `$C1` | `#14141A` | Paneles |
| `$C2` | `#1E1E28` | Controles |
| `$OR` | `#FF8C00` | Naranja principal (acento) |
| `$GR` | `#3CBE5A` | Verde OK |
| `$RD` | `#DC4141` | Rojo error |
| `$AM` | `#DCAF28` | Amber advertencia |
| `$MT` | `#6E6E82` | Texto secundario |

---

## Flujo OAuth (detalle técnico)

```
Usuario pulsa "Conectar Dropbox"
    │
    ├─ Kill rclone headless anteriores (sin ventana)
    │
    ├─ Lanza: rclone authorize dropbox
    │   (redirige stdout + stderr a StringBuilder $buf)
    │
    ├─ Timer cada 1 segundo comprueba HasExited
    │   │
    │   └─ Proceso terminó?
    │       ├─ WaitForExit(3000) → asegura que el buffer async esté completo
    │       ├─ Busca JSON de token en $buf con regex
    │       │
    │       ├─ Token encontrado?
    │       │   ├─ rclone config create <nombre> dropbox token <tok>
    │       │   └─ Marca como conectado
    │       │
    │       └─ Sin token?
    │           └─ GetRemotes() → ¿ya estaba configurado?
    │               ├─ Sí → marca conectado
    │               └─ No → muestra error
    │
    └─ Habilita "Ir a Migrar" si ambos remotes están listos
```

### Regex de extracción de token

```
(?s)(\{"access_token".+?"expiry"\s*:\s*"[^"]+"\})   # formato completo
(?s)(\{[^{}]*"access_token"[^{}]*\})                  # formato simplificado
```

---

## Parámetros de rclone sync

La migración usa estos flags optimizados para millones de archivos:

| Flag | Valor | Motivo |
|---|---|---|
| `--transfers` | 16 (configurable) | Transferencias paralelas |
| `--checkers` | transfers × 2.5 | Verificaciones paralelas |
| `--drive-batch-mode` | async | Reduce API calls |
| `--drive-batch-size` | 100 | Lotes de 100 ops |
| `--fast-list` | — | Menos API calls al listar |
| `--retries` | 10 | Reintentos ante errores |
| `--low-level-retries` | 20 | Reintentos de bajo nivel |
| `--drive-chunk-size` | 16M | Tamaño de chunk de upload |
| `--ignore-errors` | — | Continúa ante errores |
| `--stats` | 5s | Estadísticas cada 5s |
| `--no-update-modtime` | — | No actualiza fecha de modificación |

---

## Bugs corregidos

### Bug principal: app se cerraba al completar login en Dropbox (y potencialmente en migración)

**Causa raíz confirmada** (Windows Error Reporting, EventID 1001):
```
P3: Management.Automation.PSInvalidOperation
P5: Management.Automation.ScriptBlock.GetContextFromTLS
```

Los eventos `OutputDataReceived` y `ErrorDataReceived` de `System.Diagnostics.Process` disparan en **hilos del ThreadPool** de .NET. Cuando PowerShell intenta ejecutar un script block en uno de esos hilos, llama a `ScriptBlock.GetContextFromTLS()` para obtener el contexto de ejecución, pero el contexto solo existe en el hilo principal → `PSInvalidOperationException` no capturada en un hilo secundario → el runtime termina el proceso entero → la ventana se cierra.

Este bug afectaba a **dos sitios**:
1. **OAuth** (`StartOAuth`): `$ap.BeginOutputReadLine()` / `$ap.BeginErrorReadLine()`
2. **Migración** (`$btnGo`): `$G.Proc.BeginOutputReadLine()` / `$G.Proc.BeginErrorReadLine()`

#### Fix OAuth: reemplazar async I/O por `Start-Job`

```powershell
# ANTES — script blocks en hilos del ThreadPool → crash
$ap.add_OutputDataReceived({param($s,$e);if($e.Data){[void]$buf.AppendLine($e.Data)}})
$ap.add_ErrorDataReceived({ param($s,$e);if($e.Data){[void]$buf.AppendLine($e.Data)}})
$ap.Start()|Out-Null; $ap.BeginOutputReadLine(); $ap.BeginErrorReadLine()

# DESPUÉS — Start-Job crea un proceso PowerShell separado; el output
# se recoge con Receive-Job desde el hilo UI (timer tick) → seguro
$job=Start-Job -ScriptBlock {param($rc,$be); & $rc authorize $be 2>&1} -ArgumentList $rcPath,$backend
$at.add_Tick({
    if($job.State -notin @("Completed","Failed","Stopped")){return}
    $out=(Receive-Job $job) -join "`n"
    ...procesamiento del token en el hilo UI...
})
```

#### Fix Migración: tailear el log file desde el timer

```powershell
# ANTES — mismo problema de ThreadPool
$G.Proc.add_OutputDataReceived({...BeginOutputReadLine...})

# DESPUÉS — no redirigir stdout/stderr; rclone ya escribe todo al log file
# via --log-file. El timer lee solo las líneas nuevas cada 2 segundos desde el hilo UI.
$migSt=@{Lines=0}
$t.add_Tick({
    $all=[System.IO.File]::ReadAllLines($lf)
    if($all.Count -gt $migSt.Lines){
        $nuevas=$all[$migSt.Lines..($all.Count-1)]
        $migSt.Lines=$all.Count
        foreach($ln in $nuevas){LogLine $ln; UpdStats $ln}
    }
})
```

### Bug secundario: `Start-Sleep` en el hilo UI

**Causa**: `Start-Sleep -Milliseconds 700` (al iniciar OAuth) y `Start-Sleep -Milliseconds 400` (dentro del timer tick) bloqueaban el hilo principal de WinForms haciendo la app irresponsiva.

**Fix**: ambos `sleep` eliminados. El timing necesario se resuelve mediante el polling del timer y `Start-Job`.

### Bug terciario: kill de todos los procesos rclone

**Causa**: `Stop-Process` mataba **todos** los procesos rclone al iniciar OAuth, lo que podría interrumpir migraciones en curso.

**Fix**: filtrar solo procesos sin ventana (headless):
```powershell
Get-Process -Name "rclone" -EA SilentlyContinue |
    Where-Object {$_.MainWindowHandle -eq [IntPtr]::Zero} |
    Stop-Process -Force -EA SilentlyContinue
```

---

## Warnings conocidos (inofensivos)

| Variable | Motivo |
|---|---|
| `$OL` | Color naranja claro definido pero no usado en la UI actual |
| `$stW`, `$stGap` | Variables de layout de las tarjetas de stats, calculadas pero aplicadas inline |

---

## Configuración guardada

`envMigracion.json` — se crea automáticamente al conectar las cuentas:

```json
{
    "RemoteDB": "dropbox",
    "RemoteGD": "gdrive"
}
```

Al arrancar, si el archivo existe y ambos remotes están configurados en rclone, la app salta directamente a la página de Migrar.
