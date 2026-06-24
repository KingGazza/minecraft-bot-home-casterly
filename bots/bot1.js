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
  process.env.OLLAMA_MODEL || 'llama3.2:3b'
);

const ownerName = process.env.PLAYER_NAME || '';
let following = null;     // player name currently being followed
let isFighting = false;
let ollamaReady = false;

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

  // Follow owner by default if they're online
  if (ownerName && bot.players[ownerName]?.entity) {
    following = ownerName;
    bot.pathfinder.setGoal(new goals.GoalFollow(bot.players[ownerName].entity, 3));
    console.log(`[${config.username}] Following owner: ${ownerName}`);
  }

  bot.chat(`👋 I'm ${config.username}! Say "follow me" to get my protection!`);

  // Re-follow current target periodically if too far
  setInterval(() => {
    if (following && !isFighting) {
      const target = bot.players[following]?.entity;
      if (target && target.position.distanceTo(bot.entity.position) > 6) {
        bot.pathfinder.setGoal(new goals.GoalFollow(target, 3));
      }
    }
  }, 3000);
});

// Auto-attack hostile mobs
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

// Handle chat from ANY player
bot.on('chat', async (username, message) => {
  // Skip own messages
  if (username === config.username) return;

  console.log(`[${config.username}] 💬 ${username}: ${message}`);

  const aiAvailable = await ollama.isAvailable();

  if (aiAvailable && ollamaReady) {
    const systemPrompt = `You are ${config.username}, a Minecraft companion.
Your role: FIGHTER/BODYGUARD.
You protect players from hostile mobs.
Available actions (put in [brackets]):
- [action:follow] - Follow whoever asked
- [action:attack] - Attack nearby hostile mobs
- [action:guard] - Stand guard at current position
- [action:stop] - Stop current action
- [action:help] - Explain what you can do

Keep responses VERY SHORT (1-2 sentences) and friendly.`;

    const aiResponse = await ollama.chat(message, systemPrompt);

    if (aiResponse) {
      console.log(`[${config.username}] 🤖 AI: ${aiResponse}`);
      const chatMessage = aiResponse.length > 100 ? aiResponse.substring(0, 97) + '...' : aiResponse;
      bot.chat(chatMessage);

      const lower = aiResponse.toLowerCase();
      if (lower.includes('[action:follow]') || lower.includes('follow')) {
        const entity = bot.players[username]?.entity;
        if (entity) {
          following = username;
          bot.pathfinder.setGoal(new goals.GoalFollow(entity, 3));
          bot.chat(`✅ Following you, ${username}!`);
        }
      } else if (lower.includes('[action:attack]') || lower.includes('attack') || lower.includes('fight')) {
        const mob = bot.nearestEntity((e) => e.type === 'mob');
        if (mob) {
          isFighting = true;
          bot.attack(mob);
          setTimeout(() => { isFighting = false; }, 1000);
          bot.chat('⚔️ Attacking!');
        } else {
          bot.chat('🔍 No mobs nearby!');
        }
      } else if (lower.includes('[action:guard]') || lower.includes('guard') || lower.includes('stay')) {
        following = null;
        bot.pathfinder.setGoal(null);
        bot.chat('🛡️ Guarding this spot!');
      } else if (lower.includes('[action:stop]') || lower.includes('stop')) {
        following = null;
        bot.pathfinder.setGoal(null);
        isFighting = false;
        bot.chat('⏹️ Stopped!');
      } else if (lower.includes('[action:help]') || lower.includes('help')) {
        bot.chat('🛡️ I can: follow me, attack, guard, stop. Just ask!');
      }
    }
  } else {
    // Basic keyword fallback — any player can command
    const lower = message.toLowerCase();
    if (lower.includes('follow me') || lower.includes('follow')) {
      const entity = bot.players[username]?.entity;
      if (entity) {
        following = username;
        bot.pathfinder.setGoal(new goals.GoalFollow(entity, 3));
        bot.chat(`✅ Following you, ${username}!`);
      }
    } else if (lower.includes('attack') || lower.includes('fight')) {
      const mob = bot.nearestEntity((e) => e.type === 'mob');
      if (mob) {
        isFighting = true;
        bot.attack(mob);
        setTimeout(() => { isFighting = false; }, 1000);
        bot.chat('⚔️ Attacking!');
      } else {
        bot.chat('🔍 No mobs nearby!');
      }
    } else if (lower.includes('guard') || lower.includes('stay')) {
      following = null;
      bot.pathfinder.setGoal(null);
      bot.chat('🛡️ Guarding!');
    } else if (lower.includes('stop')) {
      following = null;
      bot.pathfinder.setGoal(null);
      isFighting = false;
      bot.chat('⏹️ Stopped!');
    } else if (lower.includes('help')) {
      bot.chat('🛡️ Commands: follow me, attack, guard, stop');
    }
  }
});

bot.on('error', (err) => console.error(`[${config.username}] ❌ Error:`, err.message));

bot.on('end', () => {
  console.log(`[${config.username}] 🔌 Disconnected, reconnecting in 5s...`);
  setTimeout(() => bot.connect(), 5000);
});

bot.on('kicked', (reason) => {
  console.log(`[${config.username}] 👢 Kicked: ${reason}`);
  setTimeout(() => bot.connect(), 10000);
});

console.log(`[${config.username}] Starting...`);
