# Atom Migrador — Dropbox → Google Shared Drive

Aplicación de escritorio (Electron + React) para migrar archivos de Dropbox a Google Shared Drives usando **rclone** como motor de transferencia. Incluye cola de trabajos persistente con verificación automática post-copia.

> La versión anterior (PowerShell + WinForms) sigue en el repo como referencia histórica (`Migrar-GUI.ps1`).

---

## Requisitos

| Componente | Notas |
|---|---|
| Windows 10/11 x64 | Probado en Win 11 |
| Atom Migrador Setup x.y.z.exe | Instalador NSIS — rclone ya va bundled |

rclone se incluye dentro del instalador (`resources/extra/rclone.exe`). No es necesario instalarlo por separado.

---

## Instalación

Ejecutar `Atom Migrador Setup x.y.z.exe` → Siguiente → Siguiente → Instalar.
Sin comandos, sin dependencias externas.

---

## Generar el instalador (desarrolladores)

```bat
cd app
npm run dist
```

Resultado: `app/dist/Atom Migrador Setup <version>.exe` (instalador NSIS, ~93 MB, sin firma).

Para publicar en GitHub Releases automáticamente:

```bat
npm run dist:gh
```

### Primer build en una máquina nueva

electron-builder descarga `winCodeSign` (herramientas de firma). En Windows sin Developer Mode activado, la extracción falla por falta de privilegio de symlinks (solo afecta a ficheros macOS del paquete, que no se usan). Fix único manual:

```bat
:: Ejecutar una vez, como administrador o con Developer Mode activo:
:: Copiar la carpeta temporal extraída al nombre esperado
xcopy /E /I "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\<XXXXXXXX>" ^
      "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0"
```

El número `<XXXXXXXX>` es el directorio temporal creado por el intento fallido. Con `npm run dist` ya no vuelve a intentarlo al encontrar `winCodeSign-2.6.0`.

---

## Estructura del proyecto

```
Migrador/
├── app/
│   ├── electron/
│   │   ├── main.ts          # Proceso principal Electron
│   │   ├── preload.ts       # Bridge renderer ↔ main
│   │   ├── db.ts            # Mini-BD JSON persistente (jobs, logs recientes)
│   │   └── queue.ts         # Runner de cola secuencial con verificación
│   ├── src/
│   │   ├── App.tsx          # Shell con pestañas
│   │   ├── pages/
│   │   │   ├── RequirementsPage.tsx
│   │   │   ├── AccountsPage.tsx
│   │   │   ├── MigratePage.tsx   # Configurar y encolar trabajos
│   │   │   └── JobsPage.tsx      # Gestión de cola (nueva)
│   │   └── components/
│   │       ├── FolderBrowser.tsx
│   │       ├── LogViewer.tsx
│   │       ├── StatCard.tsx
│   │       ├── TitleBar.tsx
│   │       └── UpdateBanner.tsx
│   ├── resources/
│   │   └── extra/rclone.exe     # rclone bundled (generado por scripts/download-rclone.mjs)
│   └── package.json
├── DOCUMENTACION.md
└── Migrar-GUI.ps1               # Versión legacy PowerShell (referencia histórica)
```

---

## Datos persistentes (userData)

Todos los datos de usuario se guardan en `%APPDATA%\atom-migrador\` y sobreviven a actualizaciones del instalador:

| Archivo / carpeta | Contenido |
|---|---|
| `migrador.db.json` | Cola de jobs, estado, logs recientes (hasta 2000 líneas), configuración de cola |
| `envMigracion.json` | Nombres de los remotes de rclone (RemoteDB, RemoteGD) |
| `logs/<ts>_<jobId>/migration.log` | Log completo por trabajo (sincronización + verificación) |

---

## Flujo de uso

### Pestaña 1 — Requisitos
- Detecta rclone (bundled, PATH, WinGet, `C:\rclone`…).
- Si no lo encuentra descarga el zip oficial y lo copia a userData.
- Muestra versión detectada.

### Pestaña 2 — Cuentas
- **Conectar Dropbox**: lanza `rclone authorize dropbox`, abre el navegador, extrae el token del stdout y llama a `rclone config create`.
- **Conectar Google Drive**: ídem con `rclone authorize drive`.
- Soporta espacios de nombres Dropbox Business (team namespace).

### Pestaña 3 — Migrar *(configurar y encolar)*
1. Seleccionar carpeta origen en Dropbox (soporte Personal / Equipo).
2. Seleccionar Shared Drive y carpeta destino en Google Drive.
3. Configurar opciones: dry-run, crear subcarpeta, banda, transferencias paralelas.
4. (Opcional) Dar nombre al trabajo.
5. Pulsar **＋ Añadir a la cola** → la app salta automáticamente a la pestaña Cola.

Se pueden añadir tantos trabajos como se quiera antes de que empiece a ejecutarse ninguno.

### Pestaña 4 — Cola *(nueva)*
Gestión completa de la cola de trabajos:

| Elemento | Descripción |
|---|---|
| Lista de trabajos | Estado en tiempo real, estadísticas en vivo durante la ejecución |
| ↑ / ↓ | Reordenar trabajos pendientes |
| ▶ Ejecutar ya | Forzar ejecución inmediata de un trabajo pendiente (sin esperar su turno) |
| ↻ Reintentar | Relanzar trabajos con error / interrumpidos / verificación fallida |
| ✕ Eliminar | Quitar un trabajo de la cola (no aplica al trabajo activo) |
| ⏸ Pausar cola | Detiene el inicio automático del siguiente trabajo (el actual termina normal) |
| ■ Detener actual | Para el proceso rclone en curso (SIGTERM → SIGKILL a los 3 s) |
| 🧹 Limpiar terminados | Elimina de la lista los trabajos finalizados (OK / error / detenidos) |
| Panel de detalle | Muestra metadatos del trabajo + log en vivo (se recarga al seleccionar) |

---

## Verificación post-copia

Tras cada `rclone sync` con código de salida 0 (y cuando **no** es dry-run), la app ejecuta automáticamente:

```
rclone check ORIGEN DESTINO --size-only --one-way --fast-list
```

Esto comprueba que **todos los archivos del origen existen en el destino con el mismo tamaño** (no verifica hashes, pero es rápido y sin descargas). El resultado aparece en el badge del trabajo:

| Badge | Significado |
|---|---|
| `✓ N archivos verificados` | Verificación OK — ningún archivo falta ni difiere |
| `✗ N faltan / M difieren` | Verificación fallida — el trabajo queda en estado `verify-failed` para revisión |
| `— (saltada por dry-run)` | No aplica en simulaciones |

---

## Resiliencia ante cierres inesperados

- **Base de datos atómica**: cada escritura se hace a un `.tmp` y se renombra, nunca corrompe el JSON aunque se corte la luz.
- **Recuperación al arrancar**: si un trabajo estaba en estado `running` o `verifying` cuando la app se cerró de golpe, al volver a abrirla aparece como `⚠ Interrumpido` con el mensaje "La aplicación se cerró antes de terminar". Se puede reintentar con ↻.
- **Aviso al cerrar durante migración**: si hay un trabajo activo y el usuario intenta cerrar la ventana, aparece un diálogo:
  > *⚠ Hay una migración en curso — Si cierras la app ahora la migración se interrumpirá y los archivos que estuvieran transfiriéndose podrían quedar a medio copiar (corruptos). ¿Quieres detener la migración y salir igualmente?*
  
  Opciones: **Cancelar** (volver a la app) o **Detener migración y salir** (SIGTERM → flush DB → cierre).

---

## Parámetros de rclone sync

La migración usa estos flags optimizados para grandes volúmenes:

| Flag | Valor | Motivo |
|---|---|---|
| `--transfers` | 32 (configurable) | Transferencias paralelas |
| `--checkers` | transfers × 3 | Verificaciones paralelas |
| `--fast-list` | — | Menos llamadas a la API al listar |
| `--retries` | 10 | Reintentos ante errores transitorios |
| `--low-level-retries` | 20 | Reintentos de bajo nivel |
| `--retries-sleep` | 5s | Pausa entre reintentos |
| `--ignore-errors` | — | Continúa ante errores individuales |
| `--size-only` | — | Compara solo tamaño (no hash) para velocidad |
| `--no-traverse` | — | No recorre el destino para diff (más rápido) |
| `--no-update-modtime` | — | No actualiza fecha de modificación |
| `--drive-chunk-size` | 64M | Chunk de upload a Drive |
| `--drive-upload-cutoff` | 64M | Umbral para upload multipart |
| `--drive-pacer-min-sleep` | 10ms | Mínimo delay entre llamadas API |
| `--drive-pacer-burst` | 100 | Burst de llamadas API permitido |
| `--drive-acknowledge-abuse` | — | Descarga archivos marcados como abuso |
| `--buffer-size` | 32M | Buffer de lectura por transferencia |
| `--tpslimit` | 30 | Límite de transacciones por segundo |
| `--tpslimit-burst` | 60 | Burst de TPS |
| `--bwlimit` | configurable | Limitar ancho de banda (0 = libre) |
| `--stats` | 3s | Estadísticas cada 3 s |
| `--stats-one-line` | — | Stats en una línea (para parseo) |
| `--log-level` | INFO | Nivel de log |

---

## Arquitectura interna

### IPC renderer ↔ main

```
Renderer (React)          |  Main (Electron / Node)
--------------------------|---------------------------
window.api.jobs.add(...)  →  ipcMain.handle('jobs:add')
window.api.jobs.list()    →  ipcMain.handle('jobs:list')
window.api.queue.state()  →  ipcMain.handle('queue:state')
window.api.jobs.stop()    →  ipcMain.handle('jobs:stop')
                          ←  send('jobs:update')          ← queue.ts emite al cambiar estado
                          ←  send('migration:log', line)  ← por cada línea de rclone
                          ←  send('migration:stats', {})  ← parseStats() cada 3 s
                          ←  send('migration:done', {})   ← al terminar sync + verify
```

### Módulo `db.ts`

- Almacena en memoria + flush diferido (250 ms) a `migrador.db.json`.
- Escritura atómica: `writeFileSync(tmp)` + `renameSync(tmp, real)`.
- Al `initDB()`: jobs `running`/`verifying` → `interrupted` (crash recovery).
- Expone: `addJob`, `updateJob`, `removeJob`, `reorderJob`, `clearFinishedJobs`, `nextPendingJob`, `hasActiveJob`, `appendLog`, `getRecentLogs`, `getQueueAutorun`/`setQueueAutorun`.

### Módulo `queue.ts`

- `processNext()` — busca el primer job `pending` y llama a `runJob(id)`.
- `runJob(id)` — escribe headers al log, lanza `rclone sync`, parsea stats línea a línea, al cierre con código 0 llama a `runVerification()`.
- `runVerification()` — lanza `rclone check --size-only --one-way`, parsea el resumen, actualiza el job como `done` o `verify-failed`, llama a `processNext()` para continuar la cola.
- `stopCurrent()` — SIGTERM al proceso activo, marca el job como `stopped`.

### Flujo de estados de un job

```
pending
  └─→ running  (runJob)
        └─→ verifying  (runVerification, solo si exitCode=0 y no dry-run)
              ├─→ done          (verify OK)
              └─→ verify-failed (verify KO)
        └─→ done        (dry-run, skip verify)
        └─→ error       (exitCode ≠ 0)
        └─→ stopped     (stopCurrent)
  └─→ interrupted  (crash recovery al arrancar)
```

---

## Actualización automática

La app comprueba GitHub Releases al arrancar (con 3 s de retraso). Si hay una versión mayor disponible muestra un banner con enlace de descarga directa al `.exe`. No hay autoinstalación — el usuario descarga e instala el nuevo `.exe` manualmente.

---

## Configuración OAuth (detalle)

```
Usuario pulsa "Conectar Dropbox"
  │
  ├─ Lanza: rclone authorize dropbox  (windowsHide:true)
  │   (captura stdout+stderr en memoria)
  │
  ├─ Espera cierre del proceso
  │
  ├─ Extrae JSON de token con regex:
  │   /\{[\s\S]*?"access_token"[\s\S]*?"expiry"\s*:\s*"[^"]*"[\s\S]*?\}/
  │
  ├─ Token encontrado?
  │   ├─ rclone config create <nombre> dropbox token <tok>
  │   └─ Verifica con rclone listremotes
  │
  └─ Sin token?
      └─ getRemotes() → ¿ya estaba configurado? → ok / error
```
