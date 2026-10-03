# OpenCode Local

**Fork no oficial y experimental de OpenCode, centrado en mejorar la compatibilidad con Ollama y la inferencia local en NVIDIA GeForce RTX 5070.**

[English](README.md) · [Rama de desarrollo](https://github.com/wandoth1/opencode-local/tree/feature/local-foundation) · [PR #1 en borrador](https://github.com/wandoth1/opencode-local/pull/1)

> El código y el agente originales pertenecen al trabajo de los colaboradores de [anomalyco/opencode](https://github.com/anomalyco/opencode). [wandoth1](https://github.com/wandoth1) mantiene esta variante de forma independiente. No está desarrollada, respaldada ni mantenida por el equipo de OpenCode.
>
> Estado experimental: esta es una base de integración local disponible como código fuente, no una versión de producción ni una mejora de velocidad demostrada en RTX 5070. Siguen siendo necesarias una reauditoría independiente y la prueba en la GPU real.

## Objetivo

Conservar las sesiones, herramientas, configuración, interfaz e infraestructura de proveedores de OpenCode mientras se desarrolla una integración local de Ollama más fiable. El objetivo inicial es Windows con RTX 5070; no se anuncia que otras tarjetas RTX 50 estén probadas.

El trabajo de `feature/local-foundation` incluye descubrimiento y transporte nativo de Ollama, texto y razonamiento incrementales, validación de llamadas a herramientas, diagnóstico NVIDIA, estimaciones de contexto/caché KV y un comando de diagnóstico y benchmark reproducible. [vercel-labs/fx](https://github.com/vercel-labs/fx) es una referencia arquitectónica para separar agente, proveedor y transporte; su runtime en Zig no está integrado aquí.

## Ramas y estado

| Rama | Función |
| --- | --- |
| `dev` | Rama predeterminada: aplicación base importada, presentación del fork y mantenimiento del repositorio. Los cambios del runtime local no están fusionados. |
| `feature/local-foundation` | Implementación experimental y correcciones de auditoría propuestas en la PR #1 de este repositorio, todavía en borrador. |

Base importada: `anomalyco/opencode@b155b15694dbcc6768f11d2f25cc2bdd1f738ab4`. Es una referencia histórica, no una afirmación de estar sincronizado con el último commit del original. El repositorio se importó de forma independiente; "fork" describe el origen del código, no necesariamente su pertenencia a la red de forks de GitHub.

La primera auditoría estática encontró defectos materiales. Las correcciones están ahora representadas por cambios directos en el código, no por paquetes de bootstrap. Consulta el [registro de auditoría](https://github.com/wandoth1/opencode-local/blob/feature/local-foundation/docs/local-foundation/AUDIT.md), el diff y las comprobaciones de la revisión exacta. Las afirmaciones antiguas de finalización y las ejecuciones verdes anteriores no validan un HEAD nuevo.

Los mantenimientos heredados programados y los jobs que modificaban su propia rama permanecen archivados. El workflow que los sustituye valida Linux y Windows en cambios de PR o por ejecución manual: permisos de solo lectura sobre el repositorio, sin calendario, sin commits automáticos y sin despliegues.

## Inspeccionar y ejecutar el código experimental

```bash
git clone --single-branch --branch feature/local-foundation https://github.com/wandoth1/opencode-local.git
cd opencode-local
bun install --frozen-lockfile
cd packages/opencode
bun run --conditions=browser src/index.ts local doctor --json
```

Utiliza la versión de Bun fijada en `package.json` e inicia Ollama por separado. Consulta la [guía de uso](https://github.com/wandoth1/opencode-local/blob/feature/local-foundation/docs/local-foundation/USAGE.md) antes del benchmark. Los valores de memoria son estimaciones; un test unitario o un servidor simulado no son una prueba de rendimiento con un modelo real.

**El instalador oficial, el paquete npm `opencode-ai` y las releases de OpenCode instalan la aplicación original, no esta rama.** Este README no anuncia una distribución binaria propia.

## Colaboración y seguridad

Las propuestas específicas de esta variante deben enviarse a [sus incidencias y pull requests](https://github.com/wandoth1/opencode-local/issues). Trabaja en ramas revisables y no reactives workflows retirados sin autorización. Las reglas de protección se activan en GitHub Settings; un JSON guardado en el repositorio no protege la rama por sí solo.

Configura los servidores Ollama remotos y sus credenciales en el ámbito de usuario de confianza o mediante las variables de entorno documentadas, no en una configuración de proyecto compartida. Esta variante sigue siendo un agente capaz de ejecutar herramientas/plugins: no es un entorno aislado para abrir repositorios arbitrarios.

## Reconocimiento y licencia

Se conservan la [licencia MIT y el aviso de copyright originales](LICENSE). Las referencias a OpenCode en paquetes, comandos, documentos históricos y recursos heredados mantienen atribución o compatibilidad; no implican respaldo oficial. Otras traducciones heredadas pueden describir el proyecto original; las portadas en inglés y español describen OpenCode Local.
