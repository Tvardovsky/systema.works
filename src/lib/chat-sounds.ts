/**
 * Chat Widget Sound Effects
 * Subtle, modern sounds for chat interactions
 */

type SoundType = 'send' | 'receive' | 'open' | 'close';

export class ChatSoundManager {
  private audioContext: AudioContext | null = null;
  private enabled: boolean = true;
  private volume: number = 0.3;

  constructor() {
    // Initialize audio context on user interaction
    this.initAudioContext();
  }

  private initAudioContext() {
    if (typeof window === 'undefined') return;
    
    const init = () => {
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }
    };

    // Initialize on first user interaction
    document.addEventListener('click', init, { once: true });
    document.addEventListener('keydown', init, { once: true });
  }

  private playTone(frequency: number, duration: number, type: OscillatorType = 'sine', delay: number = 0) {
    if (!this.enabled || !this.audioContext) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = type;

    const now = this.audioContext.currentTime + delay;
    
    gainNode.gain.setValueAtTime(this.volume, now);
    gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);

    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  play(type: SoundType) {
    if (!this.enabled) return;

    switch (type) {
      case 'send':
        // Quick ascending tone for sent message
        this.playTone(587, 0.1, 'sine', 0);      // D5
        this.playTone(784, 0.1, 'sine', 0.05);   // G5
        break;

      case 'receive':
        // Soft descending chime for received message
        this.playTone(784, 0.15, 'sine', 0);     // G5
        this.playTone(659, 0.15, 'sine', 0.08);  // E5
        this.playTone(523, 0.2, 'sine', 0.16);   // C5
        break;

      case 'open':
        // Pleasant ascending arpeggio for opening chat
        this.playTone(523, 0.1, 'sine', 0);      // C5
        this.playTone(659, 0.1, 'sine', 0.05);   // E5
        this.playTone(784, 0.15, 'sine', 0.1);   // G5
        break;

      case 'close':
        // Gentle descending tone for closing chat
        this.playTone(784, 0.1, 'sine', 0);      // G5
        this.playTone(659, 0.1, 'sine', 0.05);   // E5
        this.playTone(523, 0.15, 'sine', 0.1);   // C5
        break;
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
  }
}

// Export singleton instance
export const chatSoundManager = new ChatSoundManager();
