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
  process.env.OLLAMA_MODEL || 'llama3.2:3b'
);

const playerName = process.env.PLAYER_NAME || 'YourBedrockName';
let ollamaReady = false;

const bot = mineflayer.createBot(config);
bot.loadPlugin(pathfinder);

let isGathering = false;
let mcData;

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

  const player = bot.players[playerName]?.entity;
  if (player) {
    bot.pathfinder.setGoal(new goals.GoalFollow(player, 5));
    console.log(`[${config.username}] Following ${playerName}`);
  }

  bot.chat(`🌿 Hello ${playerName}! I'm ${config.username}, your gatherer!`);

  // Auto-gather resources periodically
  setInterval(() => {
    if (!isGathering && bot.inventory.items().length < 36) {
      gatherResources();
    }
  }, 10000);
});

async function gatherResources() {
  // Find nearby resources
  const resources = bot.findBlocks({
    matching: (block) => {
      if (!block) return false;
      const name = block.name;
      return name.includes('log') || 
             name.includes('oak') ||
             name.includes('birch') ||
             name.includes('spruce') ||
             name.includes('stone') ||
             name.includes('dirt') ||
             name.includes('coal_ore') ||
             name.includes('iron_ore');
    },
    maxDistance: 25,
    count: 5
  });

  if (resources.length > 0 && !isGathering) {
    isGathering = true;
    const target = resources[0];
    const block = bot.blockAt(target);
    
    if (block && bot.canDig(block)) {
      try {
        console.log(`[${config.username}] Mining: ${block.name}`);
        await bot.dig(block);
        console.log(`[${config.username}] ✅ Mined: ${block.name}`);
      } catch (err) {
        console.log(`[${config.username}] ⚠️ Can't mine: ${err.message}`);
      }
    }
    isGathering = false;
  }
}

// Auto-collect dropped items
bot.on('physicsTick', () => {
  const items = Object.values(bot.entities).filter(e => 
    e.type === 'object' && 
    e.objectType === 'Item' &&
    e.position.distanceTo(bot.entity.position) < 3
  );
  
  if (items.length > 0 && !isGathering) {
    const item = items[0];
    bot.pathfinder.setGoal(new goals.GoalNear(item.position.x, item.position.y, item.position.z, 1));
  }
});

// Handle chat messages
bot.on('chat', async (username, message) => {
  if (username === playerName) {
    console.log(`[${config.username}] 💬 Player: ${message}`);

    const aiAvailable = await ollama.isAvailable();
    
    if (aiAvailable) {
      const systemPrompt = `You are ${config.username}, a Minecraft companion.
Your role: GATHERER/COLLECTOR.
You gather resources for the player.
Available actions (put in [brackets]):
- [action:follow] - Follow the player
- [action:gather] - Gather nearby resources
- [action:inventory] - Show what you have
- [action:drop] - Drop all items
- [action:stop] - Stop current action
- [action:help] - Explain what you can do

Keep responses VERY SHORT (1-2 sentences).`;

      const aiResponse = await ollama.chat(message, systemPrompt);
      
      if (aiResponse) {
        console.log(`[${config.username}] 🤖 AI: ${aiResponse}`);
        
        const chatMessage = aiResponse.length > 100 ? aiResponse.substring(0, 97) + '...' : aiResponse;
        bot.chat(chatMessage);

        const lowerResponse = aiResponse.toLowerCase();
        if (lowerResponse.includes('[action:follow]') || lowerResponse.includes('follow')) {
          const player = bot.players[playerName]?.entity;
          if (player) {
            bot.pathfinder.setGoal(new goals.GoalFollow(player, 5));
            bot.chat('✅ Following!');
          }
        } else if (lowerResponse.includes('[action:gather]') || lowerResponse.includes('gather') || lowerResponse.includes('collect')) {
          gatherResources();
          bot.chat('🌿 Gathering!');
        } else if (lowerResponse.includes('[action:inventory]') || lowerResponse.includes('inventory')) {
          const items = bot.inventory.items();
          const itemCount = items.reduce((sum, item) => sum + item.count, 0);
          bot.chat(`📦 I have ${items.length} types, ${itemCount} total items`);
        } else if (lowerResponse.includes('[action:drop]') || lowerResponse.includes('drop')) {
          bot.inventory.items().forEach(item => {
            bot.tossStack(item);
          });
          bot.chat('💨 Dropped everything!');
        } else if (lowerResponse.includes('[action:stop]') || lowerResponse.includes('stop')) {
          isGathering = false;
          bot.pathfinder.setGoal(null);
          bot.chat('⏹️ Stopped!');
        } else if (lowerResponse.includes('[action:help]') || lowerResponse.includes('help')) {
          bot.chat('🌿 I can: follow, gather, inventory, drop, stop. Just ask!');
        }
      }
    } else {
      // Fallback: simple commands
      const lowerMsg = message.toLowerCase();
      if (lowerMsg.includes('follow')) {
        const player = bot.players[playerName]?.entity;
        if (player) {
          bot.pathfinder.setGoal(new goals.GoalFollow(player, 5));
          bot.chat('✅ Following!');
        }
      } else if (lowerMsg.includes('gather') || lowerMsg.includes('collect')) {
        gatherResources();
        bot.chat('🌿 Gathering!');
      } else if (lowerMsg.includes('inventory')) {
        const items = bot.inventory.items();
        const count = items.reduce((sum, item) => sum + item.count, 0);
        bot.chat(`📦 ${items.length} types, ${count} total`);
      } else if (lowerMsg.includes('drop')) {
        bot.inventory.items().forEach(item => bot.tossStack(item));
        bot.chat('💨 Dropped!');
      } else if (lowerMsg.includes('stop')) {
        isGathering = false;
        bot.pathfinder.setGoal(null);
        bot.chat('⏹️ Stopped!');
      } else if (lowerMsg.includes('help')) {
        bot.chat('🌿 Commands: follow, gather, inventory, drop, stop');
      }
    }
  }
});

bot.on('error', (err) => {
  console.error(`[${config.username}] ❌ Error:`, err.message);
});

bot.on('end', () => {
  console.log(`[${config.username}] 🔌 Disconnected, reconnecting in 5s...`);
  setTimeout(() => bot.connect(), 5000);
});

bot.on('kicked', (reason) => {
  console.log(`[${config.username}] 👢 Kicked: ${reason}`);
  setTimeout(() => bot.connect(), 10000);
});

console.log(`[${config.username}] Starting...`);
