# OpenCode Local

**Fork no oficial y experimental de OpenCode, orientado a mejorar la compatibilidad con Ollama y la inferencia local en NVIDIA GeForce RTX 5070.**

[English](README.md) · [Rama de desarrollo](https://github.com/wandoth1/opencode-local/tree/feature/local-foundation) · [PR #1 en borrador](https://github.com/wandoth1/opencode-local/pull/1)

El código y el agente originales son obra de los colaboradores de [anomalyco/opencode](https://github.com/anomalyco/opencode). [wandoth1](https://github.com/wandoth1) mantiene esta variante de forma independiente, sin respaldo ni soporte del equipo original. Se conservan [la licencia MIT y el copyright](LICENSE). FX sirve como referencia arquitectónica; su runtime en Zig no está integrado.

## Estado

Código fuente experimental, no una versión de producción ni una aceleración demostrada. La reauditoría física de `0b4b6fc` encontró defectos importantes pese a los tests verdes. Las correcciones y sus límites están en [REAUDIT_FIXES.md](docs/local-foundation/REAUDIT_FIXES.md). Antes de fusionar son necesarias las comprobaciones del commit exacto, la revisión independiente y la repetición de las pruebas físicas.

`dev` es la rama predeterminada protegida; `feature/local-foundation` contiene el trabajo local de la PR #1, sin fusionar. Base original importada: `b155b15694dbcc6768f11d2f25cc2bdd1f738ab4`. "Fork" describe la procedencia del código, no necesariamente pertenencia a la red de forks de GitHub. No se anuncia compatibilidad probada con otras RTX 50.

## Ejecutar el código revisado

Usa Node 22 o posterior y Bun 1.3.14 en un clon de confianza. Inicia Ollama por separado.

```bash
git clone --single-branch --branch feature/local-foundation https://github.com/wandoth1/opencode-local.git
cd opencode-local
bun install --frozen-lockfile --filter './' --filter './packages/opencode'
node scripts/opencode-local.mjs local doctor --json
```

**Arranca con Node como en el ejemplo, no directamente con `bun run src/index.ts`: el lanzador impide que el `.env` del proyecto se cargue automáticamente en el agente.** Desde otro directorio utiliza la ruta absoluta del lanzador. Consulta [USAGE.md](docs/local-foundation/USAGE.md) para seleccionar modelos, configurar credenciales, tiempos de espera y benchmarks.

El contexto predeterminado es 32K, limitado por el máximo del modelo. La VRAM libre momentánea ya no lo reduce automáticamente a 4K. Las cifras de memoria son orientativas; las arquitecturas no cubiertas se presentan como desconocidas. No se garantiza que todos los modelos o tareas quepan en GPU.

El instalador oficial, npm `opencode-ai` y las releases de OpenCode instalan el original, no esta rama. El script `install` de la raíz ya no descarga esos binarios. Algunas traducciones históricas siguen describiendo el original: utiliza estas portadas en español e inglés para este fork.

## Colaboración y seguridad

Las propuestas específicas se reciben en las incidencias y PR de este repositorio. La validación Linux/Windows es de solo lectura, sin calendario, commits automáticos ni despliegues. Incluye una prueba acotada de streaming de 305 segundos, no un job recurrente. Los mantenimientos heredados permanecen archivados. No hay fusión ni publicación automática.

Configura los secretos en el ámbito de usuario de confianza o en las variables de shell documentadas. Las herramientas/plugins conservan los privilegios del usuario: esto no es un entorno aislado para repositorios arbitrarios. Cualquier afirmación de velocidad requiere comparar el mismo modelo, cuantización, contexto, prompt y hardware.
