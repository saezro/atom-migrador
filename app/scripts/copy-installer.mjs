import { readdirSync, copyFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const distDir = resolve(fileURLToPath(import.meta.url), '../../dist')
const rootDir = resolve(fileURLToPath(import.meta.url), '../../../')

if (!existsSync(distDir)) {
  console.error('No existe dist/')
  process.exit(1)
}

const exes = readdirSync(distDir).filter(f => f.endsWith('.exe') && !f.endsWith('blockmap'))
if (exes.length === 0) {
  console.error('No se encontró ningún .exe en dist/')
  process.exit(1)
}

for (const file of exes) {
  const src = join(distDir, file)
  const dst = join(rootDir, file)
  copyFileSync(src, dst)
  console.log(`✓ Instalador copiado a raíz: ${file}`)
}
