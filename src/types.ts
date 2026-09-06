export interface WordItem {
  id: string;
  kanji: string;
  reading: string;
  meaning: string;
  partOfSpeech: string;
  level: 'N5' | 'N4' | 'N3' | 'N2' | 'N1';
  hanViet: string;
  exampleJa: string;
  exampleRuby?: { text: string; ruby?: string }[];
  exampleVi: string;
  createdAt: string;
  reviewCount: number;
  correctStreak: number;
  lastRating?: 'Quên' | 'Khó' | 'Được' | 'Dễ';
  nextDueDate: string;
}

export interface KanjiItem {
  character: string;
  hanViet: string;
  meaning: string;
  level: string;
  wordIds: string[];
}

export type ScreenId = 'review' | 'add' | 'words' | 'kanji' | 'stats';

export type RatingChoice = 'Quên' | 'Khó' | 'Được' | 'Dễ';
