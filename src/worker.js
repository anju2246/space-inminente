const EPIC_START="2015-06-13";
const SDO_START="2010-06-02";
const SOHO_START="1996-01-16";
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/ingest-html" && request.method === "PUT") {
      const html = await request.text();
      if (html.length < 1000) return json({error:"too_small"},400);
      const n = 4;
      const size = Math.ceil(html.length / n);
      for (let i = 0; i < n; i++) {
        const part = html.slice(i*size, (i+1)*size);
        await env.SPACE_HTML.put("index.html." + i, part);
      }
      await env.SPACE_HTML.put("index.html", html);
      return json({ok:true, len: html.length, parts:n});
    }
    if (url.pathname === "/api/sun") return handleSun(request, url, ctx);
    if (url.pathname === "/api/earth") return handleEarth(request, url, ctx);
    if (url.pathname === "/api/meta") return json({sohoStart:SOHO_START,sdoStart:SDO_START,epicStart:EPIC_START,credit:"ESA/NASA SOHO, NASA SDO via Helioviewer; NASA EPIC/DSCOVR."});
    if (url.pathname === "/" || url.pathname === "/index.html") return page(env);
    return new Response("Not found", {status:404});
  }
};
async function page(env) {
  let html = await env.SPACE_HTML.get("index.html");
  if (!html) {
    const parts = await Promise.all([0,1,2,3].map(i => env.SPACE_HTML.get("index.html." + i)));
    if (parts.every(Boolean)) html = parts.join("");
  }
  if (!html) return new Response("UI pending", {status:503});
  return new Response(html, {headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-robots-tag":"noindex"}});
}
async function handleSun(request, url, ctx) {
  const date = url.searchParams.get("date");
  const sourceId = url.searchParams.get("sourceId");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({error:"date YYYY-MM-DD required"},400);
  if (!sourceId || !/^\d+$/.test(sourceId)) return json({error:"sourceId required"},400);
  const sid = Number(sourceId);
  const iso = date + "T12:00:00Z";
  const imageScale = sid===4||sid===5 ? 11.9 : sid>=8&&sid<=19 ? 2.4 : 2.63;
  const hv = new URL("https://api.helioviewer.org/v2/takeScreenshot/");
  hv.searchParams.set("date", iso);
  hv.searchParams.set("imageScale", String(imageScale));
  hv.searchParams.set("layers", "[" + sid + ",1,100]");
  hv.searchParams.set("x0","0"); hv.searchParams.set("y0","0");
  hv.searchParams.set("width","768"); hv.searchParams.set("height","768");
  hv.searchParams.set("display","true"); hv.searchParams.set("watermark","false");
  const cacheKey = new Request(hv.toString(), {method:"GET"});
  const cache = caches.default;
  let res = await cache.match(cacheKey);
  if (res) return withCors(res);
  const upstream = await fetch(hv.toString(), {headers:{accept:"image/png,*/*"}, cf:{cacheTtl:86400, cacheEverything:true}});
  if (!upstream.ok) return json({error:"helioviewer_failed", status:upstream.status},502);
  const headers = new Headers(upstream.headers);
  headers.set("cache-control","public, max-age=86400");
  headers.set("access-control-allow-origin","*");
  headers.set("content-type","image/png");
  res = new Response(upstream.body, {status:200, headers});
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
async function handleEarth(request, url, ctx) {
  const date = url.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({error:"date YYYY-MM-DD required"},400);
  if (date < EPIC_START) return json({available:false, reason:"EPIC/DSCOVR starts " + EPIC_START});
  const metaRes = await fetch("https://epic.gsfc.nasa.gov/api/natural/date/" + date, {cf:{cacheTtl:3600, cacheEverything:true}});
  if (!metaRes.ok) return json({error:"epic_meta_failed", status:metaRes.status},502);
  const frames = await metaRes.json();
  if (!Array.isArray(frames) || frames.length===0) return json({available:false, reason:"No EPIC frames that day"});
  const mid = frames[Math.floor(frames.length/2)];
  const [y,m,d] = date.split("-");
  const pngUrl = "https://epic.gsfc.nasa.gov/archive/natural/" + y + "/" + m + "/" + d + "/png/" + mid.image + ".png";
  if (url.searchParams.get("image") !== "1") return json({available:true, date, caption:mid.caption, observedAt:mid.date, image:mid.image, imageUrl:"/api/earth?date=" + date + "&image=1", sourceUrl:pngUrl, frames:frames.length});
  const cacheKey = new Request(pngUrl, {method:"GET"});
  const cache = caches.default;
  let res = await cache.match(cacheKey);
  if (res) return withCors(res);
  const upstream = await fetch(pngUrl, {cf:{cacheTtl:86400, cacheEverything:true}});
  if (!upstream.ok) return json({error:"epic_image_failed", status:upstream.status},502);
  const headers = new Headers();
  headers.set("content-type","image/png");
  headers.set("cache-control","public, max-age=86400");
  headers.set("access-control-allow-origin","*");
  res = new Response(upstream.body, {status:200, headers});
  ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}
function withCors(res){const headers=new Headers(res.headers);headers.set("access-control-allow-origin","*");return new Response(res.body,{status:res.status,headers});}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","access-control-allow-origin":"*","cache-control":"no-store"}});}
