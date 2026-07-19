let context: AudioContext | null = null;

function getContext() {
    if (context) return context;
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    context = new AudioContextClass();
    return context;
}

export function unlockGenerationCompleteSound() {
    try {
        const audioContext = getContext();
        if (audioContext?.state === "suspended") void audioContext.resume().catch(() => undefined);
    } catch {
        // Sound support must never block generation.
    }
}

export function playGenerationCompleteSound() {
    try {
        const audioContext = getContext();
        if (!audioContext) return;
        if (audioContext.state === "suspended") void audioContext.resume().catch(() => undefined);
        const gain = audioContext.createGain();
        gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.58);
        gain.connect(audioContext.destination);

        [660, 880, 1320].forEach((frequency, index) => {
            const oscillator = audioContext.createOscillator();
            oscillator.type = "sine";
            oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime + index * 0.08);
            oscillator.connect(gain);
            oscillator.start(audioContext.currentTime + index * 0.08);
            oscillator.stop(audioContext.currentTime + 0.34 + index * 0.08);
        });

        window.setTimeout(() => gain.disconnect(), 900);
    } catch {
        // Browser audio can be blocked; generation should still succeed.
    }
}
