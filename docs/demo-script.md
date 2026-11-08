# Demo script: Level AI

Owner: **Noel**. Two deliverables on **Sun Nov 8**: a **2-minute video** (record ~10:30 AM, due
11:00 AM, top 10 teams advance) and a **3-minute live demo at 1:00 PM**. Rewritten Sat Nov 7, 11:00 PM
from live data. Times are Pacific.

Rules: show only real or labeled things. Read every `[N: …]` from the table below right before you
record. Never present a rehearsal as live.

## Morning checklist (in time order)

Run from the repo root. Each block assumes `set -a; . ./.env; set +a` ran first in that terminal.

| When | Do | Good looks like |
|---|---|---|
| 7:30 | `curl -s https://levelai.vercel.app/health` and `grep -E 'RED\|RECOVERY\|WARN' /tmp/levelai-monitor.log \| tail` | `"ok":true`; no red in the last hours. |
| 7:35 | Confirm the overnight row exists: open the console, click **Human step-ins**. | A row covering the team's overnight test runs, plus the 8 earlier ones. If it's missing, tell the coordinator before you record. The clock isn't true without it. |
| 7:40 | **X:** open the main phone in Mobilerun's live view. Open x.com in Safari and log in again, or clear Safari's x.com data first. | The X home timeline loads. Nothing else fixes this; it needs you. |
| 7:50 | Decide the email plan. Upgrade AgentMail if you want the QR form to work for new addresses. Otherwise keep the email-in route (Segment C). | Decision made. |
| 8:00 | Snapshot runs by itself. Check: `ls -t demo/data/run-*.jsonl \| head -1` | A file stamped about 16:00 UTC. |
| 8:05 | Readiness: `cd platform/checks && PLATFORM_URL=https://br-broad-violet-bem8cpy5-platform.compute.c-9.us-east-2.aws.neon.tech EXPECT_RUNNING=1 npm run check` | All green, or `deployments` flaky on Naïve capacity (seen at 9:46 PM). |
| 8:15 | **X test:** run the post-now command in Segment D. | `posted on x from the iPhone` in the feed. If it fails, use the fallback in Segment D. |
| 8:30 | Rehearse once: read both tables aloud against the console. Run the numbers command below. | You can say every line without looking. |
| 9:40 | Start a pack for the video (Segment A) and screen-record the console and phone until it finishes (about 12.5 min). | Rows from "level pack ordered" through the closing playtest. |
| 10:10 | Record the money shot and the step-in drawer (Segment B, Segment G). | Clips saved. |
| 10:20 | Run the numbers command and fill every `[N: …]`. Record the voiceover. | |
| 10:30 | Second snapshot runs by itself. Cut and upload the video. | **Submitted before 11:00.** Code freeze at 11:00: change nothing after it. |
| 12:30 | Run the numbers command again. Open tabs: console (F for full screen), `/pricing`, `/join`, Mobilerun live view. | |
| 12:48 | Start the live pack (Segment A). 13 minutes before you need it. | |
| 1:00 | Present. | |

**Numbers command.** Prints everything the tables need. It prints no secrets.

```bash
set -a; . ./.env; set +a
curl -s https://levelai.vercel.app/public-stats; echo
curl -s -u "x:$DEMO_PASSWORD" localhost:4545/api/state | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const {stats:t,pipeline:p,naiveSpend:n}=JSON.parse(s);console.log({actions:t.agentActions,decisions:t.decisions,stepIns:t.stepIns,autoApproved:t.autoApprovals,onItsOwnSince:new Date(t.unattendedSince).toLocaleString(),compiled:t.levelsCompiled,spentUsd:+(n.usd+t.spendUsd).toFixed(2),earnedUsd:p.payments.liveAmountMinor/100})})'
node --no-warnings -e "const {Client}=require('./solver/node_modules/pg');(async()=>{const d=new Client({connectionString:process.env.DATABASE_URL});await d.connect();const a=await d.query(\"select count(*)::int n from levels where created_by='tuner' and status in ('accepted','published')\");console.log('agent-made levels accepted:',a.rows[0].n);const w=await d.query(\"select count(*)::int n from biz_pack_deliveries where state in ('queued','working') and due_at <= now()\");console.log('packs queued or working now:',w.rows[0].n);const p=await d.query(\"select to_char(ts at time zone 'America/Los_Angeles','Dy HH12:MI AM') at, action, result from activity_log where action like 'payment received%' order by ts desc limit 5\");console.table(p.rows);await d.end()})()"
```

## The numbers

Measured Sat 10:55–11:00 PM. They will have moved. Reread them from the "where" column.

| `[N: …]` | Value at Sat ~11:00 PM | Where to read it |
|---|---|---|
| reviews | 36,281 (12 passes, 254 games) | Numbers command, `reviewsRead`; on the console, the Market research card. Say "reviews read": it counts reads, so a review read twice counts twice. |
| found | 23 studios | `studiosAudited`. The console's "Found" tile shows only studios not yet emailed (16, including 1 agency). Don't read that one as the total. |
| emailed | 8 studios | `emailsSent`; the "Emailed" tile. |
| replied | 0 | Outreach board totals (press **O**). Say it if asked. |
| playtests | 17 | `playtestsRun`. |
| actions | 1,229 | `actions`; the **Agent actions** tile. |
| decisions | 15 | `decisions`; the **Decisions** tile. |
| step-ins | 8 at 11:01 PM (expect one more for the overnight tests) | `stepIns`; the **Human step-ins** tile. |
| auto-approved | 528 | `autoApproved`; shown beside the step-ins. |
| agent levels | 12 accepted | "agent-made levels accepted" (Designer and Tuner agents). |
| compiled | 769 | `compiled`; made by the deterministic compiler, not agents. |
| spent | $15.12 | `spentUsd`; the **Spent** tile. It's Naïve credits plus logged tool costs. Monid rows before 10:53 PM are understated, so call it "logged spend". |
| earned | **$0** | `earnedUsd`. No real payment yet. Say so. |
| own clock | since 11:01 PM, Pinara's newest step-in (true only once the overnight row is in) | **Running on its own for** in the console header. |

## 2-minute video

Screen-record the console (`levelai-console.vercel.app`, full screen with **F**, password
`DEMO_PASSWORD`, any username) and the phone. The studios emailed so far are Loop Games, Rotatelab,
GOODROID, ABI Games, Oakever Games, Hidden Folks B.V., Rollic Games, and Loom Games A.Ş.

| Time | On screen | Say |
|---|---|---|
| 0:00–0:10 | Press **O**. GOODROID's card, the Bus Traffic Fever quote. | "Puzzle games live or die on their levels. Players say exactly what's wrong, in reviews nobody reads. Here's one: levels are impossible to pass without power up." |
| 0:10–0:20 | Console header: clock, actions, step-ins. | "Level AI is a level studio run by AI agents. This is its live log since we stopped touching it." |
| 0:20–0:35 | Market research card, then a "read N player reviews" feed row. | "All night the research agent has worked through the store charts. It has read [N: reviews] reviews so far, counting repeats, and a model double-checks each quote before any studio is emailed." |
| 0:35–0:50 | Outreach board, a studio card with its quote and subject. | "When three or more players describe the same problem, the sales agent writes to the studio's public address and quotes them. That's [N: emailed] studios so far, each with an opt-out. None has replied yet." |
| 0:50–1:15 | Pack recording from 9:40 AM, sped up with a "sped up" label: phone study, then "level k of 20 accepted". | "A studio orders a level pack. A real iPhone plays their game to measure how hard it gets. Then our pack builder makes twenty levels, one at a time: generate, bot plays, tune, accept. The whole order took about twelve minutes." |
| 1:15–1:30 | Pack email, then the phone playing level 1. | "The pack lands in their inbox with each level's target and measured difficulty. If the phone can't see a difficulty ramp, the email says we used our default curve. Then the phone plays level one." |
| 1:30–1:45 | `/pricing`, the $49 form, Stripe's live page (stop there). Then the payment rows from the numbers command. | "Checkout is live: a five-dollar playtest, a forty-nine-dollar pack, and a subscription. Nobody has paid us yet, so we've earned zero dollars. Here's a test-mode order the system ran on its own, labeled test." |
| 1:45–2:00 | Click **Human step-ins**. Then the logo. | "Here's every time a person stepped in, and why. A policy program approved [N: auto-approved] held tool calls, and each one is logged. We set the goal and the budget. Everything else, the agents and their programs did." |

If a clip wasn't recorded, cut the shot. Don't substitute a rehearsal without saying it is one.

## Live demo (3:00)

Start the pack at **12:48 PM**.

| Time | Show | Say |
|---|---|---|
| 0:00–0:15 | Console header. | "Level AI is a puzzle-game level studio with no employees. Agents read what players say, sell to studios, build and bot-test levels, and playtest on a real iPhone. Here's what it did since we stopped touching it." |
| 0:15–0:25 | Press **Q** for the QR. | "Judges, scan this, tap Email us your game, and send the name of any puzzle game. Then put your phone down." |
| 0:25–1:00 | Feed: the new audit rows. | Narrate the rows you see. "The agents are reading that game's reviews now. You should have a reply within a minute. Check your phone." |
| 1:00–1:40 | The pack started at 12:48: phone study row, level rows, the phone on level 1. | "This order came in about thirteen minutes ago, before I walked up. The phone studied the game for about three minutes, the twenty levels took about seventy-five seconds, and the phone is now playing level one." |
| 1:40–2:10 | The phone (press **P**). | "A real cloud iPhone, driven by our playtest agent. Paid orders get it first." |
| 2:10–2:40 | `/pricing`, then **Human step-ins**. | "Checkout is live, and we've earned zero dollars so far. Here's every human step-in." Read them. Say the morning items out loud: "This morning I logged back in to X on the phone and started this test order." |
| 2:40–3:00 | Numbers. | "[N: found] studios found, [N: emailed] emailed, [N: reviews] reviews read, [N: agent levels] levels accepted by agents, [N: spent] logged spend. We set the goal and the budget; the agents run it." |

Timing warning: the level build happens about six minutes into a run and lasts about 75 seconds, so
"levels counting up" is hard to catch live. Plan for a finished build. If it happens to be running,
narrate it.

## Segments

### A. Pack run

Always send `company` and `name`. Check first that the numbers command shows 0 packs queued or
working now. Packs run one at a time.

```bash
curl -X POST localhost:8787/orders/demo-run -H "Authorization: Bearer $BUSINESS_MCP_TOKEN" -H "content-type: application/json" \
  -d '{"email":"noel_sason@berkeley.edu","genre":"match3","game":"Candy Crush Saga","bundleId":"com.midasplayer.apps.candycrushsaga","company":"Level AI Test Agency","name":"Noel"}'
```

Real timings from the 10:07–10:19 PM run, 12 min 25 s end to end: wait for phone 2:38, study 3:06,
20 levels 75 s, pack email 1 s later, closing playtest 4:58. **Start it about 13 minutes before you
need it.** The phone saw no ramp in that run, so the default curve was used and the email says so.
The feed labels it "no payment: a team test order"; say that.

### B. Money

The console's test-payment tile hides team orders and reads 0, so don't show it. Show live checkout
(`/pricing`, the $49 form, stop at Stripe's page) and the activity-log row, for example
`payment received: pilot_pack, 49.00 USD (test mode)` at 8:08 PM. The console feed holds only the
newest 150 rows, so by morning that row won't be in it. Read it from the numbers command and show
the terminal. **Earned is $0.** Refunds don't lower Earned; it doesn't matter while Earned is $0.

### C. Judge flow

AgentMail can't send a first email to a **new** address until **3:04 PM Sunday**, unless you upgrade.
Replies to people who wrote first are always allowed. So:

- **Works now:** email `levelai@agentmail.to` with the subject `Audit: <game>` (or tap "Email us your
  game" at the top of `/join`). The reply took 26 s when tested tonight.
- **The form on `/join`** to a new address fails and shows "Email us your game instead". Don't send
  judges to the form unless the upgrade is done. Re-test with a never-emailed address after upgrading.
- **Second send path:** at 11:00 PM it's uncommitted work in `business/src/outreach/alt-mail.ts`. It
  isn't running, and `.env` has neither `NAIVE_SALES_INBOX_ID` nor `RESEND_API_KEY`. Don't describe it
  unless `log.md` says it's live and a never-emailed address got mail.

### D. X post

```bash
curl -X POST localhost:8787/social/post-now -H "Authorization: Bearer $BUSINESS_MCP_TOKEN"
```

Feed rows, in order: `asked to post now` → (`asked the phone to stop studying <game> early`) →
`posting on X from the iPhone` → `posted on x from the iPhone`, or
`couldn't post on x from the iPhone`. A 409 means a post is already running. Failures took about
90 s tonight; a successful run wasn't timed.

The scheduled loop stays quiet 3 AM–2 PM, so nothing posts by itself during the video or demo. As of
10:14 PM, x.com doesn't load on the phone (black logo screen); Noel must log in again. **Fallback:**
show the 6:55 PM post (`posted on x from the iPhone`, phone task a4868c26…), labeled "earlier today".

### E. Agency conversation (swap-in)

Tested 10:46–10:48 PM: inquiry answered in 23 s, "yes, send a sample" answered in 27 s, 5 levels 2 s
later. The inbox is polled every 15 s, so allow up to a minute. You play the agency; say that.

1. Reset, so the turn count starts over:
   ```bash
   curl -X POST localhost:8787/agency/demo-start -H "authorization: Bearer $BUSINESS_MCP_TOKEN" -H 'content-type: application/json' \
     -d '{"email":"noel_sason@berkeley.edu","direction":"inbound"}'
   ```
2. From noel_sason@berkeley.edu, email levelai@agentmail.to, subject **Agency inquiry**, body: "We're
   a small agency; one client has a water-sort game that needs more levels. What can you do, and what
   does it cost?" Don't include a store link; that routes to the audit path.
3. When the reply arrives, answer: **"Let's try the free sample: water sort, easy."**
4. Console rows: `new prospect wrote in`, `replied to Level AI Test Agency (test agency): …`, the
   level-pack rows, `delivered level pack`.

### F. Bring your own generator (swap-in)

Generator `9fbe79ac-23f1-470b-af8d-ca05fbce724e`, "Example generator (Level AI sample)". The API
reports its genre as `lotescape`; emails say "parking-puzzle". **Don't re-register it:** that rotates
its secret and breaks the sample. Each level now gets up to 10 tries.

```bash
# Live test, about 2 s: 25 of 50 wins at difficulty 0.5 at 10:27 PM.
curl -X POST https://levelai.vercel.app/api/studio/generators/9fbe79ac-23f1-470b-af8d-ca05fbce724e/test -H "Authorization: Bearer $LEVELAI_DEMO_STUDIO_KEY"
# A 5-level pack through it.
curl -X POST localhost:8787/orders/demo-run -H "Authorization: Bearer $BUSINESS_MCP_TOKEN" -H "content-type: application/json" \
  -d '{"email":"noel_sason@berkeley.edu","generator_id":"9fbe79ac-23f1-470b-af8d-ca05fbce724e","levels":5,"company":"Level AI Test Agency","name":"Noel"}'
```

Feed rows: `asked Level AI Test Agency's generator for level k at difficulty …`, `level k measured …
vs … target: …`, `delivered level pack`. A real 9:47 PM run took 12.7 s for 5 levels. If the endpoint
is down, the pack logs "step-in needed"; say so and show the 9:47 PM email.

### G. Step-ins

The panel shows only the newest 6. **Click the Human step-ins number** for the full list. As of
11:01 PM it holds 8: Abhinav's switch-on (4:44 PM), Pinara enabling and re-running the Designer
(6:21, 6:25 PM), starting and stopping bulk production (7:57, 8:10 PM), publishing the opening
packs (8:19 PM), and building the Mosslight Trails client (11:01 PM). A policy program also approved 528 held tool calls to our own servers; those are
logged, shown beside the step-ins, and not counted as people.

The clock caveat: "Running on its own" counts only logged step-ins. The team's overnight test runs
(9:31–10:19 PM test leads, demo packs, restarts, tunnel drill) get logged as **one** step-in when
hardening stops, and the clock restarts from that row. Morning actions (X login, test orders) aren't
rows. Say them out loud.

## If something breaks

| Break | Do |
|---|---|
| Email takes over 45 s | Keep narrating. Past 90 s, show tonight's test reply and say it's from rehearsal. |
| Console down | The tunnel watchdog restores it in about 40 s (37 s in the 9:53 PM drill). Meanwhile open `http://localhost:4545` (same password). |
| Network or database down | Replay the newest snapshot on a free port: `./demo.sh --replay "$PWD/$(ls -t demo/data/run-*.jsonl \| head -1)" --port 4547`. The banner says it's a replay. Snapshots run at 8:00 and 10:30 AM, plus hourly. |
| Phone view frozen | Open Mobilerun's live view, or say the phone is between jobs and show the last playtest row. |
| Pack is slow | Show how far it got. Don't pretend it finished. |

Never run `./demo.sh` plain tonight or tomorrow: `:4545` is already running.

## Likely questions

- **"Did agents make all those levels?"** No. Agents accepted [N: agent levels]. The rest come from
  two deterministic programs using the same game rules and bots: the compiler ([N: compiled]) and the
  pack builder. The Tuner is a program, not an LLM agent.
- **"Do you put levels inside the customer's game?"** No. Packs are levels in our engine for their
  genre, delivered as playable previews and JSON in a documented format (`/developers`).
- **"Is the cold email spam?"** Role-based addresses only, real quotes, a daily cap, an opt-out line,
  and auto-replies only to clear yeses.
- **"Any real customers?"** Not yet. [N: replied] replies and $0 earned. Say it plainly.
- **"How does it scale?"** Costs are compute, not people: about $0.05 a research pass, cloud-phone
  minutes per playtest, solver CPU per level.
- **"Why these sponsors?"** Naïve runs the team, crons, budgets, and the Marketing, Research, CEO, and
  Designer agents. Mobilerun is the phone. Monid is the review data. Neon holds the activity log every
  number here comes from.

## Verified vs. not verified

| Segment | Status | Last verified | By |
|---|---|---|---|
| Numbers table | Verified | Sat ~11:00 PM | Console `/api/state`, `/public-stats`, Neon SQL (this pass) |
| Console tiles reconcile with Neon | Verified | 10:39 PM | Sentinel 11 |
| Pack run (20 levels + phone) | Verified | 10:07–10:19 PM | Sentinel 5, real run; emails and links checked |
| Live checkouts | Verified, no real charge | 10:17 PM | Sentinel 6 |
| Test-mode payment path | Verified | 10:17 PM | Sentinel 6 webhook test |
| Email-in audit | Verified live earlier tonight | ~10:05 PM | Judge-flow sentinel, inbox checked |
| QR form to a new address | **Blocked until 3:04 PM or upgrade** | 10:54 PM | Feed: "paused until Sun 3:04 PM PT" |
| Second send path | **Not running, not tested** | 11:00 PM | Uncommitted code, no env vars |
| Agency conversation | Verified | 10:46–10:48 PM | Sentinel 7, live thread |
| Generator test | Verified | 10:27 PM | Sentinel 8 |
| Generator pack at 10 tries | **Not run live** (simulated; the 10:21 PM run with 6 tries delivered 3 of 5) | n/a | Tests only |
| X post-now | **Broken; needs Noel's login** | Failed 10:14 PM | Feed |
| Phone loop | Verified | 10:54 PM | Feed row, `phones=ready/ready` |
| Research cadence 10–15 min | Observed | 10:33, 10:45, 10:55 PM | Neon rows; 8–14 min passes expected |
| Tunnel self-heal | Verified | 9:53 PM (37 s) | Sentinel 3 drill |
| Readiness check | 17/17 | 9:54 PM | Sentinel 3 |
| 30-minute console soak | Passed | 10:36 PM | Heap flat, no errors |
| Overnight step-in row | **Not yet written** | n/a | Coordinator, at relay end |
| Replay at `--port 4547` | **Not run** | n/a | Flag exists in `demo/src/server.ts` |
| Video and live timing | **Not rehearsed** | n/a | Do at 8:30 AM |
