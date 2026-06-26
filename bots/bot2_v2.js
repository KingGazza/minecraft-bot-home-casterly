const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const OllamaClient = require('./ollama-client');

const config = {
  host: process.env.MC_HOST || 'localhost',
  port: parseInt(process.env.MC_PORT) || 25565,
  username: process.env.BOT_NAME || 'AI_Gatherer',
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
let ollamaReady = false;
let isGathering = false;
let gatherTarget = null;
let gatherQuantity = 64;
let mcData;

const botNames = ['AI_Fighter', 'AI_Gatherer', 'Mr_Angry', 'Mr_Helpful',
  'Mr_Angry_Nox', 'Mr_Helpful_Nox'];

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

    mcData = require('minecraft-data')(bot.version);
    const defaultMove = new Movements(bot, mcData);
    bot.pathfinder.setMovements(defaultMove);

    if (ownerName && bot.players[ownerName]?.entity) {
      following = ownerName;
      bot.pathfinder.setGoal(new goals.GoalFollow(bot.players[ownerName].entity, 5));
      console.log(`[${config.username}] Following owner: ${ownerName}`);
    }

    bot.chat(`I'm ${config.username}! Say something like "gather 64 oak"`);

    // --- FOLLOW INTERVAL ---
    setInterval(() => {
      if (following && !isGathering) {
        const target = bot.players[following]?.entity;
        if (target) {
          bot.pathfinder.setGoal(new goals.GoalFollow(target, 5));
        }
      }

      // If owner eventually joins, start following
      if (!following && ownerName && bot.players[ownerName]?.entity) {
        following = ownerName;
        if (bot.players[ownerName]?.entity) {
          bot.pathfinder.setGoal(new goals.GoalFollow(bot.players[ownerName].entity, 5));
        }
        console.log(`[${config.username}] Owner ${ownerName} joined, following`);
      }
    }, 4000);

    // --- EMERGENCY SURFACE ---
    setInterval(() => {
      if (bot.entity && bot.entity.air !== undefined && bot.entity.air < 100) {
        const pos = bot.entity.position;
        bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y + 10, pos.z, 2));
        bot.chat('Help! Drowning!');
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
  });

  // ============================================================
  // CHAT HANDLER
  // ============================================================
  bot.on('chat', async (username, message) => {
    if (username === config.username) return;

    if (botNames.includes(username)) {
      if (!message.toLowerCase().includes(config.username.toLowerCase())) return;
      return;
    } else {
      if (username !== ownerName) return;
    }

    console.log(`[${config.username}] 💬 ${username}: ${message}`);

    const aiAvailable = await ollama.isAvailable();

    // --- AI HANDLER ---
    if (aiAvailable && ollamaReady) {
      const systemPrompt = `You are ${config.username}, a Minecraft gatherer bot owned by ${ownerName}.
Your ONLY job: mine resources that ${ownerName} asks for. You do NOT fight mobs.

Actions (put EXACTLY ONE in [brackets]):
- [action:follow] — Follow ${ownerName}
- [action:gather:resource:qty] — Mine resource (e.g. [action:gather:oak_log:64], [action:gather:iron_ore:32])
- [action:inventory] — Show items
- [action:drop] — Drop all items
- [action:stop] — Stop everything
- [action:help] — List commands
- [action:deposit] — Put items in a chest

Examples of what to say to me:
  "get me some wood" → [action:gather:oak_log:64]
  "mine 32 iron" → [action:gather:iron_ore:32]
  "collect stone" → [action:gather:stone:64]
  "come here" → [action:follow]
  "store your stuff" → [action:deposit]

${config.username} does NOT fight mobs. Only gather ${ownerName} wants.
Keep response short (1 sentence).`;

      const aiResponse = await ollama.chat(message, systemPrompt);
      if (aiResponse) {
        console.log(`[${config.username}] 🤖 AI: ${aiResponse}`);
        const msg = aiResponse.length > 100 ? aiResponse.substring(0, 97) + '...' : aiResponse;
        bot.chat(msg);
        const aiLower = aiResponse.toLowerCase();

        if (aiLower.includes('[action:follow]') || aiLower.includes('follow')) {
          const entity = bot.players[username]?.entity;
          if (entity) {
            isGathering = false;
            following = username;
            bot.pathfinder.setGoal(new goals.GoalFollow(entity, 5));
            bot.chat(`Following you, ${username}!`);
          }
        } else if (aiLower.includes('[action:gather:') || aiLower.includes('[action:gather]') || aiLower.includes('gather') || aiLower.includes('collect')) {
          const gatherMatch = aiResponse.match(/\[action:gather:([^\]]+)\]/i);
          if (gatherMatch) {
            const parts = gatherMatch[1].split(':');
            gatherTarget = parts[0].toLowerCase().replace(/_/g, ' ');
            gatherQuantity = parseInt(parts[1]) || 64;
            bot.chat(`Gathering ${gatherQuantity} ${gatherTarget}!`);
          } else {
            gatherTarget = null;
            gatherQuantity = 64;
            bot.chat('Gathering!');
          }
          gatherResources(bot, gatherTarget, gatherQuantity);
        } else if (aiLower.includes('[action:inventory]') || aiLower.includes('inventory')) {
          const items = bot.inventory.items();
          const c = items.reduce((s, i) => s + i.count, 0);
          bot.chat(`Inventory: ${items.length} types, ${c} total`);
        } else if (aiLower.includes('[action:drop]') && aiLower.includes(':') && !aiLower.includes('[action:drop_all]')) {
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
          }
        } else if (aiLower.includes('[action:drop]') || aiLower.includes('drop')) {
          bot.inventory.items().forEach(i => bot.tossStack(i));
          bot.chat('Dropped everything!');
        } else if (aiLower.includes('[action:stop]')) {
          isGathering = false;
          following = null;
          bot.pathfinder.setGoal(null);
          bot.chat('Stopped!');
        } else if (aiLower.includes('[action:deposit]')) {
          const filter = null;
          depositToChest(bot, filter);
        } else if (aiLower.includes('[action:help]')) {
          bot.chat('Commands: gather [qty] [resource], follow, stop, drop, deposit');
        }
        return;
      }
    }

    // ============================================================
    // RULE-BASED FALLBACK
    // ============================================================
    const lower = message.toLowerCase();

    if (lower.includes('follow me') || lower === 'come' || lower === 'come here' ||
        (lower.includes('follow') && !lower.includes('stop'))) {
      const entity = bot.players[username]?.entity;
      if (entity) {
        isGathering = false;
        following = username;
        bot.pathfinder.setGoal(new goals.GoalFollow(entity, 5));
        bot.chat(`Following you, ${username}!`);
      }
    } else if (lower === 'tp' || lower === 'teleport') {
      bot.chat(`/tp ${ownerName}`);
      bot.chat('Teleporting!');
    } else if (lower.includes('gather') || lower.includes('collect') || lower.includes('mine') || lower.includes('get')) {
      // "gather 64 oak", "get me 32 iron", "mine some stone", "collect wood"
      const qtyMatch = message.match(/(?:gather|collect|mine|get)\s+(?:me\s+)?(\d+)\s+(.+)/i);
      if (qtyMatch) {
        gatherQuantity = parseInt(qtyMatch[1]);
        gatherTarget = qtyMatch[2].toLowerCase().trim();
        bot.chat(`Gathering ${gatherQuantity} ${gatherTarget}!`);
      } else {
        const nameMatch = message.match(/(?:gather|collect|mine|get)\s+(?:me\s+)?(.+)/i);
        if (nameMatch) {
          gatherTarget = nameMatch[1].toLowerCase().trim()
            .replace(/^some\s+/, '')
            .replace(/^me\s+/, '');
          gatherQuantity = 64;
          bot.chat(`Gathering ${gatherTarget}!`);
        } else {
          gatherTarget = null;
          gatherQuantity = 64;
          bot.chat('Gathering!');
        }
      }
      gatherResources(bot, gatherTarget, gatherQuantity);
    } else if (lower.startsWith('deposit') || lower.startsWith('store')) {
      const depType = message.match(/^(?:deposit|store)\s+(.+)/i);
      const filter = depType ? depType[1].toLowerCase().trim() : null;
      depositToChest(bot, filter);
    } else if (lower.includes('inventory') || lower.includes('holding') || lower.includes('carrying')) {
      const items = bot.inventory.items();
      const c = items.reduce((s, i) => s + i.count, 0);
      bot.chat(`Inventory: ${items.length} types, ${c} total`);
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
    } else if (lower.includes('stop') || lower.includes('cancel')) {
      isGathering = false;
      following = null;
      bot.pathfinder.setGoal(null);
      bot.chat('Stopped!');
    } else if (lower === 'help') {
      bot.chat('Commands: gather [qty] [resource], follow, stop, drop, deposit, inventory');
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

  bot.on('death', () => {
    console.log(`[${config.username}] 💀 Died! Respawning...`);
    isGathering = false;
    setTimeout(() => bot.respawn(), 3000);
  });

  bot.on('respawn', () => {
    console.log(`[${config.username}] ↩️ Respawned!`);
    if (ownerName && bot.players[ownerName]?.entity) {
      following = ownerName;
      bot.pathfinder.setGoal(new goals.GoalFollow(bot.players[ownerName].entity, 5));
      console.log(`[${config.username}] Following owner after respawn`);
    }
  });
}

// ============================================================
// GATHER RESOURCES
// ============================================================
async function gatherResources(bot, resourceType, targetQty = 64) {
  const typeFilter = resourceType ? resourceType.toLowerCase() : null;

  if (isGathering) return;
  isGathering = true;

  let totalMined = 0;
  let consecutiveEmptyScans = 0;
  let searchRadius = 25; // Start at default, expand on empty scans

  while (totalMined < targetQty) {
    if (!isGathering) break;

    // Check current count in inventory
    let currentCount = 0;
    if (typeFilter) {
      const items = bot.inventory.items();
      for (const item of items) {
        if (item.name.toLowerCase().includes(typeFilter)) {
          currentCount += item.count;
        }
      }
    } else {
      currentCount = bot.inventory.items().reduce((s, i) => s + i.count, 0);
    }

    if (currentCount >= targetQty) {
      bot.chat(`Got ${currentCount} ${typeFilter || 'resources'}! That's your ${targetQty}!`);
      break;
    }

    // Find blocks — expand search radius on retry up to 64 blocks
    const resources = bot.findBlocks({
      matching: (block) => {
        if (!block) return false;
        const name = block.name.toLowerCase();
        if (typeFilter) return name.includes(typeFilter);
        return name.includes('log') || name.includes('oak') || name.includes('birch') ||
               name.includes('spruce') || name.includes('stone') || name.includes('dirt') ||
               name.includes('coal_ore') || name.includes('iron_ore');
      },
      maxDistance: searchRadius,
      count: 10 // look for more blocks at once
    });

    if (resources.length === 0) {
      consecutiveEmptyScans++;
      if (consecutiveEmptyScans >= 3 && searchRadius >= 64) {
        // Really tried — give up
        bot.chat(`Got ${currentCount} ${typeFilter || 'resources'} — explored far and found nothing more.`);
        break;
      }

      // Expand search and move
      searchRadius = Math.min(searchRadius + 10, 64);

      // Move to an interesting direction instead of random
      // Walk toward a random point 15-25 blocks away
      const angle = Math.random() * Math.PI * 2;
      const wanderX = bot.entity.position.x + Math.cos(angle) * (15 + Math.random() * 10);
      const wanderZ = bot.entity.position.z + Math.sin(angle) * (15 + Math.random() * 10);
      const wanderY = Math.floor(bot.entity.position.y);

      bot.pathfinder.setGoal(new goals.GoalNear(wanderX, wanderY, wanderZ, 3));
      bot.chat(`Exploring further... searching ${searchRadius} blocks`);
      await new Promise(resolve => setTimeout(resolve, 4000));
      continue;
    }

    // Reset empty scan counter since we found something
    consecutiveEmptyScans = 0;
    searchRadius = 25;

    // Mine blocks
    let minedThisBatch = false;
    for (const target of resources) {
      if (!isGathering) break;
      if (currentCount >= targetQty) break;

      const block = bot.blockAt(target);
      if (!block || !bot.canDigBlock(block)) continue;

      try {
        const dist = bot.entity.position.distanceTo(target);
        if (dist > 4) {
          bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, 3));
          // Wait until close enough or timeout
          await new Promise(resolve => {
            const check = setInterval(() => {
              if (!isGathering) { clearInterval(check); resolve(); return; }
              if (bot.entity.position.distanceTo(target) < 4 || !bot.pathfinder.isMoving()) {
                clearInterval(check);
                resolve();
              }
            }, 500);
            setTimeout(() => { clearInterval(check); resolve(); }, 8000);
          });
        }

        if (!isGathering) break;

        // Check if block still exists after pathfinding
        const currentBlock = bot.blockAt(target);
        if (!currentBlock || !bot.canDigBlock(currentBlock)) continue;

        // Check distance one more time
        if (bot.entity.position.distanceTo(target) > 6) {
          console.log(`[${config.username}] Still too far from ${block.name}, skipping`);
          continue;
        }

        console.log(`[${config.username}] Mining: ${currentBlock.name}`);
        await bot.dig(currentBlock);
        totalMined++;
        minedThisBatch = true;
        console.log(`[${config.username}] Mined: ${currentBlock.name}`);

        // Update count
        if (typeFilter) {
          const items = bot.inventory.items();
          currentCount = items.filter(i => i.name.toLowerCase().includes(typeFilter))
                              .reduce((s, i) => s + i.count, 0);
        } else {
          currentCount = bot.inventory.items().reduce((s, i) => s + i.count, 0);
        }

        // Small delay between digs
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        console.log(`[${config.username}] Can't mine: ${err.message}`);
      }
    }

    if (!minedThisBatch && resources.length > 0) {
      // We found blocks but couldn't reach any — move closer and retry
      const closest = resources[0];
      bot.pathfinder.setGoal(new goals.GoalNear(closest.x, closest.y, closest.z, 3));
      await new Promise(resolve => setTimeout(resolve, 4000));
      // Don't break, let the loop retry
    }

    if (!minedThisBatch) {
      // No blocks reachable — let the outer loop expand search
      await new Promise(r => setTimeout(r, 500));
    }
  }

  isGathering = false;

  const finalCount = typeFilter
    ? bot.inventory.items().filter(i => i.name.toLowerCase().includes(typeFilter))
                           .reduce((s, i) => s + i.count, 0)
    : bot.inventory.items().reduce((s, i) => s + i.count, 0);

  if (finalCount > 0) {
    bot.chat(`Done! Have ${finalCount} ${typeFilter || 'total items'}.`);
  } else {
    bot.chat(`Couldn't find any ${typeFilter || 'resources'}!`);
  }

  // Return to owner
  if (ownerName && bot.players[ownerName]?.entity) {
    following = ownerName;
    bot.pathfinder.setGoal(new goals.GoalFollow(bot.players[ownerName].entity, 5));
    bot.chat(`Coming back to you, ${ownerName}!`);
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
