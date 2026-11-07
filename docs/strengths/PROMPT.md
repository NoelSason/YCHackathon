# Strengths prompts

Two prompts. Everyone runs **Prompt 1** in their own coding agent. Once all four strengths files
are in, one person runs **Prompt 2**, and the team decides together.

---

## Prompt 1: find my strengths (everyone)

Copy everything between the lines into your coding agent (Claude Code, Codex, Cursor, or another),
started in this repo.

---

I'm on a 4-person hackathon team. Help me write an honest strengths profile so the team can assign
roles. Follow these steps in order.

1. **Read the plan:** `README.md`, `AGENTS.md`, and `docs/agent-plan.md`. Learn the work areas
   listed in step 3.

2. **Gather evidence, with my permission.** Ask me before you look at anything outside this repo.
   If I agree, you may look at:
   - my GitHub profile or repos I name (public information only), and
   - local project folders I point you to (read the README, the languages used, and recent
     commits; don't open `.env` files or anything that looks like a secret).
   Don't upload or paste my private code anywhere. If I decline, skip this step.

3. **Interview me.** Ask these questions a few at a time, not all at once. Push for specifics:
   "What did you build with it, and what part was yours?"
   - For each work area below: have I done this before? What did I build, and how recently?
     1. **Game integration:** forking a web game, JS/TS game code, separating game rules from
        drawing code, running game logic headless in Node
     2. **Solvers and simulation:** search (BFS, DP), physics stepping, Monte Carlo or bot players
     3. **Backend and platform:** Postgres or Neon, APIs, MCP servers, hosting (Vercel, Render)
     4. **AI agents:** the Naïve SDK or other agent frameworks, prompting, multi-agent hand-offs,
        tool permissions, evals
     5. **Mobile:** iOS or Android, device automation, Mobilerun
     6. **Frontend and visual design:** dashboards, UI polish, art and rebranding
     7. **Business:** sales or outreach emails, Stripe, HubSpot, AgentMail
     8. **Demo and pitch:** presenting, storytelling, recording a demo video
   - Which two areas do I most want to work on? Is there one I want to learn this weekend?
   - Which areas do I want to avoid?
   - **Time:** how many hours can I work between now and 11:00 AM Sunday? Can I be awake and
     reachable during the 2:00–8:00 AM unattended run?
   - Anything that limits me this weekend (laptop, accounts, leaving early)?

4. **Rate each area 1–5,** using only evidence from steps 2 and 3:
   - 5: shipped real work in this area recently, and could lead it
   - 4: done it several times, works without help
   - 3: done it once or twice, needs to look things up
   - 2: read about it or did a tutorial
   - 1: never done it
   Don't flatter me. If the evidence is thin, rate lower and say why. Show me the ratings and let me
   correct them before you write the file.

5. **Write the file** `docs/strengths/<my-first-name-lowercase>.md` using
   `docs/strengths/TEMPLATE.md`. Put only what's needed to assign roles: no contact details, no
   grades, no private code.

6. **Update the dev log.** Add an entry at the top of `log.md` (the template is in that file)
   saying I added my strengths file. Pushes are blocked without a log entry.

7. Show me the finished file and the log entry. **Commit and push only if I ask you to.** Never use
   `--no-verify`.

---

## Prompt 2: propose roles (one person, after all four files exist)

---

All four teammates have strengths files in `docs/strengths/`. Propose roles for the hackathon.

1. Read `README.md`, `AGENTS.md`, `docs/agent-plan.md`, and every file in `docs/strengths/` except
   `PROMPT.md` and `TEMPLATE.md`.
2. List the work packages from the plan. For each one, give a size (S, M, L) and whether it's on
   the critical path, meaning other work waits on it. The critical path includes the game adapter
   contract, the agent tools (MCP server), the Naïve Team setup, and the first phone the agents
   control.
3. Assign every package to one owner:
   - Put each critical-path package with the person rated highest in that area.
   - Respect each person's "avoid" list and time limits.
   - Keep the load roughly even: count S=1, M=2, L=3 and show each person's total.
   - Give each person at least one of their "most want" areas where possible.
   - Name a backup owner for each critical-path package.
   - Note who covers the 2:00–8:00 AM unattended run.
4. Write the proposal to `docs/roles.md`: a table of person → packages → why, the load totals,
   the backups, and any gap where nobody is rated 3 or higher. For each gap, suggest a fix (pair
   up, cut scope, or ask a mentor).
5. Add an entry at the top of `log.md`. Don't change `README.md` or `AGENTS.md` yet. The team
   decides first, then the docs get updated.

---
