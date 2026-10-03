# OpenCode Local

**Fork no oficial y experimental de OpenCode, orientado a mejorar la integración con Ollama y optimizar la inferencia local en una NVIDIA RTX 5070.**

[English](README.md) · [Rama de desarrollo](https://github.com/wandoth1/opencode-local/tree/feature/local-foundation) · [PR #1 en borrador](https://github.com/wandoth1/opencode-local/pull/1)

> **Autoría e independencia:** Este proyecto deriva de [OpenCode](https://github.com/anomalyco/opencode), creado por sus colaboradores originales. [wandoth1](https://github.com/wandoth1) mantiene el trabajo específico de esta variante. OpenCode Local no está desarrollado, respaldado ni mantenido por el equipo de OpenCode y no está afiliado a él.
>
> **Estado experimental:** Las correcciones del runtime y la reauditoría independiente siguen pendientes. La rama local no está lista para producción. Este proyecto todavía no ha demostrado una mejora de rendimiento en una RTX 5070 física.

## Qué es este proyecto

OpenCode Local es una línea de desarrollo independiente sobre el código existente de OpenCode. No es un agente creado desde cero ni una versión oficial del proyecto original. Conserva el producto, las herramientas, las sesiones, la configuración y la infraestructura de proveedores heredadas, mientras desarrolla una integración local más consciente de los recursos del equipo.

El objetivo inicial es **Windows con una NVIDIA GeForce RTX 5070 y Ollama**. Otras tarjetas de la serie RTX 50 y otros motores de inferencia son posibles ampliaciones futuras; no se presentan como hardware o integraciones ya probados.

Los objetivos del desarrollo son:

- Mejorar el descubrimiento de Ollama, los metadatos de modelos, el transporte nativo, el streaming y las llamadas a herramientas.
- Ajustar los presupuestos de contexto y caché KV a la VRAM disponible, distinguiendo las estimaciones de los datos medidos.
- Utilizar benchmarks reproducibles antes de afirmar mejoras de velocidad, consumo de memoria o descarga de trabajo a CPU.

[vercel-labs/fx](https://github.com/vercel-labs/fx) sirve como referencia arquitectónica para separar agente, proveedor y transporte. Esto no significa que su runtime en Zig esté integrado en esta variante.

## Dónde se desarrolla

| Rama | Función |
| --- | --- |
| [`dev`](https://github.com/wandoth1/opencode-local/tree/dev) | Rama predeterminada y portada: base importada de OpenCode, presentación del fork y mantenimiento de las automatizaciones del repositorio. No contiene la implementación local que sigue sin fusionar. |
| [`feature/local-foundation`](https://github.com/wandoth1/opencode-local/tree/feature/local-foundation) | Desarrollo experimental de Ollama, diagnóstico de hardware y gestión de contexto. Aquí se revisan y corrigen esos cambios. |

El punto de partida importado es `anomalyco/opencode@b155b15694dbcc6768f11d2f25cc2bdd1f738ab4`. Es una referencia histórica, no una afirmación de estar sincronizado con la última revisión del proyecto original.

El repositorio se importó como una copia independiente. Aquí, **fork** describe el origen del código; no implica que GitHub lo muestre dentro de la red de forks del original. La PR #1 pertenece a `wandoth1/opencode-local`, no al repositorio de OpenCode.

## Estado e instalación

Los cambios locales siguen en desarrollo en la [PR #1 en borrador](https://github.com/wandoth1/opencode-local/pull/1), sin fusionar en `dev`. Los hallazgos de auditoría y los intentos fallidos de aplicar correcciones no deben confundirse con arreglos terminados ni con una validación satisfactoria del HEAD actual.

Los mantenimientos heredados programados y los jobs temporales de aplicación de correcciones que se pausaron deben continuar pausados. Sus archivos YAML se conservan en `.github/disabled-workflows/` en la rama correspondiente. Este cambio de README no los reactiva ni lanza una compilación nueva.

Para inspeccionar el código experimental:

```bash
git clone --single-branch --branch feature/local-foundation https://github.com/wandoth1/opencode-local.git
cd opencode-local
```

**El instalador oficial de OpenCode, el paquete npm `opencode-ai` y las descargas de `anomalyco/opencode` instalan el programa original, no esta rama experimental.** Sus paquetes, versiones, distintivos de compilación y resultados de CI no acreditan que esta variante se haya compilado o validado.

La documentación técnica de la rama está en [docs/local-foundation](https://github.com/wandoth1/opencode-local/tree/feature/local-foundation/docs/local-foundation). Describe la intención de la implementación; el código actual, los hallazgos y las comprobaciones del commit exacto prevalecen sobre afirmaciones antiguas de estado.

## Reconocimiento del proyecto original y licencia

Se conservan sin cambios la [licencia MIT y el aviso de copyright originales](LICENSE). Las referencias a OpenCode en paquetes, comandos, claves de configuración, documentos históricos y recursos heredados reconocen el software original o mantienen compatibilidad; no implican respaldo oficial a este fork.

El [README original en el commit importado](https://github.com/anomalyco/opencode/blob/b155b15694dbcc6768f11d2f25cc2bdd1f738ab4/README.es.md) sigue siendo la referencia del proyecto original. Otras traducciones heredadas pueden seguir describiendo OpenCode; los README en inglés y español de este repositorio describen OpenCode Local.

Las incidencias y propuestas específicas de esta variante deben tratarse en [wandoth1/opencode-local](https://github.com/wandoth1/opencode-local/issues), sin asumir soporte por parte de los mantenedores originales.
