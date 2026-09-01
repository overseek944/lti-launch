export function adminHtml(): string {
  return String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>lti-launch admin</title><style>
:root{--ink:#0f172a;--dim:#475569;--faint:#64748b;--line:#e2e8f0;--bg:#f8fafc;--paper:#fff;
--blue:#2563eb;--mint:#059669;--red:#b91c1c;--amber:#b45309;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
header{background:var(--ink);color:#fff;padding:1.1rem 2rem;display:flex;justify-content:space-between;flex-wrap:wrap;gap:1rem;align-items:center}
header h1{margin:0;font-size:1.05rem}header p{margin:.25rem 0 0;color:#94a3b8;font-size:13px}
header input{font-family:var(--mono);padding:.4rem .5rem;border:1px solid #334155;background:#1e293b;color:#fff;width:18rem}
main{max-width:1140px;margin:0 auto;padding:2rem}
section{background:var(--paper);border:1px solid var(--line);margin-bottom:1.5rem}
section>h2{margin:0;padding:.8rem 1.2rem;border-bottom:1px solid var(--line);
font:700 11.5px/1.4 var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
.body{padding:1.2rem}table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;padding:.45rem 1rem .45rem 0;border-bottom:1px solid var(--ink);
font:700 10.5px/1.4 var(--mono);letter-spacing:.07em;text-transform:uppercase;color:var(--faint)}
td{padding:.6rem 1rem .6rem 0;border-bottom:1px solid var(--line);vertical-align:top}
code{font-family:var(--mono);font-size:12px}
button{border:1px solid var(--ink);background:var(--ink);color:#fff;padding:.45rem .85rem;font-size:13px;font-weight:600;cursor:pointer}
button.ghost{background:transparent;color:var(--ink)}
input.f{padding:.4rem .5rem;border:1px solid var(--line);font-size:13px;width:100%}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:.7rem}
.muted{color:var(--faint);font-size:13px}.ok{color:var(--mint)}.bad{color:var(--red)}.warn{color:var(--amber)}
.badge{display:inline-block;padding:.1rem .45rem;font:700 10.5px/1.5 var(--mono);border:1px solid currentColor}
pre{background:var(--bg);padding:1rem;overflow:auto;font-size:12px;max-height:22rem}
</style></head><body>
<header><div><h1>lti-launch</h1><p>LTI 1.3 Advantage tool. Registrations, launches and score delivery.</p></div>
<div><input id="key" type="password" placeholder="admin key"/><button id="go">Connect</button> <span id="s" class="muted"></span></div></header>
<main>
<section><h2>Register this tool on a platform</h2><div class="body" id="cfg">
<p class="muted">Give these to the platform administrator. Every platform asks for the same five things under different names.</p>
<table id="cfgtable"></table></div></section>
<section><h2>Platform registrations</h2><div class="body" id="regs">Not connected.</div></section>
<section><h2>Recent launches</h2><div class="body" id="launches">Not connected.</div></section>
<section><h2>Score delivery</h2><div class="body" id="deliveries">Not connected.</div></section>
</main>
<script>
const $=i=>document.getElementById(i);let KEY=sessionStorage.getItem("ltiKey")||"";
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const base=location.origin;
$("cfgtable").innerHTML=[["OIDC initiation URL",base+"/lti/login"],["Redirect URI / target link URI",base+"/lti/launch"],
["Public JWKS URL",base+"/.well-known/jwks.json"],["Deep linking URL",base+"/lti/launch"],
["Tool configuration JSON",base+"/.well-known/lti-configuration"]]
.map(([k,v])=>'<tr><td><strong>'+esc(k)+'</strong></td><td><code>'+esc(v)+'</code></td></tr>').join('');
async function api(p,o={}){const r=await fetch("/api"+p,{...o,headers:{"x-admin-key":KEY,"content-type":"application/json",...(o.headers||{})}});
if(!r.ok)throw new Error(await r.text()||r.statusText);return r.json();}
async function refresh(){$("s").textContent="loading…";
try{const[a,b,c]=await Promise.all([api("/registrations"),api("/launches"),api("/deliveries")]);
regs(a.registrations);launches(b.launches);deliveries(c.deliveries);
$("s").innerHTML='<span class="ok">connected</span>';sessionStorage.setItem("ltiKey",KEY);}
catch(e){$("s").innerHTML='<span class="bad">'+esc(e.message)+'</span>';}}
function regs(list){
$("regs").innerHTML=(list.length?'<table><tr><th>Label</th><th>Issuer</th><th>Client ID</th><th>Deployment</th></tr>'+
list.map(r=>'<tr><td>'+esc(r.label)+'</td><td><code>'+esc(r.issuer)+'</code></td><td><code>'+esc(r.client_id)+
'</code></td><td><code>'+esc(r.deployment_id)+'</code></td></tr>').join('')+'</table>':'<p class="muted">No registrations yet.</p>')+
'<div class="grid" style="margin-top:1.2rem">'+
['label','issuer','clientId','deploymentId','authLoginUrl','authTokenUrl','jwksUrl']
.map(f=>'<input class="f" id="f_'+f+'" placeholder="'+f+'"/>').join('')+
'</div><button id="add" style="margin-top:.8rem">Add registration</button>'+
'<p class="muted">Tenancy is keyed on issuer + client ID + deployment ID together. One platform issuer can host several deployments; keying on the issuer alone puts two districts in one tenant.</p>';
$("add").addEventListener("click",async()=>{const b={};
['label','issuer','clientId','deploymentId','authLoginUrl','authTokenUrl','jwksUrl'].forEach(f=>b[f]=$("f_"+f).value.trim());
try{await api("/registrations",{method:"POST",body:JSON.stringify(b)});refresh();}catch(e){alert(e.message);}});}
function launches(list){$("launches").innerHTML=list.length?'<table><tr><th>When</th><th>Who</th><th>Type</th><th>Context</th><th></th></tr>'+
list.map(l=>'<tr><td class="muted">'+esc(String(l.created_at).slice(5,19).replace("T"," "))+'</td>'+
'<td>'+esc(l.name||'(no name shared)')+'<br><span class="muted">'+esc(l.role)+'</span></td>'+
'<td><code>'+esc(l.message_type)+'</code></td><td>'+esc(l.context_title||'-')+'</td>'+
'<td><button class="ghost" data-l="'+esc(l.id)+'">Roster</button></td></tr>').join('')+'</table><div id="rost"></div>'
:'<p class="muted">No launches yet.</p>';
document.querySelectorAll("[data-l]").forEach(b=>b.addEventListener("click",async()=>{
$("rost").innerHTML='<p class="muted">fetching from the platform…</p>';
try{const r=await api("/launches/"+b.dataset.l+"/roster",{method:"POST"});
$("rost").innerHTML='<p class="muted">'+esc(r.contextTitle||'')+' — '+r.members.length+' members, fetched live from the platform</p><pre>'+esc(JSON.stringify(r.members.slice(0,10),null,1))+'</pre>';}
catch(e){$("rost").innerHTML='<p class="bad">'+esc(e.message)+'</p>';}}));}
function deliveries(list){$("deliveries").innerHTML=list.length?'<table><tr><th>When</th><th>Who</th><th>Score</th><th>State</th><th>HTTP</th><th>Timestamp sent</th></tr>'+
list.map(d=>'<tr><td class="muted">'+esc(String(d.created_at).slice(5,19).replace("T"," "))+'</td>'+
'<td>'+esc(d.name||d.subject)+'</td><td class="mono">'+d.score+' / '+d.max_score+'</td>'+
'<td><span class="badge '+(d.state==="accepted"?"ok":d.state==="superseded"?"warn":"bad")+'">'+esc(d.state)+'</span></td>'+
'<td><code>'+esc(d.http_status)+'</code></td><td><code>'+esc(d.sent_timestamp)+'</code></td></tr>').join('')+'</table>'+
'<p class="muted">Timestamps are strictly increasing per user and line item. A retry that reuses the original timestamp is rejected as stale, which is why a 409 is recorded as superseded rather than retried.</p>'
:'<p class="muted">No scores delivered yet.</p>';}
$("go").addEventListener("click",()=>{KEY=$("key").value.trim();refresh();});
$("key").addEventListener("keydown",e=>{if(e.key==="Enter")$("go").click();});
if(KEY){$("key").value=KEY;refresh();}
</script></body></html>`;
}
