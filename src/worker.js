const EPIC_START="2015-06-13",SDO_START="2010-06-02",SOHO_START="1996-01-16";
export default{async fetch(request,env,ctx){const url=new URL(request.url);const p=url.pathname;
if(p==="/api/sun")return sun(url,ctx);if(p==="/api/earth")return earth(url,ctx);
if(p==="/api/meta")return j({sohoStart:SOHO_START,sdoStart:SDO_START,epicStart:EPIC_START});
if(p==="/"||p==="/index.html"){const html=await env.SPACE_HTML.get("index.html");if(!html)return new Response("UI pending",{status:503});return new Response(html,{headers:{"content-type":"text/html;charset=utf-8","cache-control":"no-store","x-robots-tag":"noindex"}});}
return new Response("Not found",{status:404});}};
async function sun(url,ctx){const date=url.searchParams.get("date"),sourceId=url.searchParams.get("sourceId");
if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))return j({error:"date"},400);if(!sourceId||!/^\d+$/.test(sourceId))return j({error:"sourceId"},400);
const sid=+sourceId,iso=date+"T12:00:00Z",imageScale=sid===4||sid===5?11.9:sid>=8&&sid<=19?2.4:2.63;
const hv=new URL("https://api.helioviewer.org/v2/takeScreenshot/");
hv.searchParams.set("date",iso);hv.searchParams.set("imageScale",String(imageScale));hv.searchParams.set("layers","["+sid+",1,100]");
hv.searchParams.set("x0","0");hv.searchParams.set("y0","0");hv.searchParams.set("width","768");hv.searchParams.set("height","768");hv.searchParams.set("display","true");hv.searchParams.set("watermark","false");
const key=new Request(hv.toString());let res=await caches.default.match(key);if(res)return cors(res);
const up=await fetch(hv.toString(),{headers:{accept:"image/png,*/*"},cf:{cacheTtl:86400,cacheEverything:true}});if(!up.ok)return j({error:"helioviewer_failed",status:up.status},502);
const h=new Headers(up.headers);h.set("cache-control","public,max-age=86400");h.set("access-control-allow-origin","*");h.set("content-type","image/png");
res=new Response(up.body,{status:200,headers:h});ctx.waitUntil(caches.default.put(key,res.clone()));return res;}
async function earth(url,ctx){const date=url.searchParams.get("date");if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))return j({error:"date"},400);
if(date<EPIC_START)return j({available:false,reason:"EPIC/DSCOVR starts "+EPIC_START});
const metaRes=await fetch("https://epic.gsfc.nasa.gov/api/natural/date/"+date,{cf:{cacheTtl:3600,cacheEverything:true}});if(!metaRes.ok)return j({error:"epic_meta_failed",status:metaRes.status},502);
const frames=await metaRes.json();if(!Array.isArray(frames)||!frames.length)return j({available:false,reason:"No EPIC frames that day"});
const mid=frames[Math.floor(frames.length/2)],[y,m,d]=date.split("-");
const pngUrl="https://epic.gsfc.nasa.gov/archive/natural/"+y+"/"+m+"/"+d+"/png/"+mid.image+".png";
if(url.searchParams.get("image")!=="1")return j({available:true,date,caption:mid.caption,observedAt:mid.date,image:mid.image,imageUrl:"/api/earth?date="+date+"&image=1",sourceUrl:pngUrl,frames:frames.length});
const key=new Request(pngUrl);let res=await caches.default.match(key);if(res)return cors(res);
const up=await fetch(pngUrl,{cf:{cacheTtl:86400,cacheEverything:true}});if(!up.ok)return j({error:"epic_image_failed",status:up.status},502);
const h=new Headers();h.set("content-type","image/png");h.set("cache-control","public,max-age=86400");h.set("access-control-allow-origin","*");
res=new Response(up.body,{status:200,headers:h});ctx.waitUntil(caches.default.put(key,res.clone()));return res;}
function cors(res){const h=new Headers(res.headers);h.set("access-control-allow-origin","*");return new Response(res.body,{status:res.status,headers:h});}
function j(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json;charset=utf-8","access-control-allow-origin":"*","cache-control":"no-store"}});}
