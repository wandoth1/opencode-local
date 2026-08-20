export * as WarmingPlugin from "./warming.js"

import { define } from "@opencode-ai/plugin/effect/plugin"
import { Clock, Duration, Effect, Scope } from "effect"
import { Config } from "../config.js"
import { SessionSchema } from "../session/schema.js"
import { Token } from "../util/token.js"

// Ephemeral implicit prefix caches for Gemini and Vertex AI expire after ~3 to 5 minutes of inactivity.
// See:
//   - https://ai.google.dev/gemini-api/docs/caching
//   - https://cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview
// A 2.5-minute (150s) interval keeps the ephemeral cache warm before the provider evicts the prefix.
const defaults = {
  prompt: "This is a keep-alive request. Do not perform any work or use tools. Reply with exactly: OK",
  interval: Duration.seconds(150),
  duration: Duration.minutes(30),
}

const LARGE_CONTEXT_TOKEN_THRESHOLD = 32_768

const estimateContextTokens = (event: {
  readonly system?: ReadonlyArray<{ readonly text?: string } | string>
  readonly messages?: ReadonlyArray<unknown>
}) => {
  let chars = 0
  if (event.system) {
    for (const part of event.system) {
      if (typeof part === "string") chars += part.length
      else if (part && typeof part.text === "string") chars += part.text.length
    }
  }
  if (event.messages) {
    for (const msg of event.messages) {
      if (typeof msg === "object" && msg !== null && "content" in msg) {
        const content = (msg as { content: unknown }).content
        if (typeof content === "string") chars += content.length
        else if (Array.isArray(content)) {
          for (const item of content) {
            if (typeof item === "string") chars += item.length
            else if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
              chars += item.text.length
            }
          }
        }
      }
    }
  }
  return Token.estimate(" ".repeat(chars))
}

export const Plugin = define({
  id: "opencode.warming",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const loadSettings = Effect.fn("WarmingPlugin.loadSettings")(function* () {
      const warming = Config.latest(yield* config.entries(), "warming")
      if (warming === false) return false
      if (warming === true) return defaults
      if (warming) {
        const settings = { ...defaults, ...warming }
        const interval = Duration.toMillis(settings.interval)
        const duration = Duration.toMillis(settings.duration)
        if (Number.isFinite(interval) && interval > 0 && Number.isFinite(duration) && duration > 0) return settings
        yield* Effect.logWarning("warming interval and duration must be finite positive durations")
        return false
      }
      return undefined
    })

    const scope = yield* Scope.Scope
    const sessions = new Map<SessionSchema.ID, { last: number; expires: number; settings: typeof defaults }>()
    const loop: (sessionID: SessionSchema.ID) => Effect.Effect<void> = Effect.fn("WarmingPlugin.loop")(
      function* (sessionID) {
        const current = sessions.get(sessionID)
        if (!current) return

        const now = yield* Clock.currentTimeMillis
        const next = Math.min(current.last + Duration.toMillis(current.settings.interval), current.expires)
        if (now < next) {
          yield* Effect.sleep(Duration.millis(next - now))
          return yield* loop(sessionID)
        }
        if (now >= current.expires) {
          sessions.delete(sessionID)
          return
        }

        const last = current.last
        yield* Effect.logInfo("warming session", { sessionID, last })
        yield* ctx.session
          .generate({ sessionID, prompt: current.settings.prompt })
          .pipe(Effect.catchCause((cause) => Effect.logWarning("failed to warm session", { sessionID, cause })))
        const latest = sessions.get(sessionID)
        if (latest === current && latest.last === last) latest.last = yield* Clock.currentTimeMillis
        return yield* loop(sessionID)
      },
    )

    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        const active = sessions.get(event.sessionID)
        const configured = yield* loadSettings()
        if (configured === false) {
          sessions.delete(event.sessionID)
          return
        }
        const settings =
          configured ?? (estimateContextTokens(event) >= LARGE_CONTEXT_TOKEN_THRESHOLD ? defaults : undefined)
        if (!settings) {
          sessions.delete(event.sessionID)
          return
        }

        // Once generate exposes request metadata to context hooks, tag warm requests instead of matching the prompt.
        const message = event.messages.at(-1)
        if (
          message?.role === "user" &&
          message.content.length === 1 &&
          message.content[0]?.type === "text" &&
          (message.content[0].text === active?.settings.prompt || message.content[0].text === settings.prompt)
        ) {
          if (active) active.settings = settings
          return
        }

        const now = yield* Clock.currentTimeMillis
        const duration = Duration.toMillis(settings.duration)
        if (active) {
          active.last = now
          active.expires = now + duration
          active.settings = settings
          return
        }
        sessions.set(event.sessionID, { last: now, expires: now + duration, settings })
        yield* Effect.logInfo("scheduled session warming", {
          sessionID: event.sessionID,
          interval: settings.interval,
          expires: now + duration,
        })
        yield* loop(event.sessionID).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("session warming loop failed", { sessionID: event.sessionID, cause }),
          ),
          Effect.forkIn(scope),
        )
      }),
    )
  }),
})
