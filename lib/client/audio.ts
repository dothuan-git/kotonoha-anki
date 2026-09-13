import { rubyToReading } from '@/lib/ruby';

/**
 * TTS, which is the platform's.
 *
 * No audio is generated, stored or fetched — this is a single-user app that
 * does not need the infrastructure a speech provider would add, and the Web
 * Speech API already reads Japanese on every platform this runs on —
 * including on the train, because the voice is installed on the device
 * rather than streamed.
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

/**
 * Speak a word, which means speak its *reading* and never its headword.
 *
 * 開く is あく or ひらく, both correct Japanese, and the voice picks for
 * itself — it cannot know which of the two a card means, because a headword
 * is not a pronunciation. The reading is one, and `words.reading` is
 * `notNull`, so there is always one to hand.
 *
 * That the collection can hold 開く twice under two readings — see the
 * `(headword, reading)` unique index — is the same fact from the other side:
 * a headword does not identify a word here, so it cannot be what gets spoken.
 *
 * Sentences have the same problem and their own answer — `playSentenceAudio`,
 * which reads them out of their stored ruby.
 */
export function playWordAudio(word: { reading: string }): void {
  playJapaneseAudio(word.reading);
}

/**
 * Speak an example sentence from its stored furigana, not from its kanji.
 *
 * The same problem as `playWordAudio`, one level up: 開く inside a sentence is
 * あく or ひらく and the voice guesses, with no card beside it to consult. The
 * ruby was written by hand when the sentence was added — `lib/ruby.ts` says
 * why it has to be — so it is the only thing here that actually knows.
 *
 * The cost is real and worth stating. Kanji is what a TTS engine segments a
 * sentence on, and a line of unbroken kana leaves it guessing where the words
 * divide, so the phrasing comes out flatter than the kanji version would. For
 * an app whose whole purpose is teaching readings that is the right trade: a
 * reading that is flat and right beats one that is natural and wrong.
 *
 * Partial ruby degrades gracefully — an unannotated kanji is left as itself,
 * so a half-annotated sentence is spoken no worse than it is today.
 */
export function playSentenceAudio(sentence: { jpRuby: string }): void {
  playJapaneseAudio(rubyToReading(sentence.jpRuby));
}

/**
 * Native Japanese speech synthesis helper.
 *
 * Takes text the caller has already decided is pronounceable — a sentence, or
 * a reading. For a saved word use `playWordAudio`, which makes that decision
 * once instead of at each call site.
 */
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
