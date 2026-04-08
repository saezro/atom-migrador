// scripts/download-rclone.mjs
// Descarga rclone.exe a resources/extra/ para incluirlo en el installer.
// Se ejecuta automáticamente como "predist" antes de npm run dist.

import { existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import { tmpdir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'resources', 'extra')
const outFile = join(outDir, 'rclone.exe')

if (existsSync(outFile)) {
  console.log('✓ rclone.exe ya existe en resources/extra/, omitiendo descarga.')
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })
console.log('Descargando rclone para Windows x64...')

const tmpZip = join(tmpdir(), 'rclone-current-win.zip')
const tmpExtract = join(tmpdir(), 'rclone-win-extract')

try {
  execSync(
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "` +
    `Invoke-WebRequest -Uri 'https://downloads.rclone.org/rclone-current-windows-amd64.zip' ` +
    `-OutFile '${tmpZip}' -UseBasicParsing; ` +
    `Expand-Archive -LiteralPath '${tmpZip}' -DestinationPath '${tmpExtract}' -Force; ` +
    `$exe = Get-ChildItem '${tmpExtract}' -Recurse -Filter rclone.exe | Select-Object -First 1; ` +
    `Copy-Item $exe.FullName '${outFile}' -Force"`,
    { stdio: 'inherit' }
  )
  console.log(`✓ rclone.exe guardado en resources/extra/`)
} catch (e) {
  console.warn('⚠ No se pudo descargar rclone:', e.message)
  console.warn('  El installer se creará sin rclone bundled.')
  console.warn('  Ejecuta este script manualmente o coloca rclone.exe en resources/extra/')
}
