/**
 * Loads the seeded recipe base.
 *
 * Idempotent: upserts on slug, so re-running updates rather than duplicating.
 *
 *   pnpm seed:meals
 */
import { connectDatabase, disconnectDatabase } from '../src/lib/db/connection.js';
import { MealModel } from '../src/features/meals/meals.model.js';
import { buildSeedMeals } from '../src/features/meals/seed/meals.seed.js';
import { byId } from '../src/shared/catalogue/index.js';

async function main(): Promise<void> {
  await connectDatabase();

  const meals = buildSeedMeals();

  // Fail loudly before writing: a meal referencing a catalogue id that does not
  // exist would never match anyone's kitchen, and would do it silently.
  const problems: string[] = [];
  for (const meal of meals) {
    for (const ingredient of meal.ingredients) {
      if (ingredient.catalogueId !== null && byId(ingredient.catalogueId) === undefined) {
        problems.push(`${meal.slug}: unknown catalogue id "${ingredient.catalogueId}"`);
      }
    }
    if (meal.ingredients.filter((i) => !i.optional).length === 0) {
      problems.push(`${meal.slug}: has no required ingredients — it would match every kitchen`);
    }
  }

  if (problems.length > 0) {
    console.error('Seed validation failed:');
    for (const problem of problems) console.error('  -', problem);
    process.exit(1);
  }

  for (const meal of meals) {
    await MealModel.findOneAndUpdate({ slug: meal.slug }, { $set: meal }, { upsert: true, new: true }).exec();
    console.log(`  ${meal.name.padEnd(32)} ${String(meal.ingredients.length).padStart(2)} ingredients · ${String(meal.steps.length)} steps`);
  }

  const total = await MealModel.countDocuments({ status: 'published' });
  console.log(`\n${String(meals.length)} meals seeded · ${String(total)} published in total`);

  await disconnectDatabase();
}

main().catch((error: unknown) => {
  console.error('seed failed', error);
  process.exit(1);
});
