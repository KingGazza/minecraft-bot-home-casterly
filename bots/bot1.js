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
let ollamaReady = false;

// Bot names to ignore (other bots)
const botNames = ['AI_Fighter', 'AI_Gatherer', 'Mr_Angry', 'Mr_Helpful',
  'Mr_Angry_Nox', 'Mr_Helpful_Nox',
  'Mr_Angry_KAT', 'Mr_Helpful_KAT',
  'Mr_Angry_NED', 'Mr_Helpful_NED'];

// Global error handler to prevent crashes from mineflayer protocol issues
process.on('uncaughtException', (err) => {
  console.error(`[${config.username}] Uncaught: ${err.message}`);
});

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
      bot.pathfinder.setGoal(new goals.GoalFollow(bot.players[ownerName].entity, 3));
      console.log(`[${config.username}] Following owner: ${ownerName}`);
    }

    bot.chat(`I'm ${config.username}! Say "follow me" for protection!`);

    // Equip best available armor and weapon from inventory
    equipBestGear(bot);

    setInterval(() => {
      // If owner joins later, start following
      if (!following && ownerName && bot.players[ownerName]?.entity) {
        following = ownerName;
        console.log(`[${config.username}] Owner ${ownerName} joined, following`);
      }
      if (following && !isFighting) {
        const target = bot.players[following]?.entity;
        if (target && target.position.distanceTo(bot.entity.position) > 6) {
          bot.pathfinder.setGoal(new goals.GoalFollow(target, 3));
        }
      }
    }, 3000);

    // Emergency surface if drowning
    setInterval(() => {
      if (bot.entity && bot.entity.air !== undefined && bot.entity.air < 100) {
        const pos = bot.entity.position;
        bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y + 10, pos.z, 2));
        console.log(`[${config.username}] Help! Drowning!`);
      }
    }, 2000);

    // Auto-heal: eat food when low
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
  });

  bot.on('physicsTick', () => {
    if (!isFighting) {
      const entity = bot.nearestEntity((e) =>
        e.type === 'mob' &&
        e.mobType &&
        ['zombie', 'skeleton', 'spider', 'creeper', 'enderman', 'witch', 'drowned'].includes(e.mobType) &&
        e.position.distanceTo(bot.entity.position) < 5
      );
      if (entity) {
        isFighting = true;
        bot.attack(entity);
        bot.lookAt(entity.position.offset(0, 1.5, 0));
        setTimeout(() => { isFighting = false; }, 800);
      }
    }
  });

  bot.on('chat', async (username, message) => {
    if (username === config.username) return;

    // Another bot talking — only respond if they mention my name
    if (botNames.includes(username)) {
      if (!message.toLowerCase().includes(config.username.toLowerCase())) return;
    } else {
      // For players, only respond to owner
      if (username !== ownerName) return;
    }

    console.log(`[${config.username}] 💬 ${username}: ${message}`);

    const aiAvailable = await ollama.isAvailable();

    if (aiAvailable && ollamaReady) {
      const systemPrompt = `You are ${config.username}, a Minecraft fighter.
Protect the player from mobs.
Actions (put in [brackets]):
- [action:follow] - Follow whoever asked
- [action:attack] - Fight mobs
- [action:guard] - Stand guard
- [action:stop] - Stop
- [action:help] - Explain
Keep responses very short (1-2 sentences).`;

      const aiResponse = await ollama.chat(message, systemPrompt);
      if (aiResponse) {
        console.log(`[${config.username}] 🤖 AI: ${aiResponse}`);
        const msg = aiResponse.length > 100 ? aiResponse.substring(0, 97) + '...' : aiResponse;
        bot.chat(msg);
        const lower = aiResponse.toLowerCase();
        if (lower.includes('[action:follow]') || lower.includes('follow')) {
          const entity = bot.players[username]?.entity;
          if (entity) { following = username; bot.pathfinder.setGoal(new goals.GoalFollow(entity, 3)); bot.chat(`Following you, ${username}!`); }
        } else if (lower.includes('[action:attack]') || lower.includes('attack')) {
          const mob = bot.nearestEntity((e) => e.type === 'mob');
          if (mob) { isFighting = true; bot.attack(mob); setTimeout(() => { isFighting = false; }, 1000); bot.chat('Attacking!'); }
          else { bot.chat('No mobs nearby!'); }
        } else if (lower.includes('[action:guard]') || lower.includes('guard') || lower.includes('stay')) {
          following = null; bot.pathfinder.setGoal(null); bot.chat('Guarding!');
        } else if (lower.includes('[action:stop]')) {
          following = null; bot.pathfinder.setGoal(null); isFighting = false; bot.chat('Stopped!');
        } else if (lower.includes('[action:help]') || lower.includes('help')) {
          bot.chat('Commands: follow me, attack, guard, drop, stop');
        } else if (lower.includes('[action:inventory]') || lower.includes('inventory')) {
          const items = bot.inventory.items();
          const c = items.reduce((s, i) => s + i.count, 0);
          bot.chat(`Inventory: ${items.length} types, ${c} total`);
        } else if (lower.includes('[action:drop:') || lower.includes('[action:drop]') || lower.includes('drop')) {
          const dropMatch = aiResponse.match(/\[action:drop:([^\]]+)\]/i);
          if (dropMatch) {
            const dropType = dropMatch[1].toLowerCase().replace(/_/g, ' ');
            let dropped = 0;
            for (const item of bot.inventory.items()) {
              if (item.name.toLowerCase().includes(dropType)) {
                bot.tossStack(item);
                dropped += item.count;
              }
            }
            bot.chat(`Dropped ${dropped} ${dropType}!`);
          } else {
            bot.inventory.items().forEach(i => bot.tossStack(i));
            bot.chat('Dropped everything!');
          }
        }
        return; // AI handled it, skip rule-based fallback
      }
      // AI returned null (timeout/error) — fall through to rule-based
    }

    // Rule-based fallback (no AI, or AI timed out)
    const lower = message.toLowerCase();
    if (lower.includes('follow me') || lower === 'come' || lower === 'come here' || (lower.includes('follow') && !lower.includes('stop'))) {
      const entity = bot.players[username]?.entity;
      if (entity) { following = username; bot.pathfinder.setGoal(new goals.GoalFollow(entity, 3)); bot.chat(`Following you, ${username}!`); }
    } else if (lower.includes('attack') || lower.includes('fight')) {
      const mob = bot.nearestEntity((e) => e.type === 'mob');
      if (mob) { isFighting = true; bot.attack(mob); setTimeout(() => { isFighting = false; }, 1000); bot.chat('Attacking!'); }
      else { bot.chat('No mobs nearby!'); }
    } else if (lower === 'tp' || lower === 'teleport') {
      bot.chat(`/tp ${ownerName}`);
      bot.chat('Teleporting!');
    } else if (lower.startsWith('deposit') || lower.startsWith('store')) {
      const depType = message.match(/^(?:deposit|store)\s+(.+)/i);
      const filter = depType ? depType[1].toLowerCase().trim() : null;
      depositToChest(bot, filter);
    } else if (lower.includes('guard') || lower.includes('stay')) {
      following = null; bot.pathfinder.setGoal(null); bot.chat('Guarding!');
    } else if (lower.includes('stop')) {
      following = null; bot.pathfinder.setGoal(null); isFighting = false; bot.chat('Stopped!');
    } else if (lower === 'help') {
      bot.chat('Commands: follow me, attack, guard, drop, stop');
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
    } else if (lower.includes('inventory')) {
      const items = bot.inventory.items();
      const c = items.reduce((s, i) => s + i.count, 0);
      bot.chat(`Inventory: ${items.length} types, ${c} total`);
    } else {
      bot.chat(`Say "help" for commands, ${username}!`);
    }
  });

  bot.on('error', (err) => console.error(`[${config.username}] Error:`, err.message));

  bot.on('end', () => {
    console.log(`[${config.username}] Disconnected, reconnecting in 20s...`);
    setTimeout(() => {
      createBot();
    }, 20000);
  });

  bot.on('kicked', (reason) => {
    const msg = typeof reason === 'string' ? reason : JSON.stringify(reason);
    console.log(`[${config.username}] Kicked: ${msg}`);
  });

  // Respawn on death
  bot.on('death', () => {
    console.log(`[${config.username}] 💀 Died! Respawning...`);
    setTimeout(() => bot.respawn(), 3000);
  });

  bot.on('respawn', () => {
    console.log(`[${config.username}] ↩️ Respawned!`);
    if (ownerName && bot.players[ownerName]?.entity) {
      following = ownerName;
      bot.pathfinder.setGoal(new goals.GoalFollow(bot.players[ownerName].entity, 3));
      console.log(`[${config.username}] Following owner after respawn`);
    }
  });
}

// Equip best armor and weapon from inventory
function equipBestGear(bot) {
  const items = bot.inventory.items();

  // Slot map: what armor type goes in which equipment slot
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

  // Equip best sword
  const swords = items.filter(i => i.name.includes('sword'));
  if (swords.length > 0) {
    swords.sort((a, b) => (b.attackDamage || 0) - (a.attackDamage || 0));
    try { bot.equip(swords[0], 'hand'); } catch (e) {}
  }

  // If no armor at all, ask for it
  const hasAnyArmor = items.some(i => Object.keys(armorMap).some(t => i.name.includes(t)));
  if (!hasAnyArmor) {
    console.log(`[${config.username}] ⚠️ No armor found — need gear to survive!`);
  }
}

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
