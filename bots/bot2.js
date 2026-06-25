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
let gatherQuantity = 64; // default target per command
let mcData;

const botNames = ['AI_Fighter', 'AI_Gatherer', 'Mr_Angry', 'Mr_Helpful',
  'Mr_Angry_Nox', 'Mr_Helpful_Nox',
  'Mr_Angry_KAT', 'Mr_Helpful_KAT',
  'Mr_Angry_NED', 'Mr_Helpful_NED'];

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

    bot.chat(`I'm ${config.username}! Say "gather 64 oak" and I'll work!`);

    setInterval(() => {
      if (following && !isGathering) {
        const target = bot.players[following]?.entity;
        if (target && target.position.distanceTo(bot.entity.position) > 6) {
          bot.pathfinder.setGoal(new goals.GoalFollow(target, 5));
        }
      }
    }, 3000);

    setInterval(() => {
      if (!following && ownerName && bot.players[ownerName]?.entity) {
        following = ownerName;
        if (bot.players[ownerName]?.entity) {
          bot.pathfinder.setGoal(new goals.GoalFollow(bot.players[ownerName].entity, 5));
        }
        console.log(`[${config.username}] Owner ${ownerName} joined, following`);
      }
    }, 10000);

    // Emergency surface if drowning
    setInterval(() => {
      if (bot.entity && bot.entity.air !== undefined && bot.entity.air < 100) {
        const pos = bot.entity.position;
        bot.pathfinder.setGoal(new goals.GoalNear(pos.x, pos.y + 10, pos.z, 2));
        bot.chat('Help! Drowning!');
      }
    }, 2000);
  });

  bot.on('chat', async (username, message) => {
    if (username === config.username) return;

    if (botNames.includes(username)) {
      if (!message.toLowerCase().includes(config.username.toLowerCase())) return;
    } else {
      if (username !== ownerName) return;
    }

    console.log(`[${config.username}] 💬 ${username}: ${message}`);

    const aiAvailable = await ollama.isAvailable();

    if (aiAvailable && ollamaReady) {
      const systemPrompt = `You are ${config.username}, a focused Minecraft helper bot for ${ownerName}.\nYour only job is to obey commands. Do NOT take initiative.\nActions (put in [brackets]):\n- [action:follow] - Follow the player\n- [action:gather:resource:quantity] - Mine a specific resource (e.g. [action:gather:oak_log:64], [action:gather:iron_ore:32], [action:gather:stone:64])\n- [action:inventory] - Show items\n- [action:drop] - Drop all items\n- [action:drop:resource] - Drop specific items (e.g. [action:drop:dirt], [action:drop:oak_log])\n- [action:stop] - Stop following / gathering\n- [action:help] - Explain commands\nRespond in 1 short sentence. No chit-chat.`;

      const aiResponse = await ollama.chat(message, systemPrompt);
      if (aiResponse) {
        console.log(`[${config.username}] 🤖 AI: ${aiResponse}`);
        const msg = aiResponse.length > 100 ? aiResponse.substring(0, 97) + '...' : aiResponse;
        bot.chat(msg);
        const lower = aiResponse.toLowerCase();
        if (lower.includes('[action:follow]') || lower.includes('follow')) {
          const entity = bot.players[username]?.entity;
          if (entity) { following = username; bot.pathfinder.setGoal(new goals.GoalFollow(entity, 5)); bot.chat(`Following you, ${username}!`); }
        } else if (lower.includes('[action:gather:') || lower.includes('[action:gather]') || lower.includes('gather') || lower.includes('collect')) {
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
        } else if (lower.includes('[action:inventory]') || lower.includes('inventory')) {
          const items = bot.inventory.items();
          const c = items.reduce((s, i) => s + i.count, 0);
          bot.chat(`Inventory: ${items.length} types, ${c} total`);
        } else if (lower.includes('[action:drop:') || lower.includes('[action:drop]') || lower.includes('drop')) {
          // Check for specific drop target
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
        } else if (lower.includes('[action:stop]')) {
          isGathering = false; following = null; bot.pathfinder.setGoal(null); bot.chat('Stopped!');
        } else if (lower.includes('[action:help]') || lower.includes('help')) {
          bot.chat('Commands: gather [qty] [resource], follow, inventory, drop, stop');
        }
        return;
      }
    }

    // Rule-based fallback
    const lower = message.toLowerCase();
    if (lower.includes('follow me') || (lower.includes('follow') && !lower.includes('stop'))) {
      const entity = bot.players[username]?.entity;
      if (entity) { following = username; bot.pathfinder.setGoal(new goals.GoalFollow(entity, 5)); bot.chat(`Following you, ${username}!`); }
    } else if (lower.includes('gather') || lower.includes('collect')) {
      // Parse: "gather 64 oak" or "gather oak" or "gather 32 iron ore"
      const qtyMatch = message.match(/(?:gather|collect)\s+(\d+)\s+(.+)/i);
      if (qtyMatch) {
        gatherQuantity = parseInt(qtyMatch[1]);
        gatherTarget = qtyMatch[2].toLowerCase().trim();
        bot.chat(`Gathering ${gatherQuantity} ${gatherTarget}!`);
      } else {
        const nameMatch = message.match(/(?:gather|collect)\s+(.+)/i);
        if (nameMatch) {
          gatherTarget = nameMatch[1].toLowerCase().trim();
          gatherQuantity = 64;
          bot.chat(`Gathering ${gatherTarget}!`);
        } else {
          gatherTarget = null;
          gatherQuantity = 64;
          bot.chat('Gathering!');
        }
      }
      gatherResources(bot, gatherTarget, gatherQuantity);
    } else if (lower.includes('inventory')) {
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
    } else if (lower.includes('stop')) {
      isGathering = false; following = null; bot.pathfinder.setGoal(null); bot.chat('Stopped!');
    } else if (lower.includes('help')) {
      bot.chat('Commands: gather [qty] [resource], follow, inventory, drop, stop');
    } else {
      bot.chat(`Say "help" for commands, ${username}!`);
    }
  });

  bot.on('error', (err) => console.error(`[${config.username}] Error:`, err.message));

  bot.on('end', () => {
    console.log(`[${config.username}] Disconnected, reconnecting in 20s...`);
    setTimeout(() => createBot(), 20000);
  });

  bot.on('kicked', (reason) => {
    const msg = typeof reason === 'string' ? reason : JSON.stringify(reason);
    console.log(`[${config.username}] Kicked: ${msg}`);
  });
}

async function gatherResources(bot, resourceType, targetQty = 64) {
  const typeFilter = resourceType ? resourceType.toLowerCase() : null;

  if (isGathering) return;
  isGathering = true;

  let totalMined = 0;

  while (totalMined < targetQty) {
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

    // Find blocks to mine
    const resources = bot.findBlocks({
      matching: (block) => {
        if (!block) return false;
        const name = block.name.toLowerCase();
        if (typeFilter) return name.includes(typeFilter);
        return name.includes('log') || name.includes('oak') || name.includes('birch') ||
               name.includes('spruce') || name.includes('stone') || name.includes('dirt') ||
               name.includes('coal_ore') || name.includes('iron_ore');
      },
      maxDistance: 25,
      count: 5
    });

    if (resources.length === 0) {
      // Try moving a bit and re-scanning
      const nearby = bot.findBlocks({ matching: () => true, maxDistance: 3, count: 1 });
      if (nearby.length > 0) {
        const wanderTarget = nearby[0];
        bot.pathfinder.setGoal(new goals.GoalNear(
          wanderTarget.x + Math.floor(Math.random() * 10) - 5,
          wanderTarget.y,
          wanderTarget.z + Math.floor(Math.random() * 10) - 5,
          2
        ));
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }
      bot.chat(`Got ${currentCount} ${typeFilter || 'resources'} — can't find more nearby.`);
      break;
    }

    // Mine blocks we found
    let minedThisBatch = false;
    for (const target of resources) {
      if (!isGathering) break; // stop command was issued
      if (currentCount >= targetQty) break;

      const block = bot.blockAt(target);
      if (!block || !bot.canDigBlock(block)) continue;

      try {
        const dist = bot.entity.position.distanceTo(target);
        if (dist > 4) {
          bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, 3));
          await new Promise(resolve => {
            const check = setInterval(() => {
              if (bot.entity.position.distanceTo(target) < 4 || !bot.pathfinder.isMoving()) {
                clearInterval(check);
                resolve();
              }
            }, 500);
            setTimeout(() => { clearInterval(check); resolve(); }, 8000);
          });
        }

        console.log(`[${config.username}] Mining: ${block.name}`);
        await bot.dig(block);
        totalMined++;
        minedThisBatch = true;
        console.log(`[${config.username}] Mined: ${block.name}`);

        // Update count after dig
        if (typeFilter) {
          const items = bot.inventory.items();
          currentCount = items.filter(i => i.name.toLowerCase().includes(typeFilter))
                              .reduce((s, i) => s + i.count, 0);
        } else {
          currentCount = bot.inventory.items().reduce((s, i) => s + i.count, 0);
        }
      } catch (err) {
        console.log(`[${config.username}] Can't mine: ${err.message}`);
      }

      await new Promise(r => setTimeout(r, 300));
    }

    if (!minedThisBatch) {
      bot.chat(`Stuck — got ${currentCount} so far. Need more reachable blocks.`);
      break;
    }
  }

  isGathering = false;
  const finalCount = typeFilter
    ? bot.inventory.items().filter(i => i.name.toLowerCase().includes(typeFilter))
                           .reduce((s, i) => s + i.count, 0)
    : bot.inventory.items().reduce((s, i) => s + i.count, 0);

  if (finalCount > 0) {
    bot.chat(`Done! Have ${finalCount} ${typeFilter || 'total items'}.`);
  }

  // Go find the owner
  if (ownerName && bot.players[ownerName]?.entity) {
    following = ownerName;
    bot.pathfinder.setGoal(new goals.GoalFollow(bot.players[ownerName].entity, 5));
    bot.chat(`Coming back to you, ${ownerName}!`);
  }
}

console.log(`[${config.username}] Starting...`);
createBot();
