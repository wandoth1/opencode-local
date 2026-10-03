# OpenCode Local

**Fork no oficial y experimental de OpenCode, centrado en mejorar la compatibilidad con Ollama y la inferencia local en NVIDIA GeForce RTX 5070.**

[English](README.md) · [Rama de desarrollo](https://github.com/wandoth1/opencode-local/tree/feature/local-foundation) · [PR #1 en borrador](https://github.com/wandoth1/opencode-local/pull/1)

> El código y el agente originales son obra de los colaboradores de [anomalyco/opencode](https://github.com/anomalyco/opencode). [wandoth1](https://github.com/wandoth1) mantiene esta variante de forma independiente. No está desarrollada, respaldada ni mantenida por el equipo de OpenCode.
>
> Estado experimental: esta base local está disponible como código fuente. No es una versión de producción ni una mejora de velocidad demostrada en RTX 5070. Siguen siendo necesarias la reauditoría independiente y la prueba en la GPU real.

## Objetivo y desarrollo

Conservar las sesiones, herramientas, configuración, interfaz y proveedores de OpenCode mientras se desarrolla una integración local de Ollama más fiable. El objetivo inicial es Windows con RTX 5070; no se anuncia que otras tarjetas RTX 50 estén probadas.

El trabajo incluye descubrimiento y transporte nativo de Ollama, texto y razonamiento incrementales, validación de llamadas a herramientas, diagnóstico NVIDIA, estimaciones de contexto/caché KV y un comando de diagnóstico y benchmark. [vercel-labs/fx](https://github.com/vercel-labs/fx) es una referencia para separar agente, proveedor y transporte; su runtime en Zig no está integrado aquí.

| Rama | Función |
| --- | --- |
| `dev` | Rama predeterminada: aplicación base importada, presentación del fork y mantenimiento del repositorio. Los cambios locales no están fusionados. |
| `feature/local-foundation` | Implementación experimental y correcciones de auditoría propuestas en la PR #1 de este repositorio, todavía en borrador. |

Base importada: `anomalyco/opencode@b155b15694dbcc6768f11d2f25cc2bdd1f738ab4`. Es una referencia histórica, no una afirmación de estar sincronizado con el último commit del original. El repositorio se importó independientemente: "fork" describe su origen, no necesariamente pertenencia a la red de forks de GitHub.

La primera auditoría estática encontró defectos materiales. Las correcciones están ahora en archivos fuente directos, no en paquetes de bootstrap. Consulta el [registro de auditoría](https://github.com/wandoth1/opencode-local/blob/feature/local-foundation/docs/local-foundation/AUDIT.md), el diff y las comprobaciones de la revisión exacta. Las afirmaciones antiguas de finalización o ejecuciones verdes anteriores no validan un HEAD nuevo.

## Ejecutar el código experimental

```bash
git clone --single-branch --branch feature/local-foundation https://github.com/wandoth1/opencode-local.git
cd opencode-local
bun install --frozen-lockfile --filter './' --filter './packages/opencode'
cd packages/opencode
bun run --conditions=browser src/index.ts local doctor --json
```

Usa la versión de Bun fijada en `package.json` e inicia Ollama por separado. La instalación selecciona las herramientas de desarrollo de la raíz, el agente y sus dependencias. Excluye aplicaciones web alojadas ajenas a este objetivo, cuyo paquete preliminar de SolidStart devolvió 404. No cambia las versiones ni el lockfile y no equivale a validar todo el monorepositorio original. Consulta la [guía de uso](https://github.com/wandoth1/opencode-local/blob/feature/local-foundation/docs/local-foundation/USAGE.md) antes del benchmark.

**El instalador oficial, el paquete npm `opencode-ai` y las releases de OpenCode instalan la aplicación original, no esta rama.** Aquí no se anuncia una distribución binaria propia.

## Colaboración y seguridad

Las propuestas específicas se reciben en [las incidencias y pull requests de este repositorio](https://github.com/wandoth1/opencode-local/issues). Los mantenimientos programados heredados y los jobs que modificaban su propia rama siguen archivados. La validación que los sustituye comprueba Linux y Windows con permisos de solo lectura, sin calendario, commits automáticos ni despliegues, y con tiempo máximo de ejecución.

La protección se activa en GitHub Settings: guardar `.github/protect-dev.ruleset.json` no protege `dev` por sí solo. Los servidores Ollama remotos y sus credenciales se configuran en el ámbito de usuario de confianza o en las variables documentadas, no en un proyecto compartido. Sigue siendo un agente que ejecuta herramientas/plugins, no un entorno aislado para repositorios arbitrarios.

## Reconocimiento y licencia

Se conservan la [licencia MIT y el copyright originales](LICENSE). Las referencias a OpenCode en paquetes, comandos, documentos históricos y recursos heredados mantienen atribución o compatibilidad; no implican respaldo oficial. Otras traducciones heredadas pueden describir el original; las portadas en inglés y español describen OpenCode Local. Las estimaciones de memoria y los tests simulados no acreditan aceleración medida en la GPU.
