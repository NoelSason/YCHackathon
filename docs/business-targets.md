# Studios to pitch

Nov 7, 2026. Built from two Monid research runs over the US Google Play puzzle charts:
`npx tsx src/research/cli.ts --max 15` (top free) and the same `findTargets` call with
`chart: "topgrossing"` (top grossing, 15 games). Each game's newest 150 English reviews
were read, or fewer if the game has fewer reviews. Reviews date from Oct 11 to Nov 6, 2026.

The counts below are **hand-checked**. Every flagged review was read in full, and the ones
that don't actually complain about level difficulty or level supply were removed. So some
counts are lower than the classifier's (noted in the table).

## Targets

| # | Studio | Game | Google Play | Signal (hand-checked) | Example quote | Contact | Contact source |
|---|---|---|---|---|---|---|---|
| 1 | Loop Games A.S. (Ankara) | Parking Loop (100K+) | [link](https://play.google.com/store/apps/details?id=com.loop.packedloop) | 7 of 86 newest reviews say the levels are too easy or take too long to get challenging | "it takes too long for the levels to actually prove a challenge. I could complete the first few dozen half asleep..." | support@loopgames.net | Developer email on the [Google Play listing](https://play.google.com/store/apps/details?id=com.loop.packedloop) |
| 2 | Rotatelab | Cube Land Puzzle Game (1M+) | [link](https://play.google.com/store/apps/details?id=com.rotatelab.cubeblast) | 6 of 150 say a specific level is impossible, and 3 more say it's too easy (classifier: 9 + 3) | "Lvl 136 is impossible. I've tried it every way and you can't unlock the last padlock as the colours don't exist." | info@rotatelab.com | Developer email on the [Google Play listing](https://play.google.com/store/apps/details?id=com.rotatelab.cubeblast) |
| 3 | GOODROID, Inc. (Japan) | Bus Traffic Fever! (10M+) | [link](https://play.google.com/store/apps/details?id=jp.co.goodroid.hyper.busflow) | 7 of 150 say levels are too hard or impossible without boosters (classifier: 10) | "Spent about 2 hours trying to clear level 4. it is physically impossible to beat." | contact_apps_casual@goodroid.co.jp | Developer email on the [Google Play listing](https://play.google.com/store/apps/details?id=jp.co.goodroid.hyper.busflow). For business inquiries, the studio also has a corporate (法人) form at [goodroid.co.jp/contact](https://goodroid.co.jp/contact) |
| 4 | ABI Games (Hanoi) | Colony Flow! (5M+) | [link](https://play.google.com/store/apps/details?id=com.abi.colony.flow) | 5 of 150 say a level is too hard or impossible without paying, and 1 more says the hard stages are "no real challenge. Just memorization" (classifier: 7 + 2) | "This game is super fun until you get to the level where it's impossible to beat without paying for power ups." | contact@abigames.com.vn | Developer email on ABI's [Bus Jam Google Play listing](https://play.google.com/store/apps/details?id=com.abi.busjam.sortpuzzle). Colony Flow's own listing shows one person's address, so that one isn't used |
| 5 | Loom Games A.Ş. (Istanbul; Scopely holds a majority stake) | Pixel Flow! (10M+) | [link](https://play.google.com/store/apps/details?id=com.loomgames.pixelflow) | 3 of 150 say a level is impossible without power-ups, and 2 more say the levels are repetitive | "level 376 is actually quite literally impossible without using a single power-up." | support@loomgames.com | Developer email on the [Google Play listing](https://play.google.com/store/apps/details?id=com.loomgames.pixelflow), also under "Contact" on [loomgames.com](https://loomgames.com/) |
| 6 | Grand Games A.Ş. (Istanbul; $103M raised) | Magic Sort! (10M+) | [link](https://play.google.com/store/apps/details?id=com.grandgames.magicsort) | 3 of 150 say levels are too hard or impossible (classifier: 4) | "the super hard levels NEED a powerup to beat. and i'm still pretty early on... i'm stuck on 99." | support@grand.gs | Developer email on the [Google Play listing](https://play.google.com/store/apps/details?id=com.grandgames.magicsort) |
| 7 | SayGames Ltd | Pocket Sort: Coin Merge Puzzle (10M+) | [link](https://play.google.com/store/apps/details?id=com.pocket.sort.coin.puzzle.game) | 2 of 150 say a level becomes impossible unless you pay, and 1 more says it gets repetitive | "it's a fun game but when it gets to hard you have to spend money in order to win the level." | publishing@say.games | "Business Inquiries and Publishing" on [say.games/contacts](https://say.games/contacts) |

Notes:

- Only SayGames publishes a business address. Every other contact is the support inbox from
  the store listing, so expect a support agent to read it first and forward it.
- Loom Games (Scopely) and Grand Games ($103M raised) are larger than the rest and less
  likely to buy a small pilot. Loop Games, Rotatelab, GOODROID, and ABI Games fit best.
- Many of the "too hard" reviews tie the difficulty to paying for power-ups. That's a
  difficulty-curve complaint we can work on, but the pitch should say "levels that feel
  unwinnable," not "monetization."

## Dropped

- **Search It - Hidden Objects (Leap Game Studios).** Both "too easy" hits are praise: "Some
  games are way too easy." (about other games) and "balanced with not being too easy or hard."
- **Find The Cat 2 (Agave Games).** Both "more levels" hits are about access, not wanting
  new content: "it won't let me play any more levels" and "you need internet to access more
  levels". Only 1 real signal is left, a "repetitive" review.
- **Yarn Loop (Combo Game).** Only 1 real review (level 250 is too hard). The other is about
  the coin cost of continuing.
- **Brain Puzzle 3: Crazy Mind (JoyGame Studio).** 2 real "more levels" reviews, but the
  only public contact is a personal Gmail address, so we can't contact them.
- **Meowdoku (Oakever Games).** Thin: 1 real "too easy" and 1 real "repetitive" review. The
  third hit is "no good ai dribble repetitive".
- **Empires & Puzzles (Small Giant Games).** All 5 hits are general "pay to win" complaints
  about heroes and items, not levels. The studio is also owned by Zynga.
- **Flambé: Merge & Cook (Microfun).** Both hits are "Pay to win game."
- **Travel Town (Magmatic Games).** The "too easy" hit is a false positive ("takes too long to
  get through the 20 ads/events"). What's left is about events, not levels.
- **Color Block Jam (Rollic Games).** The signal is real and a good story: 3 reviews say the
  levels got too easy after an update ("game got too easy... now the levels are far too
  simple and unchallenging"). Dropped because Rollic is owned by Zynga, which the research
  code already treats as too big to pitch.
- **All in Hole (Homa).** Real but weaker: 2 "impossible without paying", 1 "waiting for new
  levels", and 1 "repetitive". One hit was a false positive. Homa is a large publisher. Next
  in line if a slot opens.
