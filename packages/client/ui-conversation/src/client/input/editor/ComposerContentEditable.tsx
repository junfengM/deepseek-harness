/**
 * The composer's contenteditable host: binds one shell-owned Lexical editor
 * to a resident div. Session-maybe by design — a null editor renders the
 * same DOM inert (the no-session Workspace-trigger state), so switching
 * between the two never swaps the element tree. Editability has ONE writer:
 * this component reflects the `editable` prop onto the editor; nothing else
 * calls setEditable.
 */
import { useLayoutEffect, useRef } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'
import { $setSelection } from 'lexical'
import type { LexicalEditor } from 'lexical'
import { isTouchPrimary } from '@deepseek-ai/dsh-client-ui-primitives'

/** Host props: the editor binding plus the div passthroughs the bar owns. */
export interface ComposerContentEditableProps extends HTMLAttributes<HTMLDivElement> {
  /** The shell-owned editor; null renders the same div unbound and inert. */
  readonly editor: LexicalEditor | null
  /** Whether the user may edit (readOnly/disabled states fold in here). */
  readonly editable: boolean
}

/**
 * Render the composer's editable surface.
 * @param props - editor binding, editability, and div passthroughs.
 * @returns the resident contenteditable div.
 */
export function ComposerContentEditable({ editor, editable, ...rest }: ComposerContentEditableProps): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (editor === null || el === null) return
    // Touch-primary devices: a previously interacted session's saved editor
    // state carries a non-null RangeSelection. setRootElement below commits
    // that state, and Lexical's $updateDOMSelection FOCUSES the root element
    // whenever it restores a selection into an unfocused editable — a session
    // switch from the sidebar would pop the on-screen keyboard over the
    // conversation the user just navigated to. Drop the saved selection right
    // before binding (null-root update: state-only commit, no DOM work) so
    // the bind has nothing to restore. Desktop keeps the selection: its
    // unlock effect intentionally re-focuses the composer on session switch.
    if (isTouchPrimary()) {
      editor.update(() => { $setSelection(null) }, { discrete: true })
    }
    editor.setRootElement(el)
    return () => { editor.setRootElement(null) }
  }, [editor])
  useLayoutEffect(() => {
    if (editor !== null) editor.setEditable(editable)
  }, [editor, editable])
  return (
    <div
      ref={ref}
      // Lexical's setRootElement never touches contenteditable; the binding
      // renders it, and setEditable above keeps the editor's own gate in step.
      contentEditable={editor !== null && editable}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      data-composer-input
      {...rest}
    />
  )
}
