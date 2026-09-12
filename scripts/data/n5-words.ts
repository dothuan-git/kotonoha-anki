/**
 * A starter deck: 50 N5 words, for a collection that would otherwise be empty.
 *
 * Only the three things a dictionary cannot supply are written here — the
 * Vietnamese meaning, and one example sentence with its ruby. Reading, part of
 * speech, transitivity, the JLPT hint and the kanji links all come from Jotoba
 * at seed time, through the same `lookup` the add form uses, so a seeded
 * row is indistinguishable from a hand-added one.
 *
 * `reading` is a selector, not data: it picks the right candidate when a
 * headword is ambiguous, and a mismatch is reported rather than guessed
 * through. `pos` is a fallback for the handful of words Jotoba tags in a way
 * `mapPos` cannot place.
 *
 * Sentences follow the same drafting constraints as elsewhere: N5–N4
 * vocabulary besides the target word, the word in its most frequent
 * pattern, ruby on every kanji.
 */
import type { Jlpt, Pos } from '../../lib/types';

/**
 * The level every word in this file is filed under.
 *
 * Jotoba carries no word-level JLPT: its hint is derived from the constituent
 * kanji and disagrees often (閉める hints N3, 少し hints N4; both are N5). The
 * add form exists to overrule that hint by hand, and a seed has no one to ask
 * — so the deck states its own level, and `/words` can correct any of them.
 */
export const DECK_LEVEL: Jlpt = 'N5';

export interface SeedWord {
  headword: string;
  /** Disambiguates the Jotoba candidate; must match what it returns. */
  reading: string;
  meaning: string;
  /** Used only if Jotoba's tags map to nothing. */
  pos?: Pos;
  /** Overrides DECK_LEVEL for a word that does not belong at it. */
  jlpt?: Jlpt;
  sentence: { jp: string; jpRuby: string; vi: string };
}

export const N5_WORDS: SeedWord[] = [
  // ── Verbs ──────────────────────────────────────────────────────────────
  {
    headword: '開ける',
    reading: 'あける',
    meaning: 'mở',
    sentence: {
      jp: '窓を開けてください。',
      jpRuby: '窓[まど]を開[あ]けてください。',
      vi: 'Xin hãy mở cửa sổ.',
    },
  },
  {
    headword: '閉める',
    reading: 'しめる',
    meaning: 'đóng',
    sentence: {
      jp: 'ドアを閉めてください。',
      jpRuby: 'ドアを閉[し]めてください。',
      vi: 'Xin hãy đóng cửa.',
    },
  },
  {
    headword: '飲む',
    reading: 'のむ',
    meaning: 'uống',
    sentence: {
      jp: '毎朝コーヒーを飲みます。',
      jpRuby: '毎朝[まいあさ]コーヒーを飲[の]みます。',
      vi: 'Mỗi sáng tôi uống cà phê.',
    },
  },
  {
    headword: '食べる',
    reading: 'たべる',
    meaning: 'ăn',
    sentence: {
      jp: '朝ごはんを食べましたか。',
      jpRuby: '朝[あさ]ごはんを食[た]べましたか。',
      vi: 'Bạn đã ăn sáng chưa?',
    },
  },
  {
    headword: '行く',
    reading: 'いく',
    meaning: 'đi',
    sentence: {
      jp: '明日学校へ行きます。',
      jpRuby: '明日[あした]学校[がっこう]へ行[い]きます。',
      vi: 'Ngày mai tôi đi đến trường.',
    },
  },
  {
    headword: '来る',
    reading: 'くる',
    meaning: 'đến',
    sentence: {
      jp: '友だちが家に来ます。',
      jpRuby: '友[とも]だちが家[いえ]に来[き]ます。',
      vi: 'Bạn tôi sẽ đến nhà.',
    },
  },
  {
    headword: '見る',
    reading: 'みる',
    meaning: 'xem, nhìn',
    sentence: {
      jp: '毎晩テレビを見ます。',
      jpRuby: '毎晩[まいばん]テレビを見[み]ます。',
      vi: 'Tối nào tôi cũng xem tivi.',
    },
  },
  {
    headword: '聞く',
    reading: 'きく',
    meaning: 'nghe; hỏi',
    sentence: {
      jp: '音楽を聞くのが好きです。',
      jpRuby: '音楽[おんがく]を聞[き]くのが好[す]きです。',
      vi: 'Tôi thích nghe nhạc.',
    },
  },
  {
    headword: '話す',
    reading: 'はなす',
    meaning: 'nói, nói chuyện',
    sentence: {
      jp: '日本語で話しましょう。',
      jpRuby: '日本語[にほんご]で話[はな]しましょう。',
      vi: 'Chúng ta hãy nói bằng tiếng Nhật.',
    },
  },
  {
    headword: '読む',
    reading: 'よむ',
    meaning: 'đọc',
    sentence: {
      jp: '図書館で本を読みます。',
      jpRuby: '図書館[としょかん]で本[ほん]を読[よ]みます。',
      vi: 'Tôi đọc sách ở thư viện.',
    },
  },
  {
    headword: '書く',
    reading: 'かく',
    meaning: 'viết',
    sentence: {
      jp: '名前をここに書いてください。',
      jpRuby: '名前[なまえ]をここに書[か]いてください。',
      vi: 'Xin hãy viết tên vào đây.',
    },
  },
  {
    headword: '買う',
    reading: 'かう',
    meaning: 'mua',
    sentence: {
      jp: 'スーパーで野菜を買います。',
      jpRuby: 'スーパーで野菜[やさい]を買[か]います。',
      vi: 'Tôi mua rau ở siêu thị.',
    },
  },
  {
    headword: '帰る',
    reading: 'かえる',
    meaning: 'về, trở về',
    sentence: {
      jp: '六時に家へ帰ります。',
      jpRuby: '六時[ろくじ]に家[いえ]へ帰[かえ]ります。',
      vi: 'Tôi về nhà lúc sáu giờ.',
    },
  },
  {
    headword: '待つ',
    reading: 'まつ',
    meaning: 'đợi, chờ',
    sentence: {
      jp: 'ここで少し待ってください。',
      jpRuby: 'ここで少[すこ]し待[ま]ってください。',
      vi: 'Xin hãy đợi ở đây một chút.',
    },
  },
  {
    headword: '働く',
    reading: 'はたらく',
    meaning: 'làm việc',
    sentence: {
      jp: '父は銀行で働いています。',
      jpRuby: '父[ちち]は銀行[ぎんこう]で働[はたら]いています。',
      vi: 'Bố tôi làm việc ở ngân hàng.',
    },
  },
  {
    headword: '休む',
    reading: 'やすむ',
    meaning: 'nghỉ, nghỉ ngơi',
    sentence: {
      jp: '今日は会社を休みます。',
      jpRuby: '今日[きょう]は会社[かいしゃ]を休[やす]みます。',
      vi: 'Hôm nay tôi nghỉ làm.',
    },
  },
  {
    headword: '起きる',
    reading: 'おきる',
    meaning: 'thức dậy',
    sentence: {
      jp: '毎朝六時に起きます。',
      jpRuby: '毎朝[まいあさ]六時[ろくじ]に起[お]きます。',
      vi: 'Mỗi sáng tôi dậy lúc sáu giờ.',
    },
  },
  {
    headword: '寝る',
    reading: 'ねる',
    meaning: 'ngủ, đi ngủ',
    sentence: {
      jp: '昨日は早く寝ました。',
      jpRuby: '昨日[きのう]は早[はや]く寝[ね]ました。',
      vi: 'Hôm qua tôi đi ngủ sớm.',
    },
  },
  {
    headword: '教える',
    reading: 'おしえる',
    meaning: 'dạy; chỉ, cho biết',
    sentence: {
      jp: '先生が日本語を教えます。',
      jpRuby: '先生[せんせい]が日本語[にほんご]を教[おし]えます。',
      vi: 'Thầy giáo dạy tiếng Nhật.',
    },
  },
  {
    headword: '習う',
    reading: 'ならう',
    meaning: 'học, tập',
    sentence: {
      jp: '姉はピアノを習っています。',
      jpRuby: '姉[あね]はピアノを習[なら]っています。',
      vi: 'Chị tôi đang học piano.',
    },
  },
  {
    headword: '分かる',
    reading: 'わかる',
    meaning: 'hiểu, biết',
    sentence: {
      jp: 'この漢字が分かりません。',
      jpRuby: 'この漢字[かんじ]が分[わ]かりません。',
      vi: 'Tôi không hiểu chữ Hán này.',
    },
  },
  {
    headword: '使う',
    reading: 'つかう',
    meaning: 'dùng, sử dụng',
    sentence: {
      jp: '仕事でパソコンを使います。',
      jpRuby: '仕事[しごと]でパソコンを使[つか]います。',
      vi: 'Tôi dùng máy tính trong công việc.',
    },
  },
  {
    headword: '作る',
    reading: 'つくる',
    meaning: 'làm, chế tạo, nấu',
    sentence: {
      jp: '母が晩ごはんを作ります。',
      jpRuby: '母[はは]が晩[ばん]ごはんを作[つく]ります。',
      vi: 'Mẹ tôi nấu bữa tối.',
    },
  },
  {
    headword: '歩く',
    reading: 'あるく',
    meaning: 'đi bộ',
    sentence: {
      jp: '駅まで歩いて行きます。',
      jpRuby: '駅[えき]まで歩[ある]いて行[い]きます。',
      vi: 'Tôi đi bộ đến ga.',
    },
  },

  // ── Nouns ──────────────────────────────────────────────────────────────
  {
    headword: '時間',
    reading: 'じかん',
    meaning: 'thời gian; tiếng (đồng hồ)',
    sentence: {
      jp: '今日は時間がありません。',
      jpRuby: '今日[きょう]は時間[じかん]がありません。',
      vi: 'Hôm nay tôi không có thời gian.',
    },
  },
  {
    headword: '学校',
    reading: 'がっこう',
    meaning: 'trường học',
    sentence: {
      jp: '学校まで歩いて行きます。',
      jpRuby: '学校[がっこう]まで歩[ある]いて行[い]きます。',
      vi: 'Tôi đi bộ đến trường.',
    },
  },
  {
    headword: '先生',
    reading: 'せんせい',
    meaning: 'giáo viên, thầy cô',
    sentence: {
      jp: '先生はとても親切です。',
      jpRuby: '先生[せんせい]はとても親切[しんせつ]です。',
      vi: 'Thầy giáo rất tử tế.',
    },
  },
  {
    headword: '友達',
    reading: 'ともだち',
    meaning: 'bạn, bạn bè',
    sentence: {
      jp: '友達と映画を見ました。',
      jpRuby: '友達[ともだち]と映画[えいが]を見[み]ました。',
      vi: 'Tôi đã xem phim với bạn.',
    },
  },
  {
    headword: '会社',
    reading: 'かいしゃ',
    meaning: 'công ty',
    sentence: {
      jp: '会社は駅の近くにあります。',
      jpRuby: '会社[かいしゃ]は駅[えき]の近[ちか]くにあります。',
      vi: 'Công ty ở gần nhà ga.',
    },
  },
  {
    headword: '電車',
    reading: 'でんしゃ',
    meaning: 'tàu điện',
    sentence: {
      jp: '電車で会社へ行きます。',
      jpRuby: '電車[でんしゃ]で会社[かいしゃ]へ行[い]きます。',
      vi: 'Tôi đi làm bằng tàu điện.',
    },
  },
  {
    headword: '天気',
    reading: 'てんき',
    meaning: 'thời tiết',
    sentence: {
      jp: '今日は天気がいいですね。',
      jpRuby: '今日[きょう]は天気[てんき]がいいですね。',
      vi: 'Hôm nay thời tiết đẹp nhỉ.',
    },
  },
  {
    headword: '部屋',
    reading: 'へや',
    meaning: 'phòng',
    sentence: {
      jp: '私の部屋は広くないです。',
      jpRuby: '私[わたし]の部屋[へや]は広[ひろ]くないです。',
      vi: 'Phòng của tôi không rộng.',
    },
  },
  {
    headword: '食べ物',
    reading: 'たべもの',
    meaning: 'đồ ăn, thức ăn',
    sentence: {
      jp: '好きな食べ物は何ですか。',
      jpRuby: '好[す]きな食[た]べ物[もの]は何[なん]ですか。',
      vi: 'Món ăn bạn thích là gì?',
    },
  },
  {
    headword: '名前',
    reading: 'なまえ',
    meaning: 'tên',
    sentence: {
      jp: 'お名前を教えてください。',
      jpRuby: 'お名前[なまえ]を教[おし]えてください。',
      vi: 'Xin cho tôi biết tên của bạn.',
    },
  },
  {
    headword: '仕事',
    reading: 'しごと',
    meaning: 'công việc',
    sentence: {
      jp: '今日の仕事は終わりました。',
      jpRuby: '今日[きょう]の仕事[しごと]は終[お]わりました。',
      vi: 'Công việc hôm nay đã xong.',
    },
  },
  {
    headword: '家族',
    reading: 'かぞく',
    meaning: 'gia đình',
    sentence: {
      jp: '私の家族は四人です。',
      jpRuby: '私[わたし]の家族[かぞく]は四人[よにん]です。',
      vi: 'Gia đình tôi có bốn người.',
    },
  },
  {
    headword: '毎日',
    reading: 'まいにち',
    meaning: 'mỗi ngày, hằng ngày',
    sentence: {
      jp: '毎日日本語を勉強します。',
      jpRuby: '毎日[まいにち]日本語[にほんご]を勉強[べんきょう]します。',
      vi: 'Mỗi ngày tôi học tiếng Nhật.',
    },
  },

  // ── I-adjectives ───────────────────────────────────────────────────────
  {
    headword: '高い',
    reading: 'たかい',
    meaning: 'cao; đắt',
    sentence: {
      jp: 'この店の魚は高いです。',
      jpRuby: 'この店[みせ]の魚[さかな]は高[たか]いです。',
      vi: 'Cá ở cửa hàng này đắt.',
    },
  },
  {
    headword: '安い',
    reading: 'やすい',
    meaning: 'rẻ',
    sentence: {
      jp: '駅の前の店は安いです。',
      jpRuby: '駅[えき]の前[まえ]の店[みせ]は安[やす]いです。',
      vi: 'Cửa hàng trước ga thì rẻ.',
    },
  },
  {
    headword: '新しい',
    reading: 'あたらしい',
    meaning: 'mới',
    sentence: {
      jp: '新しい靴を買いました。',
      jpRuby: '新[あたら]しい靴[くつ]を買[か]いました。',
      vi: 'Tôi đã mua đôi giày mới.',
    },
  },
  {
    headword: '古い',
    reading: 'ふるい',
    meaning: 'cũ',
    sentence: {
      jp: 'この建物はとても古いです。',
      jpRuby: 'この建物[たてもの]はとても古[ふる]いです。',
      vi: 'Toà nhà này rất cũ.',
    },
  },
  {
    headword: '忙しい',
    reading: 'いそがしい',
    meaning: 'bận, bận rộn',
    sentence: {
      jp: '今週はとても忙しいです。',
      jpRuby: '今週[こんしゅう]はとても忙[いそが]しいです。',
      vi: 'Tuần này tôi rất bận.',
    },
  },
  {
    headword: '楽しい',
    reading: 'たのしい',
    meaning: 'vui, thú vị',
    sentence: {
      jp: '昨日のパーティーは楽しかったです。',
      jpRuby: '昨日[きのう]のパーティーは楽[たの]しかったです。',
      vi: 'Bữa tiệc hôm qua rất vui.',
    },
  },
  {
    headword: '難しい',
    reading: 'むずかしい',
    meaning: 'khó',
    sentence: {
      jp: 'この問題は少し難しいです。',
      jpRuby: 'この問題[もんだい]は少[すこ]し難[むずか]しいです。',
      vi: 'Bài này hơi khó.',
    },
  },

  // ── Na-adjectives ──────────────────────────────────────────────────────
  {
    headword: '元気',
    reading: 'げんき',
    meaning: 'khoẻ, khoẻ mạnh',
    pos: 'Na-adjective',
    sentence: {
      jp: '祖母はとても元気です。',
      jpRuby: '祖母[そぼ]はとても元気[げんき]です。',
      vi: 'Bà tôi rất khoẻ.',
    },
  },
  {
    headword: '便利',
    reading: 'べんり',
    meaning: 'tiện lợi',
    pos: 'Na-adjective',
    sentence: {
      jp: 'この駅はとても便利です。',
      jpRuby: 'この駅[えき]はとても便利[べんり]です。',
      vi: 'Nhà ga này rất tiện lợi.',
    },
  },
  {
    headword: '静か',
    reading: 'しずか',
    meaning: 'yên tĩnh',
    pos: 'Na-adjective',
    sentence: {
      jp: '図書館はとても静かです。',
      jpRuby: '図書館[としょかん]はとても静[しず]かです。',
      vi: 'Thư viện rất yên tĩnh.',
    },
  },
  {
    headword: '有名',
    reading: 'ゆうめい',
    meaning: 'nổi tiếng',
    pos: 'Na-adjective',
    sentence: {
      jp: 'この店はラーメンで有名です。',
      jpRuby: 'この店[みせ]はラーメンで有名[ゆうめい]です。',
      vi: 'Quán này nổi tiếng về mì ramen.',
    },
  },

  // ── Adverbs & expressions ──────────────────────────────────────────────
  {
    headword: '少し',
    reading: 'すこし',
    meaning: 'một chút, hơi',
    pos: 'Adverb',
    sentence: {
      jp: 'ここで少し休みましょう。',
      jpRuby: 'ここで少[すこ]し休[やす]みましょう。',
      vi: 'Chúng ta nghỉ một chút ở đây nhé.',
    },
  },
  {
    headword: '大丈夫',
    reading: 'だいじょうぶ',
    meaning: 'không sao, ổn',
    pos: 'Na-adjective',
    sentence: {
      jp: '心配しないで、大丈夫です。',
      jpRuby: '心配[しんぱい]しないで、大丈夫[だいじょうぶ]です。',
      vi: 'Đừng lo, không sao đâu.',
    },
  },
];
