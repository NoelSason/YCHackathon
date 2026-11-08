/** The page behind the QR code at our table and on stage. Copy is for the person scanning it. */
export function joinPage(companyName: string): string {
  const name = companyName.replace(/[<>&"]/g, "");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}: free levels for your game</title>
<style>
  :root { --bg: #0b0d12; --card: #151924; --text: #f3f5f8; --muted: #9aa3b2; --accent: #7c5cff; --ok: #3ddc97; --err: #ff6b6b; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; display: grid; place-items: center; padding: 16px; }
  main { width: 100%; max-width: 440px; background: var(--card); border-radius: 18px; padding: 28px 22px; }
  h1 { font-size: 26px; line-height: 1.2; margin: 0 0 8px; }
  p.lede { color: var(--muted); margin: 0 0 22px; }
  label { display: block; font-size: 14px; color: var(--muted); margin: 14px 0 6px; }
  input[type=text], input[type=email], input[type=url] { width: 100%; padding: 13px 14px; border-radius: 10px; border: 1px solid #2a3142; background: #0f131c; color: var(--text); font-size: 16px; }
  .check { display: flex; gap: 10px; align-items: flex-start; margin: 18px 0 4px; font-size: 14px; color: var(--muted); }
  .check input { margin-top: 3px; width: 18px; height: 18px; }
  button { width: 100%; margin-top: 18px; padding: 15px; border: 0; border-radius: 12px; background: var(--accent); color: white; font-size: 17px; font-weight: 600; }
  button:disabled { opacity: .6; }
  #msg { margin-top: 16px; min-height: 24px; font-size: 15px; }
  .ok { color: var(--ok); } .err { color: var(--err); }
  .small { font-size: 12px; color: var(--muted); margin-top: 18px; }
</style>
</head>
<body>
<main>
  <h1>Free levels for your game</h1>
  <p class="lede">Tell us about your puzzle game. In about a minute, we'll email you what your players are saying and a few free levels to try.</p>
  <form id="f" novalidate>
    <label for="name">Your name</label>
    <input id="name" name="name" type="text" autocomplete="name" required>
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="email" required>
    <label for="company">Studio</label>
    <input id="company" name="company" type="text" autocomplete="organization" required>
    <label for="game">Game</label>
    <input id="game" name="game" type="text">
    <label for="storeUrl">Google Play link (optional)</label>
    <input id="storeUrl" name="storeUrl" type="url" inputmode="url" placeholder="https://play.google.com/store/apps/details?id=…">
    <div class="check"><input id="consent" name="consent" type="checkbox" required><label for="consent" style="margin:0">Email me my free levels. I can reply "stop" anytime.</label></div>
    <button id="b" type="submit">Get my free levels</button>
    <div id="msg" role="status" aria-live="polite"></div>
  </form>
  <p class="small">${name} is a studio where AI agents design and test puzzle levels.</p>
</main>
<script>
  const f = document.getElementById("f"), b = document.getElementById("b"), msg = document.getElementById("msg");
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f).entries());
    d.consent = document.getElementById("consent").checked;
    if (!d.storeUrl) delete d.storeUrl;
    if (!d.game) delete d.game;
    b.disabled = true; msg.className = ""; msg.textContent = "Sending…";
    try {
      const r = await fetch("/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(d) });
      const j = await r.json();
      if (r.ok) { msg.className = "ok"; msg.textContent = "You're in. Check your inbox in about a minute."; f.reset(); }
      else { msg.className = "err"; msg.textContent = j.error || "Something went wrong. Please try again."; }
    } catch { msg.className = "err"; msg.textContent = "Couldn't reach us. Please try again."; }
    b.disabled = false;
  });
</script>
</body>
</html>`;
}
