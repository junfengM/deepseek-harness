/**
 * MicButton — the composer tool-row voice dictation control (PoC).
 *
 * Sits in the `conversation.input.right` list seat. Click to start Web
 * Speech API dictation; recognized text is appended into the input draft
 * through `inputActions.setDraft` (the single public draft write path).
 * Interim results are shown live; the base draft is captured at start and
 * preserved (CJK-aware joining, no spurious spaces between han characters).
 */
import { useRef, useState } from 'react'

/** Structural view of what this seat actually consumes — keeps the PoC import-free. */
interface MicButtonProps {
  /** Owner share (InputZone): point-in-time input machine snapshot. */
  input?: { draft?: string } | undefined
  /** Session standard kit: the public input action face. */
  inputActions?: { setDraft(text: string): void } | undefined
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

const ERRORS: Record<string, string> = {
  'not-allowed': '麦克风权限被拒绝（浏览器地址栏重新允许后重试）',
  'service-not-allowed': '语音识别服务被系统/浏览器策略禁止',
  'no-speech': '未检测到语音',
  'audio-capture': '未找到可用麦克风',
  network: '识别服务网络错误（Chrome 的 Web Speech 走云端，需联网）',
  aborted: '',
}

export function MicButton(props: MicButtonProps) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  const baseRef = useRef('')

  function stop(): void {
    try {
      recRef.current?.stop()
    } catch {
      // already stopped
    }
  }

  function start(): void {
    const w = window as unknown as {
      SpeechRecognition?: RecognitionConstructor
      webkitSpeechRecognition?: RecognitionConstructor
    }
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (SR === undefined) {
      setError('当前浏览器不支持 Web Speech API（请用 Chrome / Edge）')
      return
    }
    const rec = new SR()
    rec.lang = navigator.language?.startsWith('zh') ? 'zh-CN' : (navigator.language ?? 'zh-CN')
    rec.continuous = true
    rec.interimResults = true

    baseRef.current = props.input?.draft ?? ''
    const finals: string[] = []
    let interim = ''

    rec.onresult = (event: RecognitionResultEvent) => {
      interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result === undefined) continue
        const text = String(result[0]?.transcript ?? '')
        if (result.isFinal) finals.push(text)
        else interim += text
      }
      const spoken = finals.join('') + interim
      props.inputActions?.setDraft(joinDraft(baseRef.current, spoken))
    }
    rec.onerror = (event: RecognitionErrorEvent) => {
      const code = String(event?.error ?? 'unknown')
      setError(ERRORS[code] ?? `识别错误：${code}`)
      if (code !== 'no-speech') setListening(false)
    }
    rec.onend = () => {
      setListening(false)
    }

    recRef.current = rec
    setError('')
    setListening(true)
    rec.start()
  }

  const title = listening
    ? '正在听写…点击停止'
    : error === ''
      ? '语音输入（Web Speech API）'
      : error

  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      onMouseDown={event => event.preventDefault()}
      title={title}
      style={{
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: 15,
        lineHeight: 1,
        padding: '2px 4px',
        borderRadius: 6,
        opacity: error === '' ? 1 : 0.55,
        color: listening ? '#e5484d' : undefined,
      }}
    >
      {listening ? '⏹' : '🎤'}
    </button>
  )
}
