import { readFileSync } from 'node:fs';
import {
  PhotoVerdictSchema, ExtractionResultSchema, GeneratedRecipeSchema,
  ChatReplySchema, WeekInsightSchema,
} from '../src/lib/ai/ai.contracts.js';

const cases: [string, { safeParse: (v: unknown) => { success: boolean; error?: unknown } }][] = [
  ['photo.verdict', PhotoVerdictSchema],
  ['ingredients.from_photo', ExtractionResultSchema],
  ['ingredients.from_receipt', ExtractionResultSchema],
  ['ingredients.from_text', ExtractionResultSchema],
  ['recipe.generate', GeneratedRecipeSchema],
  ['chat.answer', ChatReplySchema],
  ['week.insight', WeekInsightSchema],
];

let pass = 0;
for (const [id, schema] of cases) {
  const raw: unknown = JSON.parse(readFileSync(`src/lib/ai/mock-data/${id}.json`, 'utf8'));
  const r = schema.safeParse(raw);
  if (r.success) { console.log(`  ✅ ${id}`); pass++; }
  else {
    const issues = (r.error as { issues: { path: unknown[]; message: string }[] }).issues;
    console.log(`  ❌ ${id}`);
    for (const i of issues.slice(0, 4)) console.log(`       ${i.path.join('.')}: ${i.message}`);
  }
}
console.log(`\n${pass}/${cases.length} canned answers satisfy their schema`);
if (pass !== cases.length) process.exit(1);
