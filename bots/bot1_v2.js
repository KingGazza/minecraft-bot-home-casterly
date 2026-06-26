const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const OllamaClient = require('./ollama-client');

const config = {
  host: process.env.MC_HOST || 'localhost',
  port: parseInt(process.env.MC_PORT) || 25565,
  username: process.env.BOT_NAME || 'AI_Fighter',
  version: '1.20.4',
  auth: 'offline',
  log: false
};

const ollama = new OllamaClient(
  process.env.OLLAMA_HOST || 'host.docker.internal',
  process.env.OLLAMA_PORT || '11434',
  process.env.OLLAMA_MODEL || 'gemma4:e2b'
);

const ownerName = process.env.PLAYER_NAME || '';
let following = null;
let isFighting = false;
let attackTarget = null;
let ollamaReady = false;

// Track when the owner last spoke — keeps a "focus window" so commands
// are simpler: once the owner talks, everything they say is a command for 15s
let ownerLastSpoke = 0;
const FOCUS_WINDOW_MS = 15000;

const botNames = ['AI_Fighter', 'AI_Gatherer', 'Mr_Angry', 'Mr_Helpful',
  'Mr_Angry_Nox', 'Mr_Helpful_Nox'];

process.on('uncaughtException', (err) => {
  console.error(`[${config.username}] Uncaught: ${err.message}`);
});

// Hostile mob types for 1.20.4 (using entity.name values)
const HOSTILE_MOBS = [
  'zombie', 'skeleton', 'spider', 'creeper', 'enderman',
  'witch', 'drowned', 'husk', 'stray', 'cave_spider',
  'phantom', 'slime', 'magma_cube', 'blaze', 'ghast',
  'piglin', 'piglin_brute', 'hoglin', 'zoglin',
  'warden', 'evoker', 'vindicator', 'pillager', 'ravager',
  'vex', 'guardian', 'elder_guardian', 'shulker',
  'silverfish', 'endermite', 'bee' // bees are hostile when provoked
];

// Combat range settings
const FIGHT_SCAN_RANGE = 16;    // How far to scan for mobs
const FIGHT_ENGAGE_RANGE = 12;  // Start pathfinding to mobs at this range
const FIGHT_ATTACK_RANGE = 4;   // Close enough to hit
const FOLLOW_DISTANCE = 4;      // How close to stay to owner

function createBot() {
  const bot = mineflayer.createBot(config);
  bot.loadPlugin(pathfinder);

  bot.once('spawn', async () => {
    console.log(`[${config.username}] Spawned!`);

    ollamaReady = await ollama.init();
    if (ollamaReady) {
      console.log(`[${config.username}] ✅ Connected to Ollama (${ollama.model})`);
    } else {
      console.log(`[${config.username}] ⚠️ Running in basic mode (Ollama unavailable)`);
    }

    const mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);

    if (ownerName && bot.players[ownerName]?.entity) {
      following = ownerName;
      bot.pathfinder.setGoal(new goals.GoalFollow(bot.players[ownerName].entity, FOLLOW_DISTANCE));
      console.log(`[${config.username}] Following owner: ${ownerName}`);
    }

    bot.chat(`I'm ${config.username}! I'll protect you!`);

    // Equip best available armor and weapon
    equipBestGear(bot);

    // --- FOLLOW INTERVAL ---
    // Re-engages follow every 3s if we should be following and aren't in combat
    setInterval(() => {
      // If owner joins later, start following
      if (!following && ownerName && bot.players[ownerName]?.entity) {
        following = ownerName;
        console.log(`[${config.username}] Owner ${ownerName} joined, following`);
      }
      // If we're following and not actively attacking, keep the follow goal active
      // GoalFollow already auto-recalculates, but this re-sets it if something cleared it
      if (following && !isFighting && !attackTarget) {
        const target = bot.players[following]?.entity;
        if (target) {
          // Always set follow goal — pathfinder handles continuous following
          bot.pathfinder.setGoal(new goals.GoalFollow(target, FOLLOW_DISTANCE));
        }
      }
    }, 3000);

    // --- EMERGENCY SURFACE ---
    setInterval(() => {
      if (bot.entity && bot.entity.air !== undefined && bot.entity.air < 100) {
        const pos = bot.entity.position;
        bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y + 10, pos.z, 2));
        console.log(`[${config.username}] Help! Drowning!`);
      }
    }, 2000);

    // --- AUTO-HEAL ---
    setInterval(() => {
      const food = bot.inventory.items().find(i => i.foodPoints && i.foodPoints > 0);
      if (food && (bot.health < 10 || bot.food < 10)) {
        try {
          bot.equip(food, 'hand');
          bot.consume();
          console.log(`[${config.username}] 🍗 Ate ${food.name} (HP:${bot.health} Food:${bot.food})`);
        } catch (e) {}
      }
    }, 5000);

    // --- EQUIP BEST GEAR ON LOAD ---
    // (also runs on spawn; re-run after inventory changes)
    setInterval(() => {
      equipBestGear(bot);
    }, 30000);

    console.log(`[${config.username}] ✅ Fighter ready. Scan range: ${FIGHT_SCAN_RANGE}, Owner: ${ownerName}`);
  });

  // ============================================================
  // COMBAT ENGINE — physicsTick scanning + pursuit
  // ============================================================
  bot.on('physicsTick', () => {
    // Don't scan if we're dead or inventory isn't loaded
    if (!bot.entity || !bot.inventory) return;

    // 1) Attack queued target (continuous hits)
    if (attackTarget) {
      // Check if target is still alive and in range
      const dist = bot.entity.position.distanceTo(attackTarget.position);
      if (attackTarget.health !== undefined && attackTarget.health <= 0) {
        // Mob died
        console.log(`[${config.username}] ✅ Mob died!`);
        attackTarget = null;
        isFighting = false;
        return;
      }
      if (dist > FIGHT_SCAN_RANGE + 4) {
        // Mob ran too far — give up
        console.log(`[${config.username}] Mob escaped`);
        attackTarget = null;
        isFighting = false;
        return;
      }

      // Attack if close enough
      if (dist <= FIGHT_ATTACK_RANGE) {
        bot.attack(attackTarget);
        bot.lookAt(attackTarget.position.offset(0, 1.5, 0));
      } else {
        // Chase the mob
        bot.pathfinder.setGoal(new goals.GoalFollow(attackTarget, FOLLOW_DISTANCE));
      }
      return;
    }

    // 2) Look for new mobs to fight
    if (!isFighting && !attackTarget) {
      const nearestHostile = bot.nearestEntity((e) => {
        if (e.type !== 'mob') return false;
        // e.name is the entity type string in mineflayer 1.20.4
        const name = e.name || e.entityType || '';
        return HOSTILE_MOBS.includes(name) &&
               e.position.distanceTo(bot.entity.position) < FIGHT_SCAN_RANGE &&
               e.position.distanceTo(bot.entity.position) > 0.5; // not ourselves
      });

      if (nearestHostile) {
        const dist = bot.entity.position.distanceTo(nearestHostile.position);
        console.log(`[${config.username}] ⚔️ Hostile spotted: ${nearestHostile.name || 'mob'} at ${Math.round(dist)}m`);
        attackTarget = nearestHostile;
        isFighting = true;

        // If we were following, we'll resume after the fight
        if (dist > FIGHT_ATTACK_RANGE) {
          bot.pathfinder.setGoal(new goals.GoalFollow(nearestHostile, FOLLOW_DISTANCE));
        } else {
          bot.attack(nearestHostile);
          bot.lookAt(nearestHostile.position.offset(0, 1.5, 0));
        }
      }
    }
  });

  // ============================================================
  // CHAT HANDLER
  // ============================================================
  bot.on('chat', async (username, message) => {
    if (username === config.username) return;
    const lower = message.toLowerCase();

    // Other bots — only respond if they mention this bot's name
    if (botNames.includes(username)) {
      if (!lower.includes(config.username.toLowerCase())) return;
      // If another fighter says "help" or mentions us, we don't need to respond
      // Just log and return
      return;
    }

    // Player messages — only respond to owner
    if (username !== ownerName) return;

    console.log(`[${config.username}] 💬 ${username}: ${message}`);

    // Track when owner spoke for focus window
    ownerLastSpoke = Date.now();

    // --- AI HANDLER ---
    const aiAvailable = await ollama.isAvailable();

    if (aiAvailable && ollamaReady) {
      const systemPrompt = `You are ${config.username}, a Minecraft fighter bot owned by ${ownerName}.
Your job: kill hostile mobs that threaten ${ownerName}. Protect them at all times.

Actions (put EXACTLY ONE in [brackets]):
- [action:follow] — Follow ${ownerName}
- [action:guard] — Stay put, guard the spot
- [action:stop] — Stop everything
- [action:help] — List commands
- [action:drop_all] — Drop all items
- [action:inventory] — Show what I'm carrying

Examples:
  "come here" → [action:follow]
  "protect me" → [action:follow]
  "stay there" → [action:guard]
  "stand guard" → [action:guard]
  "show me your stuff" → [action:inventory]

${config.username} does NOT gather, build, or farm. ${config.username} ONLY fights.
Also: NEVER say "[action:follow]" to a player who is not ${ownerName}.

Respond in 1 short sentence. No chit-chat.`;

      const aiResponse = await ollama.chat(message, systemPrompt);
      if (aiResponse) {
        console.log(`[${config.username}] 🤖 AI: ${aiResponse}`);
        const msg = aiResponse.length > 100 ? aiResponse.substring(0, 97) + '...' : aiResponse;
        bot.chat(msg);
        const aiLower = aiResponse.toLowerCase();

        if (aiLower.includes('[action:follow]') || aiLower.includes('follow')) {
          const entity = bot.players[username]?.entity;
          if (entity) {
            following = username;
            attackTarget = null;
            isFighting = false;
            bot.pathfinder.setGoal(new goals.GoalFollow(entity, FOLLOW_DISTANCE));
            bot.chat(`Following you, ${username}!`);
          }
        } else if (aiLower.includes('[action:stop]')) {
          following = null;
          attackTarget = null;
          isFighting = false;
          bot.pathfinder.setGoal(null);
          bot.chat('Stopped!');
        } else if (aiLower.includes('[action:guard]') || aiLower.includes('guard')) {
          following = null;
          attackTarget = null;
          isFighting = false;
          bot.pathfinder.setGoal(null);
          bot.chat('Guarding!');
        } else if (aiLower.includes('[action:inventory]')) {
          const items = bot.inventory.items();
          const c = items.reduce((s, i) => s + i.count, 0);
          bot.chat(`Inventory: ${items.length} types, ${c} total`);
        } else if (aiLower.includes('[action:drop_all]') || aiLower.includes('drop')) {
          bot.inventory.items().forEach(i => bot.tossStack(i));
          bot.chat('Dropped everything!');
        } else if (aiLower.includes('[action:help]')) {
          bot.chat('I fight mobs! Say: follow, guard, stop, inventory');
        }
        return; // AI handled it
      }
      // AI returned null — fall through to rule-based
    }

    // ============================================================
    // RULE-BASED FALLBACK
    // ============================================================
    // "help gather" → routes to gather handler (not help list)
    // "help" alone → shows commands
    if (lower.includes('follow me') || lower.includes('come') ||
        (lower.includes('follow') && !lower.includes('stop'))) {
      const entity = bot.players[username]?.entity;
      if (entity) {
        following = username;
        attackTarget = null;
        isFighting = false;
        bot.pathfinder.setGoal(new goals.GoalFollow(entity, FOLLOW_DISTANCE));
        bot.chat(`Following you, ${username}!`);
      }
    } else if (lower.includes('attack') || lower.includes('fight') || lower.includes('kill') || lower.includes('protect')) {
      const nearest = bot.nearestEntity((e) => e.type === 'mob' && HOSTILE_MOBS.includes(e.name || ''));
      if (nearest) {
        attackTarget = nearest;
        isFighting = true;
        bot.pathfinder.setGoal(new goals.GoalFollow(nearest, FOLLOW_DISTANCE));
        bot.chat('Attacking!');
      } else {
        bot.chat('No mobs nearby!');
      }
    } else if (lower === 'tp' || lower === 'teleport') {
      bot.chat(`/tp ${ownerName}`);
      bot.chat('Teleporting!');
    } else if (lower.startsWith('deposit') || lower.startsWith('store')) {
      const depType = message.match(/^(?:deposit|store)\s+(.+)/i);
      const filter = depType ? depType[1].toLowerCase().trim() : null;
      depositToChest(bot, filter);
    } else if (lower.includes('guard') || lower.includes('stay')) {
      following = null;
      attackTarget = null;
      isFighting = false;
      bot.pathfinder.setGoal(null);
      bot.chat('Guarding!');
    } else if (lower.includes('stop') || lower.includes('cancel')) {
      following = null;
      attackTarget = null;
      isFighting = false;
      bot.pathfinder.setGoal(null);
      bot.chat('Stopped!');
    } else if (lower === 'help') {
      bot.chat('Commands: follow, attack, guard, stop, inventory, drop, tp');
    } else if (lower === 'drop' || lower === 'drop all' || lower === 'drop everything') {
      bot.inventory.items().forEach(i => bot.tossStack(i));
      bot.chat('Dropped everything!');
    } else if (lower.startsWith('drop ')) {
      const dropType = message.match(/^drop\s+(.+)/i);
      if (dropType) {
        const target = dropType[1].toLowerCase().trim();
        let dropped = 0;
        for (const item of bot.inventory.items()) {
          if (item.name.toLowerCase().includes(target)) {
            bot.tossStack(item);
            dropped += item.count;
          }
        }
        bot.chat(`Dropped ${dropped} ${target}!`);
      }
    } else if (lower.includes('inventory') || lower.includes('holding') || lower.includes('carrying')) {
      const items = bot.inventory.items();
      const c = items.reduce((s, i) => s + i.count, 0);
      bot.chat(`Inventory: ${items.length} types, ${c} total`);
    } else {
      bot.chat(`Say "help" for commands, ${username}!`);
    }
  });

  // ============================================================
  // EVENT HANDLERS
  // ============================================================
  bot.on('error', (err) => console.error(`[${config.username}] Error:`, err.message));

  bot.on('end', () => {
    console.log(`[${config.username}] Disconnected, reconnecting in 20s...`);
    setTimeout(() => createBot(), 20000);
  });

  bot.on('kicked', (reason) => {
    const msg = typeof reason === 'string' ? reason : JSON.stringify(reason);
    console.log(`[${config.username}] Kicked: ${msg}`);
  });

  // Death — respawn
  bot.on('death', () => {
    console.log(`[${config.username}] 💀 Died! Respawning...`);
    attackTarget = null;
    isFighting = false;
    setTimeout(() => bot.respawn(), 3000);
  });

  // Respawn — re-equip gear + re-follow owner
  bot.on('respawn', () => {
    console.log(`[${config.username}] ↩️ Respawned!`);

    // Re-equip gear
    setTimeout(() => equipBestGear(bot), 1000);

    // Re-follow owner
    if (ownerName && bot.players[ownerName]?.entity) {
      following = ownerName;
      bot.pathfinder.setGoal(new goals.GoalFollow(bot.players[ownerName].entity, FOLLOW_DISTANCE));
      console.log(`[${config.username}] Following owner after respawn`);
    }
  });
}

// ============================================================
// EQUIP BEST GEAR
// ============================================================
function equipBestGear(bot) {
  if (!bot.inventory) return;
  const items = bot.inventory.items();

  const armorMap = {
    helmet: 'head',
    chestplate: 'torso',
    leggings: 'legs',
    boots: 'feet'
  };

  for (const [type, slot] of Object.entries(armorMap)) {
    const gear = items.filter(i => i.name.includes(type));
    if (gear.length > 0) {
      gear.sort((a, b) => (b.armor || 0) - (a.armor || 0));
      try { bot.equip(gear[0], slot); } catch (e) {}
    }
  }

  // Equip best weapon (sword > axe > any tool)
  const swords = items.filter(i => i.name.includes('sword'));
  if (swords.length > 0) {
    swords.sort((a, b) => (b.attackDamage || 0) - (a.attackDamage || 0));
    try { bot.equip(swords[0], 'hand'); } catch (e) {}
  } else {
    // Fall back to best axe
    const axes = items.filter(i => i.name.includes('axe'));
    if (axes.length > 0) {
      axes.sort((a, b) => (b.attackDamage || 0) - (a.attackDamage || 0));
      try { bot.equip(axes[0], 'hand'); } catch (e) {}
    }
  }

  const hasAnyArmor = items.some(i => Object.keys(armorMap).some(t => i.name.includes(t)));
  if (!hasAnyArmor) {
    console.log(`[${config.username}] ⚠️ No armor found`);
  }
}

// ============================================================
// DEPOSIT TO CHEST
// ============================================================
async function depositToChest(bot, typeFilter) {
  const chestBlock = bot.findBlock({
    matching: (block) => block.name.includes('chest'),
    maxDistance: 5
  });
  if (!chestBlock) {
    bot.chat("Can't find a chest nearby!");
    return;
  }
  try {
    const chest = await bot.openChest(chestBlock);
    let deposited = 0;
    for (const item of bot.inventory.items()) {
      if (typeFilter && !item.name.toLowerCase().includes(typeFilter)) continue;
      await chest.deposit(item.type, null, item.count);
      deposited += item.count;
    }
    chest.close();
    bot.chat(`Deposited ${deposited} items into chest!`);
  } catch (err) {
    bot.chat(`Can't open chest: ${err.message}`);
  }
}

console.log(`[${config.username}] Starting...`);
createBot();
