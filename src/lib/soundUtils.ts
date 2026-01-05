/**
 * Sound Utilities
 * 
 * Provides audio feedback for pill window state changes using Web Audio API.
 * All sounds are designed to be subtle and non-intrusive.
 */

export type SoundType = "processing" | "done";

/**
 * Play sound effect using Web Audio API
 * 
 * @param type - The type of sound to play ("processing" or "done")
 */
export function playSound(type: SoundType): void {
  try {
    const audioContext = new (
      window.AudioContext || (window as any).webkitAudioContext
    )();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    if (type === "processing") {
      playProcessingSound(oscillator, gainNode, audioContext);
    } else if (type === "done") {
      playDoneSound(audioContext);
    }
  } catch (error) {
    // Silently fail if audio context is not available
    console.log("Audio playback not available:", error);
  }
}

/**
 * Play processing sound: gentle ascending tone
 */
function playProcessingSound(
  oscillator: OscillatorNode,
  gainNode: GainNode,
  audioContext: AudioContext
): void {
  // Processing sound: gentle ascending tone
  oscillator.frequency.setValueAtTime(400, audioContext.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(
    600,
    audioContext.currentTime + 0.15,
  );
  oscillator.type = "sine";
  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(
    0.01,
    audioContext.currentTime + 0.15,
  );
  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.15);
}

/**
 * Play done sound: pleasant success chime (two-tone)
 */
function playDoneSound(audioContext: AudioContext): void {
  // Done sound: pleasant success chime (two-tone)
  const playTone = (freq: number, time: number, duration: number) => {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.3, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.01, time + duration);
    osc.start(time);
    osc.stop(time + duration);
  };
  playTone(523.25, audioContext.currentTime, 0.1); // C5
  playTone(659.25, audioContext.currentTime + 0.1, 0.15); // E5
}

