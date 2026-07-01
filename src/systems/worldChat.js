// src/systems/worldChat.js
// A living world-chat: named "players" populate the world, chatter about skilling,
// trading and bosses, react to your level-ups, and reply when you talk — so the
// world feels like a busy MMO even before bots visibly walk around. Fully
// templated (no deps, always works); an optional local-LLM hook can enrich replies
// later. `worldChat.roster` is ALSO the ready-made population the world-gen/render
// lanes can later spawn as visible, moving bots (each has a name + activity).

import { Game } from '../engine/state.js';
import { sendChat } from '../net/presence.js';

// [presence lane] Chat is REAL now: messages go to the server and every online
// player sees them (see src/net/presence.js). The old local bot chatter/replies
// below are disabled so chat only shows actual players.
const AMBIENT_BOTS = false;

const NAMES = [
  'Grimtooth', 'Zog the Bold', 'xX_Slayer_Xx', 'MudFoot', 'Snagglepike', 'IronGut Ada',
  'Blisterhand', 'Grok99', 'Turnip King', 'Lady Vex', 'Old Borin', 'Fenwick',
  'Rustclaw', 'Mossbeard', 'Pipsqueak', 'Durgin', 'Sootscale', 'Warbler',
  'Kex', 'Hobblefoot', 'Bogrot', 'Threefingers', 'Nan the Green', 'Skarr',
];
const ACTIVITIES = [
  'mining iron', 'chopping willows', 'fishing trout', 'fighting goblins',
  'smithing bars', 'training on rats', 'wandering the swamp', 'flipping at the GE',
  'cooking fish', 'hunting the dragon', 'gathering herbs',
];
const SKILLS = ['Woodcutting', 'Mining', 'Fishing', 'Cooking', 'Smithing', 'Firemaking',
  'Attack', 'Strength', 'Defence', 'Ranged', 'Prayer', 'Crafting'];
const ITEMS = ['bronze bars', 'iron ore', 'willow logs', 'raw trout', 'coal', 'goblin hide',
  'rat tooth charms', 'meteor diamonds', 'trollbone swords', 'cooked fish'];
const PLACES = ['the mines', 'the willows', 'the Grand Bazaar', 'Goblin Settlement',
  'the swamp', "the dragon's lair"];

const rng = (a) => a[Math.floor(Math.random() * a.length)];
const chance = (p) => Math.random() < p;

// "Online" roster — a subset that's currently logged in.
let online = [];
function pickOnline() {
  online = [...NAMES].sort(() => Math.random() - 0.5).slice(0, 12)
    .map((name) => ({ name, activity: rng(ACTIVITIES) }));
}
export const worldChat = { get roster() { return online; }, get names() { return NAMES; } };

// ---- ambient chatter templates ----
const LINES = {
  brag: () => rng([
    `just hit ${2 + Math.floor(Math.random() * 97)} ${rng(SKILLS)} 🎉`,
    `finally 99 ${rng(SKILLS)}, my hands hurt lol`,
    `${rng(SKILLS)} grind is real today`,
    `ding! ${rng(SKILLS)} never felt so good`,
  ]),
  trade: () => rng([
    `selling ${rng(ITEMS)} cheap at the GE`,
    `buying ${rng(ITEMS)}, pm me a price`,
    `wtb ${rng(ITEMS)} in bulk, got coins`,
    `${rng(ITEMS)} prices are nuts rn 👀`,
    `anyone flipping ${rng(ITEMS)}? margins are juicy`,
  ]),
  help: () => rng([
    `where do i find ${rng(ITEMS)}?`,
    `how do i get to ${rng(PLACES)}?`,
    `whats the fastest ${rng(SKILLS)} xp?`,
    `is Goldscale soloable or do i need a team?`,
  ]),
  banter: () => rng([
    'lol', 'gz', 'nice', 'this world is packed today', 'anyone wanna team the dragon?',
    'brb kettle', 'goblins never learn', 'who let the rats out again',
    "treasury's getting fat again 👀", 'that dragon raid earlier was insane',
    'need a clan, anyone recruiting?', 'first', 'haha classic',
  ]),
};
function ambientLine() {
  // weighted: more trade/banter, some brag/help
  return LINES[rng(['brag', 'trade', 'trade', 'help', 'banter', 'banter'])]();
}

let running = false;
export function startWorldChat() {
  if (running) return;
  running = true;
  if (!AMBIENT_BOTS) return; // [presence lane] real chat only — no fake bot chatter
  pickOnline();
  setInterval(() => { if (chance(0.5)) pickOnline(); }, 60000); // roster churn
  const tick = () => {
    if (online.length && Game.ui.postChat) {
      const bot = rng(online);
      Game.ui.postChat({ channel: 'public', name: bot.name, text: ambientLine() });
    }
    setTimeout(tick, 4000 + Math.random() * 5000);
  };
  setTimeout(tick, 2500);
}

// ---- player interaction (NPCs reply to you) ----
function replyTo(text) {
  const t = text.toLowerCase();
  const bot = rng(online) || { name: rng(NAMES) };
  let msg;
  if (/\b(sell|selling|buy|buying|price|gp|gold|ge|exchange|flip)\b/.test(t)) {
    msg = rng(['check the GE, prices move fast', "i'll buy if it's cheap", `${rng(ITEMS)} is the play rn`, 'undercut and it sells instantly']);
  } else if (/\b(help|where|how|find|guide)\b/.test(t)) {
    msg = rng([`try ${rng(PLACES)}`, `${rng(SKILLS)} is best trained there`, "follow me, i'll show ya", 'ask in clan chat, someone knows']);
  } else if (/\b(dragon|boss|team|raid|goldscale)\b/.test(t)) {
    msg = rng(["i'm down for the dragon!", 'need like 3 more for the raid', 'Goldscale hits HARD, bring food', 'last raid the hoard was HUGE']);
  } else if (/\b(hi|hey|hello|yo|sup|hola|greetings)\b/.test(t)) {
    msg = rng(['hey Gork!', 'yo', 'welcome to the swamp 🐸', 'sup', 'ayy']);
  } else if (/\b(noob|scrub|ez|trash|bad)\b/.test(t)) {
    msg = rng(['lol ok', 'says you', 'cope', 'ratio']);
  } else {
    msg = rng(['lol', 'true', 'haha', 'gz', 'fair', 'based', 'facts', 'oof', 'real']);
  }
  return { name: bot.name, text: msg };
}

// ---- optional local-LLM (Ollama) enrichment --------------------------------
// Off by default (templated always works). Enable in the console:
//   __CHAT.enableLLM()                      // uses llama3.1:8b on :11434
//   __CHAT.enableLLM({ model: 'qwen2.5-coder:7b' })
// Requires Ollama to allow the game's origin: run it with OLLAMA_ORIGINS=* (or the
// game's URL). Any failure (offline / CORS / timeout) silently falls back to templated.
export const llm = { enabled: false, url: 'http://127.0.0.1:11434', model: 'llama3.1:8b' };
export function enableLLM(opts = {}) { Object.assign(llm, opts, { enabled: true }); return llm; }

async function llmReply(playerText) {
  const prompt = 'You are a player in a goblin-themed fantasy MMORPG called Goblin '
    + 'Empire, chatting in public chat. Reply to this message in ONE short casual '
    + 'line, max 12 words, lowercase, gamer slang ok, stay in-world, no quotes. '
    + `Message: "${playerText}"`;
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(llm.url + '/api/generate', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: llm.model, prompt, stream: false,
        options: { temperature: 0.9, num_predict: 40 } }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const txt = (d.response || '').trim().split('\n')[0].replace(/^["']+|["']+$/g, '').slice(0, 120);
    return txt || null;
  } catch { return null; } finally { clearTimeout(to); }
}

export function playerSay(text) {
  text = (text || '').trim().slice(0, 120);
  if (!text || !Game.ui.postChat) return;
  // Echo my own line immediately (no round-trip lag), then broadcast it to every
  // other online player via the server. Their clients show it on their next beat.
  Game.ui.postChat({ channel: 'public', name: Game.account || 'Gork', text, self: true });
  sendChat(text);
}

// ---- bot "brain": activity → concrete world intent (the seam for VISIBLE bots) ---
// World-gen calls intentFor(bot) to decide where a bot should go / what to do, then
// executes movement (map.js BFS) + reuses my gathering/combat systems. Ids are
// canonical so GameData resolves them; a specific id is a PREFERENCE — if the map
// has no such instance, treat it as the goal category and pick the nearest.
const ACTIVITY_INTENT = {
  'mining iron': { goal: 'gather', nodeType: 'iron_rock' },
  'chopping willows': { goal: 'gather', nodeType: 'willow_tree' },
  'fishing trout': { goal: 'gather', nodeType: 'trout_fishing_spot' },
  'fighting goblins': { goal: 'combat' },
  'smithing bars': { goal: 'station', station: 'furnace' },
  'training on rats': { goal: 'combat', monsterId: 'training_rat' },
  'wandering the swamp': { goal: 'wander' },
  'flipping at the GE': { goal: 'goto', place: 'grand_bazaar' },
  'cooking fish': { goal: 'station', station: 'range' },
  'hunting the dragon': { goal: 'combat', monsterId: 'hoard_dragon' },
  'gathering herbs': { goal: 'gather', nodeType: 'normal_tree' },
};
export function intentFor(bot) {
  return ACTIVITY_INTENT[bot && bot.activity] || { goal: 'wander' };
}
// Rotate a bot to a fresh task (call when it "finishes" its current one).
export function reassign(bot) {
  if (bot) bot.activity = rng(ACTIVITIES);
  return intentFor(bot);
}

// Console handle: enable the LLM, poke chat, inspect the roster/intents.
if (typeof window !== 'undefined') {
  window.__CHAT = { worldChat, enableLLM, playerSay, intentFor, reassign, llm };
}

// A bot congratulates your level-ups now and then — chat reacts to gameplay.
export function cheerLevel(skill, level) {
  if (!AMBIENT_BOTS) return; // [presence lane] no fake congratulations
  if (!online.length || !Game.ui.postChat || !chance(0.5)) return;
  setTimeout(() => {
    if (Game.ui.postChat) {
      Game.ui.postChat({ channel: 'public', name: rng(online).name,
        text: rng([`gz on ${level} ${skill}!`, `nice ${skill} 🎉`, 'gz gz', `${level} ${skill}, lets goo`]) });
    }
  }, 900);
}
