/**
 * Voice input plugin, browser half: a mic button in the composer tool row's
 * right list seat (`conversation.input.right`). Dictation runs through the
 * browser's Web Speech API and lands in the draft via the session standard
 * kit's `inputActions.setDraft` — no host round-trip, no attachment plumbing.
 */
import { MicButton } from './MicButton.tsx'

/** The slot registry is the only service this plugin touches. */
export const inject = ['slots']

/** Structural view of the slot service this plugin consumes. */
interface SlotsCtx {
  slots: {
    inject(seat: string, describe: () => unknown): void
    register(options: { name: string; id: string; order?: number }, component: unknown): () => void
  }
}

/**
 * Client plugin body: register the mic button into the tool-row right seat.
 * @param ctx - client root context.
 */
export function apply(ctx: SlotsCtx): void {
  ctx.slots.inject('conversation.input.right', () =>
    ctx.slots.register(
      { name: 'conversation.input.right', id: 'voice', order: 5 },
      MicButton,
    ),
  )
}
