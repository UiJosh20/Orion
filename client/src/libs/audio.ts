// src/libs/audio.ts
export class AudioService {
  private static audioContext: AudioContext | null = null;
  private static oscillator: OscillatorNode | null = null;
  private static gainNode: GainNode | null = null;
  private static isPlaying = false;
  private static currentAlertId: string | null = null;

  /**
   * Play a continuous alert sound that loops until stopped
   */
  public static playAlertSound(alertId: string): void {
    // If the same alert is already playing, don't restart
    if (this.currentAlertId === alertId && this.isPlaying) {
      console.log('[Audio] Alert sound already playing for:', alertId);
      return;
    }

    // Stop any existing sound
    this.stopAlertSound();

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) {
        console.warn('[Audio] Web Audio API not supported');
        return;
      }

      this.audioContext = new AudioContextClass();
      
      // Resume context if it's suspended (autoplay policy)
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }

      // Create oscillator for the alert tone
      this.oscillator = this.audioContext.createOscillator();
      this.gainNode = this.audioContext.createGain();

      // Use a more noticeable sound - alternating frequencies
      this.oscillator.type = 'square'; // More piercing sound
      this.oscillator.frequency.setValueAtTime(880, this.audioContext.currentTime); // A5

      // Create a more complex pattern - frequency modulation for attention
      const now = this.audioContext.currentTime;
      
      // Alternate between two frequencies for a siren-like effect
      this.oscillator.frequency.setValueAtTime(880, now);
      this.oscillator.frequency.setValueAtTime(660, now + 0.3);
      this.oscillator.frequency.setValueAtTime(880, now + 0.6);
      this.oscillator.frequency.setValueAtTime(660, now + 0.9);
      this.oscillator.frequency.setValueAtTime(880, now + 1.2);

      // Set volume - start at moderate, then pulse
      this.gainNode.gain.setValueAtTime(0.3, now);
      this.gainNode.gain.exponentialRampToValueAtTime(0.4, now + 0.1);
      this.gainNode.gain.exponentialRampToValueAtTime(0.2, now + 0.2);
      this.gainNode.gain.exponentialRampToValueAtTime(0.4, now + 0.3);
      this.gainNode.gain.exponentialRampToValueAtTime(0.2, now + 0.4);

      this.oscillator.connect(this.gainNode);
      this.gainNode.connect(this.audioContext.destination);

      // Start the oscillator
      this.oscillator.start(now);
      
      // Set up looping - schedule it to loop indefinitely
      this.currentAlertId = alertId;
      this.isPlaying = true;

      // Store reference to cancel loop
      this.loopSound(alertId);

      console.log('[Audio] Alert sound started for:', alertId);

    } catch (error) {
      console.error('[Audio] Error playing alert sound:', error);
    }
  }

  /**
   * Loop the sound by recreating the oscillator when it ends
   */
  private static loopSound(alertId: string): void {
    if (!this.isPlaying || this.currentAlertId !== alertId) return;

    // Check if audio context is still valid
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.isPlaying = false;
      return;
    }

    // Create a new oscillator after the current one ends
    const now = this.audioContext.currentTime;
    const duration = 1.5; // Duration of each loop

    // Schedule the next loop
    setTimeout(() => {
      // Check if we should continue playing
      if (this.isPlaying && this.currentAlertId === alertId && this.audioContext) {
        try {
          // Recreate the sound for the next loop
          const newOscillator = this.audioContext.createOscillator();
          const newGain = this.audioContext.createGain();

          newOscillator.type = 'square';
          // Create alternating pattern for attention
          const startTime = this.audioContext.currentTime;
          newOscillator.frequency.setValueAtTime(880, startTime);
          newOscillator.frequency.setValueAtTime(660, startTime + 0.3);
          newOscillator.frequency.setValueAtTime(880, startTime + 0.6);
          newOscillator.frequency.setValueAtTime(660, startTime + 0.9);
          newOscillator.frequency.setValueAtTime(880, startTime + 1.2);

          newGain.gain.setValueAtTime(0.3, startTime);
          newGain.gain.exponentialRampToValueAtTime(0.4, startTime + 0.1);
          newGain.gain.exponentialRampToValueAtTime(0.2, startTime + 0.2);

          newOscillator.connect(newGain);
          newGain.connect(this.audioContext.destination);

          newOscillator.start(startTime);
          newOscillator.stop(startTime + 1.5);

          // Store new nodes
          this.oscillator = newOscillator;
          this.gainNode = newGain;

          // Schedule next loop
          this.loopSound(alertId);

        } catch (error) {
          console.error('[Audio] Error in loop:', error);
          this.isPlaying = false;
        }
      } else {
        this.isPlaying = false;
      }
    }, duration * 1000);
  }

  /**
   * Stop the alert sound
   */
  public static stopAlertSound(): void {
    console.log('[Audio] Stopping alert sound...');
    
    this.isPlaying = false;
    this.currentAlertId = null;

    try {
      if (this.oscillator) {
        try {
          this.oscillator.stop();
        } catch (e) {
          // Oscillator may already be stopped
        }
        this.oscillator.disconnect();
        this.oscillator = null;
      }

      if (this.gainNode) {
        this.gainNode.disconnect();
        this.gainNode = null;
      }

      if (this.audioContext && this.audioContext.state !== 'closed') {
        // Don't close the context, just suspend it
        this.audioContext.suspend();
      }
    } catch (error) {
      console.error('[Audio] Error stopping sound:', error);
    }
  }

  /**
   * Check if sound is currently playing
   */
  public static isSoundPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Clean up audio resources
   */
  public static cleanup(): void {
    this.stopAlertSound();
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (e) {
        // Ignore
      }
      this.audioContext = null;
    }
  }
}

// Export the main function for backward compatibility
export const playAlarmSound = (alertId: string): void => {
  AudioService.playAlertSound(alertId);
};

export const stopAlarmSound = (): void => {
  AudioService.stopAlertSound();
};