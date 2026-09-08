/**
 * MicButton — the composer tool-row voice dictation control (PoC).
 *
 * Sits in the `conversation.input.right` list seat. Click to start Web
 * Speech API dictation; recognized text is appended into the input draft
 * through `inputActions.setDraft` (the single public draft write path).
 * Interim results are shown live; the base draft is captured at start and
 * preserved (CJK-aware joining, no spurious spaces between han characters).
 * All copy rides the plugin's own `voice-input` locale namespace.
 *
 * Send owns the stop: while dictating, a submission (the send button, Enter,
 * or a claimed command — announced by the input shell's `dsh:composer-submit`
 * window event) stops the recognizer and swallows any trailing results, so
 * the settling draft is never rewritten by speech that lands after the send.
 */
import { useEffect, useRef, useState } from 'react'
import type { VoiceInputKey } from './locales.ts'

/** Structural slice of the published input state this control reads. */
interface InputSnapshot {
  draft?: string
}

/**
 * Structural view of what this seat actually consumes — keeps the PoC
 * import-free (the package declares no cross-package project references).
 */
interface MicButtonProps {
  /** Owner share (InputZone): point-in-time input machine snapshot. */
  input?: { draft?: string } | undefined
  /** Session standard kit: the public input action face. */
  inputActions?: { setDraft(text: string): void } | undefined
  /**
   * Session standard kit: live selector hook over the input machine. The
   * scope adapter keeps the prop present (a stub while unbound), so the
   * seat renders only with a session and the call order stays stable.
   */
  useInput?: ((selector: (state: InputSnapshot) => InputSnapshot) => InputSnapshot) | undefined
  /** Locale seat: the `voice-input` namespace registered by this plugin. */
  t: (key: VoiceInputKey, params?: Record<string, string>) => string
}

/** One dictation alternative (the top transcript of a recognition result). */
interface RecognitionAlternative { transcript?: string }
/** A recognition result: alternatives by index plus a final/partial flag. */
interface RecognitionResult extends ArrayLike<RecognitionAlternative> {
  isFinal?: boolean
}
/** The onresult payload: which index changed, plus the latest results. */
interface RecognitionResultEvent {
  resultIndex: number
  results: ArrayLike<RecognitionResult>
}
/** The onerror payload: a machine-readable error code. */
interface RecognitionErrorEvent { error?: string }
/** The subset of a SpeechRecognition instance this control drives. */
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: RecognitionResultEvent) => void) | null
  onerror: ((event: RecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  /** Not on every engine (absent on old WebKit): the guaranteed cut. */
  abort?(): void
}
type RecognitionConstructor = new () => SpeechRecognitionLike

/** True when the char is CJK / full-width — join without a space after these. */
function endsWithCjk(text: string): boolean {
  const last = text.charCodeAt(text.length - 1)
  return Number.isNaN(last)
    ? false
    : (last >= 0x2e80 && last <= 0x9fff)
      || (last >= 0x3000 && last <= 0x303f)
      || (last >= 0xff00 && last <= 0xffef)
}

/** Append `addition` onto `base`, inserting a space only between latin runs. */
function joinDraft(base: string, addition: string): string {
  if (base === '') return addition.replace(/^\s+/, '')
  const trimmed = addition.replace(/^\s+/, '')
  if (trimmed === '') return base
  return base + (endsWithCjk(base) ? '' : ' ') + trimmed
}

/** Engine error code → dictionary key; '' means "silent" (a send-owned stop). */
const ERROR_KEYS: Record<string, VoiceInputKey | ''> = {
  'not-allowed': 'error.notAllowed',
  'service-not-allowed': 'error.serviceNotAllowed',
  'no-speech': 'error.noSpeech',
  'audio-capture': 'error.audioCapture',
  network: 'error.network',
  aborted: '',
}

export function MicButton(props: MicButtonProps) {
  const { t, inputActions } = props
  const [listening, setListening] = useState(false)
  const [errorKey, setErrorKey] = useState<VoiceInputKey | null>(null)
  const [errorCode, setErrorCode] = useState('')
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const baseRef = useRef('')
  // Set when the stop is owned by a send: results arriving after the submit
  // cleared the draft must not rewrite it, so onresult swallows them. A
  // manual mic stop keeps the final transcript flowing into the draft.
  const suppressRef = useRef(false)

  // Live input machine share: the current draft for the base capture.
  const input = props.useInput !== undefined ? props.useInput(state => state) : undefined

  function stop(): void {
    const rec = recRef.current
    if (rec === null) return
    try {
      rec.stop()
    } catch {
      // already ended
    }
    // Some engines (iOS Safari in particular) ignore stop() while they are
    // still receiving audio; abort() is the guaranteed cut. Give stop() a
    // beat to flush its final results into the draft first, then force it.
    window.setTimeout(() => {
      if (recRef.current !== rec) return
      try {
        rec.abort?.()
      } catch {
        // already ended
      }
    }, 400)
  }

  /** Send-owned stop: finals are unwanted and the mic must go quiet now. */
  function stopForSend(): void {
    suppressRef.current = true
    setListening(false)
    const rec = recRef.current
    if (rec === null) return
    try {
      rec.stop()
    } catch {
      // already ended
    }
    try {
      rec.abort?.()
    } catch {
      // already ended
    }
  }

  // Send owns the stop: the input shell announces every submit (send button,
  // Enter, or a claimed command) on the window — an ordinary default send
  // deliberately leaves the phase 'plain', so the published state cannot
  // carry this. A submit while dictating stops the recognizer, flips the
  // control back immediately, and swallows the results flushed by the stop,
  // so the draft the submission consumed is never rewritten.
  useEffect(() => {
    if (!listening) return
    window.addEventListener('dsh:composer-submit', stopForSend)
    return () => { window.removeEventListener('dsh:composer-submit', stopForSend) }
  }, [listening])

  // Net under the submit event: if the draft is cleared under us while
  // dictating (the optimistic send's commit, or the user wiping the box),
  // treat that as a send too — the sent text must not be dictated back into
  // the now-empty draft (it would invite a duplicate send).
  const draft = input?.draft
  const heardDraft = useRef(false)
  useEffect(() => {
    if (!listening) {
      heardDraft.current = false
      return
    }
    if (draft !== undefined && draft !== '') heardDraft.current = true
    else if (heardDraft.current) stopForSend()
  }, [draft, listening])

  function start(): void {
    const w = window as unknown as {
      SpeechRecognition?: RecognitionConstructor
      webkitSpeechRecognition?: RecognitionConstructor
    }
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (SR === undefined) {
      setErrorKey('mic.unsupported')
      return
    }
    const rec = new SR()
    rec.lang = navigator.language.startsWith('zh') ? 'zh-CN' : navigator.language
    rec.continuous = true
    rec.interimResults = true

    suppressRef.current = false
    baseRef.current = input?.draft ?? props.input?.draft ?? ''
    const finals: string[] = []
    let interim = ''

    rec.onresult = (event: RecognitionResultEvent) => {
      // A send-owned stop flushed the recognizer: nothing here may rewrite
      // the draft the submission already consumed.
      if (suppressRef.current) return
      interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result === undefined) continue
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) finals.push(text)
        else interim += text
      }
      const spoken = finals.join('') + interim
      inputActions?.setDraft(joinDraft(baseRef.current, spoken))
    }
    rec.onerror = (event: RecognitionErrorEvent) => {
      const code = event.error ?? 'unknown'
      const key = ERROR_KEYS[code]
      // '' (a send-owned abort) keeps the current copy; unknown codes carry
      // the raw engine code into the generic message.
      if (key === '') return
      setErrorKey(key ?? 'error.generic')
      if (key === undefined) setErrorCode(code)
      if (code !== 'no-speech') setListening(false)
    }
    rec.onend = () => {
      setListening(false)
    }

    recRef.current = rec
    setErrorKey(null)
    setListening(true)
    rec.start()
  }

  const errorText = errorKey === null
    ? ''
    : errorKey === 'error.generic'
      ? t('error.generic', { code: errorCode })
      : t(errorKey)
  const title = listening
    ? t('mic.listening')
    : errorKey === null
      ? t('mic.start')
      : errorText

  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      onMouseDown={(event) => { event.preventDefault() }}
      title={title}
      style={{
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: 15,
        lineHeight: 1,
        padding: '2px 4px',
        borderRadius: 6,
        opacity: errorKey === null ? 1 : 0.55,
        color: listening ? '#e5484d' : undefined,
      }}
    >
      {listening ? '⏹' : '🎤'}
    </button>
  )
}
