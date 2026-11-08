// Additive session-id convention: old rows remain untouched and explicitly unclassified.
// Collapse duplicate terminal events and require a matching first-action attempt.
export const HUMAN_ATTEMPTS_CTE = `human_starts as (
  select game_id,level_id,session_id,min(ts) as started_at from player_events
  where type='attempt' and session_id like 'human:v1:%' and level_id is not null
  group by game_id,level_id,session_id
), human_outcomes as (
  select distinct on(e.game_id,e.level_id,e.session_id)
    e.game_id,e.level_id,e.session_id,e.type,e.ts,e.moves_used,e.time_seconds,s.started_at
  from player_events e join human_starts s using(game_id,level_id,session_id)
  where e.type in ('win','loss','quit') and e.ts>=s.started_at
  order by e.game_id,e.level_id,e.session_id,e.ts,e.id
)`;
