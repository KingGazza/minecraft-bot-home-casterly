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
    if (botNames.includes(username)) return;
    // Only respond to assigned player
    if (username !== ownerName) return;

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
          bot.chat('Commands: follow me, attack, guard, stop');
        }
      }
    } else {
      const lower = message.toLowerCase();
      if (lower.includes('follow me') || (lower.includes('follow') && !lower.includes('stop'))) {
        const entity = bot.players[username]?.entity;
        if (entity) { following = username; bot.pathfinder.setGoal(new goals.GoalFollow(entity, 3)); bot.chat(`Following you, ${username}!`); }
      } else if (lower.includes('attack') || lower.includes('fight')) {
        const mob = bot.nearestEntity((e) => e.type === 'mob');
        if (mob) { isFighting = true; bot.attack(mob); setTimeout(() => { isFighting = false; }, 1000); bot.chat('Attacking!'); }
        else { bot.chat('No mobs nearby!'); }
      } else if (lower.includes('guard') || lower.includes('stay')) {
        following = null; bot.pathfinder.setGoal(null); bot.chat('Guarding!');
      } else if (lower.includes('stop')) {
        following = null; bot.pathfinder.setGoal(null); isFighting = false; bot.chat('Stopped!');
      } else if (lower.includes('help')) {
        bot.chat('Commands: follow me, attack, guard, stop');
      }
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
}

console.log(`[${config.username}] Starting...`);
createBot();
