"""
Clean up the series column in the editions table.

Strategy:
1. NULL out series that are clearly not real book series:
   - Non-Latin first character (Cyrillic, CJK, Arabic, etc.)
   - Known publisher imprint patterns
   - Catalog/reference numbers
   - Digital collection names
   - Too short (<=3 chars) or too long (>150 chars)
2. For each work, find the most common series name. If a series name
   appears on only 1 edition of a work (and the work has >3 editions
   with series), it's likely noise — NULL it out.
3. Add series/series_number columns to the works table with the
   consensus value.
"""

import sqlite3
import re
import sys

DB_PATH = sys.argv[1] if len(sys.argv) > 1 else "data/openlibrary-trimmed.db"

conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA journal_mode=WAL")
conn.execute("PRAGMA cache_size=-64000")
c = conn.cursor()

before = c.execute("SELECT COUNT(*) FROM editions WHERE series IS NOT NULL").fetchone()[0]
print(f"Editions with series before cleanup: {before:,}")

# Step 1: NULL out obviously junk series values
print("\nStep 1: Removing obvious junk...")

junk_updates = [
    # Non-Latin first character
    ("Non-Latin", "series NOT GLOB '[A-Za-z0-9\"(]*'"),
    # Too short or too long
    ("Too short/long", "LENGTH(series) <= 3 OR LENGTH(series) > 150"),
    # Digital/archival collections (very common in OL)
    ("Digital collections", """
        series LIKE '%Collections Online%'
        OR series LIKE '%Early English books%'
        OR series LIKE '%Early Arabic%'
        OR series LIKE '%SAMP early%'
        OR series LIKE '%Three centuries of drama%'
        OR series LIKE '%Making of modern%'
        OR series LIKE '%Making of the Modern%'
        OR series LIKE '%Slavery and anti-slavery%'
        OR series LIKE '%Women''s Studies Archive%'
        OR series LIKE '%Historische Quellen%'
        OR series LIKE '%Water-resources investigations%'
        OR series LIKE '%monographs%' AND series NOT LIKE '%series%'
    """),
    # Publisher imprints and reprint series
    ("Publisher imprints", """
        series LIKE '%large print%'
        OR series LIKE '%Large Print%'
        OR series LIKE '%casebook series%'
        OR series LIKE '%reprint series%'
        OR series LIKE '%Reprint Series%'
        OR series LIKE 'Penguin%'
        OR series LIKE 'Pelican%'
        OR series LIKE 'Everyman%'
        OR series LIKE 'A Studio book%'
        OR series LIKE 'Teach yourself%'
        OR series LIKE 'Clarendon Press%'
        OR series LIKE 'Oxford medical%'
        OR series LIKE 'Oxford world%'
        OR series LIKE 'G.K. Hall%'
        OR series LIKE 'Signet classic%'
        OR series LIKE 'A Signet%'
        OR series LIKE 'Vintage%'
        OR series LIKE 'Bantam classic%'
        OR series LIKE 'Fawcett%'
        OR series LIKE 'Pocket book%'
        OR series LIKE 'Mentor book%'
        OR series LIKE 'Anchor book%'
        OR series LIKE 'Dover%'
        OR series LIKE 'Beacon%paperback%'
    """),
    # Catalog numbers and IDs
    ("Catalog numbers", """
        series LIKE 'eBook%'
        OR series LIKE 'ISBN%'
        OR series LIKE 'S. hrg.%'
        OR series LIKE 'NBER%'
        OR series LIKE 'SuDoc%'
        OR series LIKE '%working paper%'
        OR series LIKE '%Working Paper%'
        OR series LIKE '%technical report%'
        OR series LIKE '%Technical Report%'
        OR series LIKE '%investigations report%'
    """),
    # Academic/reference series unlikely to be what users want
    ("Academic reference", """
        series LIKE 'Loeb classical%'
        OR series LIKE 'Bibliotheca scriptorum%'
        OR series LIKE 'Classiques Garnier%'
        OR series LIKE '%Heath''s modern language%'
        OR series LIKE 'International library of sociology%'
        OR series LIKE 'English men of letters%'
        OR series LIKE 'Essay index%'
        OR series LIKE 'Landmarks of science%'
        OR series LIKE 'Landmarks II%'
        OR series LIKE 'Literature of theology%'
        OR series LIKE 'Cicognara%'
    """),
    # Generic collection names
    ("Generic collections", """
        series LIKE '%Images of America%'
        OR series LIKE 'Minguo ji cui%'
    """),
]

total_nulled = 0
for label, condition in junk_updates:
    c.execute(f"UPDATE editions SET series = NULL, series_number = NULL WHERE series IS NOT NULL AND ({condition})")
    affected = c.rowcount
    total_nulled += affected
    print(f"  {label}: {affected:,} rows cleaned")

conn.commit()
print(f"  Total cleaned in step 1: {total_nulled:,}")

after_step1 = c.execute("SELECT COUNT(*) FROM editions WHERE series IS NOT NULL").fetchone()[0]
print(f"  Remaining with series: {after_step1:,}")

# Step 2: For each work, NULL out series that appear on only 1 edition
# (when the work has multiple editions with series — singleton series on
# a work with only 1 series edition is fine, that's likely correct)
print("\nStep 2: Removing singleton series per work...")

c.execute("""
    UPDATE editions SET series = NULL, series_number = NULL
    WHERE rowid IN (
        SELECT e.rowid
        FROM editions e
        JOIN (
            SELECT work_key, series, COUNT(*) as cnt
            FROM editions
            WHERE series IS NOT NULL
            GROUP BY work_key, series
            HAVING cnt = 1
        ) singles ON e.work_key = singles.work_key AND e.series = singles.series
        WHERE e.work_key IN (
            SELECT work_key
            FROM editions
            WHERE series IS NOT NULL
            GROUP BY work_key
            HAVING COUNT(DISTINCT series) > 1
        )
    )
""")
step2_cleaned = c.rowcount
conn.commit()
print(f"  Singleton series removed: {step2_cleaned:,}")

after_step2 = c.execute("SELECT COUNT(*) FROM editions WHERE series IS NOT NULL").fetchone()[0]
print(f"  Remaining with series: {after_step2:,}")

# Step 3: Add consensus series to works table
print("\nStep 3: Adding consensus series to works table...")

# Add columns if they don't exist
try:
    c.execute("ALTER TABLE works ADD COLUMN series TEXT")
    c.execute("ALTER TABLE works ADD COLUMN series_number REAL")
    print("  Added series columns to works table")
except sqlite3.OperationalError:
    print("  Series columns already exist, clearing...")
    c.execute("UPDATE works SET series = NULL, series_number = NULL")

# For each work, pick the most common series name
c.execute("""
    UPDATE works SET
        series = (
            SELECT e.series
            FROM editions e
            WHERE e.work_key = works.key AND e.series IS NOT NULL
            GROUP BY e.series
            ORDER BY COUNT(*) DESC
            LIMIT 1
        ),
        series_number = (
            SELECT e.series_number
            FROM editions e
            WHERE e.work_key = works.key AND e.series IS NOT NULL
            GROUP BY e.series
            ORDER BY COUNT(*) DESC
            LIMIT 1
        )
""")
works_with_series = c.execute("SELECT COUNT(*) FROM works WHERE series IS NOT NULL").fetchone()[0]
conn.commit()
print(f"  Works with consensus series: {works_with_series:,}")

# Step 4: Clean the series strings (trim trailing punctuation, extract numbers)
# This is better done at query time with cleanSeries(), but let's do basic cleanup
print("\nStep 4: Basic string cleanup on works.series...")
c.execute("""
    UPDATE works SET series = TRIM(series)
    WHERE series IS NOT NULL AND series != TRIM(series)
""")
trimmed = c.rowcount
print(f"  Trimmed whitespace: {trimmed:,}")

conn.commit()

final = c.execute("SELECT COUNT(*) FROM editions WHERE series IS NOT NULL").fetchone()[0]
works_final = c.execute("SELECT COUNT(*) FROM works WHERE series IS NOT NULL").fetchone()[0]
print(f"\n=== Summary ===")
print(f"Editions with series: {before:,} -> {final:,} (removed {before - final:,})")
print(f"Works with consensus series: {works_final:,}")

# Show top series after cleanup
print(f"\nTop 20 series after cleanup:")
rows = c.execute("""
    SELECT series, COUNT(*) as cnt
    FROM works
    WHERE series IS NOT NULL
    GROUP BY series
    ORDER BY cnt DESC
    LIMIT 20
""").fetchall()
for r in rows:
    print(f"  {r[1]:>5}  {r[0][:70]}")

conn.close()
print("\nDone!")
