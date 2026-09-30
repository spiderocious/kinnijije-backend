/**
 * Generates simpler versions of every recipe, streaming to a JSON file.
 *
 *   pnpm variants:build            # all meals
 *   pnpm variants:build -- --limit 5   # a sample, to eyeball first
 *
 * WHY THIS EXISTS
 * A kitchen holding yam and eggs should see yam and egg sauce, then plain
 * fried yam and egg, then boiled yam — not one full recipe and then five
 * dishes needing a shop. The catalogue only has full preparations, so the
 * simpler forms people actually cook are missing entirely.
 *
 * WHAT IT WRITES
 * One JSON array of NEW meal documents, importable straight into the `meals`
 * collection. Nothing existing is modified: every variant is a new `_id` and a
 * new slug, carrying `variantOf` so the ranker can collapse a family into one
 * shortlist row.
 *
 * STREAMING, not held in memory: the file is appended per meal, so a crash
 * halfway leaves a valid partial file rather than nothing.
 */
import { appendFileSync, writeFileSync } from 'node:fs';

import { connectDatabase, disconnectDatabase } from '../src/lib/db/connection.js';
import { MealModel, type MealAttributes } from '../src/features/meals/meals.model.js';
import { byId, resolve } from '../src/shared/catalogue/index.js';

const OUT = 'docs/seed/variant-dump.json';

/** Ingredients assumed present; never the thing that makes a variant simpler. */
function isPantry(catalogueId: string | null, name: string): boolean {
  if (catalogueId !== null) return byId(catalogueId)?.pantry === true;
  return resolve(name)?.pantry === true;
}

/** A URL-safe slug that will not collide with the parent. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Deterministic id, derived from the slug.
 *
 * Re-running the script produces the SAME ids, so a second import updates
 * rather than duplicating. A random id would mean every run doubled the
 * collection.
 */
function idFor(slug: string): string {
  let hash = 0;
  for (let i = 0; i < slug.length; i += 1) hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  return `meal_var_${Math.abs(hash).toString(36)}${String(slug.length).padStart(2, '0')}`;
}

interface Variant {
  suffix: string;
  quality: 'simple' | 'minimal';
  /** Keep this many of the non-pantry ingredients, in recipe order. */
  keep: number;
  timeFactor: number;
  note: string;
}

/**
 * The shapes a dish reduces to.
 *
 * Deliberately only two tiers below `full`, and both are real things people
 * cook rather than arbitrary truncations. A dish with few ingredients gets
 * fewer variants, because there is nothing left to take away.
 */
const SHAPES: readonly Variant[] = [
  {
    suffix: 'the easy way',
    quality: 'simple',
    keep: 4,
    timeFactor: 0.8,
    note: 'A pared-back version: the same dish with the optional flourishes left out.',
  },
  {
    suffix: 'quick version',
    quality: 'simple',
    keep: 3,
    timeFactor: 0.65,
    note: 'What you cook on a weeknight, with the essentials only.',
  },
  {
    suffix: 'bare bones',
    quality: 'minimal',
    keep: 2,
    timeFactor: 0.5,
    note: 'Almost nothing in the kitchen. Honest about what it is, and still a meal.',
  },
];

function buildVariant(meal: MealAttributes, shape: Variant): MealAttributes | null {
  const required = meal.ingredients.filter((i) => !i.optional);
  const core = required.filter((i) => !isPantry(i.catalogueId, i.name));
  const pantry = required.filter((i) => isPantry(i.catalogueId, i.name));

  // Nothing to simplify: a variant identical to its parent is noise.
  if (core.length <= shape.keep) return null;

  const kept = core.slice(0, shape.keep);
  const dropped = core.slice(shape.keep).map((i) => i.name);

  const name = `${meal.name} (${shape.suffix})`;
  const slug = slugify(name);

  // The steps that survive: those that do not name a dropped ingredient.
  const steps = meal.steps
    .filter((step) => !dropped.some((d) => step.description.toLowerCase().includes(d.toLowerCase())))
    .map((step, index) => ({ ...step, index: index + 1 }));

  return {
    _id: idFor(slug),
    slug,
    name,
    source: 'seed',
    status: 'published',
    cuisines: meal.cuisines,
    difficulty: shape.quality === 'minimal' ? 'easy' : meal.difficulty,
    cookTimeMinutes: Math.max(10, Math.round(meal.cookTimeMinutes * shape.timeFactor)),
    serves: meal.serves,
    whatMakesItGood: shape.note,
    description: `${shape.note} Based on ${meal.name}${dropped.length > 0 ? `, without ${dropped.slice(0, 3).join(', ').toLowerCase()}` : ''}.`,
    ingredients: [...kept, ...pantry],
    steps: steps.length > 0 ? steps : meal.steps.slice(0, 2).map((s, i) => ({ ...s, index: i + 1 })),
    ingredientKeys: [...kept, ...pantry].map((i) => i.catalogueId).filter((id): id is string => id !== null),
    heroIcon: meal.heroIcon,
    quality: shape.quality,
    variantOf: meal.slug,
    images: [],
    primaryImageId: null,
    createdBy: null,
  } as unknown as MealAttributes;
}

async function main(): Promise<void> {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg !== undefined ? Number(limitArg.split('=')[1]) : Infinity;

  await connectDatabase();

  const meals = (await MealModel.find({ status: 'published' })
    .sort({ slug: 1 })
    .lean()
    .exec()) as unknown as MealAttributes[];

  // Variants of variants would compound the simplification into nonsense.
  const parents = meals.filter((m) => (m.variantOf ?? null) === null).slice(0, limit);

  // Streamed: the file is valid JSON at every point, so a crash halfway leaves
  // something importable rather than nothing.
  writeFileSync(OUT, '[\n');
  let written = 0;
  const seen = new Set<string>();

  for (const meal of parents) {
    for (const shape of SHAPES) {
      const variant = buildVariant(meal, shape);
      if (variant === null) continue;
      if (seen.has(variant.slug)) continue;
      seen.add(variant.slug);

      appendFileSync(OUT, `${written > 0 ? ',\n' : ''}${JSON.stringify(variant, null, 2)}`);
      written += 1;
    }
    process.stdout.write(`  ${meal.name.padEnd(36)} -> ${String(written)} so far\n`);
  }

  appendFileSync(OUT, '\n]\n');
  process.stdout.write(`\n${String(written)} variants from ${String(parents.length)} meals -> ${OUT}\n`);

  await disconnectDatabase();
}

await main();
