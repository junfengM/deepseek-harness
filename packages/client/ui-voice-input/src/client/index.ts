/**
 * Voice input plugin, browser half: a mic button in the composer tool row's
 * right list seat (`conversation.input.right`). Dictation runs through the
 * browser's Web Speech API and lands in the draft via the session standard
 * kit's `inputActions.setDraft` — no host round-trip, no attachment plumbing.
 * Copy rides this plugin's own `voice-input` locale namespace.
 *
 * Types stay structural on purpose: this PoC package declares no
 * cross-package project references, so importing the real service faces
 * would drag foreign sources into its `rootDir`.
 */
import { MicButton } from './MicButton.tsx'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'voice-input'

/** Structural view of the services this plugin consumes. */
interface VoiceInputCtx {
  /** Run a side effect with the owner's lifetime. */
  effect(fn: () => () => void, label?: string): void
  locale: {
    /** Register one namespace's dictionaries; returns the unregister disposer. */
    register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
  }
  slots: {
    inject(seat: string, describe: () => unknown): void
    register(
      options: { name: string; id: string; order?: number; locale?: string },
      component: unknown,
    ): () => void
  }
}

/** Required services: the slot registry and the copy seat. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the `voice-input` dictionaries and the mic
 * button into the tool-row right seat.
 * @param ctx - client root context.
 */
export function apply(ctx: VoiceInputCtx): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-voice-input: dictionaries')
  ctx.slots.inject('conversation.input.right', () =>
    ctx.slots.register(
      { name: 'conversation.input.right', id: 'voice', order: 5, locale: NS },
      MicButton,
    ),
  )
}
