// A short two-note chime, made with Web Audio so there's no file to fetch
let ctx: AudioContext | undefined;

// Browsers only let audio start from a click or key press, so call this from one
export function unlockSound(): Promise<void> {
  ctx ??= new AudioContext();
  return ctx.state === 'suspended' ? ctx.resume() : Promise.resolve();
}

export function chime(): void {
  const audio = ctx;
  if (!audio || audio.state !== 'running') return;
  const start = audio.currentTime;
  [880, 1320].forEach((freq, i) => {
    const t = start + i * 0.15;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.15, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.45);
  });
}
