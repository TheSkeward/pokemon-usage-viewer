const REBORN_MACHINE_AVAILABILITY = getRebornMachineAvailability();

export const REBORN_TM_OPTIONS = [
  ["tm01", "TM01", "Work Up"],
  ["tm02", "TM02", "Dragon Claw"],
  ["tm03", "TM03", "Psyshock"],
  ["tm04", "TM04", "Calm Mind"],
  ["tm05", "TM05", "Roar"],
  ["tm06", "TM06", "Toxic"],
  ["tm07", "TM07", "Hail"],
  ["tm08", "TM08", "Bulk Up"],
  ["tm09", "TM09", "Venoshock"],
  ["tm10", "TM10", "Hidden Power"],
  ["tm11", "TM11", "Sunny Day"],
  ["tm12", "TM12", "Taunt"],
  ["tm13", "TM13", "Ice Beam"],
  ["tm14", "TM14", "Blizzard"],
  ["tm15", "TM15", "Hyper Beam"],
  ["tm16", "TM16", "Light Screen"],
  ["tm17", "TM17", "Protect"],
  ["tm18", "TM18", "Rain Dance"],
  ["tm19", "TM19", "Roost"],
  ["tm20", "TM20", "Safeguard"],
  ["tm21", "TM21", "Frustration"],
  ["tm22", "TM22", "Solar Beam"],
  ["tm23", "TM23", "Smack Down"],
  ["tm24", "TM24", "Thunderbolt"],
  ["tm25", "TM25", "Thunder"],
  ["tm26", "TM26", "Earthquake"],
  ["tm27", "TM27", "Return"],
  ["tm28", "TM28", "Leech Life"],
  ["tm29", "TM29", "Psychic"],
  ["tm30", "TM30", "Shadow Ball"],
  ["tm31", "TM31", "Brick Break"],
  ["tm32", "TM32", "Double Team"],
  ["tm33", "TM33", "Reflect"],
  ["tm34", "TM34", "Sludge Wave"],
  ["tm35", "TM35", "Flamethrower"],
  ["tm36", "TM36", "Sludge Bomb"],
  ["tm37", "TM37", "Sandstorm"],
  ["tm38", "TM38", "Fire Blast"],
  ["tm39", "TM39", "Rock Tomb"],
  ["tm40", "TM40", "Aerial Ace"],
  ["tm41", "TM41", "Torment"],
  ["tm42", "TM42", "Facade"],
  ["tm43", "TM43", "Flame Charge"],
  ["tm44", "TM44", "Rest"],
  ["tm45", "TM45", "Attract"],
  ["tm46", "TM46", "Thief"],
  ["tm47", "TM47", "Low Sweep"],
  ["tm48", "TM48", "Round"],
  ["tm49", "TM49", "Echoed Voice"],
  ["tm50", "TM50", "Overheat"],
  ["tm51", "TM51", "Steel Wing"],
  ["tm52", "TM52", "Focus Blast"],
  ["tm53", "TM53", "Energy Ball"],
  ["tm54", "TM54", "False Swipe"],
  ["tm55", "TM55", "Scald"],
  ["tm56", "TM56", "Fling"],
  ["tm57", "TM57", "Charge Beam"],
  ["tm58", "TM58", "Sky Drop"],
  ["tm59", "TM59", "Brutal Swing"],
  ["tm60", "TM60", "Quash"],
  ["tm61", "TM61", "Will-O-Wisp"],
  ["tm62", "TM62", "Acrobatics"],
  ["tm63", "TM63", "Embargo"],
  ["tm64", "TM64", "Explosion"],
  ["tm65", "TM65", "Shadow Claw"],
  ["tm66", "TM66", "Payback"],
  ["tm67", "TM67", "Smart Strike"],
  ["tm68", "TM68", "Giga Impact"],
  ["tm69", "TM69", "Rock Polish"],
  ["tm70", "TM70", "Aurora Veil"],
  ["tm71", "TM71", "Stone Edge"],
  ["tm72", "TM72", "Volt Switch"],
  ["tm73", "TM73", "Thunder Wave"],
  ["tm74", "TM74", "Gyro Ball"],
  ["tm75", "TM75", "Swords Dance"],
  ["tm76", "TM76", "Struggle Bug"],
  ["tm77", "TM77", "Psych Up"],
  ["tm78", "TM78", "Bulldoze"],
  ["tm79", "TM79", "Frost Breath"],
  ["tm80", "TM80", "Rock Slide"],
  ["tm81", "TM81", "X-Scissor"],
  ["tm82", "TM82", "Dragon Tail"],
  ["tm83", "TM83", "Infestation"],
  ["tm84", "TM84", "Poison Jab"],
  ["tm85", "TM85", "Dream Eater"],
  ["tm86", "TM86", "Grass Knot"],
  ["tm87", "TM87", "Swagger"],
  ["tm88", "TM88", "Sleep Talk"],
  ["tm89", "TM89", "U-turn"],
  ["tm90", "TM90", "Substitute"],
  ["tm91", "TM91", "Flash Cannon"],
  ["tm92", "TM92", "Trick Room"],
  ["tm93", "TM93", "Wild Charge"],
  ["tm94", "TM94", "Secret Power"],
  ["tm95", "TM95", "Snarl"],
  ["tm96", "TM96", "Nature Power"],
  ["tm97", "TM97", "Dark Pulse"],
  ["tm98", "TM98", "Power-Up Punch"],
  ["tm99", "TM99", "Dazzling Gleam"],
  ["tm100", "TM100", "Confide"],
]
  .map(([id, code, move]) => ({
    id,
    code,
    move,
    ...REBORN_MACHINE_AVAILABILITY[id],
  }))
  .sort(compareMachineAvailability);

export const REBORN_TMX_OPTIONS = [
  ["tmx1", "TMX1", "Cut"],
  ["tmx2", "TMX2", "Fly"],
  ["tmx3", "TMX3", "Surf"],
  ["tmx4", "TMX4", "Strength"],
  ["tmx5", "TMX5", "Waterfall"],
  ["tmx6", "TMX6", "Dive"],
  ["tmx7", "TMX7", "Rock Smash"],
  ["tmx8", "TMX8", "Flash"],
  ["tmx9", "TMX9", "Rock Climb"],
]
  .map(([id, code, move]) => ({
    id,
    code,
    move,
    ...REBORN_MACHINE_AVAILABILITY[id],
  }))
  .sort(compareMachineAvailability);

export const REBORN_TUTOR_GROUPS = [
  {
    label: "Onyx Trainers' School - left lower room",
    available: "After Badge 01",
    moves: ["Magic Coat", "Magic Room", "Wonder Room", "Telekinesis"],
  },
  {
    label: "Onyx Trainers' School - top lower room",
    available: "After Badge 01",
    moves: ["Iron Defense", "Snore", "Bind", "Spite"],
  },
  {
    label: "Onyx Trainers' School - right upper room",
    available: "After Badge 01",
    moves: ["Gravity", "Magnet Rise", "Block", "Worry Seed"],
  },
  {
    label: "Onyx Trainers' School - left upper room",
    available: "After Badge 01",
    moves: ["Snatch", "Helping Hand", "Ally Switch", "After You"],
  },
  {
    label: "Rhodochrine Jungle",
    available: "After Badge 02",
    moves: ["Giga Drain"],
  },
  {
    label: "Lapis Ward",
    available: "After Badge 02",
    moves: ["Water Pledge", "Fire Pledge", "Grass Pledge"],
  },
  {
    label: "Apophyll Academy",
    available: "After Badge 04",
    moves: ["Gastro Acid", "Recycle", "Endeavor", "Pain Split"],
  },
  {
    label: "North Aventurine Woods",
    available: "After Badge 07",
    moves: ["Volt Tackle"],
  },
  {
    label: "7th Street - top right, top row",
    available: "After Badge 08",
    moves: ["Role Play", "Covet", "Electroweb", "Sky Attack"],
  },
  {
    label: "7th Street - top right, bottom row",
    available: "After Badge 08",
    moves: ["Trick", "Defog", "Laser Focus", "Skill Swap"],
  },
  {
    label: "7th Street - middle area, top row",
    available: "After Badge 08",
    moves: ["Water Pulse", "Last Resort", "Super Fang", "Shock Wave"],
  },
  {
    label: "7th Street - middle area, second row",
    available: "After Badge 08",
    moves: ["Headbutt", "Bounce", "Heal Bell", "Bug Bite"],
  },
  {
    label: "Agate Circus - fake Samson",
    available: "After Badge 09",
    moves: ["Dual Chop", "Thunder Punch", "Fire Punch", "Ice Punch"],
  },
  {
    label: "Agate Circus - man left of stage",
    available: "After Badge 09",
    moves: ["Uproar", "Hyper Voice", "Stomping Tantrum", "Low Kick"],
  },
  {
    label: "Agate Circus - clown left of stage",
    available: "After Badge 09",
    moves: ["Iron Tail", "Focus Punch", "Drill Run", "Synthesis"],
  },
  {
    label: "Agate Circus - bottom right",
    available: "After Badge 09",
    moves: ["Water Pledge", "Fire Pledge", "Grass Pledge"],
  },
  {
    label: "7th Street - middle area, bottom row",
    available: "After Badge 13 + Craudburry Intimidation sidequest",
    moves: ["Knock Off", "Iron Head", "Giga Drain", "Liquidation"],
  },
  {
    label: "Peridot Ward - top row, left",
    available: "After Badge 13",
    moves: ["Aqua Tail", "Icy Wind", "Signal Beam", "Throat Chop"],
  },
  {
    label: "Peridot Ward - top row, middle",
    available: "After Badge 13",
    moves: ["Drain Punch", "Tailwind", "Zen Headbutt", "Stealth Rock"],
  },
  {
    label: "Peridot Ward - top left corner",
    available: "After Badge 14",
    moves: ["Gunk Shot", "Dragon Pulse", "Seed Bomb", "Foul Play"],
  },
  {
    label: "Peridot Ward - top row, right",
    available: "After Badge 15",
    moves: ["Superpower", "Earth Power", "Outrage", "Heat Wave"],
  },
  {
    label: "Peridot Ward - bottom left corner",
    available: "After Badge 17",
    moves: ["Hydro Cannon", "Blast Burn", "Frenzy Plant", "Draco Meteor"],
  },
  {
    label: "Grand Hall - bottom right corner",
    available: "After Badge 18",
    moves: ["Celebrate", "Happy Hour"],
  },
].map((group) => ({
  ...group,
  options: group.moves.map((move) => ({ id: normalizeMoveId(move), move })),
}));

export const REBORN_TUTOR_OPTIONS = uniqueOptions(
  REBORN_TUTOR_GROUPS.flatMap((group) => group.options),
);

function normalizeMoveId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function compareMachineAvailability(a, b) {
  return (
    getBadgeOrder(a.available) - getBadgeOrder(b.available) ||
    String(a.location || "").localeCompare(String(b.location || "")) ||
    a.code.localeCompare(b.code, undefined, { numeric: true })
  );
}

function getBadgeOrder(available) {
  const match = String(available || "").match(/Badge\s+(\d+)/i);
  if (!match) return 999;

  return Number.parseInt(match[1], 10);
}

function uniqueOptions(options) {
  const seen = new Set();
  const unique = [];

  for (const option of options) {
    if (seen.has(option.id)) continue;
    seen.add(option.id);
    unique.push(option);
  }

  return unique;
}

function getRebornMachineAvailability() {
  return {
  tm57: { available: "After Badge 01", location: "Peridot Gym" },
  tm60: { available: "After Badge 01", location: "Obsidia Slums" },
  tmx1: { available: "After Badge 01", location: "Coral Ward" },
  tm54: { available: "After Badge 01", location: "Obsidia Ward" },
  tm42: { available: "After Badge 01", location: "Onyx Arcade" },
  tm45: { available: "After Badge 01", location: "Onyx Arcade" },
  tm90: { available: "After Badge 01", location: "Onyx Arcade" },
  tm63: { available: "After Badge 01", location: "Onyx Ward" },
  tm96: { available: "After Badge 02", location: "Onyx Trainers' School" },
  tm100: { available: "After Badge 02", location: "Onyx Trainers' School" },
  tm20: { available: "After Badge 02", location: "Beryl Library" },
  tm77: { available: "After Badge 02", location: "Rhodochrine Jungle" },
  tm88: { available: "After Badge 02", location: "Peridot Ward" },
  tm56: { available: "After Badge 02", location: "North Obsidia Ward" },
  tm46: { available: "After Badge 02", location: "North Obsidia Alleyway" },
  tm17: { available: "After Badge 02", location: "Nightclub" },
  tm48: { available: "After Badge 02", location: "Obsidia Department Store" },
  tm07: { available: "After Badge 02", location: "Lapis Ward" },
  tm21: { available: "After Badge 02", location: "Lapis Ward" },
  tm41: { available: "After Badge 02", location: "Lapis Alleyway" },
  tm69: { available: "After Badge 02", location: "Grand Stairway" },
  tmx7: { available: "After Badge 02", location: "North Obsidia Ward" },
  tm76: { available: "After Badge 03", location: "Lapis Gym" },
  tmx8: { available: "After Badge 03", location: "Underground Railnet" },
  tm05: { available: "After Badge 03", location: "Rhodochrine Jungle" },
  tm65: { available: "After Badge 04", location: "Yureyu Power Plant" },
  tm40: { available: "After Badge 07", location: "South Aventurine Woods" },
  tm51: { available: "After Badge 07", location: "South Aventurine Woods" },
  tm86: { available: "After Badge 07", location: "North Aventurine Woods" },
  tm23: { available: "After Badge 07", location: "Celestinine Mountain" },
  tm92: { available: "After Badge 08", location: "Vanhanen Castle" },
  tm11: { available: "After Badge 08", location: "Lapis Ward or 7th Street" },
  tm18: { available: "After Badge 08", location: "Lapis Ward or 7th Street" },
  tm64: { available: "After Badge 08", location: "7th Street" },
  tm97: { available: "After Badge 09", location: "Iolia Valley" },
  tm87: { available: "After Badge 09", location: "Agate Circus" },
  tm58: { available: "After Badge 09", location: "Route 2" },
  tm31: { available: "After Badge 10", location: "Big Top" },
  tmx3: { available: "After Badge 10", location: "Fiore Mansion" },
  tm39: { available: "After Badge 10", location: "Celestinine Cascade" },
  tm43: { available: "After Badge 10", location: "LCCC" },
  tmx6: { available: "After Badge 10", location: "Calcenon City" },
  tm35: { available: "After Badge 11", location: "Calcenon Gym" },
  tm95: { available: "After Badge 11", location: "Ametrine City" },
  tm79: { available: "After Badge 11", location: "Ametrine City" },
  tmx5: {
    available: "After Badge 11",
    location: "Ametrine City or Ametrine Mountain",
  },
  tm82: { available: "After Badge 11", location: "Celestinine Mountain" },
  tm78: { available: "After Badge 12", location: "Glitch World" },
  tm01: { available: "After Badge 12", location: "Ametrine Mountain" },
  tm03: { available: "After Badge 12", location: "Celestinine Mountain" },
  tm47: { available: "After Badge 12", location: "Celestinine Mountain" },
  tm74: { available: "After Badge 12", location: "Citrine Mountain" },
  tm67: { available: "After Badge 12", location: "Water Treatment Center" },
  tm93: { available: "After Badge 12", location: "Water Treatment Center" },
  tmx2: { available: "After Badge 12", location: "Celestinine Cascade" },
  tm62: { available: "After Badge 13", location: "Big Top" },
  tm06: { available: "After Badge 13", location: "Peridot Ward" },
  tm22: { available: "After Badge 13", location: "Obsidia Department Store" },
  tm27: { available: "After Badge 13", location: "Blacksteam Shelter" },
  tm30: { available: "After Badge 13", location: "Beryl Library" },
  tm33: { available: "After Badge 13", location: "The Underroot" },
  tm50: { available: "After Badge 13", location: "Chrysolia Spring" },
  tm61: { available: "After Badge 13", location: "Chrysolia Spring" },
  tm81: { available: "After Badge 13", location: "Devon Corp" },
  tm89: { available: "After Badge 13", location: "Iolia Valley" },
  tm59: { available: "After Badge 13", location: "Azurine Cave" },
  tm16: { available: "After Badge 13", location: "Azurine Lake" },
  tm98: { available: "After Badge 13", location: "Azurine Lake" },
  tm15: { available: "After Badge 13", location: "Spinel Town" },
  tm68: { available: "After Badge 13", location: "Coral Ward" },
  tm99: { available: "After Badge 14", location: "Coral Gym" },
  tm84: { available: "After Badge 14", location: "Water Treatment Center" },
  tm72: { available: "After Badge 14", location: "Tourmaline Desert" },
  tm71: { available: "After Badge 14", location: "Sugiline Cave" },
  tm36: { available: "After Badge 14", location: "Tourmaline Desert" },
  tm04: { available: "After Badge 14", location: "Mirage Tower" },
  tm08: { available: "After Badge 14", location: "Tourmaline Desert" },
  tm75: { available: "After Badge 14", location: "Teknite Ridge" },
  tm19: { available: "After Badge 14", location: "1R253 Scrapyard" },
  tm91: { available: "After Badge 15", location: "Never After" },
  tm55: { available: "After Badge 16", location: "Fiore Arena" },
  tmx9: { available: "After Badge 16", location: "Route 4" },
  tm28: { available: "After Badge 16", location: "Route 2" },
  tm52: { available: "After Badge 16", location: "Apophyll Beach" },
  tm53: { available: "After Badge 16", location: "Route 3" },
  tm73: { available: "After Badge 16", location: "Route 4" },
  tm29: { available: "After Badge 16", location: "Glass Workstation" },
  tm24: { available: "After Badge 16", location: "Devon Corp?" },
  tm13: { available: "After Badge 16", location: "Agate City" },
  tm26: { available: "After Badge 16", location: "Grand Hall" },
  tm80: { available: "After Badge 17", location: "Agate Arena" },
  tm14: { available: "After Badge 17", location: "Obsidia Department Store" },
  tm25: { available: "After Badge 17", location: "Obsidia Department Store" },
  tm38: { available: "After Badge 17", location: "Obsidia Department Store" },
  tm02: { available: "After Badge 18", location: "Labradorra Gym" },
  };
}
