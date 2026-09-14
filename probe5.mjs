import puppeteer from "/Users/stevee/aquarius/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"], defaultViewport: { width: 1440, height: 1000 } });
const p = await b.newPage();
p.on("console", m => { const t = m.text(); if (t.startsWith("EV")) console.log(t); });
await p.goto("http://localhost:3000/editor", { waitUntil: "networkidle2", timeout: 60000 });
await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => { const t=[...document.querySelectorAll("button,a,div[role=button]")].find(e=>(e.textContent||"").includes("New note")); t&&t.click(); });
await new Promise(r => setTimeout(r, 3500));
const zone = await p.evaluate(() => { const el=document.querySelector('[aria-label="Add a paragraph at the end"]'); const r=el.getBoundingClientRect(); return {x:r.x+30,y:r.y+10}; });
await p.mouse.click(zone.x, zone.y);
await new Promise(r => setTimeout(r, 500));
await p.keyboard.type("Alpha paragraph one."); await p.keyboard.press("Enter"); await new Promise(r=>setTimeout(r,250));
await p.keyboard.type("$$E = mc^2$$"); await p.keyboard.press("Escape"); await new Promise(r=>setTimeout(r,800));
const rect = (i) => p.evaluate((idx) => { const e=[...document.querySelectorAll("[data-btype]")][idx]; const r=e.getBoundingClientRect(); return {t:e.dataset.btype,x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}; }, i);
const R = [await rect(0), await rect(1)];
console.log("EV rects", JSON.stringify(R));
await p.evaluate(() => {
  const d = (e) => { const t = e.target; return (t.tagName||"?") + "." + ((t.className||"")+"").slice(0,28) + " @" + Math.round(t.getBoundingClientRect?.().y ?? -1); };
  for (const ev of ["mousedown","mouseup","click","focusout","focusin"]) {
    document.addEventListener(ev, (e) => console.log("EV " + ev + " -> " + d(e)), true);
  }
});
// click prose, then equation
await p.mouse.click(R[0].x+40, R[0].y+R[0].h/2);
await new Promise(x=>setTimeout(x,700));
console.log("EV --- now clicking the equation ---");
await p.mouse.click(R[1].x+R[1].w/2, R[1].y+R[1].h/2);
await new Promise(x=>setTimeout(x,900));
console.log("EV final active:", await p.evaluate(()=>document.activeElement.tagName));
await b.close();
