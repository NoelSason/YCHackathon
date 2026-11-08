import type { Check } from "../types.js";
const check: Check = {
  name: "kill_switch", owner: "Abhinav", path: "all (publishing not blocked)",
  async run({ db }) {
    const r = await db.query(`select value from settings where key='kill_switch'`);
    const on = (r.rows[0] as { value: boolean } | undefined)?.value === true;
    return on ? { ok: false, detail: "kill_switch is ON: publish_pack refuses. `npm run kill -- on` in platform/naive to resume" } : { ok: true, detail: "kill_switch off" };
  },
};
export default check;
