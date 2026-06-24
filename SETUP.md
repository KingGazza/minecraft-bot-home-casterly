# Minecraft Bot Home — Setup & Commands
# Stack: minecraft-bot-home (Portainer ID 31)
# Repo: https://github.com/KingGazza/minecraft-bot-home-casterly

## Ports
  MineCraft (Java):   25566
  Geyser (Bedrock):   19133/udp
  RCON:               25576

## Stack Variables (set in Portainer)
  RCON_PASSWORD=changeme
  PLAYER_NAME=Nox
  MINECRAFT_PORT=25566
  GEYSER_PORT=19133
  RCON_PORT=25576

## Bots
  bot-fighter  (Mr_Angry)    — AI bodyguard, auto-attacks mobs
  bot-gatherer (Mr_Helpful)  — AI gatherer, auto-mines resources
  Both use Ollama AI on host.docker.internal:11434
  (currently no Ollama model available — running in basic keyword mode)

## Chat Commands (any player can say these)
  "follow me"    — bot follows you
  "attack"       — attack nearby mobs (fighter)
  "gather"       — gather resources (gatherer)
  "inventory"    — list items (gatherer)
  "drop"         — drop all items (gatherer)
  "guard/stay"   — stay in place
  "stop"         — stop current action
  "help"         — list commands
