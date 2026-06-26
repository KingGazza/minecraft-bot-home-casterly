# Minecraft Bot Home — Complete Command Reference
# Stack: minecraft-bot-home (Portainer ID 50)
# Repo: https://github.com/KingGazza/minecraft-bot-home-casterly

## Ports
  MineCraft (Java):   25566
  Geyser (Bedrock):   19133/udp
  RCON:               25576

## Stack Variables (set in Portainer)
  RCON_PASSWORD=changeme
  MINECRAFT_PORT=25566
  GEYSER_PORT=19133
  RCON_PORT=25576

## Bots
  Each bot is a pair — one fighter (Mr_Angry) + one gatherer (Mr_Helpful).
  Bots only listen to their assigned owner (PLAYER_NAME env var).
  Bots talk to each other if their name is mentioned in chat.
  All use Ollama AI on host.docker.internal:11434 (gemma4:e2b).

  ### Player — Bot mapping
    NoxGTLG  → Mr_Angry_Nox + Mr_Helpful_Nox
    GELG3275 → Mr_Angry_NED + Mr_Helpful_NED   ⚠️ currently disabled
    CELG5130 → Mr_Angry_KAT + Mr_Helpful_KAT   ⚠️ currently disabled

## Movement Fix
  Paper's moved-wrongly-threshold raised to 100 in spigot.yml
  (otherwise bots get kicked for invalid_player_movement)

## Disk
  Docker storage moved to /home/docker/docker (1.8T)
  Root partition had 70G — was 100% full, now clear

## COMMANDS — Say these in Minecraft chat

### Both Bots (Mr_Angry + Mr_Helpful)

  follow me / come / come here
    Bot pathfinds to you and follows.

  stop
    Cancels current action (gathering, fighting, following).

  tp / teleport
    Bot instantly teleports to you via /tp (bots are OP'd).
    No walking — instant arrival.

  drop
    Bot drops ALL items on the ground.

  drop [resource]
    Bot drops only matching items.
    Example: "drop oak", "drop dirt", "drop iron ore"

  inventory
    Bot lists all items it's carrying (types + count).

  deposit / store
    Bot finds nearest chest within 5 blocks and deposits
    everything from its inventory into the chest.

  deposit [resource] / store [resource]
    Bot deposits only matching items.
    Example: "deposit oak", "store dirt"

  help [command]
    Routes to that command instead of showing help list.
    Example: "help gather 32 oak" → starts gathering.
    Just "help" alone shows the command list.

  help
    Shows the command list.

### Mr_Helpful Only (Gatherer)

  gather
    Defaults to gathering 64 of whatever's nearby (logs,
    stone, dirt, coal_ore, iron_ore).

  gather [resource]
    Gathers 64 of the specified resource.
    Example: "gather oak", "gather dirt", "gather iron ore"

  gather [qty] [resource]
    Gathers toward a target count, then returns to you.
    Example: "gather 32 oak", "gather 64 dirt", "gather 16 iron ore"

  What he does:
    - Scans for matching blocks within 25 blocks
    - Walks to each block before digging
    - Mines up to 3 blocks per scan, then re-scans
    - If no blocks found, wanders a bit and retries
    - When target reached, says "Got X oak!" and returns to you
    - Returns to owner when done

### Mr_Angry Only (Fighter)

  attack / fight
    Attacks the nearest mob (zombie, skeleton, spider,
    creeper, enderman, witch, drowned).

  guard / stay
    Stops following and stands in place.

  Auto-behaviors:
    - Auto-attacks any mob within 5 blocks (physics tick)
    - Equips best armor and sword from inventory on spawn
    - Warns if no armor found

### Auto-Behaviors (both bots)

  Auto-respawn
    Bot auto-respawns 3 seconds after dying.
    After respawn, re-follows owner if online.

  Drowning rescue
    Checks air every 2 seconds. If air drops below 100,
    bot surfaces immediately.

  Auto-heal
    Every 5 seconds, if health < 10 or food < 10, bot eats
    any food it's carrying.

  Bot-to-bot chat
    Bots respond to each other if their name is mentioned.
    Example: Mr_Helpful says "Mr_Angry, help!" and Mr_Angry replies.
