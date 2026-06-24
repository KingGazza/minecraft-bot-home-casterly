const mineflayer = require('mineflayer')

const bot = mineflayer.createBot({
  host: process.env.MC_HOST || 'localhost',
  port: parseInt(process.env.MC_PORT || '25565'),
  username: process.env.BOT_NAME || 'Mr_Helpful',
})

bot.on('spawn', () => {
  console.log(`${bot.username} spawned`)
  bot.chat('Time to gather!')
})

bot.on('error', (err) => console.error('Bot error:', err))
bot.on('end', (reason) => console.log('Disconnected:', reason))
