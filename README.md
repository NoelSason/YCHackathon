# Autonomous streaming studio

An entry for the Naïve Autonomous Company Hackathon (YC, Nov 7–8, 2026).

**The company:** a live-streaming channel that agents run. Agents pick the game, play it on
stream, talk with chat, cut the best moments into short clips, post those clips to TikTok, Reels,
and Shorts from real phones, and run the business around it: budget, schedule, sponsors, and
what to stream next.

**What a human does:** sets the budget and the guardrails, and steps in when something breaks.
Every step-in is logged.

## How the company runs

```
        ┌──────────── Research (Mobilerun phones) ────────────┐
        │  Scroll TikTok, Twitch, YouTube apps: what's        │
        │  trending, what clips perform, what competitors do  │
        └──────────────────────┬──────────────────────────────┘
                               ▼
  Ops agent (Naïve) ── decides what to stream, when, and the budget
                               │
                               ▼
  Streamer agent (Naïve) ── plays the game live ──► stream ◄── Chat agent (Naïve)
                               │                               reads and replies to chat
                               ▼
  Clipper (video pipeline) ── finds highlights, cuts vertical clips, captions
                               │
                               ▼
  Publisher (Mobilerun phones) ── posts clips in the YouTube, TikTok, Instagram apps
                               │
                               ▼
  Ops agent ── reads views and follows, updates the plan, emails sponsors,
               sells clipping to human streamers
                               │
                               └──────► back to Research
```

## The agents

| Agent | Built on | Job | Owner |
|---|---|---|---|
| Research | Mobilerun (iOS) | Finds trending games, formats, and clip styles by using the real apps. Writes a short brief the Ops agent can act on. | Noel |
| Publisher | Mobilerun (iOS) | Posts finished clips in the YouTube, TikTok, and Instagram apps. Reads back views and likes, with Monid's YouTube data tools as a cross-check. | Noel |
| Clipper | Video pipeline | Watches the stream recording, picks highlights, cuts 9:16 clips with captions, and makes thumbnails and intros. | Max |
| Streamer | Naïve SDK | Plays the game on stream with a consistent persona. | Abhinav |
| Chat | Naïve SDK | Reads stream chat, replies in persona, takes requests, and moderates. | Abhinav |
| Ops | Naïve SDK | Runs the business: picks what to stream, sets the schedule, tracks spend against budget, emails sponsors, sells clipping, and decides what to change from the numbers. | Teammate 4 |

## Team plan

The Team and ownership section in `AGENTS.md` has the same split. Each person works in their own
directory.

### Noel: research and publishing on phones (Mobilerun)

Goal: the Best Mobile Automation prize, plus the company's eyes and distribution.

1. Get one Mobilerun Agent task working on a cloud iPhone, such as "open TikTok, search
   `<game>`, report the top five videos with view counts."
2. Build the **Research agent**. It produces a structured brief: trending games, clip formats
   that perform, and posting times. The Ops agent reads this brief. Use phones for what only the
   apps show (the For You feed, trending sounds), and Monid's YouTube and TikTok data tools for
   bulk numbers. They're cheaper and faster than scrolling.
3. Build the **Publisher agent**. It takes a clip file and caption and posts it.
   - **All three apps (YouTube, TikTok, Instagram): use Mobilerun phones.** Start with YouTube
     Shorts. Posting from the phone is also the Best Mobile Automation story.
   - **Monid can't upload.** Checked on Nov 7: its YouTube tools only read data (video details,
     search, transcripts, channel videos). Use them for research and for reading back views.
   - **Fallback for YouTube:** the official YouTube Data API upload, which needs the channel's
     sign-in and has a daily upload quota. Check the current quota before relying on it.
4. Add **metrics read-back**: the agent reopens posted clips and records views and likes for Ops.
5. Reuse one logged-in device per app account. Don't reset devices.

### Max: video generation and clipping

Goal: turn hours of stream into a steady flow of clips worth posting.

1. Cut one good clip from a sample gameplay recording, end to end: input video in, 9:16 clip with
   captions out.
2. Add **highlight detection** with chat spikes, audio peaks, and a model pass over the transcript
   or frames.
3. Add **generated assets**: intro stinger, thumbnail, and title options. Monid offers video
   generation models (for example Kling and Wan) at roughly $0.04–$0.20 per clip. Check
   `monid inspect` for the current price before running them in a loop.
4. Expose the pipeline as one job the agents can call: "clip this recording" in, a list of clip
   files with suggested captions out. Agree on the job's input and output with Abhinav early.
5. Make the clip job usable on any streamer's recording, not only ours. Teammate 4 sells it as a
   service.

### Abhinav: Naïve SDK agents and the platform

Goal: the backbone. Agents run, the stream goes live, and everything is logged.

1. **First, before anything else:** prove a Naïve agent can play a game and get video onto a
   stream. This is the riskiest piece of the project (see Risks).
2. Build the **Streamer agent** and the **Chat agent** on the Naïve SDK, each with a budget cap.
3. Stand up the **platform**: hosting, the database, file storage for recordings and clips, and
   the job queue that connects Streamer → Clipper → Publisher.
4. Own the **activity log**. Every agent writes an entry for each decision and action: time,
   agent, action, reason, result, cost, and whether a human stepped in. Use Naïve's
   Observability and Audit logs if they cover this.
5. Wire in the other agents: give Noel's and Max's work a stable way to receive jobs and report
   results.
6. Help Teammate 4 set up the Ops agent on the Naïve SDK, using the same patterns as Streamer
   and Chat.

### Teammate 4 (_name TBD_): business ops and the demo

Goal: make it a company, not only a pipeline, and make the demo show it.

1. Build the **Ops agent** on the Naïve SDK. It reads the Research brief and the metrics, picks
   the next stream and its budget, and logs why. Start small and grow it.
2. **Spend tracking:** cost per stream across the model, Mobilerun, and Monid, against revenue.
   Take it from the cost field in the activity log.
3. **Sponsors and sales:** an AgentMail inbox the Ops agent uses to email sponsors and human
   streamers, HubSpot to track them, and a Stripe payment link for the clipping service. Use
   Stripe test mode until the team agrees to go live.
4. **Demo dashboard:** live stream, recent clips, the activity log, the step-ins, and the numbers.
   Check first whether the Naïve Studio already shows enough.
5. Own the demo script and the backup recording. Record the backup on Sunday morning.

### If we're behind, cut in this order

If Saturday at 8:00 PM arrives without an end-to-end loop, cut in this order: the custom
dashboard, sales and outreach, the Chat agent, then Instagram publishing. Keep Research →
Stream → Clip → Post → Ops decision.

## Timeline

Hacking runs from 1:00 PM Saturday to **11:00 AM Sunday, the code freeze**.

| When | Milestone |
|---|---|
| Sat 1:00–3:00 PM | **Spikes.** Each person proves their riskiest piece works at all (above, step 1). |
| Sat 3:00 PM | **Contracts.** Agree on the activity log fields, the clip job's input and output, file storage, and environment variable names. Write them in `log.md`. |
| Sat 3:00–6:00 PM | Build v1 in each area. |
| **Sat 6:00 PM** | **Switch the company on, even if it's partial.** The clip-first outreach loop sends its first real, personal messages before dinner. A rough loop with real activity beats a polished one with none. |
| **Sat 8:00 PM** | **First full loop:** research → stream → clip → post → outreach → CEO decision. |
| Sat 8:00 PM–2:00 AM | Fix what broke. Add guardrails, budget caps, and kill switches. Give the CEO room to reallocate. |
| **Sun 2:00 AM–8:00 AM** | **Hands off. The company runs unattended.** This is the history the demo shows. Log every step-in. |
| Sun 8:00–10:00 AM | **Feature freeze at breakfast.** Read the overnight log, fix the worst failure, check every demo path, and record a backup. |
| Sun 10:00–11:00 AM | Rehearse. No new features. |
| **Sun 11:00 AM** | **Code freeze.** Judging begins. |

## How we win

Researched on Nov 7, 2026. Sources are listed at the end of this section. Neither Naïve nor YC
has published a scoring rubric or weights, so the event's own statements rank first and the
general advice ranks below them.

### 1. What this event says it judges (highest weight)

- **Autonomy.** "Judges look at how much of the company runs without you." That's the main score.
- **Proof that the company actually operated.** Show what the agents delivered, what they decided,
  and where we stepped in. Show it, don't describe it.
- **Format.** A live demo of **2–4 minutes** to a small panel. The **top 8–10 teams demo again on
  the main stage.** Plan one 3-minute demo that works in both rounds.
- **Prize tracks.** 1st to 3rd overall (1st gets a guaranteed YC interview), Most autonomous company,
  Most likely to become a unicorn, Best use of Naïve, People's choice, Best design, and Best
  Mobile Automation (Mobilerun). Most track definitions aren't published.
- **Mobile track.** Mobilerun: "demonstrating a working end-to-end workflow, not just an agent
  that explains what it would do."

### 2. What recent winners of YC-hosted hackathons had in common

- **Numbers, not claims.** Winners of YC's Sep 2026 hackathon reported measured results, such as
  "cost per ticket fell 66% across 400 tickets" and "0/30 → 29/30 on held-out changes."
- **Deep use of the sponsor stack.** At that event, 90 of 91 submissions used a sponsor tool, and
  every grand-prize winner built on one. Using a sponsor's tool is the baseline. Winning takes
  using it centrally and well.
- **Output judges can check themselves.** Judging rewards visible output: judges "could assess
  the output directly rather than relying on credentials or theoretical explanations."
- **Outside attention counts.** A winning project's post drew about 382,000 views. Real views on
  our clips are evidence a judge can't argue with.

### 3. What judges say in general

- A simple project with a clear, confident demo beats a complex one with a confusing demo.
- Cut features to keep the demo short. Remove every place it could stall, and pre-load data.
- Be plain about what works and what doesn't. Judges notice when you talk around missing pieces.
- Keep a recorded backup of the same demo.
- Judges revisit repos. A README with a screenshot, a live link, and the numbers settles ties.

### 4. YC's pitch rules (from YC's Demo Day guide)

- **First sentence: what we do, in plain words.** For example: "We're a gaming channel that runs
  itself. Agents pick the game, stream it, clip it, post it, and run the business."
- **Don't bury the lead.** Open with the best real number we have.
- **Three or four points at most**, then repeat them at the end.
- **No exaggeration.** YC calls exaggeration a "fatal error." Say "we have zero revenue" if
  that's true.
- **No jargon.** "Agents" is fine. "Multi-agent orchestration substrate" isn't.
- For "Most likely to become a unicorn," show bottom-up math (how many customers, how much each
  pays), not "the creator economy is $X billion."

### 5. The official brief, and what 16 YC hackathon winners did

From Naïve's hackathon page (checked Nov 7):

> **Build an autonomous company. Not a demo of one.** … By demo time it should be operating
> without you: **making, selling, shipping, earning.**

The brief lists "a media channel" as an example market, so our idea fits the brief. It also
describes the shape: "A CEO and a team, each with its own computer, inbox, money and the web.
You set the goal; they make the calls."

Team research on 16 winners of YC-hosted hackathons (Browser Use, Conversational AI, Voice
Agents, AgentMail, Agentic Payments, RL, Greptile, Own Your Intelligence, and others) found six
patterns. The per-event details came from that research and weren't re-checked here.

1. **The idea fits in one sentence.** "Two browser agents fight each other." "Talk to your
   security cameras."
2. **The demo shows a state change.** Something gets found, fixed, generated, sent, bought, or
   deployed on screen.
3. **The agent acts instead of advising.** It updates the CRM, sends the email, posts the clip.
4. **There's evidence.** Traces, counts, and before-and-after numbers, not "imagine if."
5. **Sponsor tools make the magic moment.** Each integration is a working part of one workflow,
   not a badge.
6. **The team plays to the judging.** They pick the tracks they can win and split the work early.

Their formula: **clarity × autonomy × real-world consequence × proof.** Technical difficulty
makes a good project better, but it isn't the foundation. One reported rubric (Browser Use, Feb
2026) weighted impact at 40%, and creativity, technical difficulty, and the demo at 20% each.

**The core principle: don't demo the software. Demo the company's history since we stopped
touching it.**

| Other teams say | We show |
|---|---|
| "Our agents could find an audience." | The streams, with viewer counts |
| "Our agents could make content." | The clips they cut and posted, with views |
| "Our agents could sell." | The email thread with a streamer, and the Stripe payment |
| "Our agents run autonomously." | The hours of decisions they made while we slept |

### 6. How we close the "earning" gap

A streaming channel makes and ships content, but it won't earn real money from ads or sponsors
in 22 hours. The research's strongest point is that a **service business** can earn within the
event. It finds customers, does the work *before* asking, and sells the finished result.

**We already have that service: clipping for human streamers.** Make it the revenue loop.

1. **Find:** the Research agent finds small streamers with recent recordings and no clip
   channel, using Monid's Twitch and YouTube data tools, Naïve's Social data, or Apify.
2. **Make it first:** the Clipper cuts 3 clips from one of their recent streams *before* we
   contact them.
3. **Pitch:** the Ops agent emails them from an AgentMail inbox: "I clipped your stream from
   Tuesday. Here are 3 clips, ready to post. Want this for every stream? $X a month." It
   includes a Stripe payment link, and the clips are the proof.
4. **Close and deliver:** replies arrive in the inbox, the agent answers, payment comes through
   Stripe, and new streams get clipped and delivered on a schedule.
5. **Track:** each streamer moves through HubSpot stages: found → clipped → contacted → replied
   → paid → delivered.

Our own channel becomes the showcase and the marketing ("we do this for our own stream"), and
the clipping service brings in the money. Keep the volume small and every message personal.
Twenty real messages beat five hundred spam ones, and spam can break platform rules and email
law. Their stream is their content: send the sample clips only to them, privately, and never
post a streamer's clips anywhere until they've agreed.

**Run the agents as a Naïve Team.** Naïve supports a coordinator agent with a roster of
specialists, delegation, and a shared company board, with allow, ask, or deny set on each tool.
Make the Ops agent the **CEO coordinator**. Research, Streamer, Chat, Clipper, and Publisher are
its roster, and board cards are the hand-offs. Docs: Team (https://usenaive.ai/docs/team/overview.md),
Company board (https://usenaive.ai/docs/team/board.md), and Policies
(https://usenaive.ai/docs/concepts/policies.md).

**Give the CEO real decisions to make,** and log the reasons. For example:

> 02:14: Shifted outreach from Valorant streamers (0 replies of 9) to Minecraft streamers (3 of
> 7). Moved the next $5 of clip budget with it.

That one log entry answers the judges' question "what did the agents decide?" better than any
UI.

### What this means for us

| Criterion | What we do | Owner |
|---|---|---|
| Making, selling, shipping, earning | The clip-first outreach loop to human streamers, ending in a real Stripe payment | Teammate 4, Max |
| Agent decisions | The CEO (Ops) reallocates budget and targets from results, and logs why | Teammate 4 |
| Autonomy | Run unattended overnight (1–8 AM). Keep the intervention count low and honest. | Everyone |
| Proof of operation | Activity log with decisions and reasons. Clips posted with real views. | Abhinav, Noel |
| Numbers | Hours streamed, clips posted, views, decisions made, spend, step-ins. Put them on one screen. | Teammate 4 |
| Best use of Naïve | Streamer, Chat, and Ops all on the Naïve SDK, with budgets, Skills, and Observability, used the way the docs intend | Abhinav |
| Best Mobile Automation | Research and posting really happen on phones, end to end, with a live phone view in the demo | Noel |
| People's choice | During the demo, put a QR code on screen so the audience can join the stream chat and watch the Chat agent answer them live | Abhinav, Teammate 4 |
| Best design | Clips that look good: captions, thumbnails, a consistent channel identity | Max |
| Unicorn | One slide of bottom-up math for the clipping service and the channel model | Teammate 4 |
| Demo quality | A 3-minute script, rehearsed twice, with a recorded backup | Teammate 4 |

### 3-minute demo outline

Open with the result, not the architecture. Everyone in the room built a multi-agent system
on Naïve.

1. **0:00–0:20: the result.** "At 2:00 AM we stopped touching this company. Since then its agents
   streamed N hours, posted N clips that got N views, pitched N streamers, closed N, collected
   $N, and spent $N doing it. We stepped in N times." Use only real numbers.
2. **0:20–1:30: one customer, end to end.** Click through a real timeline: Research finds the
   streamer → Clipper cuts their clips → the email goes out → their reply → the Stripe payment →
   the delivered clips.
3. **1:30–2:00: one decision we didn't make.** Show the CEO's log entry that changed strategy,
   and the numbers behind it.
4. **2:00–2:30: the live part.** The stream is running and the Chat agent answers the
   audience (QR code on screen). A Mobilerun iPhone posts a clip live.
5. **2:30–3:00: why it's a company.** "If we leave it running when we walk offstage, tomorrow it
   will have found more customers, done more work, and changed its own plan. We only set the
   goal and the budget." Then the list of human step-ins, honestly.

The main screen is a **company heartbeat**: revenue, streamers found, clips made, emails sent,
replies, payments, deliveries, views, agent spend, margin, and human step-ins. Agent activity
goes underneath, expandable. Judges don't want to watch tokens scroll.

### Sources

- [Naïve: Autonomous Companies Hackathon](https://usenaive.ai/hackathon): judging focus, demo
  format, tracks
- [Mobilerun: Give your autonomous company a phone](https://mobilerun.ai/blog/posts/autonomous-company-hackathon-naive-mobilerun):
  mobile track
- [c0mpiled: YC Own Your Intelligence Hackathon, Sep 2026](https://www.compiled.sh/articles/yc-own-your-intelligence-hackathon):
  winners and patterns
- [Iterate: From hackathon winner to Y Combinator in 74 days](https://iterate.inc/blog/from-hackathon-winner-to-y-combinator-in-74-days):
  visible output and public reception. These were not YC-hosted events.
- [YC: A guide to Demo Day presentations](https://www.ycombinator.com/blog/guide-to-demo-day-pitches/):
  pitch rules
- [JetBrains: How to win a hackathon, notes from the judging table](https://blog.jetbrains.com/ai/2026/06/how-to-win-a-hackathon-notes-from-the-judging-table/)
  and [Devpost: advice from five judges](https://info.devpost.com/blog/hackathon-judging-tips):
  general demo advice. The JetBrains page blocked direct fetching, so its points come from search
  summaries.
- [Reskilll: how to win a hackathon](https://blogs.reskilll.com/how-to-win-hackathon-2026-complete-playbook/):
  the README-as-tiebreaker point. This is a vendor blog.

## What the demo has to show

Judges score how much of the company runs without us. By 11:00 AM Sunday, we want real numbers
for:

- Hours streamed with no human at the controls
- Clips cut and clips published, with their views
- Decisions the Ops agent made, and why (from the activity log)
- Sponsor and customer emails sent, and replies
- Total spend, and revenue (zero is an honest answer)
- **Every human intervention, and why.** Fewer is better, but hiding them is worse.

## Risks

1. **Getting an agent's gameplay onto a live stream.** This is the riskiest piece. Nobody has
   checked yet whether a Naïve Computer (a sandbox with an optional browser) can run a game and
   send video out. Fallbacks, in order:
   - a browser game in the Naïve Computer, sent out with `ffmpeg`
   - a mobile game on a Mobilerun phone, using the phone's screen as the stream
   - recorded "sessions" posted as videos instead of a true live stream

   Decide by 3:00 PM Saturday.
2. **Platform rules.** Twitch, YouTube, and TikTok have rules about automated accounts and
   AI-generated content, and some require an AI-content label. Use test accounts, label AI
   content, and read each platform's rules before going public.
3. **Spend.** Agents running overnight can burn credits. Set a budget cap on every Naïve agent and
   a daily limit in Monid and Mobilerun.
4. **Phone flakiness.** App updates, captchas, and login checks can stop the Publisher. Keep a
   human-posted fallback, and log it as an intervention if it's used.

## Docs

- Agent instructions and rules: `AGENTS.md` (Claude Code reads it through `CLAUDE.md`)
- What each push did: `log.md`
- Naïve SDK: https://vetta.sh/docs/llms.txt
- Mobilerun: https://docs.mobilerun.ai/llms.txt
