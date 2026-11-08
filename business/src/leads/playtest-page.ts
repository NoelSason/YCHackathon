/** The page teams use to order a phone playtest. Copy is for the person ordering it. */
export function playtestPage(companyName: string, priceUsd: number | undefined, paid: boolean): string {
  const name = companyName.replace(/[<>&"]/g, "");
  const price = priceUsd ? `$${Number.isInteger(priceUsd) ? priceUsd : priceUsd.toFixed(2)}` : null;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}: your app on a real iPhone</title>
<style>
  :root { --bg: #0b0d12; --card: #151924; --text: #f3f5f8; --muted: #9aa3b2; --accent: #7c5cff; --ok: #3ddc97; --err: #ff6b6b; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; display: grid; place-items: center; padding: 16px; }
  main { width: 100%; max-width: 460px; background: var(--card); border-radius: 18px; padding: 28px 22px; }
  h1 { font-size: 26px; line-height: 1.2; margin: 0 0 8px; }
  .price { display: inline-block; margin: 4px 0 14px; padding: 4px 10px; border-radius: 999px; background: rgba(124,92,255,.18); color: #c4b6ff; font-weight: 600; font-size: 14px; }
  p.lede { color: var(--muted); margin: 0 0 18px; }
  label { display: block; font-size: 14px; color: var(--muted); margin: 14px 0 6px; }
  input[type=text], input[type=email], input[type=url], textarea { width: 100%; padding: 13px 14px; border-radius: 10px; border: 1px solid #2a3142; background: #0f131c; color: var(--text); font: inherit; }
  textarea { min-height: 70px; resize: vertical; }
  .check { display: flex; gap: 10px; align-items: flex-start; margin: 18px 0 4px; font-size: 14px; color: var(--muted); }
  .check input { margin-top: 3px; width: 18px; height: 18px; }
  button { width: 100%; margin-top: 18px; padding: 15px; border: 0; border-radius: 12px; background: var(--accent); color: white; font-size: 17px; font-weight: 600; }
  button:disabled { opacity: .6; }
  #msg { margin-top: 16px; min-height: 24px; font-size: 15px; }
  .ok { color: var(--ok); } .err { color: var(--err); }
  .banner { background: rgba(61,220,151,.12); color: var(--ok); border-radius: 10px; padding: 10px 12px; margin-bottom: 14px; }
</style>
</head>
<body>
<main>
  ${paid ? '<div class="banner">Payment received. Your playtest is starting, and the report will arrive by email in about 10 minutes.</div>' : ""}
  <h1>Your app, played on a real iPhone</h1>
  <span class="price">${price ? `${price} per playtest` : "Free during the hackathon"}</span>
  <p class="lede">Send us a link to your app. We play it on a real iPhone like a first-time user and email you what works, what breaks, and where people will get stuck, in about 10 minutes.</p>
  <form id="f" novalidate>
    <label for="name">Your name</label><input id="name" name="name" type="text" autocomplete="name" required>
    <label for="email">Email for the report</label><input id="email" name="email" type="email" autocomplete="email" required>
    <label for="team">Team or company</label><input id="team" name="team" type="text" autocomplete="organization" required>
    <label for="appUrl">Link to your app (https://…)</label><input id="appUrl" name="appUrl" type="url" inputmode="url" required>
    <label for="focus">Anything specific to check? (optional)</label><textarea id="focus" name="focus" maxlength="400"></textarea>
    <div class="check"><input id="consent" type="checkbox" required><label for="consent" style="margin:0">Email me the report. I can reply "stop" anytime.</label></div>
    <button id="b" type="submit">${price ? `Continue to pay ${price}` : "Playtest my app"}</button>
    <div id="msg" role="status" aria-live="polite"></div>
  </form>
</main>
<script>
  const f = document.getElementById("f"), b = document.getElementById("b"), msg = document.getElementById("msg");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f).entries());
    d.consent = document.getElementById("consent").checked;
    if (!d.focus) delete d.focus;
    b.disabled = true; msg.className = ""; msg.textContent = "Sending…";
    try {
      const r = await fetch("/playtest-orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(d) });
      const j = await r.json();
      if (r.ok && j.payUrl) { location.href = j.payUrl; return; }
      if (r.ok) { msg.className = "ok"; msg.textContent = "On it. Your report will arrive by email in about 10 minutes."; f.reset(); }
      else { msg.className = "err"; msg.textContent = j.error || "Something went wrong. Please try again."; }
    } catch { msg.className = "err"; msg.textContent = "Couldn't reach us. Please try again."; }
    b.disabled = false;
  });
</script>
</body>
</html>`;
}
