let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  try {
    const AudioContextConstructor = window.AudioContext
    if (!AudioContextConstructor) return null
    audioContext ??= new AudioContextConstructor()
    if (audioContext.state === 'closed') audioContext = new AudioContextConstructor()
    if (audioContext.state === 'suspended') {
      void audioContext.resume().catch(() => undefined)
    }
    return audioContext
  } catch {
    return null
  }
}

function playTone(frequency: number, startAt: number, duration: number, volume: number) {
  const context = getAudioContext()
  if (!context) return
  try {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(frequency, startAt)
    gain.gain.setValueAtTime(0.0001, startAt)
    gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(startAt)
    oscillator.stop(startAt + duration + 0.01)
  } catch {
    // Sound is an optional enhancement and must never block an interaction.
  }
}

export function playInterfaceSound() {
  const context = getAudioContext()
  if (!context) return
  const now = context.currentTime
  playTone(620, now, 0.035, 0.018)
}

export function playNotificationSound() {
  const context = getAudioContext()
  if (!context) return
  const now = context.currentTime
  playTone(740, now, 0.11, 0.045)
  playTone(960, now + 0.075, 0.12, 0.035)
}
