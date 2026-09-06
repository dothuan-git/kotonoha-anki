/**
 * Native Japanese speech synthesis helper
 */
export function playJapaneseAudio(text: string): void {
  if (!('speechSynthesis' in window)) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ja-JP';
  utterance.rate = 0.9; // Natural clear cadence for study

  // Try to find a high quality ja-JP voice if available
  const voices = window.speechSynthesis.getVoices();
  const jaVoice = voices.find((v) => v.lang.startsWith('ja') || v.name.includes('Japanese'));
  if (jaVoice) {
    utterance.voice = jaVoice;
  }

  window.speechSynthesis.speak(utterance);
}
