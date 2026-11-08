# Level AI developer docs

This is the Markdown copy of https://levelai.vercel.app/developers. When you change one, change the other.

## Overview

Level AI's agents design levels for puzzle games, play each one hundreds of times with bot players, and tune it to a target difficulty. This API gives your tools those levels as JSON: the level itself, the difficulty we aimed for, and the difficulty we measured.

- **Base URL:** `https://levelai.vercel.app/api`
- **Format:** JSON over HTTPS, including errors.
- **Auth:** the public endpoints need no key. Endpoints under `/api/studio` need your developer key in an `Authorization: Bearer lvl_…` header.
- **Stability:** fields are only ever added, never renamed or removed. Ignore fields you don't know.

> The examples on this page are real responses from the live API, taken Nov 7, 2026, 6:20 PM PT. At that time no level had passed testing yet, so the level lists were empty. Where a real level would appear, a sample is shown and labeled as one.

## Quickstart

Get a key, then fetch levels with any HTTP client. Reading public levels doesn't need the key; it's for the studio endpoints and your coding agent.

### 1. Get a developer key

We email your key to you. It identifies your studio. Keep it private, like a password.

Use the form at https://levelai.vercel.app/developers#get-key, or call `POST /developer-keys` (see the reference below).

### 2. List the games

Request:

```bash
curl https://levelai.vercel.app/api/games
```

### 3. Get the newest levels for a game

Request:

```bash
curl "https://levelai.vercel.app/api/levels?game=match3&limit=5"
```

Each level in `levels` holds the level JSON in `level`. Load it into your game, or save `level_id` to fetch it again later.

### 4. Check your studio's levels

Request:

```bash
curl https://levelai.vercel.app/api/studio/levels \
  -H "Authorization: Bearer $LEVELAI_KEY"
```

## REST reference

All endpoints are `GET` unless noted. Times are ISO 8601 in UTC. Win rates are fractions from 0 to 1.

### List games

`GET /api/games` · Auth: None

Every game our agents make levels for, with how many levels are available for each.

| Field | Type | Description |
|---|---|---|
| `game_id` | string | Use it as `game` in other requests. |
| `name` | string | The game's name. |
| `genre` | string or null | For example `match-3`. Null if we haven't labeled it. |
| `levels_available` | integer | Levels that passed testing (accepted or published). |

Response 200 (live, Nov 7, 2026, 6:20 PM PT):

```json
{
  "games": [
    {
      "game_id": "match3",
      "name": "Gem Garden",
      "genre": "match-3",
      "levels_available": 0
    },
    {
      "game_id": "platformer",
      "name": "Mosslight Trails",
      "genre": "platformer",
      "levels_available": 0
    },
    {
      "game_id": "racer",
      "name": "Turbo Lanes",
      "genre": "lane racer",
      "levels_available": 0
    },
    {
      "game_id": "watersort",
      "name": "Splash Sort",
      "genre": "sort puzzle",
      "levels_available": 0
    }
  ]
}
```

### List levels

`GET /api/levels` · Auth: None

Levels that passed testing, newest first.

| Query parameter | Required | Description |
|---|---|---|
| `game` | No | A `game_id` from `/api/games`. Leave it out for every game. |
| `limit` | No | 1 to 100. Default 20. Larger values are capped at 100. |
| `since` | No | An ISO 8601 time. Returns only levels accepted or published after it, **oldest first**, so you can page forward. |

To stay in sync, store the `updated_at` of the last level you received and pass it as `since` on your next call. If you get `limit` levels back, call again with the new last `updated_at` until the list comes back shorter.

Request:

```bash
curl "https://levelai.vercel.app/api/levels?game=match3&limit=5"
```

Response 200 (live, Nov 7, 2026, 6:20 PM PT):

```json
{
  "game_id": "match3",
  "levels": []
}
```

Request: every game:

```bash
curl https://levelai.vercel.app/api/levels
```

Response 200 (live, Nov 7, 2026, 6:20 PM PT):

```json
{
  "game_id": null,
  "levels": []
}
```

When levels exist, each item in `levels` is a [level object](#level-object).

### Get a level

`GET /api/levels/{level_id}` · Auth: None

One level by its ID. Returns 404 for a level that doesn't exist or hasn't passed testing.

Request:

```bash
curl https://levelai.vercel.app/api/levels/3f2c8a14-6b1e-4d7a-9c55-0e8b7d2a41f6
```

Response 200 (sample: the shape of a real response, not a real level):

```json
{
  "level_id": "3f2c8a14-6b1e-4d7a-9c55-0e8b7d2a41f6",
  "game_id": "match3",
  "level": {
    "name": "Garden Gate",
    "width": 8,
    "height": 8,
    "colour_count": 5,
    "seed": "garden-gate-1",
    "goal": {
      "colour": "red",
      "target": 24
    },
    "move_limit": 18,
    "seals": [
      {
        "cell": 27,
        "layers": 1
      },
      {
        "cell": 28,
        "layers": 2
      },
      {
        "cell": 35,
        "layers": 2
      },
      {
        "cell": 36,
        "layers": 1
      }
    ]
  },
  "target_win_rate": 0.4,
  "measured_win_rate": 0.42,
  "status": "accepted",
  "created_at": "2026-11-08T02:05:11.482Z",
  "updated_at": "2026-11-08T02:09:47.903Z"
}
```

Response 404 (live, Nov 7, 2026, 6:20 PM PT):

```json
{
  "error": "level not found"
}
```

Match-3 levels also open in your phone's browser: `https://levelai.vercel.app/play?level={level_id}`.

### Get a pack

`GET /api/packs/{pack_id}` · Auth: None

A published set of levels, in play order. Levels pulled after publishing are left out.

Response 200 (sample: shape only):

```json
{
  "pack_id": "9a7d0c3e-2f41-4b8e-a6d2-5c1e9f03b7aa",
  "game_id": "match3",
  "name": "Starter set",
  "published_at": "2026-11-08T03:00:00.000Z",
  "levels": [
    "…level objects, in pack order…"
  ]
}
```

Response 404 (live, Nov 7, 2026, 6:20 PM PT):

```json
{
  "error": "pack not found"
}
```

Match-3 packs play at `https://levelai.vercel.app/play?pack={pack_id}`. Sort and racer packs play at `https://levelai.vercel.app/games/watersort/?pack={pack_id}` and `https://levelai.vercel.app/games/racer/?pack={pack_id}` (add `&n={k}` to start at level k). A paid level pack you ordered is a pack like this: its link and this JSON come in the delivery email. Each level's `target_win_rate` is its point on your pack's difficulty curve.

### Get the newest set

`GET /api/levels-latest` · Auth: None

What our web player shows: the newest published pack in its own order, or, before any pack exists, the newest accepted levels from easiest to hardest.

| Query parameter | Required | Description |
|---|---|---|
| `game` | No | Default `match3`. |
| `limit` | No | 1 to 30. Default 10. |

Response 200 (live, Nov 7, 2026, 6:20 PM PT):

```json
{
  "game_id": "match3",
  "pack": null,
  "levels": []
}
```

`pack` is `{ "pack_id", "name" }` when the levels come from a published pack, and null otherwise.

### List your studio's levels

`GET /api/studio/levels` · Auth: Developer key

The levels we've sent your studio. Today that's only a sample set, when one was sent. Levels and packs aren't linked to studio accounts yet, so this list is usually empty; the `note` field says so.

| Field | Type | Description |
|---|---|---|
| `studio` | string | Your studio's name, from your key. |
| `sample` | object or null | The sample we sent you: `pack_id`, `name`, and `url`. Null if we haven't sent one. |
| `levels` | array | [Level objects](#level-object) in that sample. |
| `note` | string | What this list does and doesn't include. |

Request:

```bash
curl https://levelai.vercel.app/api/studio/levels \
  -H "Authorization: Bearer $LEVELAI_KEY"
```

Response 200 (live, Nov 7, 2026, 6:20 PM PT; studio name changed):

```json
{
  "studio": "Example Games",
  "sample": null,
  "levels": [],
  "note": "Levels aren't linked to studio accounts yet: our agents design levels for our own games, not for yours. This lists the sample levels we've sent you, if any. Every public level is also at GET /api/levels."
}
```

Response 401 (live, Nov 7, 2026, 6:20 PM PT):

```json
{
  "error": "unauthorized: get a key at /developers"
}
```

### Request a developer key

`POST /developer-keys` · Auth: None

What the form on this page calls. We email the key; it's never returned in the response.

Request:

```bash
curl -X POST https://levelai.vercel.app/developer-keys \
  -H 'content-type: application/json' \
  -d '{"name": "Ada Park", "email": "ada@example.com", "studio": "Example Games", "consent": true}'
```

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Your name, up to 120 characters. |
| `email` | Yes | Where we send the key. |
| `studio` | Yes | Your studio's name, up to 160 characters. |
| `consent` | Yes | Must be `true`: you agree to get the key by email. |

Response 201:

```json
{
  "ok": true
}
```

Response 400 (live, Nov 7, 2026, 6:20 PM PT):

```json
{
  "ok": false,
  "error": "Please fill in your name, email, and studio, and tick the box."
}
```

## The level object

Every endpoint that returns levels uses this shape.

| Field | Type | Description |
|---|---|---|
| `level_id` | string (UUID) | Stable ID. |
| `game_id` | string | Which game the level is for. The shape of `level` depends on it. |
| `level` | object | The level itself. See [level JSON by game](#formats). |
| `target_win_rate` | number | The share of players we aimed to have win, from 0 to 1. |
| `measured_win_rate` | number or null | The share our reference bot actually won in testing. See [how levels are tested](#how-made). |
| `status` | string | `accepted` (passed testing) or `published` (also released in a pack). |
| `created_at` | string | When the level was designed. |
| `updated_at` | string | When it was last accepted or published. Use it with `since`. |

## Level JSON by game

The `level` field follows the game's rules. Every level we serve has already passed the game's own validation. The samples below are valid levels written to show the format; they aren't levels our agents made.

### Match-3 (`match3`, Gem Garden)

Swap neighboring gems to make lines of three or more. Collect `goal.target` gems of `goal.colour` within `move_limit` moves. The board's starting gems come from `seed`, so the same level always starts the same way.

| Field | Type | Rules |
|---|---|---|
| `name` | string | 1 to 60 characters. Required. |
| `width` | integer | 4 to 16 columns. Required. |
| `height` | integer | 4 to 32 rows. Required. |
| `colour_count` | integer | 4, 5, or 6 gem colors in play. Required. |
| `seed` | integer or string | Integer 0 to 4294967295, or a string of 1 to 200 characters. Required. |
| `goal` | object | `colour`: one of `red`, `blue`, `green`, `gold`, `purple`, `teal`. `target`: 1 to 1000. Required. |
| `move_limit` | integer | 1 to 200. Required. |
| `mask` | boolean[] | Optional. Which cells are part of the board, row by row from the top left. Length must be `width × height`. |
| `seals` | object[] | Optional, up to 512. Blockers on cells: `cell` (index, row by row from 0) and `layers` (1 to 3 hits to clear). |

No other fields are allowed.

Sample match-3 level (valid, not agent-made):

```json
{
  "name": "Garden Gate",
  "width": 8,
  "height": 8,
  "colour_count": 5,
  "seed": "garden-gate-1",
  "goal": {
    "colour": "red",
    "target": 24
  },
  "move_limit": 18,
  "seals": [
    {
      "cell": 27,
      "layers": 1
    },
    {
      "cell": 28,
      "layers": 2
    },
    {
      "cell": 35,
      "layers": 2
    },
    {
      "cell": 36,
      "layers": 1
    }
  ]
}
```

### Platformer (`platformer`, Mosslight Trails)

Walk from `S` to `G`. Each step can climb up to `jump_height` tiles or drop up to `fall_limit` tiles.

| Field | Type | Rules |
|---|---|---|
| `name` | string | 1 to 60 characters. |
| `map` | string[] | 5 to 32 rows, each 8 to 64 characters, all the same width. Tiles: `#` solid, `.` empty, `^` hazard, `C` collectible, `S` start, `G` goal. Exactly one `S` and one `G`, each standing on `#`. |
| `jump_height` | integer | 1 to 4. |
| `fall_limit` | integer | 1 to 8. |

Sample platformer level (valid, not agent-made):

```json
{
  "name": "Mossy Steps",
  "map": [
    "............",
    ".......C....",
    "......###...",
    "............",
    "S..###.....G",
    "############"
  ],
  "jump_height": 2,
  "fall_limit": 4
}
```

### Sort puzzle (`watersort`, Splash Sort)

Pour the top color of one tube onto an empty tube or a matching color. Win when every tube is empty or holds one color. Tubes list colors from bottom to top.

| Field | Type | Rules |
|---|---|---|
| `title` | string | Optional, up to 40 characters. |
| `capacity` | integer | 2 to 5 units per tube. |
| `move_limit` | integer | 1 to 300 pours. |
| `tubes` | string[][] | 3 to 11 tubes. Colors: `red`, `orange`, `yellow`, `lime`, `green`, `teal`, `sky`, `blue`, `purple`, `pink`, `brown`, `gray`. Each color appears exactly `capacity` times. |

Sample sort level (valid, not agent-made):

```json
{
  "title": "Three Tides",
  "capacity": 4,
  "move_limit": 20,
  "tubes": [
    [
      "yellow",
      "teal",
      "pink",
      "teal"
    ],
    [
      "pink",
      "yellow",
      "teal",
      "yellow"
    ],
    [
      "teal",
      "pink",
      "yellow",
      "pink"
    ],
    [],
    []
  ]
}
```

### Lane racer (`racer`, Turbo Lanes)

Drive one row per tick and cross row `length` within `time_limit` ticks. Steer one lane at a time. Hitting a `car`, `cone`, or `oil` stops you for `crash_penalty` ticks.

| Field | Type | Rules |
|---|---|---|
| `title` | string | Optional, up to 40 characters. |
| `lanes` | integer | 3 to 5. |
| `length` | integer | 20 to 400 rows. |
| `speed` | number | 4 to 16 rows per second on screen. |
| `time_limit` | integer | 1 to 1000 ticks. |
| `crash_penalty` | integer | 1 to 10 ticks. |
| `lane_change_cooldown` | integer | 0 to 3 ticks between lane changes. |
| `start_lane` | integer | Optional, 0 to 4. Default is the middle lane. |
| `objects` | object[] | Up to 600. Each has `row` (1 or more), `lane` (0 to 4), and `kind`: `car`, `cone`, `oil`, `shield`, `boost`, or `coin`. |

Sample racer level (valid, not agent-made):

```json
{
  "title": "Rush Hour",
  "lanes": 3,
  "length": 90,
  "speed": 8,
  "time_limit": 96,
  "crash_penalty": 3,
  "lane_change_cooldown": 0,
  "objects": [
    {
      "row": 6,
      "lane": 0,
      "kind": "car"
    },
    {
      "row": 6,
      "lane": 2,
      "kind": "cone"
    },
    {
      "row": 9,
      "lane": 1,
      "kind": "boost"
    },
    {
      "row": 14,
      "lane": 2,
      "kind": "coin"
    }
  ]
}
```

## Webhooks

There are no webhooks yet. To pick up new levels, poll `GET /api/levels` with `since` set to the last `updated_at` you saw. Every few minutes is plenty: new levels take several minutes each to test.

## Connect your coding agent

Level AI is also an MCP server (Model Context Protocol), so coding agents such as Claude Code, Cursor, and Codex can call it directly. Replace `YOUR_KEY` with the key from your email.

- **Server URL:** `https://levelai.vercel.app/studio-mcp` (Streamable HTTP)
- **Auth:** `Authorization: Bearer YOUR_KEY`

### Claude Code

Terminal:

```bash
claude mcp add --transport http levelai https://levelai.vercel.app/studio-mcp \
  --header "Authorization: Bearer YOUR_KEY"
```

### Cursor

Add this to `.cursor/mcp.json` in your project, or `~/.cursor/mcp.json` for every project.

.cursor/mcp.json:

```json
{
  "mcpServers": {
    "levelai": {
      "url": "https://levelai.vercel.app/studio-mcp",
      "headers": {
        "Authorization": "Bearer YOUR_KEY"
      }
    }
  }
}
```

### Codex

Add this to `~/.codex/config.toml`, then set `LEVELAI_KEY` in your shell.

~/.codex/config.toml:

```toml
[mcp_servers.levelai]
url = "https://levelai.vercel.app/studio-mcp"
bearer_token_env_var = "LEVELAI_KEY"
```

### Other agents

Any client that supports remote MCP servers over HTTP with a custom header works. Use the server URL and auth header above.

Generic MCP config:

```json
{
  "mcpServers": {
    "levelai": {
      "type": "http",
      "url": "https://levelai.vercel.app/studio-mcp",
      "headers": {
        "Authorization": "Bearer YOUR_KEY"
      }
    }
  }
}
```

### Tools

| Tool | Input | What it does |
|---|---|---|
| `list_my_levels` | none | Same as `GET /api/studio/levels`: the levels we've sent your studio, with a note on what's included. |
| `request_free_levels` | `gameName`, optional `storeUrl` | Asks for a free sample set. If you give a store link, we read your players' reviews first and email you what we found. Returns a `requestId`. |
| `audit_reviews` | `storeUrl`, optional `gameName` | Reads your game's newest Google Play or App Store reviews and reports where players say it's too easy, too hard, repetitive, or out of levels, with quotes. |
| `request_playtest` | `appUrl`, optional `focus` | Plays your app on a real iPhone like a first-time player and emails you a report. Returns a `requestId`, and a payment link when the playtest is paid. |
| `get_status` | `requestId` | Each step of a request so far, and whether it's done. |

Then ask your agent something like "List my Level AI levels" or "Get a Level AI playtest of my app."

## Rate limits and errors

### Rate limits

No rate limit is enforced today. Please keep it under one request per second. Public responses can be cached: `/api/levels/{id}` and `/api/packs/{id}` for 5 minutes, `/api/games` for 1 minute, and the lists for 30 seconds. Studio responses are never cached. If we add limits, we'll document them here first.

### Errors

Errors come back as JSON with an `error` message and a matching HTTP status:

Response 404 (live, Nov 7, 2026, 6:20 PM PT):

```json
{
  "error": "game not found"
}
```

| Status | When | Example `error` |
|---|---|---|
| 400 | A bad ID or parameter. | `invalid level id`, `limit must be a whole number from 1 to 100`, `since must be an ISO 8601 time` |
| 401 | A missing or unknown key on a studio endpoint. | `unauthorized: get a key at /developers` |
| 404 | No such level, pack, or game, or the level hasn't passed testing. | `level not found`, `pack not found`, `game not found` |
| 405 | Any method other than `GET` on a read endpoint. | `method not allowed` |
| 503 | Levels are briefly unavailable. Retry after a short wait. | `levels unavailable` |

A path that doesn't exist returns a 404 web page, not JSON.

## How levels are made and tested

Each level goes through four agents before this API serves it:

1. **Designer** writes a new level for the game, following the game's rules, and gives it a target win rate (for example, 40% of players win).
2. **Solver bots** play the level automatically, up to 200 games per bot (100 for match-3). A slow run can stop early at a time limit, but never before 20 games; the tested count is part of every result. For every game except match-3, an exact solver also checks that the level can be won and finds the fewest moves.
3. **Tuner** compares the target with the win rate of the reference bot, the bot that plays most like a person. Within 5 points, it accepts the level. Otherwise it makes one small change, such as one more move, and tests again. After 4 rounds it rejects the level instead.
4. **CEO** agent publishes accepted levels in packs and adjusts plans from how real players do.

A level pack you order is made the same way, by a program instead of the Designer and Tuner agents: our iPhone first plays your game to see how quickly it gets harder; that and the difficulty you pick set a target win rate for each level (about 85% at level 1, ramping down); then each level is generated in our own game for your genre and played by the reference bot until it lands on its target (within 5 points, or 8 when the target is inside the measurement's 95% interval). Match-3 levels are measured over 100 games, the others over 200. Parking puzzles have one exact answer, so they're rated by the solver's fewest moves instead of a win rate. The levels are ours, in the formats above; we don't build inside your game.

What the numbers mean, honestly:

- `measured_win_rate` is how often our reference bot won, not real players. Bots are a stand-in for people. Real play can differ.
- Levels that miss their target after tuning are rejected and never appear here.
- Nobody hand-checks each level. If one looks wrong, tell us at the address in the footer.

## What's not here yet

- **Levels for your own game.** Our agents make levels for our own games, including the ones in a pack you order. Making levels in your game's own format, linked to your account, isn't built yet. `/api/studio/levels` shows only samples we've sent you. Levels made for a customer's pack open by id but aren't in the public lists.
- **Webhooks.** Poll `/api/levels` with `since` instead.
- **Writes.** The API is read-only. You can't upload levels or change a target.
- **Real-player win rates.** The API returns the measured bot win rate, not live player results.
