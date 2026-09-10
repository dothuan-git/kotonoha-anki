import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import type { DraftResult, LookupCandidate } from '@/lib/types';

const MODEL = 'claude-sonnet-4-6';

/** §9's response contract. `jp_ruby` is the wire name; we expose `jpRuby`. */
const draftSchema = z.object({
  meaning: z.string().min(1),
  sentence: z.object({
    jp: z.string().min(1),
    jp_ruby: z.string().min(1),
    vi: z.string().min(1),
  }),
});

const jsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['meaning', 'sentence'],
  properties: {
    meaning: { type: 'string' },
    sentence: {
      type: 'object',
      additionalProperties: false,
      required: ['jp', 'jp_ruby', 'vi'],
      properties: {
        jp: { type: 'string' },
        jp_ruby: { type: 'string' },
        vi: { type: 'string' },
      },
    },
  },
} as const;

const SYSTEM = `Bạn soạn thẻ từ vựng tiếng Nhật cho một người Việt đang tự học.

Với từ được cho, hãy trả về:

1. "meaning" — nghĩa tiếng Việt của từ, viết đúng văn phong của một quyển từ điển Nhật–Việt dành cho người học. Tuyệt đối không dùng tiếng Anh. Không giải thích, không ví dụ, không ghi chú từ loại.

2. "sentence" — một câu ví dụ duy nhất:
   - "jp": câu tiếng Nhật dài 10–15 âm tiết (mora).
   - Ngoài từ đích, chỉ dùng từ vựng trình độ N5–N4.
   - Câu phải thể hiện từ đích trong mẫu ngữ pháp thường gặp nhất của nó.
   - "jp_ruby": đúng câu đó, có phiên âm furigana cho MỌI chữ kanji, theo định dạng ngoặc vuông: 窓[まど]を開[あ]けてください。 Mỗi cụm kanji được theo sau bởi cách đọc hiragana trong ngoặc vuông. Chữ không phải kanji không có ngoặc.
   - "vi": bản dịch tiếng Việt tự nhiên của câu đó.

Chỉ trả về JSON. Không thêm lời dẫn, không dùng khối mã.`;

function userPrompt(headword: string, candidate: LookupCandidate | null): string {
  const lines = [`Từ: ${headword}`];
  if (candidate) {
    if (candidate.reading) lines.push(`Cách đọc: ${candidate.reading}`);
    if (candidate.pos) lines.push(`Từ loại: ${candidate.pos}`);
    if (candidate.transitivity) {
      lines.push(
        `Tính chất: ${candidate.transitivity === 'transitive' ? 'tha động từ' : 'tự động từ'}`,
      );
    }
    if (candidate.glosses.length > 0) {
      // English glosses are the only sense data Jotoba has. They disambiguate
      // which 開ける is meant; the output must still be Vietnamese only.
      lines.push(`Nghĩa tiếng Anh (chỉ để phân biệt nghĩa, đừng dịch máy móc): ${candidate.glosses.join('; ')}`);
    }
  }
  return lines.join('\n');
}

function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/** Strips a fence if one appears despite the schema and the instruction. */
function stripFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced?.[1] ?? text).trim();
}

/**
 * Drafts a Vietnamese meaning and an example sentence (§9).
 *
 * Validated with Zod and retried once on a parse failure. Structured outputs
 * make prose and fences impossible rather than merely discouraged, but the
 * validate-and-retry path is kept as the safety net the plan asks for.
 *
 * The caller must never block saving on this — see app/api/draft/route.ts.
 */
export async function draftWord(
  headword: string,
  candidate: LookupCandidate | null,
): Promise<DraftResult> {
  const client = new Anthropic();
  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: userPrompt(headword, candidate) },
  ];

  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages,
      output_config: {
        format: { type: 'json_schema', schema: jsonSchema },
      },
    });

    const text = extractText(response.content);

    try {
      const parsed = draftSchema.parse(JSON.parse(stripFence(text)));
      return {
        meaning: parsed.meaning,
        sentence: {
          jp: parsed.sentence.jp,
          jpRuby: parsed.sentence.jp_ruby,
          vi: parsed.sentence.vi,
        },
      };
    } catch (error) {
      lastError = error;
      messages.push(
        { role: 'assistant', content: text },
        {
          role: 'user',
          content:
            'Phản hồi đó không đúng định dạng JSON yêu cầu. Trả về lại đúng một đối tượng JSON với các khoá meaning và sentence (jp, jp_ruby, vi). Không thêm gì khác.',
        },
      );
    }
  }

  throw new Error(`Drafting produced unparseable output: ${String(lastError)}`);
}
