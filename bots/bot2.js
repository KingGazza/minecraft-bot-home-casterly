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
let gatherTarget = null; // null = any resource, or specific type like 'oak', 'iron_ore'
let mcData;

const botNames = ['AI_Fighter', 'AI_Gatherer', 'Mr_Angry', 'Mr_Helpful',
  'Mr_Angry_Nox', 'Mr_Helpful_Nox',
  'Mr_Angry_KAT', 'Mr_Helpful_KAT',
  'Mr_Angry_NED', 'Mr_Helpful_NED'];

// Global error handler
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

    bot.chat(`I'm ${config.username}! Say "follow me" and I'll help!`);

    // Re-follow followed player periodically
    setInterval(() => {
      if (following && !isGathering) {
        const target = bot.players[following]?.entity;
        if (target && target.position.distanceTo(bot.entity.position) > 6) {
          bot.pathfinder.setGoal(new goals.GoalFollow(target, 5));
        }
      }
    }, 3000);

    setInterval(() => {
      // If owner joins later, start following
      if (!following && ownerName && bot.players[ownerName]?.entity) {
        following = ownerName;
        if (bot.players[ownerName]?.entity) {
          bot.pathfinder.setGoal(new goals.GoalFollow(bot.players[ownerName].entity, 5));
        }
        console.log(`[${config.username}] Owner ${ownerName} joined, following`);
      }
    }, 10000);
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
      const systemPrompt = `You are ${config.username}, a focused Minecraft helper bot for ${ownerName}.\nYour only job is to obey commands. Do NOT take initiative.\nActions (put in [brackets]):\n- [action:follow] - Follow the player\n- [action:gather:resource] - Mine a specific resource (e.g. [action:gather:oak_log], [action:gather:iron_ore], [action:gather:stone], [action:gather:diamond_ore])\n- [action:inventory] - Show items\n- [action:drop] - Drop all items\n- [action:stop] - Stop following / gathering\n- [action:help] - Explain commands\nRespond in 1 short sentence. No chit-chat.`;

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
          // Extract specific resource from [action:gather:resource_name]
          const gatherMatch = aiResponse.match(/\[action:gather:([^\]]+)\]/i);
          if (gatherMatch) {
            gatherTarget = gatherMatch[1].toLowerCase().replace(/_/g, ' ');
            bot.chat(`Gathering ${gatherTarget}!`);
          } else {
            gatherTarget = null; // any resource
            bot.chat('Gathering!');
          }
          gatherResources(bot, gatherTarget);
        } else if (lower.includes('[action:inventory]') || lower.includes('inventory')) {
          const items = bot.inventory.items();
          const c = items.reduce((s, i) => s + i.count, 0);
          bot.chat(`Inventory: ${items.length} types, ${c} total`);
        } else if (lower.includes('[action:drop]') || lower.includes('drop')) {
          bot.inventory.items().forEach(i => bot.tossStack(i));
          bot.chat('Dropped everything!');
        } else if (lower.includes('[action:stop]')) {
          isGathering = false; following = null; bot.pathfinder.setGoal(null); bot.chat('Stopped!');
        } else if (lower.includes('[action:help]') || lower.includes('help')) {
          bot.chat('Commands: follow me, gather, inventory, drop, stop');
        }
        return; // AI handled it, skip rule-based fallback
      }
      // AI returned null (timeout/error) — fall through to rule-based
    }

    // Rule-based fallback (no AI, or AI timed out)
    const lower = message.toLowerCase();
    if (lower.includes('follow me') || (lower.includes('follow') && !lower.includes('stop'))) {
      const entity = bot.players[username]?.entity;
      if (entity) { following = username; bot.pathfinder.setGoal(new goals.GoalFollow(entity, 5)); bot.chat(`Following you, ${username}!`); }
    } else if (lower.includes('gather') || lower.includes('collect')) {
      const resourceMatch = message.match(/(?:gather|collect)\s+(.+)/i);
      if (resourceMatch) {
        gatherTarget = resourceMatch[1].toLowerCase().trim();
        bot.chat(`Gathering ${gatherTarget}!`);
      } else {
        gatherTarget = null;
        bot.chat('Gathering!');
      }
      gatherResources(bot, gatherTarget);
    } else if (lower.includes('inventory')) {
      const items = bot.inventory.items();
      const c = items.reduce((s, i) => s + i.count, 0);
      bot.chat(`Inventory: ${items.length} types, ${c} total`);
    } else if (lower.includes('drop')) {
      bot.inventory.items().forEach(i => bot.tossStack(i));
      bot.chat('Dropped!');
    } else if (lower.includes('stop')) {
      isGathering = false; following = null; bot.pathfinder.setGoal(null); bot.chat('Stopped!');
    } else if (lower.includes('help')) {
      bot.chat('Commands: follow me, gather, inventory, drop, stop');
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

async function gatherResources(bot, resourceType) {
  const typeFilter = resourceType ? resourceType.toLowerCase() : null;

  const resources = bot.findBlocks({
    matching: (block) => {
      if (!block) return false;
      const name = block.name.toLowerCase();

      if (typeFilter) {
        // Mine only the specific requested resource
        return name.includes(typeFilter);
      }

      // Default: mine common resources
      return name.includes('log') || name.includes('oak') || name.includes('birch') ||
             name.includes('spruce') || name.includes('stone') || name.includes('dirt') ||
             name.includes('coal_ore') || name.includes('iron_ore');
    },
    maxDistance: 25,
    count: 5
  });

  if (resources.length > 0 && !isGathering) {
    isGathering = true;
    const target = resources[0];
    const block = bot.blockAt(target);
    if (block && bot.canDigBlock(block)) {
      try {
        console.log(`[${config.username}] Mining: ${block.name}`);
        await bot.dig(block);
        console.log(`[${config.username}] Mined: ${block.name}`);
      } catch (err) {
        console.log(`[${config.username}] Can't mine: ${err.message}`);
      }
    }
    isGathering = false;
  }
}

console.log(`[${config.username}] Starting...`);
createBot();
