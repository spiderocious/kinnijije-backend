/**
 * Turning a stored date into a string for the wire.
 *
 * `doc.createdAt.toISOString()` looks safe — mongoose declares it non-optional,
 * so TypeScript agrees — but the TYPE is a promise about the schema, not about
 * the bytes in the database. A document written before a field existed, one
 * inserted by a script or an import, or a `.select()` that left the field out
 * all produce `undefined` at runtime, and the call throws.
 *
 * That threw a 500 on `/admin/users` in production: one old account with no
 * `createdAt` took down the whole list for everybody.
 *
 * So: never call `.toISOString()` directly on stored data. Use these.
 */

/** A date that may not be there. Null when it is not. */
export function isoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  // Mongo can hand back a string when a document was imported rather than
  // written through mongoose.
  const date = value instanceof Date ? value : new Date(value);

  // An unparseable date is not a date. Returning "Invalid Date" downstream is
  // worse than returning nothing.
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}
