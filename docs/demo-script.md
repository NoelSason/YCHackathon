# Demo plan: Level AI

Owner: **Noel**. Three minutes on stage, the same three minutes in the first round and the final.
Everything shown is real, live, or clearly labeled as a recording. Every number comes from the
logs.

## The idea in one line

> "Level AI is a game studio with no employees. Its agents make puzzle levels, test them on real
> phones, find studios whose players are unhappy, and sell to them. It's been running on its own
> since 2 AM."

## What makes this demo hard to beat

Most teams will show a pipeline and describe what it could do. We show three things nobody else
can fake:

1. **A judge becomes our customer, live, in 30 seconds.** They scan a QR code, enter any puzzle
   game on Google Play, and put their phone down. Within about 30 seconds, an email lands on
   their phone. It tells them what that game's players are saying ("7 of the 86 newest reviews
   say it's too easy") with a real quote, and links free levels. Meanwhile the stage screen shows
   each agent step light up. Verified Nov 7 at 3:33 PM: 30 seconds end to end.
2. **A real iPhone on the big screen, playing a level the agents made a minute ago.** It's a cloud
   phone run by Mobilerun, driven by our Playtest agent from a written plan. It's live, not a
   screen recording.
3. **Overnight history we didn't touch.** The screen opens on "Running on its own for 9 h 12 m," with
   levels made, tuned, and playtested, studios found and emailed, CEO decisions with what they
   expected and what actually happened, spend, and the list of human step-ins.

## Run of show (3:00)

| Time | On screen | Say | Who |
|---|---|---|---|
| 0:00–0:15 | Demo stage, live. The "Running on its own for" counter. | The one line above, then the best real overnight number. | Presenter |
| 0:15–0:25 | Point at the "Become a customer" QR code. | "Judges, take out your phone. Scan this and enter any puzzle game you know. Then put the phone down." | Presenter |
| 0:25–1:05 | The activity feed: *reading reviews → audited → email sent*. The phone panel plays a level. | Follow the agents as they work: "Research is reading that game's newest reviews right now. … It found what players complain about. … The Sales agent just wrote to you. Check your phone." | Presenter |
| 1:05–1:20 | A judge reads their email. | Let it land. Then: "That email was written and sent by an agent, and every number in it came from a tool. The email checks that before it can send." | Judge |
| 1:20–1:50 | One overnight CEO decision record: Saw / Chose / Why / Expected / Result. | "Nobody told it to do this. At 3 AM it saw [X], changed [Y], and expected [Z]. Here's what happened." | Presenter |
| 1:50–2:20 | The pipeline panel: studios found, emailed, replied, and paid. `docs/business-targets.md` evidence. | "Overnight it found N studios whose players are telling them what's wrong. Bus Traffic Fever's players say level 4 is 'physically impossible.' It pitched them before we woke up." | Presenter |
| 2:20–2:45 | The phone panel, close up. The step-in counter. | "Every level ships only after a real phone plays it. And here's every time a human stepped in, with why." Read the list honestly. | Presenter |
| 2:45–3:00 | The numbers. | Bottom-up math: studios × levels a month × price, each number sourced. "If we leave it running, tomorrow it'll have shipped more levels, learned from more players, and pitched more studios. We set the goal and the budget." | Presenter |

## One sentence we say out loud (team decision B, Nov 7)

Naïve pauses every call to an external MCP server after the first one in a chat, for a human to
approve, no matter what the server returns. Our platform approves calls to **its own two servers**
automatically and logs each one as `platform.auto_approve`. On stage, when the step-in list comes
up: *"Naïve holds every tool call for review after an agent reads from any MCP server. Our
platform auto-approves its own read-only tools and logs each one; that happened N times
overnight. Humans stepped in M times, listed here."* Both numbers come from `activity_log`.

## The night before (checklist)

- [ ] `business/live.sh` is running on Noel's laptop (it keeps the laptop awake). After any restart, restart `./demo.sh` so the QR shows the new URL.
- [ ] `./demo.sh --check` is green, including the Play link once Max sends `DEMO_PLAY_URL`.
- [ ] The overnight run is on: the CEO, Designer, Research, Finance, and Marketing crons are enabled (Abhinav's kill switch is off).
- [ ] `npm run approver` is running in `platform/naive` on a laptop that stays awake (Abhinav's or Pinara's), and its log shows `approved` lines.
- [ ] Decide on cold outreach (below).
- [ ] At 8:00 AM and 10:30 AM: `npm --prefix demo run snapshot` for the replay backup.
- [ ] A test signup with a second phone at 10:30 AM. Time it.

## Decisions Noel needs to make

1. **Cold outreach tonight: yes or no.** `docs/business-targets.md` has 7 studios with public
   contacts and real evidence. Turning on `OUTREACH_SEND=1` lets the Sales agent email them
   overnight, so we'd have real pitches, and maybe replies, to show. The catch: AgentMail's rules
   say "no unsolicited marketing." Our emails are personal, small (at most 20 a day), evidence
   based, and easy to opt out of, but they're still cold. My recommendation: send to the 4 best-fit
   studios only (Loop Games, Rotatelab, GOODROID, ABI Games), and keep the rest for signups.
2. **AgentMail send limits.** The inbox key can't read the plan's limits. If the free plan allows
   only about 10 emails a day, a room full of judges scanning the QR will hit it. Check the
   limit in the AgentMail console and upgrade for the weekend if needed.
3. **The pilot price** (`PILOT_PRICE_USD`), once Stripe credits arrive. Without it, the emails say
   "reply for details," which is fine for the demo.

## If something breaks on stage

| Break | Do |
|---|---|
| The email takes longer than 45 s | Keep talking through the feed. It shows each step as it happens. If it's past 90 s, open the copy of the same email from the 10:30 AM test, and say it's from the rehearsal. |
| A judge's game has no Google Play link | The email still goes out, with free levels and no review evidence. Say so. |
| Phone view frozen | Switch to the snapshot replay. Its purple banner says it's a recording. Say so too. |
| The tunnel is down | Run `business/live.sh` again, then restart `./demo.sh`. About 30 seconds. |

Never claim a step that didn't happen, and never present `--sample` data.
