const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const OllamaClient = require('./ollama-client');

// Configuration from environment variables
const config = {
  host: process.env.MC_HOST || 'localhost',
  port: parseInt(process.env.MC_PORT) || 25565,
  username: process.env.BOT_NAME || 'AI_Fighter',
  version: '1.20.4',
  auth: 'offline',  // No Microsoft account needed
  log: false
};

const ollama = new OllamaClient(
  process.env.OLLAMA_HOST || 'host.docker.internal',
  process.env.OLLAMA_PORT || '11434',
  process.env.OLLAMA_MODEL || 'llama3.2:3b'
);

const playerName = process.env.PLAYER_NAME || 'YourBedrockName';

// Create the bot
const bot = mineflayer.createBot(config);

// Load pathfinder
bot.loadPlugin(pathfinder);

let followTarget = null;
let isFighting = false;
let ollamaReady = false;

bot.once('spawn', async () => {
  console.log(`[${config.username}] Spawned!`);

  // Check if Ollama is available
  ollamaReady = await ollama.init();
  if (ollamaReady) {
    console.log(`[${config.username}] ✅ Connected to Ollama (${ollama.model})`);
  } else {
    console.log(`[${config.username}] ⚠️ Running in basic mode (Ollama unavailable)`);
  }

  // Setup movement
  const mcData = require('minecraft-data')(bot.version);
  const defaultMove = new Movements(bot, mcData);
  bot.pathfinder.setMovements(defaultMove);

  // Find the player to follow
  const player = bot.players[playerName];
  if (player && player.entity) {
    followTarget = player.entity;
    bot.pathfinder.setGoal(new goals.GoalFollow(followTarget, 3));
    console.log(`[${config.username}] Following ${playerName}`);
  } else {
    console.log(`[${config.username}] ⚠️ Player ${playerName} not found!`);
  }

  // Announce arrival
  bot.chat(`👋 Hello ${playerName}! I'm ${config.username}, your bodyguard!`);

  // Auto-follow the player periodically
  setInterval(() => {
    const playerEntity = bot.players[playerName]?.entity;
    if (playerEntity && !isFighting) {
      const distance = playerEntity.position.distanceTo(bot.entity.position);
      if (distance > 6) {
        bot.pathfinder.setGoal(new goals.GoalFollow(playerEntity, 3));
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
      // Look at the entity
      bot.lookAt(entity.position.offset(0, 1.5, 0));
      setTimeout(() => { isFighting = false; }, 800);
    }
  }
});

// Handle chat messages with AI
bot.on('chat', async (username, message) => {
  if (username === playerName) {
    console.log(`[${config.username}] 💬 Player: ${message}`);

    // Check if Ollama is available
    const aiAvailable = await ollama.isAvailable();
    
    if (aiAvailable) {
      // Use AI to understand commands
      const systemPrompt = `You are ${config.username}, a Minecraft companion. 
Your role: FIGHTER/BODYGUARD.
You protect the player from hostile mobs.
Available actions (put in [brackets]):
- [action:follow] - Follow the player
- [action:attack] - Attack nearby hostile mobs
- [action:guard] - Stand guard at current position
- [action:stop] - Stop current action
- [action:help] - Explain what you can do

Keep responses VERY SHORT (1-2 sentences) and friendly.`;

      const aiResponse = await ollama.chat(message, systemPrompt);
      
      if (aiResponse) {
        console.log(`[${config.username}] 🤖 AI: ${aiResponse}`);
        
        // Truncate to avoid spam
        const chatMessage = aiResponse.length > 100 ? aiResponse.substring(0, 97) + '...' : aiResponse;
        bot.chat(chatMessage);
        
        // Parse actions
        const lowerResponse = aiResponse.toLowerCase();
        if (lowerResponse.includes('[action:follow]') || lowerResponse.includes('follow')) {
          const player = bot.players[playerName]?.entity;
          if (player) {
            bot.pathfinder.setGoal(new goals.GoalFollow(player, 3));
            bot.chat('✅ Following you!');
          }
        } else if (lowerResponse.includes('[action:attack]') || lowerResponse.includes('attack') || lowerResponse.includes('fight')) {
          const mob = bot.nearestEntity((e) => e.type === 'mob');
          if (mob) {
            isFighting = true;
            bot.attack(mob);
            setTimeout(() => { isFighting = false; }, 1000);
            bot.chat('⚔️ Attacking!');
          } else {
            bot.chat('🔍 No mobs nearby!');
          }
        } else if (lowerResponse.includes('[action:guard]') || lowerResponse.includes('guard') || lowerResponse.includes('stay')) {
          bot.pathfinder.setGoal(null);
          bot.chat('🛡️ Guarding this spot!');
        } else if (lowerResponse.includes('[action:stop]') || lowerResponse.includes('stop')) {
          bot.pathfinder.setGoal(null);
          isFighting = false;
          bot.chat('⏹️ Stopped!');
        } else if (lowerResponse.includes('[action:help]') || lowerResponse.includes('help')) {
          bot.chat('🛡️ I can: follow, attack, guard, stop. Just ask!');
        }
      }
    } else {
      // Fallback: simple command parsing without AI
      const lowerMsg = message.toLowerCase();
      if (lowerMsg.includes('follow')) {
        const player = bot.players[playerName]?.entity;
        if (player) {
          bot.pathfinder.setGoal(new goals.GoalFollow(player, 3));
          bot.chat('✅ Following you!');
        }
      } else if (lowerMsg.includes('attack') || lowerMsg.includes('fight')) {
        const mob = bot.nearestEntity((e) => e.type === 'mob');
        if (mob) {
          isFighting = true;
          bot.attack(mob);
          setTimeout(() => { isFighting = false; }, 1000);
          bot.chat('⚔️ Attacking!');
        } else {
          bot.chat('🔍 No mobs nearby!');
        }
      } else if (lowerMsg.includes('guard') || lowerMsg.includes('stay')) {
        bot.pathfinder.setGoal(null);
        bot.chat('🛡️ Guarding!');
      } else if (lowerMsg.includes('stop')) {
        bot.pathfinder.setGoal(null);
        isFighting = false;
        bot.chat('⏹️ Stopped!');
      } else if (lowerMsg.includes('help')) {
        bot.chat('🛡️ Commands: follow, attack, guard, stop');
      }
    }
  }
});

// Handle bot errors
bot.on('error', (err) => {
  console.error(`[${config.username}] ❌ Error:`, err.message);
});

bot.on('end', () => {
  console.log(`[${config.username}] 🔌 Disconnected, reconnecting in 5s...`);
  setTimeout(() => {
    bot.connect();
  }, 5000);
});

bot.on('kicked', (reason) => {
  console.log(`[${config.username}] 👢 Kicked: ${reason}`);
  setTimeout(() => {
    bot.connect();
  }, 10000);
});

console.log(`[${config.username}] Starting...`);
