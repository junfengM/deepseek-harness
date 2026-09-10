/** `voice-input` namespace dictionaries: the mic control's copy and errors. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'mic.start': '语音输入（Web Speech API）',
  'mic.listening': '正在听写…点击停止',
  'mic.unsupported': '当前浏览器不支持 Web Speech API（请用 Chrome / Edge）',
  'error.notAllowed': '麦克风权限被拒绝（浏览器地址栏重新允许后重试）',
  'error.serviceNotAllowed': '语音识别服务被系统/浏览器策略禁止',
  'error.noSpeech': '未检测到语音',
  'error.audioCapture': '未找到可用麦克风',
  'error.network': '识别服务网络错误（Chrome 的 Web Speech 走云端，需联网）',
  'error.generic': '识别错误：{code}',
} satisfies Record<string, string>

/** The voice-input namespace key union. */
export type VoiceInputKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'mic.start': 'Voice input (Web Speech API)',
  'mic.listening': 'Dictating… click to stop',
  'mic.unsupported': 'This browser does not support the Web Speech API (use Chrome or Edge)',
  'error.notAllowed': 'Microphone permission denied (re-allow it from the address bar, then retry)',
  'error.serviceNotAllowed': 'Speech recognition is blocked by system or browser policy',
  'error.noSpeech': 'No speech detected',
  'error.audioCapture': 'No microphone available',
  'error.network': 'Recognition service network error (Chrome runs Web Speech in the cloud; a connection is required)',
  'error.generic': 'Recognition error: {code}',
} satisfies Record<VoiceInputKey, string>
