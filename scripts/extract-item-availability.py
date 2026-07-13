# Extracts site-data/data/reborn-item-availability.extracted.json from the
# community "Pokemon Reborn Ep19 Items & Services Guide" spreadsheet (a
# user-supplied xlsx; not committed). Usage:
#
#   python3 scripts/extract-item-availability.py <path-to-guide.xlsx>
#
# Requires openpyxl. Re-committed after the shop-masking bug: the first
# extraction collapsed the guide to ONE row per item (earliest source wins),
# which destroyed shop stock for any item with an earlier one-off pickup
# (user report with screenshots: Oran/Cheri/Pecha/Rawst/Chesto/Aspear missing
# from the badge-1 Department Store berry floor). This version emits BOTH:
#
#   items      — merged earliest-availability per item (unchanged semantics,
#                feeding REBORN_ITEM_UNLOCK_BADGES)
#   shopItems  — per-item earliest RENEWABLE shop availability, from the
#                Shops tab directly: { badge, until? } where `until` marks a
#                stock window that closes (e.g. "0-1 Badges" mart rows)
#
# Timing model (matches the badge timeline in src/reborn/badgeTimeline.js):
# "Avail. Before: NN - Fight" means obtainable BEFORE that fight, so the
# badge count is the number of badge-awarding fights strictly before it.
# Corey, Kiki, and Saphira award no badge; the Labyrinth's 18th badge lands
# before the E4; post-game tiers collapse to badge 18.
#
# Shop-row conditions:
#   "N Sticker(s)"      -> also needs Department Store sticker N: badge of
#                          the sticker's own "Avail. Before" row (cumulative
#                          max, stickers collected in order)
#   "K Badges"/"K-M ..." -> minimum badge K; M < 18 closes the window (until)
#   "Before the 1st Badge" -> window [0, 0]
#   "Post Game"/"18 Badges" -> badge 18
#   restoration-gated   -> City Restoration happens in the Adrienn arc:
#                          "City Restoration" floors at badge 13;
#                          "Before/Pre-Restoration" closes the window at 12
#   "... Once ..."      -> a ONE-TIME purchase: real availability (items),
#                          but NOT renewable, so excluded from shopItems
#   weather/time/fees/quests -> renewable but situational; no badge change

import json
import re
import sys
import unicodedata

import openpyxl

FIGHTS = [
    ("01 - Julia", True),
    ("02 - Florinia", True),
    ("03 - Corey", False),
    ("04 - Shelly", True),
    ("05 - Shade", True),
    ("06 - Kiki", False),
    ("07 - Aya", True),
    ("08 - Serra", True),
    ("09 - Noel", True),
    ("10 - Radomus", True),
    ("11 - Luna", True),
    ("12 - Samson", True),
    ("13 - Charlotte", True),
    ("14 - Terra", True),
    ("15 - Ciel", True),
    ("16 - Adrienn", True),
    ("17 - Titania", True),
    ("18 - Amaria", True),
    ("19 - Hardy", True),
    ("20 - Saphira", False),
]
FIGHT_BADGES = {}
count = 0
for label, awards in FIGHTS:
    FIGHT_BADGES[label] = count
    if awards:
        count += 1
# The Labyrinth's badge (#18) is earned before the E4; post-game collapses.
FIGHT_BADGES["21 - E4"] = 18
for label in (
    "22 - Tier 1 PG", "23 - Tier 2 PG", "24 - Tier 2.5 PG", "25 - Tier 3 PG",
    "26 - Tier 4 PG", "27 - Tier 5 PG", "28 - Tier 6 PG", "29 - Tier 6.5 PG",
    "30 - Tier 7 PG", "31 - Tier 8 PG", "32 - Finale", "Still Here?",
):
    FIGHT_BADGES[label] = 18

RESTORATION_BADGE = 13  # Adrienn restores Reborn City


def clean_name(raw):
    # Sheet rows carry purchase quantities ("Adamant Mint x5", "Aguav Berry
    # x2"); strip them so multi-quantity rows merge with their clean names.
    # Accents fold to ASCII ("Poké Ball" -> "Poke Ball") because downstream
    # toId() drops non-ASCII letters entirely.
    name = str(raw or "").strip()
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"\s*x\d+$", "", name).strip()


def badge_of(label):
    label = str(label or "").strip()
    if not label:
        return None
    if label in FIGHT_BADGES:
        return FIGHT_BADGES[label]
    raise SystemExit(f"unknown 'Avail. Before' label: {label!r}")


def read_rows(wb, tab):
    ws = wb[tab]
    rows = ws.iter_rows(values_only=True)
    header = [str(c).strip() if c is not None else "" for c in next(rows)]
    for row in rows:
        if not row or all(c is None or str(c).strip() == "" for c in row):
            continue
        yield {header[i]: row[i] for i in range(min(len(header), len(row)))}


def sticker_badges(wb):
    # Sticker #N -> badge it becomes obtainable; cumulative max so "N
    # Stickers" is the badge by which N stickers CAN be held.
    by_number = {}
    for row in read_rows(wb, "Stickers"):
        name = str(row.get("Item") or "")
        match = re.search(r"#(\d+)", name)
        if not match:
            continue
        by_number[int(match.group(1))] = badge_of(row.get("Avail. Before"))
    cumulative = {}
    running = 0
    for n in sorted(by_number):
        running = max(running, by_number[n])
        cumulative[n] = running
    return cumulative


def shop_condition_gate(condition, stickers):
    """-> (min_badge_or_None, until_or_None, renewable) for a Shops row."""
    text = str(condition or "").strip()
    if not text or text == "None":
        return None, None, True
    if re.search(r"\bOnce\b", text):
        return None, None, False
    match = re.search(r"(\d+)\s+Stickers?", text)
    if match:
        return stickers.get(int(match.group(1)), 18), None, True
    if text == "Before the 1st Badge":
        return 0, 0, True
    match = re.match(r"^(\d+)(?:-(\d+))?\s+Badges?", text)
    if match:
        low = int(match.group(1))
        high = int(match.group(2)) if match.group(2) else None
        until = high if high is not None and high < 18 else None
        return low, until, True
    if "Post Game" in text:
        return 18, None, True
    if re.search(r"Before Restoration|Pre-Restoration|preRestoration|Pre-Slums", text):
        return None, RESTORATION_BADGE - 1, True
    if "Restoration" in text:  # "City Restoration", "$500 Museum Fee | Restoration"
        return RESTORATION_BADGE, None, True
    # Weather / time of day / coin case / fees / quests / gang routes:
    # renewable once reachable, no badge adjustment we can model.
    return None, None, True


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__ or "usage: extract-item-availability.py <xlsx>")
    wb = openpyxl.load_workbook(sys.argv[1], read_only=True, data_only=True)
    stickers = sticker_badges(wb)

    items = {}

    def note(name, badge, source):
        name = clean_name(name)
        if not name or badge is None:
            return
        current = items.get(name)
        if current is None or badge < current["badges"]:
            items[name] = {"badges": badge, "source": source}

    for row in read_rows(wb, "All Items Locations"):
        note(row.get("Item"), badge_of(row.get("Avail. Before")), str(row.get("Source") or "").strip() or "Unknown")

    # Renewable availability per item is a UNION of badge windows: e.g.
    # Potion is "0-1 Badges" at the first mart but sold permanently by the
    # Medicine Vendor from badge 1 — earliest-row-wins would freeze the
    # closing window and read Potion as expired from badge 2 on. Collect
    # every renewable row as [low, high] (high 18 = open-ended), merge
    # overlapping/adjacent windows, and emit the first merged window.
    shop_windows = {}
    for row in read_rows(wb, "Shops"):
        name = clean_name(row.get("Item"))
        if not name:
            continue
        base = badge_of(row.get("Avail. Before"))
        gate, until, renewable = shop_condition_gate(row.get("Condition"), stickers)
        badge = max(base, gate) if gate is not None else base
        note(name, badge, "Shop")
        if not renewable:
            continue
        shop_windows.setdefault(name, []).append(
            (badge, until if until is not None else 18)
        )

    shop_items = {}
    for name, windows in shop_windows.items():
        windows.sort()
        merged = []
        for low, high in windows:
            if merged and low <= merged[-1][1] + 1:
                merged[-1][1] = max(merged[-1][1], high)
            else:
                merged.append([low, high])
        if len(merged) > 1:
            # A gap the {badge, until} schema can't express; keep the first
            # window and flag it so a schema upgrade is a conscious choice.
            print(f"[extract] WARNING: {name!r} has gapped shop windows {merged}; keeping {merged[0]}")
        low, high = merged[0]
        entry = {"badge": low}
        if high < 18:
            entry["until"] = high
        shop_items[name] = entry

    for row in read_rows(wb, "Arcade Lottery"):
        note(row.get("Item"), badge_of(row.get("Avail. Before")), "Lottery")

    mining = []
    for row in read_rows(wb, "Mining Items"):
        name = clean_name(row.get("Item"))
        if name:
            mining.append(name)

    out = {
        "provenance": (
            'Community "Pokemon Reborn Ep19 Items & Services Guide" '
            "(user-supplied xlsx; scripts/extract-item-availability.py): "
            "All Items Locations + Shops + Arcade Lottery + Mining Items tabs; "
            "fight order mapped to badge counts (Corey/Kiki/Saphira award no "
            "badge; post-game collapses to 18); shopItems resolves sticker/"
            "badge-window/restoration conditions and excludes one-time offers."
        ),
        "items": dict(sorted(items.items())),
        "shopItems": dict(sorted(shop_items.items())),
        "miningItems": mining,
    }
    path = "site-data/data/reborn-item-availability.extracted.json"
    with open(path, "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print(f"[extract] {len(items)} items, {len(shop_items)} shop items, {len(mining)} mining items -> {path}")


main()
