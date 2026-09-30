#!/usr/bin/env python3
"""Verify meals-100.json against the live catalogue, units and icon set.

Run from the backend directory:

    python3 docs/seed/verify-meals.py

Exists because the dangerous error in a seed file is silent. A wrong
`catalogueId` imports cleanly, shows up in the admin console, and is simply
never suggested to anybody — nothing is logged, nothing fails. So the ids are
checked against the real source rather than trusted.
"""
import json, re, sys, pathlib

BACKEND = pathlib.Path(__file__).resolve().parents[2]
ROOT = BACKEND.parent
MEALS = pathlib.Path(__file__).parent / 'meals-100.json'

catalogue_src = (BACKEND / 'src/shared/catalogue/catalogue.data.ts').read_text()
CATALOGUE = set(re.findall(r'id:\s*"([a-z0-9_]+)"', catalogue_src))

units_src = (BACKEND / 'src/shared/catalogue/units.ts').read_text()
UNITS = set(re.findall(r"id:\s*'([a-z_]+)'", units_src))

icons_src = (ROOT / 'web/src/ui/icons/koboyo-data.ts').read_text()
ICONS = set(re.findall(r'^  ([a-zA-Z0-9]+):', icons_src, re.M))

meals = json.loads(MEALS.read_text())
errors = []

for m in meals:
    slug = m['slug']

    if m['heroIcon'] not in ICONS:
        errors.append(f"{slug}: heroIcon '{m['heroIcon']}' is not a koboyo icon")
    if m['difficulty'] not in ('easy', 'medium', 'involved'):
        errors.append(f"{slug}: difficulty '{m['difficulty']}' not in enum")
    if m['status'] != 'published':
        errors.append(f"{slug}: status is '{m['status']}', will not be suggested")
    if m['source'] not in ('seed', 'ai'):
        errors.append(f"{slug}: source '{m['source']}' not in enum")

    declared = set()
    for ing in m['ingredients']:
        cid = ing['catalogueId']
        if cid is not None:
            if cid not in CATALOGUE:
                errors.append(f"{slug}: catalogueId '{cid}' DOES NOT EXIST")
            declared.add(cid)
        if ing['unit'] is not None and ing['unit'] not in UNITS:
            errors.append(f"{slug}: unit '{ing['unit']}' is not a real unit")
        if ing['unit'] is not None and ing['quantity'] is None:
            errors.append(f"{slug}: '{ing['name']}' has a unit but no quantity")

    # ingredientKeys is what matching actually reads. If it disagrees with the
    # ingredient list the meal matches on the wrong things, or on nothing.
    if set(m['ingredientKeys']) != declared:
        missing = declared - set(m['ingredientKeys'])
        extra = set(m['ingredientKeys']) - declared
        errors.append(f"{slug}: ingredientKeys out of sync (missing {missing or '-'}, extra {extra or '-'})")
    if not m['ingredientKeys']:
        errors.append(f"{slug}: EMPTY ingredientKeys — will never be suggested")

    for i, step in enumerate(m['steps']):
        if step['index'] != i + 1:
            errors.append(f"{slug}: step {i} has index {step['index']}")

slugs = [m['slug'] for m in meals]
if len(set(slugs)) != len(slugs):
    errors.append("duplicate slugs within the file")
ids = [m['_id'] for m in meals]
if len(set(ids)) != len(ids):
    errors.append("duplicate _id within the file")

print(f"{len(meals)} meals")
print(f"{len({c for m in meals for c in m['ingredientKeys']})} distinct ingredients, "
      f"all resolved against {len(CATALOGUE)} catalogue entries")

if errors:
    print(f"\n{len(errors)} PROBLEMS:")
    for e in errors:
        print("  -", e)
    sys.exit(1)
print("\nall checks passed")
