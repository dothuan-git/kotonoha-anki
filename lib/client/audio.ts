/**
 * §13's TTS, which is the platform's.
 *
 * No audio is generated, stored or fetched. §2 lists no speech provider and
 * §1 rules out infrastructure this app does not need, and the Web Speech API
 * already reads Japanese on every platform this runs on — including on the
 * train, because the voice is installed on the device rather than streamed.
 * A stored MP3 per word would buy identical audio across devices at the cost
 * of a provider, a key, a blob store and a sync path, for a single user who
 * listens on one phone.
 *
 * What the platform does not give for free is *knowing whether it will work*.
 * A device with no Japanese voice speaks 開ける in English and the mistake is
 * invisible until you hear it. That is what `hasJapaneseVoice` is for, and why
 * the add form asks before saving rather than at review time.
 */

/** Voices arrive asynchronously in Chrome; an early `getVoices()` is empty. */
let cached: SpeechSynthesisVoice[] | null = null;

function voices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  const current = window.speechSynthesis.getVoices();
  if (current.length > 0) cached = current;
  return cached ?? [];
}

function japaneseVoice(): SpeechSynthesisVoice | undefined {
  return voices().find((v) => v.lang.replace('_', '-').toLowerCase().startsWith('ja'));
}

/**
 * Warms the voice list and calls back when it is known.
 *
 * `voiceschanged` is the only reliable signal that the list has loaded, and it
 * fires once, early. A caller that mounts after it has to cope with the list
 * already being there, which is why the callback runs immediately in that case.
 */
export function onVoicesReady(callback: () => void): () => void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return () => {};
  if (voices().length > 0) {
    callback();
    return () => {};
  }
  const handler = () => {
    voices();
    callback();
  };
  window.speechSynthesis.addEventListener('voiceschanged', handler);
  return () => window.speechSynthesis.removeEventListener('voiceschanged', handler);
}

/** Whether this device can actually read Japanese aloud. */
export function hasJapaneseVoice(): boolean {
  return japaneseVoice() !== undefined;
}

/** Native Japanese speech synthesis helper */
export function playJapaneseAudio(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ja-JP';
  utterance.rate = 0.9; // Natural clear cadence for study

  const voice = japaneseVoice();
  if (voice) utterance.voice = voice;

  window.speechSynthesis.speak(utterance);
}
