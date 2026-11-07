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
| Sat 3:00–8:00 PM | Build v1 in each area. Dinner is at 6:30. |
| **Sat 8:00 PM** | **First end-to-end loop**, even if it's rough: research → stream → clip → post → ops decision. |
| Sat 8:00 PM–1:00 AM | Fix what broke. Add guardrails, budget caps, and kill switches. |
| **Sat 1:00 AM–8:00 AM** | **The company runs unattended overnight.** This is the track record judges score. Log every step-in. |
| Sun 8:00–10:00 AM | Read the overnight log, fix the worst failure, and record a backup demo. |
| Sun 10:00–11:00 AM | Rehearse. No new features. |
| **Sun 11:00 AM** | **Code freeze.** Judging begins. |

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
