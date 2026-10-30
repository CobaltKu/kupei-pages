(function(){
'use strict';
var $=function(id){return document.getElementById(id);};
function bootFail(err){
  $('loading').hidden=true;
  document.querySelectorAll('.page').forEach(function(p){p.classList.toggle('on',p.id==='pg-home');});
  var e=$('h-err');e.hidden=false;
  e.firstElementChild.textContent='資料載入失敗：無法讀取首頁資料（'+(err&&err.message?err.message:'未知錯誤')+'）。';
  $('h-wrap').style.display='none';
  $('h-retry').onclick=function(){location.reload();};
}
$('loading').hidden=false;
/* 行情與評分並行；首頁資料到了之後最多再等行情 600ms，讓第一次畫面就有收盤價（不先畫「—」再整欄改寫） */
var homeP=KupeiAPI.home(),quoteP=KupeiAPI.req('GET','/quotes').catch(function(){return null;});
var quoteSoon=homeP.then(function(){return Promise.race([quoteP,new Promise(function(r){setTimeout(function(){r(null);},600);})]);},function(){return null;});
/* 估價（約 644 KB）與評分並行，但不擋首頁：首頁資料到了之後同樣最多再等 600ms，趕上就第一次畫面帶估價（只整表畫一次），趕不上由 vaStart 晚到再補 */
var valP=KupeiAPI.req('GET','/valuation').catch(function(){return null;});
var valSoon=homeP.then(function(){return Promise.race([valP,new Promise(function(r){setTimeout(function(){r(null);},600);})]);},function(){return null;});
Promise.all([homeP,KupeiAPI.status(),KupeiAPI.notes(),KupeiAPI.req('GET','/watchlist').catch(function(){return {ok:false};}),KupeiAPI.req('GET','/auth/session').catch(function(){return {ok:false};}),KupeiAPI.req('GET','/settings/news').catch(function(){return {ok:false};}),quoteSoon,valSoon]).then(function(res){
  $('loading').hidden=true;$('h-err').hidden=true;$('h-wrap').style.display='';
  main(res[0],res[1]||{},res[2],{watch:res[3],auth:res[4],news:res[5],quotes:res[6],val:res[7]});
}).catch(function(err){if(window.console)console.error(err);bootFail(err);}); /* main 內的例外也要接住，不讓畫面卡在半初始化 */

function main(S,STAT,TRN,SB){
var H=S.head, MJ=S.majors;
/* Pages 部署（2026-10-26）：前端在 GitHub Pages，資料來自後端 Server API；自選與設定存本機、登入後依帳號同步；沒有的功能顯示「尚未提供」 */
var PAGES=!!(window.KUPEI_CONFIG&&window.KUPEI_CONFIG.mode==='pages');
var OFFZH='此功能尚未提供（後端未承接，待確認）。';
var PXL='成交價'; /* 欄位名稱依 UI 規格 B2／答 6 固定為「成交價」；Pages 版價格是每日收盤或盤中快照，由旁邊的標示線說明（收盤價 M/D・非即時／盤中 HH:MM）。tooltip 用 pxWord() 說明實際是哪一種 */
var COLORS=['#FDC04E','#4D9BE0','#F9827F','#B79CFF','#3FC1C9'];
var MAJ=MJ.map(function(m){return m.en;});
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
/* 數字格式（與 kupei-client fmtPrice 一致）：1,000 以上整數不帶小數、非整數一位；1,000 以下兩位；null／非數字一律「—」 */
function fmt(p,d){if(p==null||p===''||!isFinite(p))return '—';p=+p;if(d==null)d=p>=1000?(Number.isInteger(p)?0:1):2;return p.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});}
/* 漲跌幅：正數帶「+」；四捨五入後為 0 不帶正負號（避免 +0.0%／-0.0%） */
function pct(x,d){if(x==null||x===''||!isFinite(x))return '—';var t=(+x).toFixed(d==null?1:d);if(+t===0)return t.replace('-','')+'%';return (+t>0?'+':'')+t+'%';}
function lsGet(k){try{return localStorage.getItem(k);}catch(e){return null;}}
function lsSet(k,v){try{localStorage.setItem(k,v);}catch(e){}}

/* ---------- 中文對照：UI/ui_note_translations.json（由後端提供）；未收錄者顯示「待查：代碼」 ---------- */
var TR=TRN||{};
var TR_OK=!!TRN;
function tr1(code){if(TR[code]!=null)return TR[code];return '待查：'+code;}
function trList(codes){var seen={},out=[];(codes||[]).forEach(function(c){String(c).split('|').forEach(function(x){x=x.trim();if(!x||seen[x])return;seen[x]=1;out.push(x);});});return out;}
function trHtml(codes){return trList(codes).map(function(c){return '<span title="'+esc(c)+'">'+esc(tr1(c))+'</span>';}).join('；');}
var STATUS={TRIAL_SCORE:'',POLICY_SCORE:'政策分',UNAVAILABLE:'分數不可得',NOT_APPLICABLE:'不適用',OUT_OF_SCOPE_FINANCIAL:'本模型不適用此財報範圍',CONFIGURATION_PENDING:'規則設定待確認',NOT_ENABLED:'功能未啟用',SCOPE_UNVERIFIED:'適用範圍待確認',NOT_ANNUAL_PERIOD:'非年度計分期',DIAGNOSTIC:'診斷資訊（不計分）',ADJUSTMENT:'調整資訊',ADJUSTMENT_NOT_EVALUATED:'調整尚未評估',MISSING_ROW:'結果未提供'};
var CODE={UNAVAILABLE:'Ab',NOT_APPLICABLE:'NA',OUT_OF_SCOPE_FINANCIAL:'NA',CONFIGURATION_PENDING:'RC',NOT_ENABLED:'FD',SCOPE_UNVERIFIED:'SU'};
STATUS.NOT_ASSESSED='未評估';STATUS.MISSING_ROW='結果未提供';
/* 交付資料的版本與 Gate 模式一律取後端（V1.0 §0）；未提供時明示 */
var GATE_MODE=STAT.gate_execution_mode||null;
var GATE_LABEL=GATE_MODE==='Production'?'正式 Gate':(GATE_MODE?'Gate '+GATE_MODE:'Gate 執行模式未提供');
/* ---------- data ---------- */
var ROWS=S.rows;
var BYID={};ROWS.forEach(function(r){BYID[r.id]=r;});
/* 金融保險業（分數狀態為 OUT_OF_SCOPE_FINANCIAL）預設不列出（V1.0 C2） */
var MARKET=ROWS.filter(function(r){return !r.fin;});
var FID2NAME={};MJ.forEach(function(m){FID2NAME[m.id]=m.en;});

/* ---------- 估價與行情：尚未交付（K2／T3、FinMind 契約）；依 I5、I6 顯示「—」，不產生示意值 ---------- */
/* ---------- 估價與行情：依 T3、T4 端點；未啟用或不可得時依 I5、I6 顯示「—」 ---------- */
function sim(id){
  var q=(typeof QT!=='undefined'&&QT.map[id])||null,v=(typeof VAL!=='undefined'&&VAL.on&&VAL.map[id])||null,ok=v&&v.status==='OK',part=v&&v.status==='PARTIAL';
  return {price:q&&q.status!=='REALTIME_UNAVAILABLE'?q.price:null,prev:q?q.prev_close:null,chgPct:q?q.change_pct:null,qst:q?q.status:null,qtime:q?q.source_time:null,
    typ:ok||part?v.center:null,part:!!part,min:ok?v.lower:null,max:ok?v.upper:null,cap:ok?v.data_cap:null,gn:v?v.implied_growth:null,gflag:v?v.implied_growth_flag:null,flags:v?(v.flags||[]):[],vst:v?v.status:null};
}
function margin(o){return (o.typ!=null&&o.typ>0&&o.price!=null)?(o.typ-o.price)/o.typ*100:null;}
// T3 PARTIAL（2026-10-24 CoKu 核定）：只有中心值，安全邊際加「*」標記
function mgTxt(o,mg){return esc(pct(mg))+(o.part&&mg!=null?'<sup class="pmk" title="僅中心值：估價區間不完整或次序異常，不提供上下限">*</sup>':'');}
function mgStyle(mg){return 'color:'+(mg==null?'var(--muted)':chgColor(mg));}
function gnHtml(o){if(o.gflag)return '<span class="gflag" title="'+esc(tr1(o.gflag))+'">'+(o.gflag==='IMPLIED_GROWTH_ABOVE_SEARCH_RANGE'?'&gt;300%':(o.gflag==='IMPLIED_GROWTH_BELOW_SEARCH_RANGE'?'&lt;−50%':'N/A'))+'</span>';return o.gn==null?'—':(o.gn*100).toFixed(1)+'%';}
function hhmm(d){return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');}
function chgColor(x){return x>0.005?'var(--up)':(x<-0.005?'var(--down)':'#8C959E');}

/* ---------- stores：自選、新聞與報告設定暫存本機瀏覽器（後端寫入端點待 K8／K9／K14） ---------- */
var GMAX=50; /* V1.0 B5：每組上限 50 */
var W=null,NS=null,RS=null;
var LS='kupei3_';
/* 本機資料可能來自雲端文件同步（可被改寫）：讀入時做結構驗證，不合格的欄位丟棄或修正，整份壞掉退回預設 */
function isObj(o){return !!o&&typeof o==='object'&&!Array.isArray(o);}
function isGid(x){return typeof x==='number'&&x>0&&x<=1e6&&Math.floor(x)===x;}
function isSid(x){return typeof x==='string'&&/^[0-9A-Za-z]{1,10}$/.test(x)&&!!BYID[x];}
function strList(a,max,len){var out=[];if(!Array.isArray(a))return out;a.forEach(function(s){if(typeof s!=='string')return;s=s.trim().slice(0,len||50);if(s&&out.indexOf(s)<0&&out.length<max)out.push(s);});return out;}
function cleanW(raw){
  var seen={},gids={},groups=[];
  if(isObj(raw)&&Array.isArray(raw.groups))raw.groups.forEach(function(g){
    if(!isObj(g)||!isGid(g.id)||gids[g.id]||groups.length>=5)return;gids[g.id]=1;
    var ids=[];(Array.isArray(g.ids)?g.ids:[]).forEach(function(x){if(isSid(x)&&!seen[x]&&ids.length<GMAX){seen[x]=1;ids.push(x);}});
    var nm=typeof g.name==='string'?g.name.trim().slice(0,12):'';
    groups.push({id:g.id,name:nm||('自選'+g.id),ids:ids});
  });
  if(!groups.length)return {groups:[{id:1,name:'自選1',color:COLORS[0],ids:[]}],cur:1};
  groups.forEach(function(g,i){g.color=COLORS[i%5];});
  return {groups:groups,cur:groups.some(function(g){return g.id===raw.cur;})?raw.cur:groups[0].id};
}
function cleanKw(o,max){return {kw:strList(o&&o.kw,max),ex:strList(o&&o.ex,5)};}
function cleanNS(raw){
  var ns={span:1,groups:[],stock:{}};if(!isObj(raw))return ns;
  if(raw.span===1||raw.span===3)ns.span=raw.span;
  var gids={};(Array.isArray(raw.groups)?raw.groups:[]).forEach(function(g){if(!isObj(g)||!isGid(g.id)||gids[g.id])return;gids[g.id]=1;var k=cleanKw(g,5);ns.groups.push({id:g.id,kw:k.kw,ex:k.ex});});
  if(isObj(raw.stock))Object.keys(raw.stock).forEach(function(id){if(isSid(id)&&isObj(raw.stock[id]))ns.stock[id]=cleanKw(raw.stock[id],5);});
  if(raw.disabled!=null)ns.disabled=strList(raw.disabled,200,100);
  return ns;
}
function cleanRS(raw){
  var rs={},fids=MJ.map(function(m){return m.id;});if(!isObj(raw))return rs;
  Object.keys(raw).forEach(function(id){var s=raw[id];if(!isSid(id)||!isObj(s))return;
    rs[id]={kw:strList(s.kw,10),time:typeof s.time==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s.time)?s.time:'',news:s.news!==false,focus:strList(s.focus,fids.length,50).filter(function(f){return fids.indexOf(f)>=0;}),cmp:s.cmp!==false};
    if(typeof s.status==='string')rs[id].status=s.status.slice(0,40);});
  return rs;
}
function lsJson(k){try{return JSON.parse(lsGet(k)||'null');}catch(e){return null;}}
function loadAll(){
  try{W=cleanW(lsJson(LS+'watch'));}catch(e){W=cleanW(null);}
  try{NS=cleanNS(lsJson(LS+'news'));}catch(e){NS=cleanNS(null);}
  try{RS=cleanRS(lsJson(LS+'report'));}catch(e){RS={};}
}
function saveW(){lsSet(LS+'watch',JSON.stringify(W));}
function nextColor(){var used=W.groups.map(function(g){return g.color;});for(var i=0;i<COLORS.length;i++)if(used.indexOf(COLORS[i])<0)return COLORS[i];return COLORS[0];}
function saveNS(){lsSet(LS+'news',JSON.stringify(NS));}
function saveRS(){lsSet(LS+'report',JSON.stringify(RS));}
loadAll();

/* ================= 後端連線（V1.0 J1、A7b；需求 V1 第 0、6 節） ================= */
var SRV={mode:'local',auth:false,wver:0,nsVer:null,savedNews:null,stockVer:{},savedStock:{},stockLoading:{},rsVer:{},savedRS:{},rsLoading:{},pending:null};
var ERRZH={GROUP_FULL:'該群組已滿 50 家',GROUP_LIMIT:'已達 5 組上限',MEMBER_SET_MISMATCH:'群組內容已變更，已重新載入',STOCK_NOT_WATCHED:'只有自選公司可以修改設定',INVALID_SCHEDULE_RANGE:'排程須介於現在與 11 個月內',INVALID_SCHEDULE:'排程時間格式不正確',LOGIN_RATE_LIMIT:'登入嘗試過多，請稍後再試'};
function errMsg(r){var d=r&&r.data||{};return ERRZH[d.error_code]||d.message_zh||('HTTP '+(r?r.status:'?'));}
function uuid(){try{if(window.crypto&&crypto.randomUUID)return crypto.randomUUID();}catch(e){}return 'k'+Date.now().toString(36)+Math.random().toString(36).slice(2,10);}
function wFromServer(w){
  SRV.wver=w.version;
  var created=w.groups.slice().sort(function(a,b){return a.created_at<b.created_at?-1:a.created_at>b.created_at?1:(a.group_id<b.group_id?-1:1);});
  var col={};created.forEach(function(g,i){col[g.group_id]=COLORS[i%5];});
  var cur=W?W.cur:null;
  W={groups:w.groups.map(function(g){return {id:g.group_id,name:g.name,color:col[g.group_id],ids:g.members.map(function(m){return m.stock_id;}).filter(function(s){return BYID[s];})};}),cur:cur};
  if(!W.groups.some(function(g){return g.id===W.cur;}))W.cur=W.groups[0]?W.groups[0].id:null;
}
function reloadW(done){KupeiAPI.req('GET','/watchlist').then(function(r){if(r.ok){wFromServer(r.data);reRender();}if(done)done();});}
/* 寫入：未登入先登入；版本衝突重新載入；連線中斷先重新查詢，不自動重送（J1） */
function srvWrite(method,path,body,opt,onOk){
  opt=opt||{};
  if(!SRV.auth&&!opt.local){showLogin(function(){srvWrite(method,path,body,opt,onOk);});return;}
  var h={};if(opt.ver!=null)h['If-Match']=String(opt.ver);if(opt.idem)h['Idempotency-Key']=opt.idem;
  KupeiAPI.req(method,path,body,h).then(function(r){
    if(r.status===401){SRV.auth=false;showLogin(function(){srvWrite(method,path,body,opt,onOk);});return;}
    if(!r.ok){
      var code=r.data&&r.data.error_code;
      if(code==='VERSION_CONFLICT'||code==='MEMBER_SET_MISMATCH'){if(opt.onConflict)opt.onConflict();else reloadW();toast('資料已在其他裝置更新，已重新載入，請再操作一次');return;}
      var cur=r.data&&r.data.detail&&r.data.detail.current;if(cur&&cur.groups){wFromServer(cur);reRender();}
      toast('儲存失敗：'+errMsg(r));if(opt.onFail)opt.onFail(r);return;
    }
    onOk(r.data);
  },function(){toast('儲存結果不明（連線中斷），已重新查詢');if(opt.onConflict)opt.onConflict();else reloadW();});
}
function wW(method,path,body,opt,onOk){opt=opt||{};opt.ver=SRV.wver;srvWrite(method,path,body,opt,onOk);}
function srvSetGroup(id,gid){
  var prev=groupOf(id),tg=W.groups.filter(function(x){return x.id===gid;})[0];
  wW('PUT','/watchlist/members/'+encodeURIComponent(id),{group_id:gid},null,function(w){
    wFromServer(w);loadStockNews(id,true);closeMenu();reRender(id);
    toast(prev?'已從 '+prev.name+' 移到 '+tg.name:'已加入 '+tg.name);
  });
}
function srvNewGroup(then){
  var before=W.groups.map(function(g){return g.id;});
  wW('POST','/watchlist/groups',{name:'自選'+(W.groups.length+1)},{idem:uuid()},function(w){
    wFromServer(w);var ng=W.groups.filter(function(g){return before.indexOf(g.id)<0;})[0];
    if(then&&ng)then(ng);else reRender();
  });
}
function srvRemove(id){
  var g=groupOf(id);if(!g)return;
  wW('DELETE','/watchlist/members/'+encodeURIComponent(id),null,null,function(res){
    SRV.wver=res.version;g.ids.splice(g.ids.indexOf(id),1);closeMenu();reRender(id);
    toast('已從 '+g.name+' 移出 '+BYID[id].name,function(){
      wW('PUT','/watchlist/members/'+encodeURIComponent(id),{group_id:res.group_id,position:res.position},null,function(w){wFromServer(w);reRender(id);toast('已復原');});
    });
  });
}
function srvDeleteGroup(gid){
  wW('DELETE','/watchlist/groups/'+encodeURIComponent(gid),null,null,function(res){
    wFromServer(res.watchlist);W.cur=W.groups[0]?W.groups[0].id:null;closeMenu();wRender();
    var n=res.deleted.members.length;
    toast('已刪除「'+res.deleted.name+'」'+(n?'，移出 '+n+' 家':''),function(){
      wW('POST','/watchlist/groups/'+encodeURIComponent(gid)+'/restore',null,null,function(r2){
        wFromServer(r2.watchlist);W.cur=gid;wRender();
        toast(r2.skipped_members&&r2.skipped_members.length?'已復原；'+r2.skipped_members.length+' 家已在其他群組或超過上限，未放回':'已復原');
      });
    });
  });
}
function srvRename(gid,name){wW('PATCH','/watchlist/groups/'+encodeURIComponent(gid),{name:name},null,function(w){wFromServer(w);wRender();});}
function srvReorder(gid,ids){wW('PUT','/watchlist/groups/'+encodeURIComponent(gid)+'/order',{stock_ids:ids},null,function(w){wFromServer(w);wRender();});}
/* 伺服器模式攔截自選相關點擊（群組代碼為字串，不轉數字） */
document.addEventListener('click',function(e){
  if(SRV.mode!=='server')return;
  var t=e.target.closest('button,a');if(!t)return;var d=t.dataset,hit=true;
  if(d.setg){if(t.getAttribute('aria-disabled')==='true')toast('該群組已滿 '+GMAX+' 家');else srvSetGroup(d.id,d.setg);}
  else if(d.newg){if(W.groups.length<5){var sid=d.newg;srvNewGroup(function(ng){srvSetGroup(sid,ng.id);});}}
  else if(d.rmg){srvRemove(d.rmg);}
  else if(d.tab){W.cur=d.tab;wRender();}
  else if(d.gmenu){openGroupMenu(d.gmenu,t);}
  else if(d.gdel){confirmDelete(d.gdel);}
  else if(d.gdelok){srvDeleteGroup(d.gdelok);}
  else if(d.addtab){if(W.groups.length<5)srvNewGroup(function(ng){W.cur=ng.id;wRender();});}
  else hit=false;
  if(hit){e.stopPropagation();e.preventDefault();}
},true);

/* ---------- 新聞與報告設定 ---------- */
function newsValue(){return {industry_default_window_days:NS.span||1,industry_groups:NS.groups.map(function(g,i){return {id:g.id,keywords:g.kw,excludes:g.ex,position:i};}),disabled_sources:NS.disabled||[]};}
function newsFromServer(r){SRV.nsVer=r.version;var v=r.value||{};NS.span=v.industry_default_window_days||1;NS.disabled=v.disabled_sources||[];NS.groups=(v.industry_groups||[]).slice().sort(function(a,b){return (a.position||0)-(b.position||0);}).map(function(g){return {id:g.id,kw:g.keywords||[],ex:g.excludes||[]};});SRV.savedNews=JSON.stringify(newsValue());}
function loadStockNews(id,force){
  if(SRV.mode!=='server'||(!force&&(SRV.stockVer[id]!=null||SRV.stockLoading[id])))return;
  SRV.stockLoading[id]=true;
  KupeiAPI.req('GET','/settings/news/stocks/'+encodeURIComponent(id)).then(function(r){
    SRV.stockLoading[id]=false;if(!r.ok)return;var v=r.data.value||{};
    NS.stock[id]={kw:v.keywords||[],ex:v.excludes||[]};SRV.stockVer[id]=r.data.version;SRV.savedStock[id]=JSON.stringify(NS.stock[id]);
    if(curPage==='news-settings')nsRender();else if(curPage==='report-settings')rsRender();else if(curPage==='stock'&&SP.id===id)sNews(id);
  });
}
var _saveNS=saveNS;
saveNS=function(){
  if(SRV.mode!=='server'){_saveNS();return;}
  var nv=newsValue(),js=JSON.stringify(nv);
  if(js!==SRV.savedNews){
    srvWrite('PUT','/settings/news',nv,{ver:SRV.nsVer,onConflict:function(){KupeiAPI.req('GET','/settings/news').then(function(r){if(r.ok){newsFromServer(r.data);if(curPage==='news-settings')nsRender();}});}},function(res){newsFromServer(res);});
  }
  Object.keys(NS.stock).forEach(function(id){
    if(SRV.stockVer[id]==null||!groupOf(id))return;
    var s=JSON.stringify(NS.stock[id]);if(s===SRV.savedStock[id])return;
    srvWrite('PUT','/settings/news/stocks/'+encodeURIComponent(id),{keywords:NS.stock[id].kw,excludes:NS.stock[id].ex},{ver:SRV.stockVer[id],onConflict:function(){loadStockNews(id,true);}},function(res){SRV.stockVer[id]=res.version;SRV.savedStock[id]=s;});
  });
};
var _stockKw=stockKw;
stockKw=function(id){if(SRV.mode==='server'){loadStockNews(id);if(!NS.stock[id])return {kw:[],ex:[],loading:true};return NS.stock[id];}return _stockKw(id);};
function rsToServer(s){return {keywords:s.kw,include_news:s.news,compare_previous:s.cmp,focus_majors:s.focus,schedule_at:s.time?s.time+':00+08:00':null};}
function loadRS(id,force){
  if(SRV.mode!=='server'||(!force&&(SRV.rsVer[id]!=null||SRV.rsLoading[id])))return;
  SRV.rsLoading[id]=true;
  KupeiAPI.req('GET','/settings/reports/'+encodeURIComponent(id)).then(function(r){
    SRV.rsLoading[id]=false;if(!r.ok)return;var v=r.data.value||{};
    var kw=v.keywords&&v.keywords.length?v.keywords:(r.data.version?[]:(NS.stock[id]?NS.stock[id].kw.slice(0,10):[]));
    RS[id]={kw:kw,time:v.schedule_at?String(v.schedule_at).slice(0,16):'',news:v.include_news!==false,focus:v.focus_majors||[],cmp:v.compare_previous!==false,status:v.schedule_status||null};
    SRV.rsVer[id]=r.data.version;SRV.savedRS[id]=JSON.stringify(rsToServer(RS[id]));
    if(curPage==='report-settings')rsRender();
  });
}
var _saveRS=saveRS;
saveRS=function(){
  if(SRV.mode!=='server'){_saveRS();return;}
  Object.keys(RS).forEach(function(id){
    if(SRV.rsVer[id]==null||!groupOf(id))return;
    var body=rsToServer(RS[id]),js=JSON.stringify(body);if(js===SRV.savedRS[id])return;
    srvWrite('PUT','/settings/reports/'+encodeURIComponent(id),body,{ver:SRV.rsVer[id],onConflict:function(){loadRS(id,true);},onFail:function(){loadRS(id,true);}},function(res){SRV.rsVer[id]=res.version;SRV.savedRS[id]=js;RS[id].status=(res.value||{}).schedule_status||null;if(curPage==='report-settings')rsRender();});
  });
};
var _rsGet=rsGet;
rsGet=function(id){if(SRV.mode==='server'){loadRS(id);if(!RS[id])return {kw:[],time:'',news:true,focus:[],cmp:true,loading:true};return RS[id];}return _rsGet(id);};

/* ---------- 登入（D-1） ---------- */
function showLogin(then){
  SRV.pending=then||null;
  $('menuHost').innerHTML='<button class="backdrop" data-lgcancel="1" aria-label="取消"></button><div class="modal" role="dialog" aria-label="登入"><h2>登入後才能修改資料</h2><p style="color:var(--text2);line-height:1.6;margin:0">自選、設定與個股問題存在主機，修改前需要登入；登入會記住 30 天。</p><label class="sr" for="lg-pw">密碼</label><input class="inp" id="lg-pw" type="password" autocomplete="current-password" placeholder="密碼" style="width:100%"><div id="lg-msg" style="color:var(--warn);font-size:12px;min-height:16px"></div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" data-lgcancel="1">取消</button><button class="btn primary" data-lgok="1">登入</button></div></div>';
  setTimeout(function(){var p=$('lg-pw');if(p)p.focus();},0);
}
function doLogin(){
  var pw=$('lg-pw').value;if(!pw){$('lg-pw').focus();return;}
  $('lg-msg').textContent='登入中…';
  KupeiAPI.req('POST','/auth/login',{password:pw}).then(function(r){
    if(!r.ok){$('lg-msg').textContent=r.status===401?'密碼不正確':errMsg(r);return;}
    SRV.auth=true;closeMenu();toast('已登入');var f=SRV.pending;SRV.pending=null;if(curPage==='status')stRender();if(f)f();
  },function(){$('lg-msg').textContent='連線失敗，請重試';});
}
document.addEventListener('click',function(e){var t=e.target.closest('[data-lgok],[data-lgcancel],[data-logout],[data-login],[data-import]');if(!t)return;
  if(t.dataset.lgok)doLogin();else if(t.dataset.lgcancel){SRV.pending=null;closeMenu();}
  else if(t.dataset.login)showLogin(function(){if(curPage==='status')stRender();});
  else if(t.dataset.logout)srvWrite('POST','/auth/logout',{},{},function(){SRV.auth=false;toast('已登出');stRender();});
  else if(t.dataset.import)doImport();});
document.addEventListener('keydown',function(e){if(e.target&&e.target.id==='lg-pw'&&e.key==='Enter')doLogin();});

/* ---------- 本機資料一次性匯入（需求 V1 K14-3） ---------- */
function localData(){var w=null,n=null,r=null;try{w=lsJson(LS+'watch');w=w?cleanW(w):null;n=lsJson(LS+'news');n=n?cleanNS(n):null;r=lsJson(LS+'report');r=r?cleanRS(r):null;}catch(e){}return {w:w,n:n,r:r};}
function importAvailable(){
  if(SRV.mode!=='server'||lsGet(LS+'imported'))return false;
  var srvEmpty=W.groups.every(function(g){return !g.ids.length;})&&!NS.groups.length;
  var L=localData(),hasW=L.w&&L.w.groups&&L.w.groups.some(function(g){return g.ids&&g.ids.length;}),hasN=L.n&&L.n.groups&&L.n.groups.length;
  return srvEmpty&&(hasW||hasN);
}
function importBanner(){var b=$('w-import');if(!b)return;b.hidden=!importAvailable();}
function doImport(){
  if(!SRV.auth){showLogin(doImport);return;}
  var L=localData(),imp=lsGet(LS+'import_id');if(!imp){imp=uuid();lsSet(LS+'import_id',imp);}
  var steps=[],fail=0,done=0;
  (L.w&&L.w.groups||[]).forEach(function(g){var ids=(g.ids||[]).filter(function(s){return BYID[s];});if(!ids.length)return;
    steps.push(function(next){
      var existing=W.groups.filter(function(x){return x.name===g.name;})[0];
      function addAll(gid){var i=0;(function one(){if(i>=ids.length){next();return;}var sid=ids[i++];if(groupOf(sid)){one();return;}
        srvWrite('PUT','/watchlist/members/'+encodeURIComponent(sid),{group_id:gid},{ver:SRV.wver,onFail:function(){fail++;one();},onConflict:function(){reloadW(one);}},function(w){wFromServer(w);done++;one();});})();}
      if(existing)addAll(existing.id);
      else{var before=W.groups.map(function(x){return x.id;});
        srvWrite('POST','/watchlist/groups',{name:String(g.name||'自選').slice(0,12)},{ver:SRV.wver,idem:'import-'+imp+'-'+g.id,onFail:function(){fail++;next();},onConflict:function(){reloadW(next);}},function(w){wFromServer(w);var ng=W.groups.filter(function(x){return before.indexOf(x.id)<0;})[0]||W.groups.filter(function(x){return x.name===g.name;})[0];if(ng)addAll(ng.id);else next();});}
    });});
  if(L.n&&L.n.groups&&L.n.groups.length)steps.push(function(next){NS.groups=L.n.groups.map(function(g){return {id:g.id,kw:g.kw||[],ex:g.ex||[]};});NS.span=L.n.span||1;
    srvWrite('PUT','/settings/news',newsValue(),{ver:SRV.nsVer,onFail:function(){fail++;next();},onConflict:next},function(res){newsFromServer(res);next();});});
  steps.push(function(next){Object.keys((L.n&&L.n.stock)||{}).forEach(function(id){if(groupOf(id)&&L.n.stock[id]){loadStockNews(id,true);}});setTimeout(function(){Object.keys((L.n&&L.n.stock)||{}).forEach(function(id){if(groupOf(id)&&SRV.stockVer[id]!=null)NS.stock[id]={kw:L.n.stock[id].kw||[],ex:L.n.stock[id].ex||[]};});saveNS();next();},800);});
  (function run(i){if(i>=steps.length){if(!fail)lsSet(LS+'imported',new Date().toISOString());importBanner();reRender();toast(fail?'匯入完成，但有 '+fail+' 項失敗；可再按一次匯入（不會重複新增）':'已匯入這台瀏覽器的自選與設定（'+done+' 家）');return;}steps[i](function(){run(i+1);});})(0);
}

/* ================= 行情（T4：每 30 秒抓取＋SSE；I6） ================= */
var QT={on:false,st:null,map:{},last:null,tdate:null,dates:null,seq:0,es:null,fails:0,poll:null,t:null,v:0,intra:null,it:null,live:null,close:null}; /* close：Pages 收盤後 FinMind 收盤快照 {day,hms,pending:{L,O},late}（正式收盤還沒到的市場用快照，MARKET-05），沒有時為 null */ /* live：Pages FinMind 盤中價 {hms,at,interval}（登入後約 30 秒，橋接層輪詢），沒有時為 null */ /* intra：Pages 盤中快照 {stale,ttl,hm}，收盤／盤前為 null */ /* v：行情版本，畫面快取比對用 */
var VAL={on:false,map:{},date:null,limitations:[]};
function qtApply(s){QT.v++;QT.on=true;QT.st=s.market_status;QT.last=s.last_success_at;QT.tdate=s.trading_date;QT.dates=s.dates||null;QT.seq=s.seq||0;QT.map=s.quotes||{};QT.intra=s.intraday||null;QT.live=s.live||null;QT.close=s.closing||null;QT.src=s.source||null;EX.stale=QT.st==='DELAYED'||!!(QT.intra&&QT.intra.stale);if(PAGES){var L=pxLabel();JX0[0][1]=JXW[0][1]=WFX[0][0]=L;}qtSchedule();}
/* 價格欄名稱：一律「成交價」（規格 B2）；實際是收盤價或盤中快照，另用 pxWord() 在滑鼠提示中說明 */
function pxLabel(){return PXL;}
function pxWord(){return PAGES?(QT.live?'FinMind 盤中價':QT.close?'FinMind 收盤快照價':QT.intra?'證交所盤中快照價':'收盤價'):'成交價';}
/* 資料來源 FinMind（K-30，條款要求）：顯示 FinMind 盤中價，或任一市場的最新收盤來自 FinMind 就標示 */
function fmSrc(){if(typeof QT!=='undefined'&&(QT.live||QT.close))return true;var s=(typeof QT!=='undefined'&&QT.src)||(STAT.quotes&&STAT.quotes.source)||{};return s.L==='finmind'||s.O==='finmind';}
function qtMerge(ev){QT.v++;var q=ev.quotes||{};Object.keys(q).forEach(function(k){QT.map[k]=q[k];});QT.seq=Math.max(QT.seq,ev.seq||0);QT.last=new Date().toISOString();}
function qtRefresh(){KupeiAPI.req('GET','/quotes').then(function(r){if(r.ok&&!qtSame(r.data)){qtApply(r.data);quotesChanged();}else qtSchedule();},function(){qtSchedule();});}
/* Pages 盤中（2026-10-27）：後端每 ttlSeconds（約 10 分鐘）更新一次盤中快照，所以只有盤中（phase=OPEN）且分頁可見時，
   每 ttl 秒重抓一次 /api/market/intraday。這是跟著後端快照的更新頻率走（經確認可接受），不是輪詢即時報價；
   分頁在背景時不抓，回到分頁由 visibilitychange 補抓；盤前、收盤後不排程，只在載入與回到分頁時讀一次（串接規範 §2.5）。 */
function qtSchedule(){if(QT.it){clearTimeout(QT.it);QT.it=null;}if(!PAGES||!QT.intra)return;QT.it=setTimeout(function(){QT.it=null;if(document.visibilityState==='visible')qtRefresh();},(QT.intra.ttl||300)*1000);}
function qtPoll(){if(QT.poll)return;QT.poll=setInterval(qtRefresh,PAGES?300000:30000);}
function qtStream(){
  if(!window.EventSource){qtPoll();return;}
  try{QT.es=new EventSource(KupeiAPI.base+'/quotes/stream');}catch(e){qtPoll();return;}
  QT.es.addEventListener('snapshot',function(e){QT.fails=0;try{qtApply(JSON.parse(e.data));quotesChanged();}catch(x){}});
  QT.es.addEventListener('quotes',function(e){QT.fails=0;try{qtMerge(JSON.parse(e.data));quotesChanged();}catch(x){}});
  QT.es.addEventListener('status',function(e){try{var s=JSON.parse(e.data);QT.st=s.market_status;QT.last=s.last_success_at||QT.last;EX.stale=QT.st==='DELAYED';quotesChanged();}catch(x){}});
  QT.es.onerror=function(){QT.fails++;if(QT.fails>=3){try{QT.es.close();}catch(x){}QT.es=null;qtPoll();}};
}
function qtSame(s){return QT.on&&s&&s.last_success_at===QT.last&&s.trading_date===QT.tdate&&(s.seq||0)===QT.seq&&s.quotes===QT.map;}
function qtStart(){KupeiAPI.req('GET','/quotes').then(function(r){if(!r.ok){QT.on=false;updLine();return;}if(!qtSame(r.data)){qtApply(r.data);quotesChanged();}else updLine();if(!PAGES)qtStream(); /* Pages 版：行情一天只更新幾次，不輪詢（串接規範 §4），回到分頁時才刷新 */},function(){updLine();});}
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible'&&QT.on)qtRefresh();});
/* Pages：橋接層的 FinMind 盤中價更新（約 30 秒）或改回證交所快照時通知；只重讀 /quotes、更新價格欄 */
window.addEventListener('kupei:live',function(){if(PAGES)qtRefresh();});
function vaApply(d){QT.v++;VAL.on=true;VAL.date=d.valuation_date;VAL.map=d.companies||{};VAL.limitations=d.dataset_limitations||[];Object.keys(d.translations||{}).forEach(function(k){TR[k]=d.translations[k];});}
/* 啟動時已趕上（SB.val）就不再讀；晚到的才重畫目前頁面（status() 不再等估價下載：狀態頁的基準日在這裡補上） */
function vaStart(){if(VAL.on)return;KupeiAPI.req('GET','/valuation').then(function(r){if(!r.ok||VAL.on)return;vaApply(r.data);quotesChanged(true);if(curPage==='status')stRender();});}
function hm(iso){if(!iso)return '—';var d=new Date(iso);return isNaN(d)?'—':hhmm(d);}
function md(s){if(!s)return '—';var p=String(s).slice(0,10).split('-');return p.length===3?(+p[1])+'/'+(+p[2]):s;}
function qtLabel(){
  if(!QT.on)return '行情：尚未接上';
  if(QT.live){
    /* Pages FinMind 盤中價（登入後約 30 秒更新）；條款要求標示資料來源 */
    var sec=QT.live.interval||30;
    return '<span id="h-live" title="FinMind 盤中價，約每 '+sec+' 秒更新">FinMind・'+(QT.live.hms?esc(QT.live.hms):'—')+'（約 '+sec+' 秒更新）・資料來源：FinMind</span>';
  }
  if(QT.intra){
    /* Pages 證交所 MIS 盤中快照（FinMind 拿不到時的備援）：後端約 10 分鐘收一次，不是逐筆即時；stale＝快照超過預期時間沒更新，價格仍顯示 */
    var at=QT.intra.hm?esc(QT.intra.hm):'—';
    if(QT.intra.stale)return '<span style="color:var(--warn)" title="證交所盤中快照超過預期時間沒有更新，價格停在最後一次快照">⚠ 證交所・盤中資料延遲｜最後更新 '+at+'</span>';
    return '<span title="證交所盤中快照，約 10 分鐘更新一次，非逐筆即時">證交所・約 10 分鐘延遲・'+at+'</span>';
  }
  if(QT.close){
    /* Pages 收盤後、正式收盤還沒到（MARKET-05）：還沒更新的市場用 FinMind 收盤快照；15:30 後仍沒到標「正式收盤延遲」 */
    var c=QT.close,pd=c.pending||{},dq=QT.dates||{},snap=esc(md(c.day))+' FinMind 收盤快照・正式收盤待更新',
      txt=pd.L&&pd.O?snap:pd.L?'上櫃 收盤價 '+esc(md(dq.O))+'｜上市 '+snap:'上市 收盤價 '+esc(md(dq.L))+'｜上櫃 '+snap,
      tt=(pd.L&&pd.O?'':'已更新的市場用每日收盤；')+'還沒更新的市場暫用 FinMind 收盤快照（'+(c.hms||'—')+'），正式收盤到了自動切換'+(c.late?'；台灣時間 15:30 後正式收盤仍未更新':'');
    return '<span id="h-close"'+(c.late?' style="color:var(--warn)"':'')+' title="'+esc(tt)+'">'+(c.late?'⚠ 正式收盤延遲｜':'')+txt+'・資料來源：FinMind</span>';
  }
  if(QT.st==='CLOSED'){
    /* Pages：每日收盤（非即時）；上市（L）、上櫃（O）收盤日不同時兩個都標 */
    var d=QT.dates||{},both=d.L&&d.O&&d.L!==d.O,tt='每日收盤價，非即時'+(d.L?'；上市 '+d.L:'')+(d.O?'；上櫃 '+d.O:'');
    return '<span title="'+esc(tt)+'">收盤價 '+(both?'上市 '+esc(md(d.L))+'／上櫃 '+esc(md(d.O)):esc(md(QT.tdate)))+(PAGES?'・非即時':'')+(fmSrc()?'・資料來源：FinMind':'')+'</span>';
  }
  if(QT.st==='DELAYED')return '<span style="color:var(--warn)">⚠ 行情延遲｜最後更新 '+hm(QT.last)+'</span>';
  return '成交價 '+hm(QT.last)+'｜FinMind';
}
function updLine(){$('h-upd').innerHTML=qtLabel();if(typeof mfootRender==='function')mfootRender();var ia=QT.on&&!!(QT.intra&&QT.intra.stale),cl=QT.on&&!!(QT.close&&QT.close.late),al=QT.on&&QT.st==='DELAYED'||ia||cl;$('h-alert').hidden=!al;if(cl)$('h-alert').textContent='正式收盤延遲：台灣時間 15:30 後'+(QT.close.pending.L&&QT.close.pending.O?'':QT.close.pending.L?'上市':'上櫃')+'每日收盤仍未更新，價格暫用 '+md(QT.close.day)+' FinMind 收盤快照；更新後自動切換。';else if(ia)$('h-alert').textContent='盤中資料延遲：後端盤中快照超過預期時間沒有更新，價格與安全邊際停在 '+(QT.intra.hm||'—')+'；恢復後自動更新。';else if(al)$('h-alert').textContent='行情延遲：超過 2 分鐘沒有新資料，成交價與安全邊際停在 '+hm(QT.last)+'；恢復後自動更新。';}
function quotesChanged(full){
  if(QT.t)return;
  QT.t=setTimeout(function(){QT.t=null;updLine();
    if(curPage==='home'){if(full||HS.pxl!==pxLabel())hRender();else hUpdateQuotes();} /* 價格欄名稱變了（盤中價 ↔ 收盤價）要重畫表頭與手機排序選單 */
    else if(curPage==='watch'){if(full)wRender();else wUpdateQuotes();} /* 只換價格與安全邊際格，不整頁重畫 */
    else if(curPage==='stock')sValRender(SP.id);
  },full?0:300);
}

/* ================= 近 20 日行情、近 5 月營收（K13；I8） ================= */
var HIST={on:null,map:{},loading:{},failAt:{}}; /* failAt：失敗時間，60 秒內不重抓（避免重畫→重抓迴圈） */
function histLoad(ids){
  if((SRV.mode!=='server'&&!PAGES)||HIST.on===false)return;
  var now=Date.now(),need=ids.filter(function(id){return !HIST.map[id]&&!HIST.loading[id]&&!(now-(HIST.failAt[id]||0)<60000);});if(!need.length)return;
  need.forEach(function(id){HIST.loading[id]=true;});
  function end(){need.forEach(function(id){HIST.loading[id]=false;});}
  KupeiAPI.req('GET','/market/history?ids='+need.map(encodeURIComponent).join(',')).then(function(r){
    end();
    if(r.status===503)HIST.on=false;
    else if(!r.ok)need.forEach(function(id){HIST.failAt[id]=Date.now();});
    else if(r.ok){HIST.on=true;var c=r.data.companies||{};Object.keys(c).forEach(function(k){HIST.map[k]=c[k];});
      need.forEach(function(id){if(!HIST.map[id])HIST.map[id]={status:'UNAVAILABLE',daily:[],monthly_revenue:[]};});} /* 回應沒有的代號記成不可得，不再重抓 */
    if(curPage==='watch')wRender(); /* 失敗也重畫：把「載入中」換回「—」 */
  },function(){end();need.forEach(function(id){HIST.failAt[id]=Date.now();});if(curPage==='watch')wRender();});
}
function spark(id){
  var h=HIST.map[id];if(!h&&HIST.loading[id])return '<span class="muted" title="近 20 日行情載入中">…</span>';if(!h||!h.daily||h.daily.length<2)return '<span class="muted" title="近 20 日行情'+(HIST.on===false?'尚未提供':'不可得')+'">—</span>';
  var d=h.daily,w=110,ht=36,c=d.map(function(x){return x.close;}),v=d.map(function(x){return x.volume||0;}),mn=Math.min.apply(null,c),mx=Math.max.apply(null,c),vm=Math.max.apply(null,v)||1,n=d.length-1;
  var pts=c.map(function(p,i){return (i*(w/n)).toFixed(1)+','+(2+(1-(p-mn)/((mx-mn)||1))*(ht-14)).toFixed(1);}).join(' ');
  var bars=v.map(function(x,i){var bh=x/vm*9;return '<rect x="'+(i*(w/n)-1.5).toFixed(1)+'" y="'+(ht-bh).toFixed(1)+'" width="3" height="'+bh.toFixed(1)+'" fill="#4A5563"/>';}).join('');
  var rr=(c[n]/c[0]-1)*100,col=chgColor(rr);
  return '<span style="display:inline-flex;align-items:center;gap:6px"><svg class="spark" data-kind="p" width="'+w+'" height="'+ht+'" viewBox="0 0 '+w+' '+ht+'" role="img" aria-label="近 20 日收盤價與成交量">'+bars+'<polyline points="'+pts+'" fill="none" stroke="'+col+'" stroke-width="1.5"/></svg><span class="num" style="font-size:10px;color:'+col+'" title="所示區間漲跌幅 '+esc(md(d[0].date))+'–'+esc(md(d[n].date))+'（末值÷首值−1）">'+pct(rr)+'</span></span>';
}
function revBars(id){
  var h=HIST.map[id],m=h&&h.monthly_revenue;if(!h&&HIST.loading[id])return '<span class="muted" title="近 5 月營收載入中">…</span>';if(!m||!m.length)return '<span class="muted" title="近 5 月營收'+(HIST.on===false?'尚未提供':'不可得')+'">—</span>';
  var w=84,ht=36,vm=Math.max.apply(null,m.map(function(x){return x.revenue||0;}))||1;
  var b=m.map(function(x,i){var bh=(x.revenue||0)/vm*(ht-4);return '<rect x="'+(i*17+1)+'" y="'+(ht-bh).toFixed(1)+'" width="12" height="'+bh.toFixed(1)+'" fill="#5B7FA8"/>';}).join('');
  var y=m[m.length-1].yoy;
  return '<span style="display:inline-flex;align-items:center;gap:6px"><svg class="spark" data-kind="r" width="'+w+'" height="'+ht+'" viewBox="0 0 '+w+' '+ht+'" role="img" aria-label="近 5 月月營收">'+b+'</svg><span class="num" style="font-size:11px;color:'+(y==null?'var(--muted)':chgColor(y*100))+'" title="'+esc(m[m.length-1].month)+' 營收 YoY">'+(y==null?'N/A':pct(y*100))+'</span></span>';
}
document.addEventListener('mousemove',function(e){
  var sv=e.target.closest&&e.target.closest('svg.spark');if(!sv){hideTip();return;}
  var cell=sv.closest('td');if(!cell)return;var id=cell.dataset.spark||cell.dataset.rev,h=HIST.map[id];if(!h)return;var rc=sv.getBoundingClientRect(),x=e.clientX-rc.left;
  if(sv.dataset.kind==='p'){var d=h.daily,n=d.length-1,i=Math.max(0,Math.min(n,Math.round(x/(rc.width/n))));showTip(e.clientX,e.clientY,esc(d[i].date)+'｜收盤 '+fmt(d[i].close)+'｜成交 '+(d[i].volume==null?'—':Number(d[i].volume).toLocaleString())+' 張');}
  else{var m=h.monthly_revenue,j=Math.max(0,Math.min(m.length-1,Math.floor(x/17)));showTip(e.clientX,e.clientY,esc(m[j].month)+'｜營收 '+fmt(m[j].revenue,0)+'｜YoY '+(m[j].yoy==null?'N/A':pct(m[j].yoy*100)));}
});

/* ================= 個股問題（K7；E7、E7a、E7b） ================= */
var QSTZ={NEW:'新增',STILL_VALID:'仍成立',RESOLVED:'已解除',UNDETERMINED:'無法判斷'};
var QS={id:null,ver:0,list:null,showDel:false,form:false,loading:false,err:null};
function QSTORE(){var s=window.KupeiAuth&&window.KupeiAuth.session&&window.KupeiAuth.session();return s?'個股問題存在這台瀏覽器；已登入 '+s.username+'，各裝置同步':'個股問題存在這台瀏覽器；登入帳號（左側「帳號」）後各裝置同步';}
function qLoad(id){
  QS.id=id;QS.list=null;QS.err=null;QS.form=false;QS.showDel=false;
  if(SRV.mode!=='server'&&!PAGES){qRender();return;}
  QS.loading=true;qRender();
  KupeiAPI.req('GET','/companies/'+encodeURIComponent(id)+'/questions?include_deleted=true').then(function(r){
    QS.loading=false;if(QS.id!==id)return;
    if(!r.ok){QS.err=errMsg(r);qRender();return;}QS.ver=r.data.version;QS.list=r.data.questions||[];qRender();
  },function(){QS.loading=false;QS.err='連線失敗';qRender();});
}
function qApply(res){QS.ver=res.version;QS.list=res.questions||[];qRender();}
function qWrite(method,path,body,idem,okMsg){
  srvWrite(method,'/companies/'+encodeURIComponent(QS.id)+'/questions'+path,body,{ver:QS.ver,idem:idem,local:PAGES,onConflict:function(){qLoad(QS.id);}},function(res){
    if(res&&res.questions)qApply(res);else qLoad(QS.id);if(okMsg)toast(okMsg);});
}
function qRow(q){
  var st=QSTZ[q.status]||q.status,man=q.manual_locked?'<span class="qman">人工</span>':'';
  var meta=esc(q.question_id)+'｜首次 '+esc(String(q.first_seen||'').slice(0,10))+(q.related_items&&q.related_items.length?'｜'+esc(q.related_items.join('、')):'');
  var ev=q.evidence&&q.evidence.length?' <span class="cite2">〔'+esc(q.evidence.join('、'))+'〕</span>':'';
  var act=q.deleted?'<button class="btn sm" data-qrestore="'+esc(q.question_id)+'">恢復</button>'
    :'<label class="sr" for="qs-'+esc(q.question_id)+'">修改狀態</label><select class="inp" id="qs-'+esc(q.question_id)+'" data-qst="'+esc(q.question_id)+'">'+Object.keys(QSTZ).map(function(k){return '<option value="'+k+'"'+(k===q.status?' selected':'')+'>'+QSTZ[k]+'</option>';}).join('')+'</select><button class="btn sm" data-qdel="'+esc(q.question_id)+'">刪除</button>';
  return '<div class="q"><span class="qb qb-'+esc(st)+'">'+esc(st)+man+'</span><div><div class="qid">'+meta+'</div><div>'+esc(q.body)+ev+'</div></div><div class="qa">'+act+'</div></div>';
}
function qRender(){
  if(SRV.mode!=='server'&&!PAGES){$('s-qtag').textContent='尚未開放';$('q-showdel').hidden=true;$('q-body').innerHTML='<div class="placeholder">'+(PAGES?OFFZH:'個股問題存在主機；主機寫入服務未啟用時無法使用。')+'</div>';return;}
  $('s-qtag').textContent='';
  if(QS.loading){$('q-body').innerHTML='<div class="placeholder">載入中…</div>';return;}
  if(QS.err){$('q-body').innerHTML='<div class="placeholder">個股問題載入失敗：'+esc(QS.err)+'</div>';return;}
  var L=QS.list||[],act=L.filter(function(q){return !q.deleted;}),del=L.filter(function(q){return q.deleted;});
  $('q-showdel').hidden=!del.length;$('q-delcount').textContent=del.length;
  var h=PAGES?'<div class="placeholder" id="q-store">'+esc(QSTORE())+'</div><div class="placeholder">只收需要外部資訊或公司說明才能回答的事項；分數、名次、觸發等評分內容在報告 2a 追蹤。每則最多 1,000 字、每家公司最多 100 則；刪除的問題可恢復（已刪除最多保留 50 則）。</div>'
    :'<div class="placeholder">只收需要外部資訊或公司說明才能回答的事項；分數、名次、觸發等評分內容在報告 2a 追蹤。手動修改標示「人工」，AI 之後不會覆蓋；刪除的問題可恢復。</div>';
  h+=act.map(qRow).join('')||'<div class="placeholder">目前沒有問題。可手動新增。</div>';
  if(QS.showDel&&del.length)h+='<div class="placeholder" style="margin-top:6px">已刪除：</div>'+del.map(qRow).join('');
  if(QS.form){
    h+='<div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line);padding-top:8px"><label class="sub" for="q-text">問題內容</label><textarea id="q-text" rows="3" maxlength="1000" style="background:var(--surface2);color:var(--text);border:1px solid var(--line2);border-radius:6px;padding:6px;font:inherit;resize:vertical" placeholder="例：法說會提到的新產品線，下一季營收是否開始貢獻？"></textarea><div class="sub">相關大項（選填）</div><div id="q-maj" style="display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px">'+
      MAJ.map(function(m){return '<label><input type="checkbox" value="'+esc(m)+'"> '+esc(m)+'</label>';}).join('')+'</div><div style="display:flex;gap:8px"><button class="btn primary sm" data-qsave="1">新增</button><button class="btn sm" data-qcancel="1">取消</button></div></div>';
  }else h+='<button class="btn sm" data-qadd="1" style="align-self:flex-start">＋ 新增問題</button>';
  $('q-body').innerHTML=h;
}
function qFind(qid){return (QS.list||[]).filter(function(q){return q.question_id===qid;})[0];}
document.addEventListener('change',function(e){var t=e.target;if(!t.dataset||!t.dataset.qst)return;var q=qFind(t.dataset.qst);if(!q)return;
  qWrite('PUT','/'+encodeURIComponent(q.question_id),{text:q.body,status:t.value,related_items:q.related_items||[],evidence:q.evidence||[],status_reason:q.status_reason||null},null,'已改為「'+QSTZ[t.value]+'」（人工）');});
document.addEventListener('click',function(e){
  var t=e.target.closest('button');if(!t)return;var d=t.dataset;
  if(d.qadd){if(!SRV.auth&&!PAGES){showLogin(function(){QS.form=true;qRender();});return;}QS.form=true;qRender();var x=$('q-text');if(x)x.focus();return;}
  if(d.qcancel){QS.form=false;qRender();return;}
  if(d.qsave){var tx=$('q-text').value.trim();if(!tx){$('q-text').focus();return;}if(tx.length>1000){toast('每則問題最多 1,000 字（目前 '+tx.length+' 字）');return;}var rel=[];document.querySelectorAll('#q-maj input:checked').forEach(function(c){rel.push(c.value);});QS.form=false;qWrite('POST','',{text:tx,related_items:rel,evidence:['人工']},uuid(),'已新增（人工）');return;}
  if(d.qdel){var q=qFind(d.qdel);qWrite('DELETE','/'+encodeURIComponent(d.qdel),null,null,null);toast('已刪除 '+d.qdel,function(){qWrite('POST','/'+encodeURIComponent(d.qdel)+'/restore',null,null,'已恢復');});return;}
  if(d.qrestore){qWrite('POST','/'+encodeURIComponent(d.qrestore)+'/restore',null,null,'已恢復');return;}
  if(t.id==='q-showdel'){QS.showDel=!QS.showDel;qRender();return;}
});
if(SB&&SB.watch&&SB.watch.ok){SRV.mode='server';SRV.auth=!!(SB.auth&&SB.auth.ok&&SB.auth.data.authenticated);W=null;wFromServer(SB.watch.data);NS={span:1,groups:[],stock:{}};RS={};if(SB.news&&SB.news.ok)newsFromServer(SB.news.data);}
function groupOf(id){for(var i=0;i<W.groups.length;i++)if(W.groups[i].ids.indexOf(id)>=0)return W.groups[i];return null;}
function watchIds(){var o=[];W.groups.forEach(function(g){o=o.concat(g.ids);});return o;}
function stockKw(id){var r=BYID[id];if(!NS.stock[id])NS.stock[id]={kw:[r.name,r.id],ex:[]};return NS.stock[id];}
function setGroup(id,gid){
  var g=groupOf(id),t=W.groups.filter(function(x){return x.id===gid;})[0];
  if(g&&g.id===gid)return 'same';
  if(t&&t.ids.length>=GMAX)return 'full';
  if(g)g.ids.splice(g.ids.indexOf(id),1);
  if(t)t.ids.push(id);
  stockKw(id);saveNS();saveW();return g?('moved:'+g.name):'added';
}

/* ---------- toast / tip ---------- */
var toastTimer=null,undoFn=null;
function toast(msg,undo){$('toast-msg').textContent=msg;$('toast').style.display='flex';undoFn=undo||null;$('toast-undo').hidden=!undo;clearTimeout(toastTimer);toastTimer=setTimeout(function(){$('toast').style.display='none';undoFn=null;},undo?5000:2200);}
$('toast-undo').addEventListener('click',function(){if(undoFn){undoFn();undoFn=null;}$('toast').style.display='none';});
function showTip(x,y,html){var t=$('tip2');t.innerHTML=html;t.style.display='block';var w=t.offsetWidth;t.style.left=Math.min(window.innerWidth-w-8,x+12)+'px';t.style.top=(y+14)+'px';}
function hideTip(){$('tip2').style.display='none';}

/* ---------- shared cells ---------- */
function scoreCell(m,act,extra){
  var cls=(act?' act':'')+(extra||'');
  if(m.st!=='TRIAL_SCORE'&&m.st!=='POLICY_SCORE'){var c=CODE[m.st]||('UN');return '<td class="code'+cls+'">'+esc(c)+'</td>';}
  if(m.s==null)return '<td class="code'+cls+'">UN</td>';
  var a=(0.06+Math.max(0,Math.min(100,m.s))/100*0.55).toFixed(3);
  return '<td class="sc num'+cls+'" style="background:rgba(58,128,228,'+a+')"><span class="s1">'+m.s.toFixed(1)+'</span><span class="s2">'+(m.pol?'<span class="pol" aria-label="政策分">政</span>':'')+'</span><span class="rk">('+(m.mr==null?'—':esc(m.mr))+')</span></td>';
}
function pcMark(r){return (r.pc&&r.pc>=1)?'<span class="pm" tabindex="0" title="政策分大項 '+esc(r.pc)+'／12">政'+esc(r.pc)+'</span>':'';}
function dotFor(id){var g=groupOf(id);return g?'<span class="dot" style="background:'+g.color+'" title="'+esc(g.name)+'"></span>':'';}
function badges(r,c){
  if(!r.assessed)return '';
  var h='';
  function nm(fid){return FID2NAME[fid]||(c&&c.zhName[fid])||fid;}
  function src(list){return list&&list.length?'｜來源：'+list.map(function(f){if(f&&typeof f==='object')return [f.rule_id,nm(f.feature_id),f.observation_period].filter(Boolean).join(' ');return nm(String(f));}).join('、'):'｜觸發來源見個股分析頁';}
  var source=c||r;
  if(r.veto)h+='<span class="badge b-veto" title="資格否決（'+esc(GATE_LABEL)+'）'+esc(src(source.vetoFeatures))+'｜不改分數與名次">否決</span>';
  if(r.finrev)h+='<span class="badge b-fin" title="財務複核（'+esc(GATE_LABEL)+'）'+esc(src(source.finSources))+'">複核</span>';
  return h;
}
function rankTxt(r){return !r.assessed?'未評估':(r.rank==null?'NR':esc(r.rank));}

/* ================= HOME ================= */
var HS={key:'total',dir:'desc',list:[],flash:null,sel:null,hideVeto:false,hideTrend:false};
var hTok=0;
/* I1：先分組再排序：已評估且可排名 → NR → 未評估；未評估組固定依代號 */
function grp(r){return !r.assessed?2:(r.rank==null?1:0);}
function isTrend(r){return r.p2cat==='TREND'||r.p2cat==='TREND_AND_DATA';}
function hSorted(){
  var key=HS.key,dir=HS.dir==='desc'?1:-1;
  function val(r){
    if(key==='total')return r.rank==null?null:-r.rank;
    if(key==='price')return sim(r.id).price;
    if(key==='margin')return margin(sim(r.id));
    var m=r.maj[+key.slice(1)];return (m.st==='TRIAL_SCORE'||m.st==='POLICY_SCORE')?m.s:null;
  }
  return MARKET.filter(function(r){return !(HS.hideVeto&&r.veto)&&!(HS.hideTrend&&isTrend(r));}).sort(function(x,y){
    var gx=grp(x),gy=grp(y);if(gx!==gy)return gx-gy;
    if(gx===2)return x.id<y.id?-1:1;
    var a=val(x),b=val(y);
    if(a==null&&b==null)return x.id<y.id?-1:1;
    if(a==null)return 1;if(b==null)return -1;
    if(a!==b)return (b-a)*dir;
    var tx=x.rank==null?1e9:x.rank,ty=y.rank==null?1e9:y.rank;
    return tx!==ty?tx-ty:(x.id<y.id?-1:1);
  });
}
/* 大項排序鍵是 m0…m11；margin（安全邊際）也是 m 開頭，不能只看第一個字 */
function isMajKey(k){return /^m\d+$/.test(k||'');}
function arrow(k){return HS.key===k?(HS.dir==='desc'?'▼':'▲'):'';}
var FX=[64,52,170]; /* 名次、代號、公司 */
var JX0=[['price',PXL,124],['','中心',76],['margin','安全邊際',80],['','隱含成長率',84],['add','自選',52]];
var JXW=[['price',PXL,124],['','中心',76],['margin','安全邊際',80],['','隱含成長率',84],['','下限',80],['','上限',80],['','數據上限',84],['add','自選',52]];
var JX=JX0;
function jRight(i){var s=0;for(var k=i+1;k<JX.length;k++)s+=JX[k][2];return s;}
function isM(){return window.innerWidth<=720;}
var EX={stale:false,fail:false,nonews:false};
function pxHtml(o){if(o.price==null)return '<span class="muted"'+(o.qst==='REALTIME_UNAVAILABLE'?' title="無即時報價"':'')+'>—</span>';var chg=o.chgPct;return fmt(o.price)+(EX.stale?'<span class="stale-ic" title="行情延遲，停在最後更新價格">⚠</span>':(chg==null?'':'<span class="chg" style="color:'+chgColor(chg)+'">'+pct(chg,2)+'</span>'));}
function hHead(){
  var h='<th class="fz" style="left:0;min-width:'+FX[0]+'px;width:'+FX[0]+'px">名次</th><th class="fz" style="left:'+FX[0]+'px;min-width:'+FX[1]+'px;width:'+FX[1]+'px">代號</th><th class="fz" style="left:'+(FX[0]+FX[1])+'px;min-width:'+FX[2]+'px;width:'+FX[2]+'px;border-right:1px solid var(--line2)">公司</th>';
  MAJ.forEach(function(l,k){
    h+='<th class="shd'+(HS.key==='m'+k?' on':'')+'"><button class="sortbtn" data-sort="m'+k+'" aria-label="依 '+esc(l)+' 排序"><span class="lab">'+esc(l)+'<span class="arrow">'+arrow('m'+k)+'</span></span></button></th>';
  });
  if(!HS.wide)h+='<th class="vgrp first">下限</th><th class="vgrp">上限</th><th class="vgrp">數據上限</th>';
  JX.forEach(function(j,i){
    var st='right:'+jRight(i)+'px;min-width:'+j[2]+'px;width:'+j[2]+'px'+(i===0?';border-left:1px solid var(--line2)':'');
    if(j[0]==='add'){h+='<th class="jr" style="'+st+';text-align:center">自選</th>';return;}
    if(i===4&&HS.wide)st+=';border-left:2px solid #3A4149';
    if(j[0])h+='<th class="jr'+(HS.key===j[0]?' on':'')+'" style="'+st+'"><button class="sortbtn" data-sort="'+j[0]+'" aria-label="依 '+j[1]+' 排序"><span class="lab">'+j[1]+'<span class="arrow">'+arrow(j[0])+'</span></span>'+(i===0?'':'')+'</button></th>';
    else h+='<th class="jr" style="'+st+'">'+j[1]+'</th>';
  });
  $('h-head').innerHTML=h;
}
/* 價格／安全邊際格目前的內容（hUpdateQuotes 只改有變的格，避免 1,900 列整欄改寫觸發整表重新排版） */
var QC={};
function qcKey(o,mg){return pxHtml(o)+'\u0001'+mgTxt(o,mg)+'\u0001'+(EX.stale?'':mgStyle(mg));}
function hRow(r){
  var o=sim(r.id),mg=margin(o),over=o.cap!=null&&o.price>o.cap,g=groupOf(r.id);QC[r.id]=qcKey(o,mg);
  var cls=(r.rank==null?'nd':'')+(!r.assessed?' na':'')+(HS.sel===r.id?' sel':'')+(HS.flash===r.id?' flash':'');
  var rid=esc(r.id),h='<tr id="hr-'+rid+'" class="'+cls+'">';
  h+='<td class="fz num" style="left:0"><button class="selbtn" data-sel="'+rid+'" aria-label="標示此列">'+rankTxt(r)+pcMark(r)+'</button></td>';
  h+='<td class="fz mono" style="left:'+FX[0]+'px"><button class="selbtn" data-sel="'+rid+'" aria-label="標示此列">'+rid+'</button></td>';
  h+='<td class="fz" style="left:'+(FX[0]+FX[1])+'px;border-right:1px solid var(--line2)"><button class="namelink" data-open="'+rid+'" aria-label="開啟 '+esc(r.name)+' 個股分析"><span class="nm">'+esc(r.name)+'</span>'+dotFor(r.id)+'</button> '+badges(r)+'</td>';
  r.maj.forEach(function(m,k){h+=scoreCell(m,HS.key==='m'+k,'');});
  if(!HS.wide){h+='<td class="vgrp first num">'+fmt(o.min)+'</td><td class="vgrp num">'+fmt(o.max)+'</td>';
  h+='<td class="vgrp num'+(over?' over':'')+'">'+fmt(o.cap)+'</td>';}
  h+='<td class="jr num'+(EX.stale?' stale':'')+'" data-q="'+rid+'" style="right:'+jRight(0)+'px;border-left:1px solid var(--line2)">'+pxHtml(o)+'</td>';
  h+='<td class="jr num" style="right:'+jRight(1)+'px">'+fmt(o.typ)+'</td>';
  h+='<td class="jr num'+(EX.stale?' stale':'')+'" data-m="'+rid+'" style="right:'+jRight(2)+'px;'+(EX.stale?'':mgStyle(mg))+'">'+mgTxt(o,mg)+'</td>';
  h+='<td class="jr num" style="right:'+jRight(3)+'px">'+gnHtml(o)+'</td>';
  if(HS.wide){h+='<td class="jr num" style="right:'+jRight(4)+'px;border-left:2px solid #3A4149">'+fmt(o.min)+'</td><td class="jr num" style="right:'+jRight(5)+'px">'+fmt(o.max)+'</td><td class="jr num'+(over?' vgrp over':'')+'" style="right:'+jRight(6)+'px">'+fmt(o.cap)+'</td>';}
  h+='<td class="jr" style="right:0;text-align:center"><button class="addbtn'+(g?' on':'')+'" data-menu="'+rid+'" aria-label="'+(g?'管理自選群組（目前 '+esc(g.name)+'）':'加入自選')+'">'+(g?'<span class="dot" style="background:'+g.color+'"></span>':'+')+'</button></td>';
  return h+'</tr>';
}
function hCheckWide(){
  var want;
  if(isM()||EX.fail)want=false;
  else{var t=$('h-tbl'),w=$('h-wrap');if(!w.clientWidth)return false;var mw=t.style.minWidth,ww=t.style.width;t.style.minWidth='0';t.style.width='max-content';var nat=t.offsetWidth;t.style.minWidth=mw;t.style.width=ww;want=nat<=w.clientWidth-(HS.wide?0:16);}
  if(want===!!HS.wide)return false;
  HS.wide=want;JX=want?JXW:JX0;hRender();return true;
}
var rzT=null;window.addEventListener('resize',function(){clearTimeout(rzT);rzT=setTimeout(function(){if(curPage==='home'&&!isM())hCheckWide();},200);});
/* ---------- mobile list ---------- */
var MX={open:{}};
function majCell(m){if(m.st!=='TRIAL_SCORE'&&m.st!=='POLICY_SCORE'||m.s==null)return '<span class="code">'+esc(CODE[m.st]||'UN')+'</span>';return m.s.toFixed(1)+(m.pol?'<span class="pol">政</span>':'');}
function mDetail(r,extra){
  var o=sim(r.id);
  var g='<div class="mgrid">'+r.maj.map(function(m,k){return '<div><span class="k">'+esc(MAJ[k])+'</span><span class="v num">'+majCell(m)+'</span><span class="r">'+(m.mr==null?'—':'名次 '+esc(m.mr))+'</span></div>';}).join('')+'</div>';
  var v='<div class="mval">'+[['中心',fmt(o.typ)],['隱含成長率',gnHtml(o)],['下限',fmt(o.min)],['上限',fmt(o.max)],['數據上限',fmt(o.cap)]].map(function(x){return '<div><span class="k">'+x[0]+'</span><span class="num">'+x[1]+'</span></div>';}).join('')+'</div>';
  return '<div class="mdet">'+v+g+(extra||'')+'</div>';
}
function mLine2(r){
  var k=HS.key;
  if(isMajKey(k)){var m=r.maj[+k.slice(1)];return esc(MAJ[+k.slice(1)])+' '+(m.s==null||(m.st!=='TRIAL_SCORE'&&m.st!=='POLICY_SCORE')?(CODE[m.st]||'UN'):m.s.toFixed(1)+'（'+(m.mr==null?'—':esc(m.mr))+'）');}
  return esc(r.id)+'｜'+esc(r.ind);
}
function mRow(r){
  var o=sim(r.id),mg=margin(o),open=!!MX.open[r.id],g=groupOf(r.id),rid=esc(r.id);QC[r.id]=qcKey(o,mg);
  var acts='<div class="mact"><a class="btn" href="#/stock/'+rid+'/home">個股分析</a></div>';
  var add='<button class="addbtn madd'+(g?' on':'')+'" data-menu="'+rid+'" aria-label="'+(g?'管理自選群組（目前 '+esc(g.name)+'）':'加入自選')+'">'+(g?'<span class="dot" style="background:'+g.color+'"></span>':'＋')+'</button>';
  return '<div class="mrow'+(open?' open':'')+(r.rank==null?' nd':'')+(HS.flash===r.id?' flash':'')+'" id="mr-'+rid+'"><div class="mhwrap"><button class="mhead" data-mexp="'+rid+'" aria-expanded="'+open+'"><span class="mrk num">'+rankTxt(r)+pcMark(r)+'</span><span class="mnm"><span class="l1"><b>'+esc(r.name)+'</b>'+dotFor(r.id)+badges(r)+'</span><span class="l2">'+mLine2(r)+'</span></span><span class="mpx num'+(EX.stale?' stale':'')+'" data-q2="'+rid+'">'+pxHtml(o)+'</span><span class="mmg num'+(EX.stale?' stale':'')+'" data-m2="'+rid+'" style="'+(EX.stale?'':mgStyle(mg))+'">'+mgTxt(o,mg)+'</span></button>'+add+'</div>'+(open?mDetail(r,acts):'')+'</div>';
}
function mSortOpts(){
  var o=[['total','總名次'],['price',pxLabel()],['margin','安全邊際']].concat(MAJ.map(function(l,k){return ['m'+k,l];}));
  $('h-msort').innerHTML=o.map(function(x){return '<option value="'+x[0]+'"'+(HS.key===x[0]?' selected':'')+'>排序：'+esc(x[1])+'</option>';}).join('');
}
function hSig(){return [HS.key,HS.dir,HS.hideVeto,HS.hideTrend,!!HS.wide,isM(),EX.stale,EX.fail,QT.v,JSON.stringify(W.groups)].join('|');}
function hRender(done){
  HS.list=hSorted();HS.sig=hSig();HS.pxl=pxLabel();
  var key=HS.key;
  $('h-sort').textContent=key==='total'?'排序：總名次':'排序：'+(key==='price'?pxLabel():key==='margin'?'安全邊際':MAJ[+key.slice(1)])+(HS.dir==='desc'?'，高 → 低':'，低 → 高');
  $('h-reset').hidden=key==='total';
  $('h-err').hidden=!EX.fail;$('h-wrap').style.visibility=EX.fail?'hidden':'';$('h-mlist').style.visibility=EX.fail?'hidden':'';
  if(EX.fail){$('h-wrap').style.display='none';$('h-mlist').style.display='none';}else{$('h-wrap').style.display='';$('h-mlist').style.display='';}
  var tok=++hTok,i=120,html,body;
  if(EX.fail){$('h-body').innerHTML='';$('h-mlist').innerHTML='';HR.sig=null;if(done)done();return;}
  if(isM()){mSortOpts();$('h-body').innerHTML='';HR.sig=null;html=HS.list.map(mRow);body=$('h-mlist');}
  else{
    $('h-mlist').innerHTML='';hHead();body=$('h-body');
    if(HR.sig===hRowSig()){hReuse(tok,done);return;}
    html=HS.list.map(hRow);
  }
  body.innerHTML=html.slice(0,i).join('');
  if(!isM()&&hCheckWide()){if(done){var d0=done;setTimeout(function(){hWhenDone(d0);},0);}return;}
  /* 前 120 列先畫出來，等這一幀畫完再補其餘列（每批 HCHUNK 列）：每插入一批整張表就重新排版一次，原本 300 列一批共 7 批，改成 500 列一批共 4 批 */
  function more(){if(tok!==hTok)return;if(i<html.length){body.insertAdjacentHTML('beforeend',html.slice(i,i+HCHUNK).join(''));i+=HCHUNK;if(i<html.length){afterPaint(more);return;}}HS.done=tok;if(!isM())hKeep();if(done)done();}
  if(i>=html.length)more();else afterPaint(more);
}
/*
 * 桌機排序／篩選重用已建好的列（不重組 HTML、不重新解析 1,900 列）：列內容只跟下面這些有關，
 * 都沒變就只調整順序與「目前排序欄」的底色；有變（行情、估價、自選群組、寬版）就整表重畫。
 */
var HR={sig:null,key:null,nodes:null};
/* 第一屏 120 列之後每批 500 列、批與批之間讓出一幀：批數少（整表排版次數少），單一長任務也壓在約 0.4 秒內，點擊不會卡住 1 秒 */
var HCHUNK=500;
function hRowSig(){return [!!HS.wide,EX.stale,QT.v,JSON.stringify(W.groups)].join('|');}
function hKeep(){var m={};$('h-body').querySelectorAll(':scope>tr[id^="hr-"]').forEach(function(tr){m[tr.id.slice(3)]=tr;});HR={sig:hRowSig(),key:HS.key,nodes:m};}
function hReuse(tok,done){
  var body=$('h-body'),old=HR.key,key=HS.key,m=HR.nodes;
  function col(k){return isMajKey(k)?3+(+k.slice(1)):-1;}
  var a=col(old),b=col(key);
  Object.keys(m).forEach(function(id){var tr=m[id],c=tr.children;
    if(a!==b){if(a>=0&&c[a])c[a].classList.remove('act');if(b>=0&&c[b])c[b].classList.add('act');}
    tr.classList.toggle('sel',HS.sel===id);tr.classList.toggle('flash',HS.flash===id);});
  HR.key=key;
  var rows=HS.list.map(function(r){var tr=m[r.id];if(!tr){var t=document.createElement('tbody');t.innerHTML=hRow(r);tr=m[r.id]=t.firstChild;}return tr;});
  body.replaceChildren.apply(body,rows.slice(0,120));var i=120;
  function more(){if(tok!==hTok)return;if(i<rows.length){body.append.apply(body,rows.slice(i,i+HCHUNK));i+=HCHUNK;if(i<rows.length){afterPaint(more);return;}}HS.done=tok;if(done)done();}
  if(rows.length>120)afterPaint(more);else more();
}
/* 下一幀畫完後執行；分頁在背景（requestAnimationFrame 暫停）時 120ms 後照樣執行 */
function afterPaint(f){var ran=false;function g(){if(!ran){ran=true;f();}}requestAnimationFrame(function(){setTimeout(g,0);});setTimeout(g,120);}
function hWhenDone(f){if(HS.done===hTok)f();else setTimeout(function(){hWhenDone(f);},30);}
function hUpdateQuotes(){
  var mob=isM(),pq=mob?'[data-q2]':'td[data-q]',pm=mob?'[data-m2]':'td[data-m]',host=mob?$('h-mlist'):$('h-body');
  var cq={},cm={};host.querySelectorAll(pq).forEach(function(td){cq[td.dataset.q||td.dataset.q2]=td;});host.querySelectorAll(pm).forEach(function(td){cm[td.dataset.m||td.dataset.m2]=td;});
  Object.keys(cq).forEach(function(id){
    var o=sim(id),mg=margin(o),k=qcKey(o,mg);if(QC[id]===k)return;QC[id]=k;
    cq[id].innerHTML=pxHtml(o);var td=cm[id];if(td){td.innerHTML=mgTxt(o,mg);td.style.color=mg==null?'var(--muted)':chgColor(mg);}
  });
  HS.sig=hSig();
  /* 重用的列全都在畫面上（沒有被篩掉的）才算已更新；否則下次排序整表重畫 */
  if(!mob&&HR.sig&&HR.nodes&&Object.keys(cq).length===Object.keys(HR.nodes).length)HR.sig=hRowSig();else if(!mob)HR.sig=null;
}
/* 首頁分數格的滑鼠提示：滑到才補 title（不在 1,900 列 × 12 格的 HTML 裡多塞字串） */
function majTitle(m,k){
  var nm=MAJ[k]+'：',pop=H.rank_population&&H.rank_population[k];
  if(m.st!=='TRIAL_SCORE'&&m.st!=='POLICY_SCORE'||m.s==null)return nm+(CODE[m.st]||'UN')+'（'+(STATUS[m.st]||(m.s==null&&m.st?'分數數值異常':'未知狀態'))+'）';
  return nm+m.s.toFixed(1)+' 分'+(m.pol?'（政策分）':'')+'｜全市場名次 '+(m.mr==null?'—':m.mr+(pop?'／'+pop:''));
}
$('h-body').addEventListener('mouseover',function(e){
  var td=e.target.closest&&e.target.closest('td');if(!td||td.title)return;
  var k=td.cellIndex-3,tr=td.parentNode,r=tr&&tr.id?BYID[tr.id.slice(3)]:null;
  if(r&&k>=0&&k<MAJ.length&&r.maj[k])td.title=majTitle(r.maj[k],k);
});
function hSortBy(k){if(HS.key!==k){HS.key=k;HS.dir='desc';}else if(HS.dir==='desc')HS.dir='asc';else{HS.key='total';HS.dir='desc';}hRender();}
function hSelect(id){
  var prev=HS.sel;HS.sel=(prev===id)?null:id;
  if(prev){var p=$('hr-'+prev);if(p)p.classList.remove('sel');}
  if(HS.sel){var e=$('hr-'+HS.sel);if(e)e.classList.add('sel');}
}
function hJump(){
  var q=$('h-q').value.trim().toLowerCase();if(!q)return;
  var all=ROWS.filter(function(r){return r.id.toLowerCase().indexOf(q)>=0||r.name.toLowerCase().indexOf(q)>=0;});
  if(!all.length){$('h-msg').textContent='找不到符合的公司';return;}
  /* 代號完全相符優先；否則跳到目前排序中的第一筆，並提示共幾筆 */
  var exact=all.filter(function(r){return r.id.toLowerCase()===q;})[0];
  var shown=HS.list.filter(function(r){return all.indexOf(r)>=0;}),hit=exact?(shown.indexOf(exact)>=0?exact:null):shown[0];
  if(exact&&!hit)all=[exact];
  if(!hit){var f=all[0];$('h-msg').textContent=f.id+' '+f.name+(f.fin?'：本模型不適用金融保險業':(HS.hideTrend&&isTrend(f)?'：已被「隱藏趨勢惡化需複核」篩掉':'：已被「隱藏資格否決」篩掉'));return;}
  $('h-msg').textContent=exact||shown.length<2?'':'找到 '+shown.length+' 筆，已跳到第一筆：'+hit.id+' '+hit.name;HS.flash=hit.id;
  var pre=isM()?'mr-':'hr-';if(isM())MX.open[hit.id]=true;
  function go(){var el=$(pre+hit.id);if(el)el.scrollIntoView({block:'center'});clearTimeout(HS.flashT);HS.flashT=setTimeout(function(){HS.flash=null;var e=$(pre+hit.id);if(e)e.classList.remove('flash');},1600);} /* 連續搜尋：上一次的計時器不能提早清掉這次的標示 */
  var cur=HS.done===hTok&&$(pre+hit.id);
  if(cur){if(isM())cur.outerHTML=mRow(hit);var el=$(pre+hit.id);el.classList.remove('flash');void el.offsetWidth;el.classList.add('flash');go();}
  else hRender(go);
}
/* 產業新聞 1 天／3 天（V1.0 C3a）；新聞管線（T9）與來源白名單（J4）未交付前不顯示佔位內容 */
var NV={span:null};
function nSpan(){if(NV.span==null)NV.span=NS.span||1;return NV.span;}
function segHtml(){var v=nSpan();return '<span class="seg" role="group" aria-label="產業新聞顯示區間"><button data-nspan="1" class="'+(v===1?'on':'')+'" aria-pressed="'+(v===1)+'">1 天</button><button data-nspan="3" class="'+(v===3?'on':'')+'" aria-pressed="'+(v===3)+'">3 天</button></span>';}
var NEWS_OFF='新聞擷取尚未開通（新聞管線與來源白名單待核准）。';
document.addEventListener('click',function(e){var t=e.target.closest('[data-nspan]');if(!t)return;NV.span=+t.dataset.nspan;if(curPage==='news')nRender(NP.kw);else hNews();});
function hMNews(){
  var gs=NS.groups;$('h-mnews-s').textContent='產業新聞（'+gs.length+' 組｜'+nSpan()+' 天）';
  $('h-mnews-b').innerHTML='<div class="nhead">顯示區間 '+segHtml()+'</div>'+(gs.length?gs.map(function(g){
    return '<div style="display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--line);padding-top:6px"><span class="kw" style="color:var(--text2)">'+esc(g.kw.join('、')||'（尚未設定關鍵字）')+'</span><span class="placeholder">'+NEWS_OFF+'</span></div>';
  }).join(''):'<span class="placeholder">尚未設定產業新聞關鍵字組，可到「新聞關鍵字設定」新增。</span>');
}
function hNews(){
  hMNews();
  $('h-nhead').innerHTML='產業新聞顯示區間 '+segHtml()+'<span>'+(PAGES?'近 '+nSpan()+' 天（依新聞發布時間）':nSpan()===3?'近 3 天（前三日 07:30 – 今日 07:30）':'當日（前一日 07:30 – 今日 07:30）')+'；預設值可在「新聞關鍵字設定」調整</span>';
  $('h-news').innerHTML=NS.groups.map(function(g){
    return '<div class="card"><div style="display:flex;align-items:baseline;gap:8px;min-width:0"><h2 style="white-space:nowrap">產業新聞</h2><span class="kw" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">｜'+esc(g.kw.join('、')||'（尚未設定關鍵字）')+'</span></div><div class="placeholder">'+NEWS_OFF+'</div><a href="#/news/g'+esc(g.id)+'" style="font-size:12px;align-self:flex-start">新聞頁</a></div>';
  }).join('')||'<div class="placeholder">尚未設定產業新聞關鍵字組，可到「新聞關鍵字設定」新增。</div>';
}

/* menus */
function placeMenu(btn,w){var rect=btn.getBoundingClientRect(),left=Math.max(8,Math.min(window.innerWidth-w-8,rect.right-w));return 'left:'+left+'px;'+(rect.bottom+300>window.innerHeight?'bottom:'+Math.round(window.innerHeight-rect.top+4)+'px':'top:'+Math.round(rect.bottom+4)+'px');}
function openMenu(id,btn){
  var r=BYID[id],g=groupOf(id);
  var h='<button class="backdrop" data-close="1" aria-label="關閉選單"></button><div class="menu" role="dialog" aria-label="自選群組" style="'+placeMenu(btn,260)+'">';
  h+='<div class="menuhd">'+esc(r.id)+' '+esc(r.name)+'</div>';
  W.groups.forEach(function(x){var full=x.ids.length>=GMAX&&!(g&&g.id===x.id);
    h+='<button class="menuitem" role="menuitemradio" aria-checked="'+(g&&g.id===x.id)+'" data-setg="'+esc(x.id)+'" data-id="'+esc(id)+'"'+(full?' aria-disabled="true"':'')+'><span class="dot" style="background:'+x.color+'"></span><span style="flex:1 1 auto">'+esc(x.name)+' <span style="color:var(--faint)">'+x.ids.length+'/'+GMAX+'</span></span><span style="color:var(--accent)">'+(g&&g.id===x.id?'目前':'')+'</span></button>';});
  if(W.groups.length<5)h+='<button class="menuitem" data-newg="'+esc(id)+'" style="color:var(--text2)">＋ 新增群組並加入</button>';else h+='<div class="menunote">已達 5 組上限</div>';
  if(g)h+='<button class="menuitem" data-rmg="'+esc(id)+'" style="color:var(--up)">移出自選</button>';
  $('menuHost').innerHTML=h+'</div>';
}
function openGroupMenu(gid,btn){
  var g=W.groups.filter(function(x){return x.id===gid;})[0];
  var h='<button class="backdrop" data-close="1" aria-label="關閉選單"></button><div class="menu" style="'+placeMenu(btn,220)+';width:220px">';
  h+='<div class="menuhd">'+esc(g.name)+'</div>';
  h+='<button class="menuitem" data-gdel="'+esc(gid)+'" style="color:var(--up)">刪除群組</button>';
  h+='<div class="menunote">改名：點群組標題旁的鉛筆。顏色依建立順序自動指定。</div>';
  $('menuHost').innerHTML=h+'</div>';
}
function confirmDelete(gid){
  var g=W.groups.filter(function(x){return x.id===gid;})[0];
  var h='<button class="backdrop" data-close="1" aria-label="取消"></button><div class="modal" role="dialog" aria-label="確認刪除群組"><h2>刪除「'+esc(g.name)+'」？</h2><p style="color:var(--text2);line-height:1.6">'+(g.ids.length?'將移出 '+g.ids.length+' 家公司。這些公司的新聞關鍵字與報告設定會保留'+(PAGES?'（'+(window.KupeiAuth&&window.KupeiAuth.session&&window.KupeiAuth.session()?'同步到你的帳號':'只存在這台瀏覽器')+'）':(SRV.mode==='server'?'在主機':'在這台瀏覽器'))+'，但從設定頁移除。':'此群組沒有公司。')+(W.groups.length===1?'<br>這是最後一個群組，刪除後會保留一個空的「自選1」。':'')+'</p><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" data-close="1">取消</button><button class="btn primary" data-gdelok="'+esc(gid)+'">刪除</button></div></div>';
  $('menuHost').innerHTML=h;
}
function closeMenu(){$('menuHost').innerHTML='';}
function reRender(id){
  if(curPage==='watch'){wRender();return;}
  /* 自選只改變該公司的按鈕與色點；手機首頁直接換單列，避免重建全市場清單造成跳位。 */
  var one=isM()&&id&&$('mr-'+id);
  if(one){
    one.outerHTML=mRow(BYID[id]);return;
  }
  hRender();
}

/* ================= WATCH ================= */
function curGroup(){var g=W.groups.filter(function(x){return x.id===W.cur;})[0];if(!g){g=W.groups[0];W.cur=g?g.id:null;}return g;}
var WS={sel:null};
var WFX=[[PXL,234,118],['中心',352,72],['安全邊際',424,78],['隱含成長率',502,84]]; /* V6：自選頁估價前 4 欄固定，其餘水平捲動 */
function wRender(){
  var g=curGroup();
  histLoad(g?g.ids:[]); /* 先標記載入中，小圖格才會先顯示「…」而不是「—」 */
  $('w-title').textContent=g?g.name:'自選';
  $('w-tabs').innerHTML=W.groups.map(function(x){return '<span class="tab'+(x.id===W.cur?' on':'')+'"><button class="tabmore" style="display:inline-flex;gap:8px;align-items:center;color:inherit" role="tab" aria-selected="'+(x.id===W.cur)+'" data-tab="'+esc(x.id)+'"><span class="dot" style="background:'+x.color+'"></span>'+esc(x.name)+' <span style="color:var(--faint)">'+x.ids.length+'</span></button><button class="tabmore" data-gmenu="'+esc(x.id)+'" aria-label="'+esc(x.name)+' 群組選單">⋯</button></span>';}).join('')+(W.groups.length<5?'<button class="tab" data-addtab="1" aria-label="新增群組">＋</button>':'');
  var hh='<th class="fz" style="left:0;width:28px;min-width:28px"></th><th class="fz" style="left:28px;width:56px;min-width:56px">代號</th><th class="fz" style="left:84px;width:150px;min-width:150px;border-right:1px solid var(--line2)">公司</th>';
  WFX.forEach(function(c,i){hh+='<th class="fz" style="left:'+c[1]+'px;width:'+c[2]+'px;min-width:'+c[2]+'px;text-align:right'+(i===3?';border-right:2px solid #3A4149':'')+'">'+c[0]+'</th>';});
  ['下限','上限','數據上限'].forEach(function(l,i){hh+='<th class="vgrp'+(i===0?' first':'')+'"'+(i===2?' style="border-right:2px solid #3A4149"':'')+'>'+l+'</th>';});
  MAJ.forEach(function(l,k){hh+='<th class="shd">'+esc(l)+'</th>';});
  hh+='<th class="jr" style="right:194px;width:150px;min-width:150px;border-left:1px solid var(--line2);text-align:center">近 20 日</th><th class="jr" style="right:44px;width:150px;min-width:150px;text-align:center">近 5 月營收</th><th class="jr" style="right:0;width:44px;min-width:44px;text-align:center">自選</th>';
  $('w-head').innerHTML=hh;
  var b='';
  (g?g.ids:[]).forEach(function(id){
    var r=BYID[id];if(!r)return;var o=sim(id),mg=margin(o),over=o.cap!=null&&o.price!=null&&o.price>o.cap;
    var gg=groupOf(id),eid=esc(id);
    b+='<tr id="wr-'+eid+'" class="'+(r.rank==null?'nd':'')+(WS.sel===id?' sel':'')+'" data-row="'+eid+'" draggable="true">';
    b+='<td class="fz" style="left:0;padding:0"><span class="handle" aria-hidden="true" title="拖曳調整順序">⋮⋮</span></td><td class="fz mono" style="left:28px"><button class="selbtn" data-wsel="'+eid+'" aria-label="標示此列">'+eid+'</button></td>';
    b+='<td class="fz" style="left:84px;border-right:1px solid var(--line2)"><button class="namelink" data-open="'+eid+'"><span class="nm">'+esc(r.name)+'</span></button><span style="color:var(--faint);font-size:11px;margin-left:6px">'+(!r.assessed?'未評估':r.rank==null?'NR':'#'+esc(r.rank))+'</span>'+pcMark(r)+' '+badges(r)+'</td>';
    b+='<td class="fz num'+(EX.stale?' stale':'')+'" data-wq="'+eid+'" style="left:'+WFX[0][1]+'px">'+pxHtml(o)+'</td><td class="fz num" style="left:'+WFX[1][1]+'px">'+fmt(o.typ)+'</td><td class="fz num'+(EX.stale?' stale':'')+'" data-wm="'+eid+'" style="left:'+WFX[2][1]+'px;'+(EX.stale?'':mgStyle(mg))+'">'+mgTxt(o,mg)+'</td><td class="fz num" style="left:'+WFX[3][1]+'px;border-right:2px solid #3A4149">'+gnHtml(o)+'</td>';
    b+='<td class="vgrp first num">'+fmt(o.min)+'</td><td class="vgrp num">'+fmt(o.max)+'</td><td class="vgrp num'+(over?' over':'')+'" style="border-right:2px solid #3A4149">'+fmt(o.cap)+'</td>';
    r.maj.forEach(function(m){b+=scoreCell(m,false,'');});
    b+='<td class="jr" style="right:194px;border-left:1px solid var(--line2);text-align:center" data-spark="'+eid+'">'+spark(id)+'</td><td class="jr" style="right:44px;text-align:center" data-rev="'+eid+'">'+revBars(id)+'</td><td class="jr" style="right:0;text-align:center"><button class="addbtn on" data-menu="'+eid+'" aria-label="管理自選群組（目前 '+esc(gg?gg.name:'')+'）"><span class="dot" style="background:'+(gg?gg.color:'')+'"></span></button></td></tr>';
  });
  if(!g||!g.ids.length)b='<tr><td colspan="30" style="text-align:left;color:var(--faint);padding:16px">此群組還沒有公司。到首頁點「＋」加入。</td></tr>';
  $('w-body').innerHTML=b;
  importBanner();
  var miss=[];if(!QT.on)miss.push('行情');if(!VAL.on)miss.push('估價');if(HIST.on===false)miss.push('近 20 日與月營收');$('w-legend3').textContent=miss.length?miss.join('、')+'尚未提供':(PAGES?(QT.live?'FinMind 盤中價（約 30 秒更新）；安全邊際依該價格計算；資料來源：FinMind':QT.close?'正式收盤還沒到的市場暫用 FinMind 收盤快照；安全邊際依該價格計算；資料來源：FinMind':QT.intra?'證交所盤中快照（約 10 分鐘延遲，非逐筆即時）；安全邊際依該價格計算':'收盤價為每日收盤（非即時）；安全邊際依收盤價計算'):'成交價來源 FinMind；安全邊際依即時股價計算');
  if(isM()){
    var ids=g?g.ids:[];
    $('w-mlist').innerHTML=ids.length?ids.map(function(id,ix){
      var r=BYID[id],o=sim(id),mg=margin(o),open=!!MX.open['w'+id],eid=esc(id);
      var acts='<div style="display:flex;gap:10px;align-items:center">'+spark(id)+revBars(id)+'</div><div class="mact"><a class="btn" href="#/stock/'+eid+'/'+encodeURIComponent('watch:'+W.cur)+'">個股分析</a><button class="btn" data-wmove="'+eid+'|-1"'+(ix===0?' disabled':'')+'>上移</button><button class="btn" data-wmove="'+eid+'|1"'+(ix===ids.length-1?' disabled':'')+'>下移</button><button class="btn" data-menu="'+eid+'">群組／移出</button></div>';
      return '<div class="mrow'+(open?' open':'')+(r.rank==null?' nd':'')+'"><button class="mhead" data-wexp="'+eid+'" aria-expanded="'+open+'"><span class="mrk num">'+(!r.assessed?'未評估':r.rank==null?'NR':'#'+esc(r.rank))+'</span><span class="mnm"><span class="l1"><b>'+esc(r.name)+'</b>'+pcMark(r)+badges(r)+'</span><span class="l2">'+esc(id)+'｜'+esc(r.ind)+'</span></span><span class="mpx num'+(EX.stale?' stale':'')+'" data-wq="'+eid+'">'+pxHtml(o)+'</span><span class="mmg num" data-wm="'+eid+'" style="'+(EX.stale?'':mgStyle(mg))+'">'+mgTxt(o,mg)+'</span></button>'+(open?mDetail(r,acts):'')+'</div>';
    }).join(''):'<div class="placeholder" style="padding:16px">此群組還沒有公司。到首頁點「＋」加入。</div>';
  }else $('w-mlist').innerHTML='';
  WQ.stale=EX.stale;WQ.legend=$('w-legend3').textContent;
}
/* 自選頁行情更新（FinMind 約 30 秒）：只換價格與安全邊際格；延遲狀態（整列樣式）變了才整頁重畫 */
var WQ={stale:null,legend:null};
function wUpdateQuotes(){
  if(WQ.stale!==EX.stale){wRender();return;}
  var host=isM()?$('w-mlist'):$('w-body');
  host.querySelectorAll('[data-wq]').forEach(function(el){var h=pxHtml(sim(el.dataset.wq));if(el.innerHTML!==h)el.innerHTML=h;});
  host.querySelectorAll('[data-wm]').forEach(function(el){var o=sim(el.dataset.wm),mg=margin(o),h=mgTxt(o,mg);if(el.innerHTML!==h)el.innerHTML=h;el.style.color=EX.stale?'':(mg==null?'var(--muted)':chgColor(mg));});
  var miss=[];if(!QT.on)miss.push('行情');if(!VAL.on)miss.push('估價');if(HIST.on===false)miss.push('近 20 日與月營收');
  if(miss.length)return;var lg=PAGES?(QT.live?'FinMind 盤中價（約 30 秒更新）；安全邊際依該價格計算；資料來源：FinMind':QT.close?'正式收盤還沒到的市場暫用 FinMind 收盤快照；安全邊際依該價格計算；資料來源：FinMind':QT.intra?'證交所盤中快照（約 10 分鐘延遲，非逐筆即時）；安全邊際依該價格計算':'收盤價為每日收盤（非即時）；安全邊際依收盤價計算'):null;
  if(lg&&lg!==WQ.legend){$('w-legend3').textContent=lg;WQ.legend=lg;}
}
var dragId=null;
$('w-body').addEventListener('dragstart',function(e){var tr=e.target.closest('tr[data-row]');if(!tr)return;dragId=tr.dataset.row;e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',dragId);}catch(x){}});
$('w-body').addEventListener('dragover',function(e){var tr=e.target.closest('tr[data-row]');if(!tr||!dragId)return;e.preventDefault();document.querySelectorAll('#w-body .dropbefore').forEach(function(x){x.classList.remove('dropbefore');});tr.classList.add('dropbefore');});
$('w-body').addEventListener('drop',function(e){var tr=e.target.closest('tr[data-row]');if(!tr||!dragId)return;e.preventDefault();var g=curGroup(),ids=g.ids.slice();ids.splice(ids.indexOf(dragId),1);ids.splice(ids.indexOf(tr.dataset.row),0,dragId);dragId=null;if(SRV.mode==='server'){srvReorder(g.id,ids);return;}g.ids=ids;saveW();wRender();});
$('w-body').addEventListener('dragend',function(){dragId=null;document.querySelectorAll('#w-body .dropbefore').forEach(function(x){x.classList.remove('dropbefore');});});

var SP={id:null,from:'home',open:{},rd:{},tok:0};
var COMP={};
function noteHtml(n){
  var t=n.text||[n.rule_id,n.reason_zh||tr1(n.reason_code),n.warning_channel_zh,n.severity_zh,n.action_zh?'處置 '+n.action_zh:'',n.observation_period].filter(Boolean).join('｜');
  return esc(t);
}
function treeScore(n){
  if(n.st==='TRIAL_SCORE'||n.st==='POLICY_SCORE'){if(n.s==null)return '<span class="code" title="'+esc(n.st)+'">UN</span>';return '<span class="num">'+n.s.toFixed(1)+'</span>'+(n.st==='POLICY_SCORE'?'<span class="pol">政</span>':'');}
  if(n.st==='DIAGNOSTIC'||n.st==='ADJUSTMENT')return n.s==null?'<span class="muted">—</span>':'<span class="num muted">'+n.s.toFixed(1)+'</span>';
  if(CODE[n.st])return '<span class="code">'+esc(CODE[n.st])+'</span>';
  if(STATUS[n.st]!=null)return '<span class="muted">—</span>';
  return '<span class="code" title="'+esc(n.st)+'">UN</span>';
}
/* I4：同業名次依 peer_rank_status 顯示（資料端產出，前端不計算） */
function peerI4(p,first){
  var st=first?' style="margin-left:0"':'';
  if(!p||!p.has)return '<span class="peer ins"'+st+'>同業名次尚未提供</span>';
  switch(p.status){
    case 'RANKED':return '<span class="peer"'+st+' title="'+esc((p.group||'')+'｜PG002')+'">同業名次 '+esc(p.rank)+'／'+esc(p.pop)+'</span>';
    case 'INSUFFICIENT_PEERS':return '<span class="peer ins"'+st+'>同業不足（'+(p.pop==null?'—':esc(p.pop))+' 家）</span>';
    case 'INDUSTRY_UNAVAILABLE':return '<span class="peer ins"'+st+'>產業資料不可得</span>';
    case 'DIAGNOSTIC_NOT_RANKED':return '<span class="peer ins"'+st+'>診斷項不排名</span>';
    case 'SOURCE_STATUS_NOT_RANKED':return '';
    default:return '<span class="peer ins"'+st+'>同業：'+esc(p.status)+'</span>';
  }
}
function treeNote(n,lv,key,C){
  var parts=[];
  if(lv===1){
    var f=C.majors[n.id]||{},k=MJ.map(function(m){return m.id;}).indexOf(n.id),mr=f.market_rank,pop=f.market_rank_population!=null?f.market_rank_population:H.rank_population[k];
    var below=f.inherited_triggered_count||0;
    var line=(mr!=null?'全市場名次 '+esc(mr)+'／'+esc(pop):'全市場名次 —')+peerI4(n.peer)+(below?'<span class="below" title="下層觸發來源項目數（以項目去重，不是獨立事件數）">下層 '+esc(below)+' 項觸發</span>':'');
    parts.push(line);
    if(STATUS[n.st])parts.push('<span class="ev">'+esc(STATUS[n.st])+'</span>');
  }else{
    if(n.diag0||n.w===0)parts.push('<span class="muted">診斷項（權重 0，不計分）</span>');
    var ph=peerI4(n.peer,true);if(ph)parts.push(ph);
    var stx=STATUS[n.st];if(stx)parts.push('<span class="ev">'+esc(stx)+'</span>');
    if(n.r&&n.r.length)parts.push('<span class="ev">'+trHtml(n.r)+'</span>');
  }
  /* I2：presentation_notes 顯示 text_zh；格內狀態碼不變 */
  (n.pn||[]).forEach(function(x){parts.push('<span class="ev pn" title="'+esc(x.code||'')+'">'+esc(x.text_zh||tr1(x.code))+'</span>');});
  var src=C.notesBy[n.id];
  if(src&&src.length)parts.push(src.map(function(x){return '<span class="gt">'+noteHtml(x)+'</span>';}).join('<br>'));
  var rd=C.readyBy[n.id];
  if(rd&&rd.length){
    if(SP.rd[key])parts.push('<button class="rdtog" data-rd="'+esc(key)+'">收合準備度備註</button><br><span class="muted">'+rd.map(noteHtml).join('<br>')+'</span>');
    else parts.push('<button class="rdtog" data-rd="'+esc(key)+'">Gate 準備度備註 '+rd.length+' 筆（未觸發）</button>');
  }
  return parts.join('<br>')||'<span class="muted">—</span>';
}
function itemCell(n,lv,key,k){
  var pad=lv===1?10:(lv===2?28:52);
  var label='<span class="'+(lv===1?'en1':'')+'">'+esc(n.en||n.id)+'</span><span class="zh">'+esc(n.zh||'')+'</span>'+(lv===1&&n.p&&n.p===H.annual_period&&n.p!==H.requested_period?'<span class="per">'+esc(n.p)+' 年報</span>':'')+(lv>1&&n.w?'<span class="per">×'+(+n.w).toFixed(2)+'</span>':'');
  if(n.c&&n.c.length&&lv<3){var open=!!SP.open[key];return '<td class="c1" style="padding-left:'+pad+'px" title="'+esc(n.id)+'"><button class="tog" data-tog="'+esc(key)+'" aria-expanded="'+open+'"><span class="caret">'+(open?'▼':'▶')+'</span><span>'+label+'</span></button></td>';}
  return '<td class="c1" style="padding-left:'+(pad+18)+'px" title="'+esc(n.id)+'">'+label+'</td>';
}
/* E1b：第二階段處置一行 */
function majorOf(C,fid){var x=fid,g=0;while(C.parentOf[x]&&g++<6)x=C.parentOf[x];return x;}
function p2Line(r,C){
  if(!r.assessed||r.p2status==='NOT_ASSESSED')return '第二階段：無法評估';
  var h='第二階段：<b>'+esc(r.p2zh||r.p2||'未提供')+'</b>';
  if(r.p2==='Review Required'&&C&&C.p2reasons.length){
    /* 依大項彙整：大項 n 項（原因｜規則）；完整明細放在滑鼠提示 */
    function group(cat){
      var by={},order=[],full=[];
      C.p2reasons.forEach(function(x){
        var c2=x.category==='TREND'?'TREND':'DATA';if(c2!==cat)return;
        var mj=majorOf(C,x.feature_id);
        if(!by[mj]){by[mj]={items:{},why:{},rules:{}};order.push(mj);}
        var g=by[mj];g.items[x.feature_id]=1;g.why[tr1(x.reason_code)]=1;g.rules[x.rule_id]=1;
        full.push((FID2NAME[mj]||mj)+'／'+(C.zhName[x.feature_id]||x.feature_id)+'：'+x.rule_id+' '+tr1(x.reason_code)+(x.category!=='TREND'&&x.category!=='DATA'?'〔'+x.category+'〕':''));
      });
      if(!order.length)return '';
      var txt=order.map(function(mj){var g=by[mj],n=Object.keys(g.items).length;return (FID2NAME[mj]||mj)+(n>1?' '+n+' 項':'')+'（'+Object.keys(g.why).join('、')+'｜'+Object.keys(g.rules).join('、')+'）';}).join('、');
      return '<span title="'+esc(full.join('\n'))+'">'+esc(txt)+'</span>';
    }
    var T=group('TREND'),D=group('DATA');
    if(T)h+='｜<span class="p2t">趨勢惡化</span>：'+T;
    if(D)h+='｜<span class="p2d">資料不足</span>：'+D;
  }
  return h+'<span class="p2n" title="第二階段：看 2025Q4 年報往前約 5 年的指標變化，公司結果取最嚴重的一筆。">　請人工判讀，不是否決也不是投資判斷；複核標記的預測力尚未驗證</span>';
}
function sRender(){
  var id=SP.id,r=BYID[id];
  /* 找不到公司：估價、報告、問題、新聞卡片與上下家按鈕都隱藏，不留上一家的內容 */
  ['s-valcard','s-repcard','s-qcard','s-news','s-prev','s-next'].forEach(function(x){$(x).hidden=!r;});
  if(!r){$('s-title').textContent='找不到公司 '+id;$('s-sub').textContent='';$('s-p2').textContent='';$('s-tree').innerHTML='<tr><td colspan="3" class="placeholder">沒有代號「'+esc(id)+'」的公司。請回首頁搜尋代號或名稱。</td></tr>';$('s-val').innerHTML='';$('s-flags').innerHTML='';$('s-vlimits').innerHTML='';$('s-vbase').textContent='';$('q-body').innerHTML='';$('s-report').innerHTML='';$('s-news').innerHTML='';QS.id=null;return;}
  var C=COMP[id]||null;
  $('s-title').innerHTML=esc(r.id+' '+r.name)+' '+dotFor(r.id)+' '+badges(r,C);
  /* 每段不換行、分隔號跟在前一段後面：手機換行時新的一行不會以「｜」開頭 */
  $('s-sub').innerHTML='<span class="nb">'+esc(r.ind)+'｜</span><span class="nb">總名次 '+rankTxt(r)+pcMark(r)+'｜</span><span class="nb">分析財報 '+(r.assessed?esc(r.period||H.requested_period||'—'):'—')+'</span>';
  $('s-p2').innerHTML=p2Line(r,C);
  var list=srcList(),i=list.indexOf(id);
  $('s-prev').disabled=i<=0;$('s-next').disabled=i<0||i>=list.length-1;
  var b='';
  if(!r.assessed){
    b='<tr><td colspan="3" class="placeholder">'+esc(r.noteNA||'尚無足夠已驗收財報')+'。</td></tr>';
  }else if(!C){
    b='<tr><td colspan="3" class="placeholder">'+(SP.err?'個股明細載入失敗：'+esc(SP.err)+' <button class="btn sm" data-sretry="1">重試</button>':'載入個股明細中…')+'</td></tr>';
  }else if(C.tree&&C.tree.length){
    C.tree.forEach(function(n,k){
      var key=n.id;
      b+='<tr class="lv1">'+itemCell(n,1,key,k)+'<td class="c2">'+treeScore(n)+'</td><td class="c3 note">'+treeNote(n,1,key,C)+'</td></tr>';
      if(SP.open[key])n.c.forEach(function(m){
        var k2=key+'/'+m.id;
        b+='<tr>'+itemCell(m,2,k2)+'<td class="c2">'+treeScore(m)+'</td><td class="c3 note">'+treeNote(m,2,k2,C)+'</td></tr>';
        if(SP.open[k2])m.c.forEach(function(x){var k3=k2+'/'+x.id;b+='<tr>'+itemCell(x,3,k3)+'<td class="c2">'+treeScore(x)+'</td><td class="c3 note">'+treeNote(x,3,k3,C)+'</td></tr>';});
      });
    });
  }else{
    /* I3：中小項明細未交付時只列 12 大項 */
    r.maj.forEach(function(m,k){
      b+='<tr class="lv1"><td class="c1" style="padding-left:28px"><span class="en1">'+esc(MJ[k].en)+'</span></td><td class="c2">'+treeScore(m)+'</td><td class="c3 note">'+(m.mr!=null?'全市場名次 '+esc(m.mr)+'／'+esc(H.rank_population[k]):'<span class="ev">'+esc(STATUS[m.st]||m.st)+'</span>')+'</td></tr>';
    });
    b+='<tr><td colspan="3" class="placeholder">中小項明細尚未提供。</td></tr>';
  }
  $('s-tree').innerHTML=b;
  sValRender(id);
  sReport(id);if(QS.id!==id)qLoad(id);else qRender();sNews(id);
}

function sValRender(id){
  var r=BYID[id];if(!r)return;var o=sim(id),mg=margin(o);
  $('s-vbase').textContent=(QT.on?qtLabel().replace(/<[^>]+>/g,''):'行情尚未接上')+'｜估價基準日 '+(VAL.on&&VAL.date?md(VAL.date):'—');
  var kv=[[EX.stale?pxLabel()+' <span class="stale-ic">⚠</span>':pxLabel(),EX.stale&&o.price!=null?'<span class="stale">'+fmt(o.price)+'</span>':pxHtml(o)],['中心',fmt(o.typ)],[EX.stale?'安全邊際 <span class="stale-ic">⚠</span>':'安全邊際','<span style="'+mgStyle(mg)+'">'+pct(mg)+'</span>'],['隱含成長率',gnHtml(o)],['下限',fmt(o.min)],['上限',fmt(o.max)],['數據上限',fmt(o.cap)]];
  function plain(h){return String(h).replace(/<[^>]+>/g,' ').replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();}
  $('s-val').innerHTML=kv.map(function(x){return '<div title="'+esc(plain(x[0])+'：'+plain(x[1]))+'"><div class="k">'+x[0]+'</div><div class="v num">'+x[1]+'</div></div>';}).join('');
  // 共通限制每家都相同，收合顯示一次；原因碼已在狀態說明列出的旗標不再重複（2026-10-24 正式快照核對）
  $('s-vlimits').innerHTML=VAL.on&&VAL.limitations.length?'<details><summary>資料集共通限制（'+VAL.limitations.length+' 項，適用全部公司）</summary>'+VAL.limitations.map(function(x){return '<div title="'+esc(x.code)+'">・'+esc(x.message_zh)+'</div>';}).join('')+'</details>':'';
  var f=[],vr=VAL.on?(VAL.map[r.id]||{}):{},rc=vr.reason_codes||[];
  if(r.fin&&(o.flags||[]).indexOf('FINANCIAL_SECTOR')<0&&rc.indexOf('FINANCIAL_SECTOR')<0)f.push('<span class="flag">'+esc(tr1('FINANCIAL_SECTOR'))+'</span>');
  var bf=(o.flags||[]).filter(function(c){return rc.indexOf(c)<0;}),seen={};
  if(VAL.on&&o.vst==='OK'&&o.price!=null){var pos=o.price<o.min?'低於下限':o.price<o.typ?'下限–中心':o.price<o.max?'中心–上限':'高於上限';
    f.push('<span class="flag" title="'+esc(pxWord()+' '+fmt(o.price)+'；估價下限 '+fmt(o.min)+'、中心 '+fmt(o.typ)+'、上限 '+fmt(o.max)+'、數據上限 '+fmt(o.cap))+'">股價位置：'+pos+'</span>');
    /* 後端旗標已有「價格高於資料支持上限」就以後端為準，不再重複 */
    if(o.cap!=null&&o.price>o.cap&&bf.indexOf('PRICE_ABOVE_DATA_SUPPORT')<0){var t0=tr1('PRICE_ABOVE_DATA_SUPPORT');seen[t0]=1;f.push('<span class="flag" title="'+esc(pxWord()+' '+fmt(o.price)+' 高於數據上限 '+fmt(o.cap))+'">'+esc(t0)+'</span>');}}
  bf.forEach(function(c){var t=tr1(c);if(seen[t])return;seen[t]=1;f.push('<span class="flag" title="'+esc(c)+'">'+esc(t)+'</span>');});
  if(!VAL.on)f.push('<span class="placeholder">估價尚未提供。</span>');else if(o.vst&&o.vst!=='OK')f.push('<span class="placeholder" title="'+esc(o.vst)+'">此公司估價'+(o.vst==='PARTIAL'?'只提供中心值，不提供上下限與數據上限':o.vst==='NOT_APPLICABLE'?'不適用':'不可得')+(rc.length?'：'+trHtml(rc):'')+'。</span>');
  if(!QT.on)f.push('<span class="placeholder">行情尚未接上。</span>');else if(VAL.on)f.push('<span class="placeholder">安全邊際依'+(PAGES?(QT.live?'FinMind 盤中價':QT.close?'FinMind 收盤快照價（正式收盤待更新）':QT.intra?'證交所盤中快照價':'最近收盤價'):'即時股價')+'計算，與規格書以估價基準日收盤價計算的數值不同。</span>');
  $('s-flags').innerHTML=f.join('');
}

function sLoad(){
  var id=SP.id,tok=++SP.tok;SP.err=null;
  if(!BYID[id]||!BYID[id].assessed||COMP[id]){sRender();return;}
  sRender();
  KupeiAPI.company(id).then(function(c){COMP[id]=c;if(tok===SP.tok&&SP.id===id)sRender();},function(e){if(tok!==SP.tok)return;SP.err=e&&e.message||'未知錯誤';sRender();});
}
/* ---------- 個股報告（T10／K4）、個股問題（K7）、個股新聞（T9）：契約交付前顯示尚未開放，不放示範內容（J2、J7） ---------- */
function sReport(id){
  var inW=!!groupOf(id);
  $('s-reptag').textContent='尚未開放';
  $('s-period').innerHTML='<option>—</option>';$('s-period').disabled=true;
  $('s-report').innerHTML='<div class="placeholder">尚無報告。報告流程（Codex 初稿 → Claude 審核 → Codex 覆核 → 發布）待報告契約交付後開放。'+(inW?'':'<br>此公司不在自選群組，無法設定或產生報告。')+'</div>';
}
function rRender(id){
  var r=BYID[id];
  $('r-title').textContent='個股報告全文｜'+id+' '+(r?r.name:'');
  $('r-sub').textContent='';$('r-body').innerHTML='<div class="placeholder">此公司尚無報告。</div>';$('r-toc').innerHTML='';
}
document.addEventListener('click',function(e){
  var t=e.target.closest('button,a');if(!t)return;var d=t.dataset;
  if(d.rtoc){e.preventDefault();var el=$(d.rtoc);if(el)el.scrollIntoView({block:'start',behavior:'smooth'});return;}
  if(d.sretry){sLoad();return;}
});
function sNews(id){
  var inW=!!groupOf(id);
  $('s-news').innerHTML='<div style="display:flex;align-items:center;gap:10px"><h2>個股新聞</h2><span class="grow"></span></div>'+
    (!inW?'<div class="placeholder">未追蹤：此公司不在自選群組，沒有個股新聞設定。加入自選後以「公司名稱、代號」為關鍵字。</div>'
      :'<div class="placeholder">'+NEWS_OFF+'關鍵字：'+esc(stockKw(id).kw.join('、')||'載入中')+'；近 5 日。</div>');
}
function srcList(){
  if(SP.from&&SP.from.indexOf('watch')===0){var g=W.groups.filter(function(x){return 'watch:'+x.id===SP.from;})[0];return g?g.ids.slice():[];}
  return (HS.list.length?HS.list:hSorted()).map(function(r){return r.id;});
}
/* ================= NEWS PAGE ================= */
var NP={kw:'g1'};
function nRender(kw){
  NP.kw=kw||NP.kw;var isStock=NP.kw.charAt(0)==='s';
  $('n-title').textContent=isStock?'個股新聞':'產業新聞';
  var opts=isStock?watchIds().map(function(id){return ['s'+id,id+' '+BYID[id].name];}):NS.groups.map(function(g,i){return ['g'+g.id,(i+1)+'｜'+(g.kw[0]||'（未設定）')];});
  if(isStock&&opts.every(function(o){return o[0]!==NP.kw;})){var rid=NP.kw.slice(1);opts.unshift([NP.kw,rid+' '+(BYID[rid]?BYID[rid].name:'')+'（未追蹤）']);}
  $('n-kw').innerHTML=opts.map(function(o){return '<option value="'+esc(o[0])+'"'+(o[0]===NP.kw?' selected':'')+'>'+esc(o[1])+'</option>';}).join('')||'<option>（尚未設定）</option>';
  var days=[],now=new Date();for(var i=0;i<5;i++){var d=new Date(now.getFullYear(),now.getMonth(),now.getDate()-i);days.push((d.getMonth()+1)+'/'+d.getDate());}
  var keep=$('n-date').dataset.kw===NP.kw?$('n-date').value:'0';$('n-date').dataset.kw=NP.kw;
  $('n-date').innerHTML=days.map(function(d,i){return '<option value="'+i+'">'+d+(i===0?'（當日）':'')+'</option>';}).join('');$('n-date').value=keep||'0';
  $('n-seg').innerHTML=isStock?'<span class="sub">近 5 日</span>':segHtml();
  nRange();
  $('n-banner2').textContent=NEWS_OFF;
  var title,kws;
  if(isStock){var sid=NP.kw.slice(1),inW=watchIds().indexOf(sid)>=0;kws=inW?stockKw(sid).kw:[];title=(BYID[sid]?sid+' '+BYID[sid].name:sid)+'｜'+(inW?kws.join('、'):'未追蹤');}
  else{var g=NS.groups.filter(function(x){return 'g'+x.id===NP.kw;})[0];kws=g?g.kw:[];title=kws.join('、')||'（尚未設定關鍵字）';}
  $('n-main').innerHTML='<div style="display:flex;align-items:baseline;gap:10px"><h2 class="kw">'+esc(title)+'</h2></div><div class="placeholder">'+NEWS_OFF+'</div>';
  $('n-src').innerHTML='';
}
function nRange(){if(PAGES){$('n-date').hidden=true;$('n-range').textContent='近 '+(NP.kw.charAt(0)==='g'?nSpan():5)+' 天（依新聞發布時間；後端不提供指定日期）';return;}var i=+$('n-date').value||0,sp=NP.kw.charAt(0)==='g'?nSpan():1,now=new Date();var d=new Date(now.getFullYear(),now.getMonth(),now.getDate()-i),p=new Date(now.getFullYear(),now.getMonth(),now.getDate()-i-sp);$('n-range').textContent=(p.getMonth()+1)+'/'+p.getDate()+' 07:30（含）– '+(d.getMonth()+1)+'/'+d.getDate()+' 07:30（不含），台灣時間';}
$('n-date').addEventListener('change',function(){nRange();});
$('n-kw').addEventListener('change',function(){location.hash='#/news/'+$('n-kw').value;});
/* ================= NEWS SETTINGS ================= */
function chipBox(arr,kind,key,max,placeholder){
  return '<div class="chips'+(kind==='ex'?' ex':'')+'">'+arr.map(function(k,i){return '<span class="chip">'+esc(k)+'<button aria-label="移除 '+esc(k)+'" data-chiprm="'+esc(kind+'|'+key+'|'+i)+'">×</button></span>';}).join('')+
   (arr.length<max?'<input aria-label="'+esc(placeholder)+'" placeholder="'+esc(placeholder)+'" data-chipadd="'+esc(kind+'|'+key)+'">':'<span style="font-size:11px;color:var(--faint)">已達 '+max+' 個</span>')+'</div>';
}
function nsRender(){
  $('ns-span').innerHTML=[1,3].map(function(v){return '<button data-nsdef="'+v+'" class="'+((NS.span||1)===v?'on':'')+'" aria-pressed="'+((NS.span||1)===v)+'">'+v+' 天</button>';}).join('');
  $('ns-groups').innerHTML=NS.groups.map(function(g,i){
    return '<div class="kwrow"><span class="mono">'+(i+1)+'</span>'+chipBox(g.kw,'kw','g'+g.id,5,'輸入關鍵字後按 Enter')+chipBox(g.ex,'ex','g'+g.id,5,'排除字（選填）')+'<span style="display:flex;gap:6px"><button class="btn sm" data-nssave="1">儲存</button><button class="xbtn" data-nsdel="'+esc(g.id)+'" aria-label="刪除第 '+(i+1)+' 組">✕</button></span></div>';
  }).join('')||'<div class="placeholder" style="padding:8px 0">尚未建立關鍵字組。</div>';
  var ids=watchIds();
  $('ns-stocks').innerHTML=ids.length?ids.map(function(id){var s=stockKw(id);return '<div class="kwrow"><span class="mono">'+esc(id)+'</span>'+chipBox(s.kw,'kw','s'+id,5,'輸入關鍵字後按 Enter')+chipBox(s.ex,'ex','s'+id,5,'排除字（選填）')+'<span><button class="btn sm" data-nssave="1">儲存</button></span></div>';}).join(''):'<div class="placeholder">自選群組目前沒有公司。</div>';
  $('ns-src').innerHTML='<div class="placeholder">新聞來源待核准（白名單由後端提供，核准後這裡只能停用）。</div>';
}
function chipTarget(key){if(key.charAt(0)==='g')return NS.groups.filter(function(g){return 'g'+g.id===key;})[0];return stockKw(key.slice(1));}
document.addEventListener('keydown',function(e){
  var t=e.target;if(!t.dataset||!t.dataset.chipadd||e.key!=='Enter')return;
  var p=t.dataset.chipadd.split('|'),obj=chipTarget(p[1]),v=t.value.trim();if(!v||!obj)return;
  var arr=obj[p[0]],mx=(p[1].charAt(0)==='r'&&p[0]==='kw')?10:5;if(arr.indexOf(v)<0&&arr.length<mx)arr.push(v);saveNS();nsRender();
  var again=document.querySelector('[data-chipadd="'+p[0]+'|'+p[1]+'"]');if(again)again.focus();
});

/* ================= REPORT SETTINGS ================= */
var RP={id:null};
function rsGet(id){if(!RS[id])RS[id]={kw:stockKw(id).kw.slice(0,5),time:'',news:true,focus:[],cmp:true};return RS[id];}
/* V6.2：排程日期改為月曆選取（Demo_issue V6 3-1） */
var CAL={y:null,m:null};
function ymd(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function calHtml(sel){
  var now=new Date(),today=ymd(now);
  if(CAL.y==null){var base=sel?new Date(sel+'T00:00'):now;CAL.y=base.getFullYear();CAL.m=base.getMonth();}
  var first=new Date(CAL.y,CAL.m,1),nd=new Date(CAL.y,CAL.m+1,0).getDate(),minM=now.getFullYear()*12+now.getMonth(),cur=CAL.y*12+CAL.m;
  var h='<div class="cal" role="group" aria-label="選擇排程日期"><div class="chd"><button data-calnav="-1" aria-label="上個月"'+(cur<=minM?' disabled':'')+'>‹</button><span>'+CAL.y+' 年 '+(CAL.m+1)+' 月</span><button data-calnav="1" aria-label="下個月"'+(cur>=minM+11?' disabled':'')+'>›</button></div><div class="cgrid">';
  '日一二三四五六'.split('').forEach(function(w){h+='<span class="wk">'+w+'</span>';});
  for(var i=0;i<first.getDay();i++)h+='<span></span>';
  for(var d=1;d<=nd;d++){var v=ymd(new Date(CAL.y,CAL.m,d)),past=v<today;
    h+='<button class="d'+(v===today?' today':'')+(v===sel?' on':'')+'" data-calpick="'+v+'"'+(past?' disabled':'')+' aria-label="'+(CAL.m+1)+' 月 '+d+' 日'+(v===today?'（今天）':'')+'"'+(v===sel?' aria-pressed="true"':'')+'>'+d+'</button>';}
  return h+'</div></div>';
}
document.addEventListener('click',function(e){
  var t=e.target.closest('[data-calnav],[data-calpick]');if(!t||t.disabled)return;
  if(t.dataset.calnav){CAL.m+=+t.dataset.calnav;if(CAL.m<0){CAL.m=11;CAL.y--;}if(CAL.m>11){CAL.m=0;CAL.y++;}rsRender();return;}
  var s=rsGet(RP.id),tm=s.time?s.time.slice(11,16):'08:00';s.time=t.dataset.calpick===(s.time||'').slice(0,10)?'':t.dataset.calpick+'T'+tm;saveRS();rsRender();
});
function rsRender(){
  var ids=watchIds();if(ids.indexOf(RP.id)<0)RP.id=ids[0]||null;
  $('rs-list').innerHTML=ids.map(function(id){var s=rsGet(id);return '<button class="'+(id===RP.id?'on':'')+'" data-rspick="'+esc(id)+'"><span>'+esc(id)+' '+esc(BYID[id].name)+'</span><span style="color:var(--faint);font-size:11px">'+(s.time?'排程 '+esc(s.time.slice(5).replace('-','/').replace('T',' ')):'手動')+'</span></button>';}).join('')||'<div class="placeholder">自選群組目前沒有公司。</div>';
  if(!RP.id){$('rs-panel').innerHTML='<div class="placeholder">請先把公司加入自選群組。</div>';return;}
  var s=rsGet(RP.id),r=BYID[RP.id];
  var h='<div style="display:flex;align-items:center;gap:10px"><h2>'+esc(r.id)+' '+esc(r.name)+'</h2><span class="grow"></span><span id="rs-genbox"><button class="btn primary" disabled title="報告流程契約交付後開放">產生報告（尚未開放）</button></span></div><div class="sub" id="rs-reqstate"></div>';
  if(PAGES)h+='<div class="placeholder">目前「產生報告」只送出公司與期別；下方的關鍵字、納入新聞、與上一期比較、重點大項與參考檔選擇，要等後端報告契約（REPORT-01）完成後才會帶入報告。報告為規則式整理（不是 AI 撰寫）。</div>';
  h+='<div class="field"><label class="k">報告關鍵字（最多 10 個，預設帶入個股新聞關鍵字；產業背景每份最多收 10 則）</label>'+chipBox(s.kw,'kw','r'+RP.id,10,'輸入後按 Enter')+'</div>';
  var sd=s.time?s.time.slice(0,10):'',st=s.time?s.time.slice(11,16):'08:00',topt='';
  for(var hh2=0;hh2<24;hh2++)for(var mm=0;mm<60;mm+=30){var tv=String(hh2).padStart(2,'0')+':'+(mm?'30':'00');topt+='<option value="'+tv+'"'+(tv===st?' selected':'')+'>'+tv+'</option>';}
  h+='<div class="field"><span class="k" style="font-size:12px;color:var(--muted)">'+(PAGES?'排程時間（尚未啟用：目前只保存設定，不會自動產生，請用「產生報告」手動送出）':'排程時間（選填；不設定則只能手動產生）')+'</span><div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">'+calHtml(sd)+
    '<div style="display:flex;flex-direction:column;gap:8px"><span style="font-size:12px;color:var(--text2)">'+(sd?'已選 '+esc(sd.replace(/-/g,'/'))+'（'+'日一二三四五六'.charAt(new Date(sd+'T00:00').getDay())+'）':'尚未選日期')+'</span><label class="sr" for="rs-tm">時間</label><select class="inp" id="rs-tm"'+(sd?'':' disabled')+'>'+topt+'</select>'+(s.time?'<button class="btn sm" data-rsclear="1" style="align-self:flex-start">清除排程</button>':'')+'</div></div>'+(s.status?'<div class="sub">排程狀態：'+esc({SCHEDULED:'已排程',PAUSED:'暫停（已移出自選）',EXPIRED:'已過期，未補跑',CANCELLED:'已取消',DONE:'已完成',FAILED:'失敗'}[s.status]||s.status)+'</div>':'')+'</div>';
  h+='<div class="field"><label class="chk"><input type="checkbox" id="rs-news"'+(s.news?' checked':'')+'>納入個股新聞</label><label class="chk"><input type="checkbox" id="rs-cmp"'+(s.cmp?' checked':'')+'>與上一期比較</label></div>';
  h+='<div class="field"><span class="k" style="font-size:12px;color:var(--muted)">重點大項（選填，報告會優先解讀）</span><div class="srcgrid">'+MAJ.map(function(l,k){return '<label class="chk"><input type="checkbox" data-focus="'+esc(MJ[k].id)+'"'+(s.focus.indexOf(MJ[k].id)>=0?' checked':'')+'>'+esc(l)+'</label>';}).join('')+'</div></div>';
  h+='<div class="field" id="rs-infield"><span class="k" style="font-size:12px;color:var(--muted)">參考資料</span><div id="rs-inputs"><div class="placeholder">上傳、列檔與移除端點交付後開放。</div><button class="btn sm" style="align-self:flex-start" disabled>加入檔案（尚未開放）</button></div></div>';
  h+='<div class="field"><span class="k" style="font-size:12px;color:var(--muted)">歷次報告</span><div id="rs-history"><div class="placeholder">尚無報告。</div></div></div>';
  h+='<div class="placeholder">新的分析期別完成或加入參考資料時，只會提示「有新資料，是否重新產生」，不會自動產生。移出自選時暫停排程、保留報告與設定；再次加入時恢復，不補跑過期排程。</div>';
  $('rs-panel').innerHTML=h;
  $('rs-tm').addEventListener('change',function(){if(s.time){s.time=s.time.slice(0,10)+'T'+this.value;saveRS();rsRender();}});
  $('rs-news').addEventListener('change',function(){s.news=this.checked;saveRS();});
  $('rs-cmp').addEventListener('change',function(){s.cmp=this.checked;saveRS();});
  document.querySelectorAll('[data-focus]').forEach(function(c){c.addEventListener('change',function(){var f=c.dataset.focus,i=s.focus.indexOf(f);if(c.checked&&i<0)s.focus.push(f);if(!c.checked&&i>=0)s.focus.splice(i,1);saveRS();});});
}
var _ct=chipTarget;chipTarget=function(key){if(key.charAt(0)==='r')return rsGet(key.slice(1));return _ct(key);};
/* ================= 說明與狀態 ================= */
var CODE_HELP=[['分數（名次）','試算分數；括號內為該大項全市場名次。個股頁另顯示同業名次（同產業，規格書 PG002，至少 5 家）。'],['政','政策分：規則依政策給分（例如歷史不足元件給 0 分），不是真實表現。名次旁「政n」表示 12 大項中有 n 項為政策分。'],['Ab','分數不可得（UNAVAILABLE）'],['NA','不適用（NOT_APPLICABLE／OUT_OF_SCOPE_FINANCIAL），個股頁展開可區分原狀態'],['RC','規則設定待確認（CONFIGURATION_PENDING）'],['FD','功能未啟用（NOT_ENABLED）'],['SU','適用範圍待確認（SCOPE_UNVERIFIED）'],['UN','未知狀態或分數數值異常'],['NR','總名次不可排名：任一大項沒有可排名的分數'],['未評估','尚無足夠已驗收財報，不參與排名（排在最後，依代號）'],['否決','資格否決：不改分數與名次'],['複核','財務複核：由實際觸發的 RGF003／RGF004 產生'],['第二階段','看最近年報往前約 5 年的指標變化，結果為可供判讀、注意警示或需複核；需複核分「趨勢惡化」「資料不足」。請人工判讀，不是否決'],['下層 n 項觸發','該大項底下觸發 Gate 的來源項目數（以項目去重，不是獨立事件數）'],['待查：代碼','中文對照表沒有收錄的代碼']];
var EXPL=null,EXPL_LOADING=false;
function explFrom(C){
  function conv(n){return {id:n.id,en:n.en,zh:n.zh,goal:n.goal,full:n.def&&n.def!==n.zh?n.def:'',w:n.lv>1?n.w:null,c:(n.c||[]).map(conv)};}
  return (C.tree||[]).map(conv);
}

/* 說明頁：/api/v1/help（版本綁定的 109 項，含公式、方向、比較基準；R-UI-2） */
function explFromHelp(h){
  var by={},roots=[];
  (h.features||[]).forEach(function(f){by[f.feature_id]={id:f.feature_id,en:f.item,zh:f.definition_zh,full:f.full_name,goal:f.goal_zh,fx:f.formula_display,dir:f.direction,bm:f.benchmark,w:f.parent_id?f.parent_weight:null,c:[]};});
  (h.features||[]).forEach(function(f){var n=by[f.feature_id];if(f.parent_id&&by[f.parent_id])by[f.parent_id].c.push(n);else if(!f.parent_id)roots.push(n);});
  var order=MJ.map(function(m){return m.id;});roots.sort(function(a,b){return order.indexOf(a.id)-order.indexOf(b.id);});
  return roots;
}
function hpLoad(){
  if(EXPL||EXPL_LOADING)return;
  if(!hpLoad.tried){hpLoad.tried=true;EXPL_LOADING=true;KupeiAPI.req('GET','/help').then(function(r){EXPL_LOADING=false;if(r.ok&&r.data.features){EXPL=explFromHelp(r.data);EXPL.ver=r.data.calculation_spec_version+'／'+r.data.presentation_spec_version;}else hpLoad();if(curPage==='help')hpRender();},function(){EXPL_LOADING=false;hpLoad();if(curPage==='help')hpRender();});return;}
  var ids=Object.keys(COMP).filter(function(k){return COMP[k].tree&&COMP[k].tree.length;});
  if(ids.length){EXPL=explFrom(COMP[ids[0]]);return;}
  var ref=MARKET.filter(function(r){return r.assessed&&r.rank!=null;})[0];if(!ref)return;
  EXPL_LOADING=true;
  KupeiAPI.company(ref.id).then(function(c){COMP[ref.id]=c;EXPL=explFrom(c);EXPL_LOADING=false;if(curPage==='help')hpRender();},function(){EXPL_LOADING=false;});
}
function hpNode(n,lv,q){
  var txt=[n.id,n.en,n.full,n.zh,n.goal].join(' ').toLowerCase(),kids='',hit=!q||txt.indexOf(q)>=0;
  (n.c||[]).forEach(function(c){kids+=hpNode(c,lv+1,q);});
  if(!hit&&!kids)return '';
  var meta='';[['分析目的',n.goal],['計算方式',n.fx],['方向',n.dir],['比較基準',n.bm],['權重',n.w==null?null:(+n.w).toFixed(2)]].forEach(function(x){if(x[1]!=null&&x[1]!==''&&x[1]!=='N/A'&&x[1]!=='None')meta+='<span class="k">'+x[0]+'</span><span>'+esc(x[1])+'</span>';});
  var head='<div class="hd"><span class="mono" style="color:var(--faint);font-size:11px">'+esc(n.id)+'</span><b>'+esc(n.en||n.id)+'</b><span>'+esc(n.zh||'')+'</span><span class="mono" style="color:var(--faint);font-size:11px">'+esc(n.full||'')+'</span>'+(lv===1&&n.id==='K005'?'<span class="tag">年報計分</span>':'')+'</div>';
  if(lv===1)return '<details class="help-node"'+(q?' open':'')+'><summary>'+head+'</summary><div class="meta">'+meta+'</div>'+kids+'</details>';
  return '<div class="help-node help-lv'+lv+'">'+head+'<div class="meta">'+meta+'</div>'+kids+'</div>';
}
function hpRender(){
  hpLoad();
  var q=($('hp-q').value||'').trim().toLowerCase();
  $('hp-tree').innerHTML=EXPL?(EXPL.map(function(n){return hpNode(n,1,q);}).join('')||'<div class="placeholder">沒有符合的項目。</div>'):'<div class="placeholder">'+(EXPL_LOADING?'載入評分項目中…':'評分項目說明尚未提供。')+'</div>';
  $('hp-codes').innerHTML=CODE_HELP.map(function(x){return '<span class="mono" style="color:var(--text)">'+esc(x[0])+'</span><span style="color:var(--text2)">'+esc(x[1])+'</span>';}).join('');
  vpRender();
}
$('hp-q').addEventListener('input',hpRender);
function vpRender(){$('vp-body').innerHTML='<tr><td colspan="6" class="placeholder">'+(VAL.on?'估價已提供（估價基準日 '+esc(VAL.date||'—')+'），各公司的中心、上下限、數據上限與隱含成長率見個股頁「估價」。參數明細表目前不在此頁顯示。':'估價參數尚未提供。')+'</td></tr>';}
function v(x){return x==null||x===''?'未提供':String(x);}
/* 日期時間一律用台灣時間「2026/10/27 13:30:00」；不是日期時間的字串原樣顯示 */
function dtTxt(x){if(x==null||x==='')return '—';var d=new Date(x);return isNaN(d)?String(x):d.toLocaleString('zh-TW',{hour12:false,timeZone:'Asia/Taipei'});}
function stRender(){
  var asd=MARKET.length,all=ROWS.length,na=ROWS.filter(function(r){return !r.assessed;}).length,ranked=ROWS.filter(function(r){return r.assessed&&r.rank!=null;}).length;
  var p2={};ROWS.forEach(function(r){if(r.assessed)p2[r.p2zh||r.p2||'未提供']=(p2[r.p2zh||r.p2||'未提供']||0)+1;});
  function en(x){return x&&x.enabled?'啟用':'未啟用';}
  var q=STAT.quotes||{},hi=STAT.history||{},va=STAT.valuation||{},bk=STAT.backup||{};
  var kv=[
    ['交付狀態',(STAT.status==='PUBLISHED_UI'?'正式資料':v(STAT.status))+(STAT.published===true?'（已發布）':STAT.published===false?'（未發布）':'')],
    ['資料計算版本',v(STAT.data_calculation_version)],
    ['呈現規格版本',v(STAT.presentation_spec_version)],
    ['Gate 執行模式',v(STAT.gate_execution_mode)+(STAT.production_enabled===true?'（Production 已啟用）':'')],
    STAT.manifest_sha256?['manifest 雜湊',String(STAT.manifest_sha256).slice(0,8)]:null, /* 沒有就不列 */
    ['分析財報期別',v(H.requested_period)+'（DAR-L 依 '+v(H.annual_period)+' 年報）'],
    ['資料可得日（as-of）',v(H.as_of)],
    ['公司數',all+' 家（已評估 '+(all-na)+'、未評估 '+na+'；可排名 '+ranked+'；首頁不列金融保險業，列出 '+asd+' 家）'],
    ['第二階段處置',Object.keys(p2).map(function(k){return k+' '+p2[k];}).join('、')],
    ['中文對照',TR_OK?'已載入（'+Object.keys(TR).length+' 個代碼）'+(!PAGES&&STAT.ui_note_translations_version?'｜'+STAT.ui_note_translations_version:''):'未提供（顯示「待查：代碼」）'], /* Pages：版本字串是交付方的內部備註，不顯示 */
    ['行情',q.enabled?({OPEN:'交易中',DELAYED:'延遲',CLOSED:'收盤／休市'}[QT.st||q.market_status]||v(q.market_status))+'｜最後成功 '+dtTxt(q.last_success_at)+(q.last_error_at?'｜最後失敗 '+dtTxt(q.last_error_at):'')+'｜判定依據 '+v(q.calendar_basis)+(fmSrc()?'｜資料來源 FinMind':''):'未啟用'],
    ['近 20 日行情與月營收',hi.enabled?'啟用｜最後更新 '+dtTxt(hi.last_success_at):'未啟用'],
    ['全市場估價',va.enabled?'啟用｜估價基準日 '+(VAL.on?v(VAL.date||va.valuation_date):'載入中…'):'未啟用（尚無正式估價快照）'],
    ['新聞',(function(n){if(PAGES)return '依關鍵字查詢 Google／Bing 新聞（每 30 分鐘更新）';if(!n||!n.enabled)return '未啟用';var t=function(x){return x?new Date(x).toLocaleString('zh-TW',{hour12:false,timeZone:'Asia/Taipei'}):'—';};return '啟用｜來源 '+((n.source_ids||[]).join('、')||'—')+'｜文章 '+(n.article_count==null?'—':n.article_count)+' 則｜最後成功 '+t(n.last_success_at)+(n.last_error_at?'｜最後失敗 '+t(n.last_error_at)+(n.last_error_code?'（'+n.last_error_code+'）':''):'')+'｜摘要方式 '+(n.summary_mode==='RULE_BASED_METADATA_SUMMARY'?'規則式（非 AI）':v(n.summary_mode));})(STAT.news)],
    ['報告',PAGES?'規則式報告（非 AI），依請求產生（登入帳號後可送出，最多 20 筆；可上傳參考檔：PDF、TXT、MD、CSV、XLSX、PNG、JPEG，單檔 20 MiB；V1 只列參考檔索引）':STAT.reports&&STAT.reports.enabled?'啟用｜佇列 '+(STAT.reports.queue_count||0)+' 筆':(PAGES?'未提供（後端未承接）':'未啟用（主機尚未設定報告根目錄）')],
    PAGES&&!bk.enabled?null:['備份',!bk.enabled?'未設定':(bk.status==='PASS'?'正常｜最後完成 '+v(bk.completed_at):'🔴 異常｜'+v(bk.error_code))], /* Pages 沒有備份功能：不列 */
    ['資料儲存',PAGES?(window.KupeiAuth&&window.KupeiAuth.session()?'這台瀏覽器；已登入 '+window.KupeiAuth.session().username+'，自選、設定與個股問題依帳號雲端同步':'這台瀏覽器（未登入；登入後自選、設定與個股問題可跨裝置同步）'):(SRV.mode==='server'?'主機（跨裝置同步）':'這台瀏覽器（主機寫入服務未啟用）')]
  ];
  $('st-kv').innerHTML=kv.filter(Boolean).map(function(x){return '<div><div class="k">'+esc(x[0])+'</div><div class="v">'+esc(x[1])+'</div></div>';}).join('');
  var lg=SRV.mode!=='server'?'':(SRV.auth?'已登入　<button class="btn sm" data-logout="1">登出</button>':'未登入（可瀏覽，不能修改）　<button class="btn sm primary" data-login="1">登入</button>');
  $('st-src').innerHTML=(lg?'<div style="margin-bottom:8px">登入狀態：'+lg+'</div>':'')+(PAGES?'評分與明細：後端 Server API 的批次資料（/data/…，依 manifest 版本）<br>行情：每日收盤與近 20 日、近 5 月營收（/api/market/…），非即時'+(QT.live?'；盤中為 FinMind 盤中價（登入後約 30 秒更新；資料來源：FinMind）':QT.close?'；收盤後正式收盤還沒到的市場暫用 FinMind 收盤快照（資料來源：FinMind）':QT.intra?'；盤中為證交所快照（約 10 分鐘延遲）':'')+(fmSrc()&&!QT.live?'；收盤資料來源：FinMind':'')+'<br>自選群組、新聞／報告設定與個股問題：存在這台瀏覽器；登入後依帳號雲端同步':'首頁與個股資料：/api/v1/home、/api/v1/companies/{代號}（依正式 pointer）<br>行情：FinMind 全市場快照，主機每 30 秒抓取並推送；畫面標示資料來源 FinMind<br>自選群組、新聞與報告設定、個股問題：'+(SRV.mode==='server'?'存在主機':'目前只存在這台瀏覽器'));
}
/* ================= router ================= */
var lastScroll={},curPage='home';
function show(pg,rail){document.querySelectorAll('.page').forEach(function(p){p.classList.toggle('on',p.id==='pg-'+pg);});document.querySelectorAll('.railbtn').forEach(function(b){b.classList.toggle('on',b.dataset.go==='#/'+(rail||pg));});}
function route(){
  var h=location.hash||'#/home',p=h.slice(2).split('/');
  if(curPage==='home')lastScroll.home=$('h-wrap').scrollTop;
  closeMenu();hideTip();
  var prev=curPage;
  if(p[0]==='stock'){SP.id=p[1];SP.from=decodeURIComponent(p[2]||'home');SP.open={};SP.rd={};show('stock','');curPage='stock';sLoad();return;}
  if(p[0]==='report'){show('report','');rRender(p[1]);curPage='report';return;}
  if(p[0]==='watch'){show('watch');wRender();curPage='watch';return;}
  if(p[0]==='news'){show('news','');nRender(p[1]||('g'+(NS.groups[0]?NS.groups[0].id:1)));curPage='news';return;}
  if(p[0]==='news-settings'){show('news-settings');nsRender();curPage=p[0];return;}
  if(p[0]==='report-settings'){show('report-settings');rsRender();curPage=p[0];return;}
  if(p[0]==='help'||p[0]==='valuation-params'){show('help','help');hpRender();curPage='help';return;}
  if(p[0]==='status'){show('status');stRender();curPage=p[0];return;}
  show('home');curPage='home';hNews();
  var back=function(){if(lastScroll.home!=null)$('h-wrap').scrollTop=lastScroll.home;};
  if(prev!=='home'){if(HS.done===hTok&&HS.sig===hSig()&&HS.pxl===pxLabel()){back();if(!isM())hCheckWide();}else hRender(back);}else if(!isM())hCheckWide();
}
window.addEventListener('hashchange',route);

/* ================= events ================= */
document.addEventListener('click',function(e){
  var t=e.target.closest('button,a,tr[data-row]');if(!t)return;var d=t.dataset;
  if(d.go){location.hash=d.go;return;}
  if(d.sort){hSortBy(d.sort);return;}
  if(d.sel){hSelect(d.sel);return;}
  if(d.open){e.stopPropagation();location.hash='#/stock/'+d.open+'/'+encodeURIComponent(curPage==='watch'?'watch:'+W.cur:'home');return;}
  if(d.menu){openMenu(d.menu,t);return;}
  if(d.close){closeMenu();return;}
  if(d.setg){if(t.getAttribute('aria-disabled')==='true'){toast('該群組已滿 '+GMAX+' 家');return;}var res=setGroup(d.id,+d.setg),gn=W.groups.filter(function(x){return x.id===+d.setg;})[0].name;
    if(res.indexOf('moved:')===0)toast('已從 '+res.slice(6)+' 移到 '+gn);else if(res==='added')toast('已加入 '+gn);closeMenu();reRender(d.id);return;}
  if(d.newg){if(W.groups.length>=5)return;var nid=W.groups.reduce(function(a,x){return Math.max(a,x.id);},0)+1;W.groups.push({id:nid,name:'自選'+nid,color:nextColor(),ids:[]});setGroup(d.newg,nid);toast('已新增 自選'+nid+' 並加入');closeMenu();reRender(d.newg);return;}
  if(d.rmg){var g=groupOf(d.rmg),rid2=d.rmg;if(g){var pos2=g.ids.indexOf(rid2);g.ids.splice(pos2,1);saveW();toast('已從 '+g.name+' 移出 '+BYID[rid2].name,function(){if(groupOf(rid2))return;g.ids.splice(pos2,0,rid2);saveW();reRender(rid2);});}closeMenu();reRender(rid2);return;}
  if(d.tab){W.cur=+d.tab;saveW();wRender();return;}
  if(d.gmenu){openGroupMenu(+d.gmenu,t);return;}
  if(d.gdel){confirmDelete(+d.gdel);return;}
  if(d.gdelok){
    var gid=+d.gdelok,idx=-1,snap=JSON.stringify(W);W.groups.forEach(function(x,i){if(x.id===gid)idx=i;});var gname=W.groups[idx].name,n=W.groups[idx].ids.length;
    W.groups.splice(idx,1);if(!W.groups.length)W.groups.push({id:1,name:'自選1',color:COLORS[0],ids:[]});W.cur=W.groups[0].id;saveW();closeMenu();wRender();
    toast('已刪除「'+gname+'」'+(n?'，移出 '+n+' 家':''),function(){W=JSON.parse(snap);W.cur=gid;saveW();wRender();});return;}
  if(d.addtab){if(W.groups.length>=5)return;var id2=W.groups.reduce(function(a,x){return Math.max(a,x.id);},0)+1;W.groups.push({id:id2,name:'自選'+id2,color:nextColor(),ids:[]});W.cur=id2;saveW();wRender();return;}
  if(d.rm){e.stopPropagation();var cg=curGroup(),pos=cg.ids.indexOf(d.rm),rid=d.rm;cg.ids.splice(pos,1);saveW();wRender();toast('已從 '+cg.name+' 移除 '+BYID[rid].name,function(){if(groupOf(rid))return;cg.ids.splice(pos,0,rid);saveW();wRender();});return;}
  if(d.tog){SP.open[d.tog]=!SP.open[d.tog];sRender();return;}
  if(d.rd){SP.rd[d.rd]=!SP.rd[d.rd];sRender();return;}
  if(d.wsel){var pv=WS.sel;WS.sel=pv===d.wsel?null:d.wsel;if(pv&&$('wr-'+pv))$('wr-'+pv).classList.remove('sel');if(WS.sel&&$('wr-'+WS.sel))$('wr-'+WS.sel).classList.add('sel');return;}
  if(d.chiprm){var p=d.chiprm.split('|'),obj=chipTarget(p[1]);if(obj){obj[p[0]].splice(+p[2],1);if(p[1].charAt(0)==='r'){saveRS();rsRender();}else{saveNS();nsRender();}}return;}
  if(d.nssave){saveNS();if(SRV.mode!=='server')toast('已儲存（目前存在這台瀏覽器）');return;}
  if(d.nsdel){NS.groups=NS.groups.filter(function(g){return g.id!==+d.nsdel;});saveNS();nsRender();return;}
  if(d.rspick){RP.id=d.rspick;CAL.y=null;rsRender();return;}
  if(d.rsclear){rsGet(RP.id).time='';saveRS();rsRender();return;}
});
/* report chips use the shared chip handler */
document.addEventListener('keydown',function(e){var t=e.target;if(t.dataset&&t.dataset.chipadd&&e.key==='Enter'&&t.dataset.chipadd.indexOf('|r')>0){saveRS();rsRender();var a=document.querySelector('[data-chipadd="'+t.dataset.chipadd+'"]');if(a)a.focus();}});
document.addEventListener('click',function(e){var t=e.target.closest('[data-nsdef]');if(!t)return;NS.span=+t.dataset.nsdef;NV.span=null;saveNS();nsRender();toast('產業新聞預設改為 '+NS.span+' 天');});
$('ns-add').addEventListener('click',function(){var nid=NS.groups.reduce(function(a,x){return Math.max(a,x.id);},0)+1;NS.groups.push({id:nid,kw:[],ex:[]});saveNS();nsRender();var ins=document.querySelectorAll('[data-chipadd^="kw|g'+nid+'"]');if(ins[0])ins[0].focus();});
$('h-reset').addEventListener('click',function(){HS.key='total';HS.dir='desc';hRender();});
$('h-jump').addEventListener('click',hJump);
$('h-q').addEventListener('keydown',function(e){if(e.key==='Enter')hJump();});
$('h-q').addEventListener('input',function(){$('h-msg').textContent='';});
$('h-hideveto').addEventListener('change',function(){HS.hideVeto=this.checked;hRender();});
$('h-hidetrend').addEventListener('change',function(){HS.hideTrend=this.checked;hRender();});
$('h-refresh').addEventListener('click',function(){location.reload();});
$('w-edit').addEventListener('click',function(){var g=curGroup();if(!g)return;var inp=$('w-rename');inp.hidden=false;$('w-title').hidden=true;inp.value=g.name;inp.focus();inp.select();});
function commitName(){var g=curGroup(),inp=$('w-rename');if(inp.hidden)return;var v=inp.value.trim();if(SRV.mode==='server'){inp.hidden=true;$('w-title').hidden=false;if(g&&v&&v.slice(0,12)!==g.name)srvRename(g.id,v.slice(0,12));return;}if(g&&v)g.name=v.slice(0,12);inp.hidden=true;$('w-title').hidden=false;saveW();wRender();}
$('w-rename').addEventListener('keydown',function(e){if(e.key==='Enter')commitName();if(e.key==='Escape'){$('w-rename').hidden=true;$('w-title').hidden=false;}});
$('w-rename').addEventListener('blur',commitName);
$('r-back').addEventListener('click',function(){var id=(location.hash.split('/')[2])||SP.id;location.hash='#/stock/'+id+'/'+encodeURIComponent(SP.id===id&&SP.from?SP.from:'home');});
$('s-back').addEventListener('click',function(){location.hash=SP.from&&SP.from.indexOf('watch')===0?'#/watch':'#/home';});
$('n-back').addEventListener('click',function(){if(NP.kw.charAt(0)==='s'){var sid=NP.kw.slice(1);location.hash='#/stock/'+sid+'/'+encodeURIComponent(SP.id===sid&&SP.from?SP.from:'home');}else history.back();});
$('s-prev').addEventListener('click',function(){var l=srcList(),i=l.indexOf(SP.id);if(i>0)location.hash='#/stock/'+l[i-1]+'/'+encodeURIComponent(SP.from);});
$('s-next').addEventListener('click',function(){var l=srcList(),i=l.indexOf(SP.id);if(i>=0&&i<l.length-1)location.hash='#/stock/'+l[i+1]+'/'+encodeURIComponent(SP.from);});
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeMenu();});
document.addEventListener('click',function(e){
  var t=e.target.closest('[data-mexp],[data-wexp],[data-wmove]');if(!t)return;var d=t.dataset;
  if(d.mexp){MX.open[d.mexp]=!MX.open[d.mexp];var el=$('mr-'+d.mexp);if(el)el.outerHTML=mRow(BYID[d.mexp]);return;}
  if(d.wexp){MX.open['w'+d.wexp]=!MX.open['w'+d.wexp];wRender();return;}
  if(d.wmove){var p=d.wmove.split('|'),g=curGroup(),ids=g.ids,i=ids.indexOf(p[0]),j=i+(+p[1]);if(j<0||j>=ids.length)return;if(SRV.mode==='server'){var nids=ids.slice();nids.splice(i,1);nids.splice(j,0,p[0]);srvReorder(g.id,nids);return;}ids.splice(i,1);ids.splice(j,0,p[0]);saveW();wRender();return;}
});
$('h-retry').addEventListener('click',function(){location.reload();});
$('h-msort').addEventListener('change',function(){HS.key=this.value;HS.dir='desc';hRender();});
var wasM=isM();window.addEventListener('resize',function(){var m=isM();if(m!==wasM){wasM=m;curPage='';route();}});
/* init */
function basisTxt(){return '分析財報 '+v(H.requested_period)+'｜DAR-L 依 '+v(H.annual_period)+' 年報｜資料計算 '+v(STAT.data_calculation_version)+'｜as-of '+v(H.as_of);}
$('h-basis').textContent=basisTxt();
/* 手機註腳：日期不在中間斷行 */
function mfootRender(){$('h-mfoot').innerHTML=esc(basisTxt()+'｜試算'+(PAGES&&fmSrc()?'｜資料來源：FinMind':'')).replace(/\d{4}-\d{2}-\d{2}|\d{4}Q\d/g,'<span class="nb">$&</span>');}
mfootRender();
function bannerRender(){$('h-banner').innerHTML='<span><b>目前分數為試算版本</b>，回測效度驗證中；首頁排序只供瀏覽，不代表分析結論。</span><span>否決／複核徽章：'+esc(GATE_LABEL)+'，不改分數與名次。</span><span>'+(QT.on?(PAGES?(QT.live?'行情為 FinMind 盤中價（約 30 秒更新；'+esc(QT.live.hms||'—')+'；資料來源：FinMind）':QT.close?(QT.close.pending.L&&QT.close.pending.O?'行情為 ':'行情：'+(QT.close.pending.L?'上櫃':'上市')+'為每日收盤，'+(QT.close.pending.L?'上市':'上櫃')+'暫用 ')+esc(md(QT.close.day))+' FinMind 收盤快照（正式收盤待更新；資料來源：FinMind）':QT.intra?'行情為證交所盤中快照（約 10 分鐘延遲，非逐筆即時；'+esc(QT.intra.hm||'—')+'）':'行情為每日收盤價（非即時，收盤日 '+esc(md(QT.tdate))+(fmSrc()?'；資料來源：FinMind':'')+'）'):'成交價來源 FinMind（主機每 30 秒更新）'):'行情尚未接上')+'；'+(VAL.on?'安全邊際依'+(PAGES?(QT.live||QT.intra?'盤中價':'收盤價'):'即時股價')+'計算':'估價尚未提供')+'。</span><span>項目與代碼說明見工作列「說明」。</span>';}
bannerRender();
$('h-upd').textContent='行情：尚未接上';
if(PAGES){$('w-store').textContent='自選存在這台瀏覽器；登入帳號（左側「帳號」）後各裝置同步';$('ns-store').textContent='設定存在這台瀏覽器；登入帳號後各裝置同步｜來源：Google／Bing 新聞（每 30 分鐘更新）';}
if(SRV.mode==='server'){$('w-store').textContent='自選存在主機，各裝置同步；修改需登入';$('ns-store').textContent='每日擷取一次（前一日 07:30–當日 07:30）；設定存在主機';}
/* 首頁只在 main() 最後的 route() 畫一次；行情若已先到（SB.quotes）先套用，第一次畫面就有收盤價 */
if(SB&&SB.quotes&&SB.quotes.ok){qtApply(SB.quotes.data);updLine();bannerRender();}
if(SB&&SB.val&&SB.val.ok){vaApply(SB.val.data);bannerRender();}
qtStart();vaStart();
var _qa=quotesChanged;quotesChanged=function(f){bannerRender();_qa(f);};

/* ================= 上線前接線（2026-10-23）：新聞 T9、報告 T10／K10 =================
 * 依據：UIUX/Codex 任務/2026-10-23_上線前非AI功能_Claude實作與複查.md C1、C2。
 * 新聞只顯示規則式整理（RSS 標題、摘要、連結），不標成 AI 摘要；報告 AI 初稿未接入時停在「已送出」。 */
/* Pages（2026-10-27）：新聞走後端 /api/news（Google 新聞 RSS），報告走 /api/reports；後端未開通時各區塊顯示「尚未提供」（見 newsErr／repErr 的 NOT_PROVIDED） */
var NEWS_ON=PAGES||SRV.mode==='server'&&!!(STAT.news&&STAT.news.enabled);
var REP_ON=PAGES||SRV.mode==='server'&&!!(STAT.reports&&STAT.reports.enabled);
var NEWS_SRC='來源：Google／Bing 新聞（每 30 分鐘更新）';
NEWS_OFF=PAGES?OFFZH:(SRV.mode!=='server'?'新聞需連上主機才能顯示（目前為本機模式）。':'新聞服務尚未啟用。');
var LIMIT_ZH={RSS_METADATA_ONLY:'僅 RSS 標題與摘要',BODY_UNAVAILABLE:'未取得新聞全文',SOURCE_DISABLED_BY_USER:'來源已停用',TITLE_ONLY:'僅標題與連結',STALE:'暫時無法更新，顯示上次擷取結果'};
var REQ_ZH={SUBMITTED:'已送出（等待人工／AI 初稿）',DRAFTING:'初稿中',REVIEWING:'審核中',RECHECKING:'覆核中',PUBLISHED:'已發布',FAILED:'失敗',CANCELLED:'已取消',QUEUED:'排隊中',RUNNING:'產生中',DONE:'已完成'};
var REQ_ACTIVE=['SUBMITTED','DRAFTING','REVIEWING','RECHECKING','QUEUED','RUNNING'];
/* C-07：規則式報告管線（REPORT_RULE_V1）寫回請求的 message 是代碼；契約欄位缺少時管線會直接標失敗、不發布報告，這不是使用者的操作錯誤 */
function reqMsg(m){
  m=String(m==null?'':m);
  if(m==='REPORT_CONTRACT_INCOMPLETE'||m==='REPORT_SETTINGS_OR_MANIFEST_MISSING')return '報告管線的設定與資料契約尚未完成，暫時無法產生（不是你的操作錯誤，也沒有發布任何報告）';
  if(/^REPORT_RULE_V\d+/.test(m))return '規則式管線';
  return m.length>80?m.slice(0,80)+'…':m;
}
var IN_ALLOW=['.pdf','.md','.txt','.docx','.xlsx','.png','.jpg','.jpeg'],IN_MAX=20*1024*1024;
var NC={},RC={},PC={},IC={},NSRC={r:null,loading:false};
function ymdOff(i){var n=new Date();return ymd(new Date(n.getFullYear(),n.getMonth(),n.getDate()-(i||0)));}
function tpTime(iso){if(!iso)return '—';var d=new Date(iso);if(isNaN(d))return '—';return d.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});}
function safeUrl(u){return /^https:\/\//i.test(String(u||''))?String(u):'#';} /* 只放行 https（2026-10-27） */
function cached(store,key,path,then){
  var c=store[key];if(c&&(c.r||c.loading))return c;
  c=store[key]={loading:true,r:null};
  KupeiAPI.req('GET',path).then(function(r){c.loading=false;c.r=r;if(then)then();},function(){c.loading=false;c.r={ok:false,status:0,data:null};if(then)then();});
  return c;
}
/* ---------- 新聞 ---------- */
function newsErr(r){
  var code=r&&r.data&&r.data.error_code;
  if(!r||!r.status)return '新聞載入失敗（連線中斷），請稍後重新整理。';
  return {NOT_PROVIDED:'新聞尚未提供（後端尚未開通）。',NEWS_NO_KEYWORDS:'這組尚未設定關鍵字，請到「新聞關鍵字設定」新增。',RATE_LIMITED:'請求太頻繁，請稍後再試。',NEWS_DISABLED:'新聞服務尚未啟用。',NEWS_GROUP_NOT_FOUND:'這個關鍵字組尚未存到主機，請到「新聞關鍵字設定」按儲存。',STOCK_NOT_WATCHED:'此公司不在自選群組，沒有個股新聞。',INVALID_NEWS_QUERY:'新聞日期或顯示區間不正確。',COMPANY_NOT_FOUND:'找不到公司。'}[code]||('新聞載入失敗：'+errMsg(r));
}
function limitTags(arr){return (arr||[]).map(function(x){return '<span class="tag" style="background:var(--line);color:var(--text2)">'+esc(LIMIT_ZH[x]||x)+'</span>';}).join(' ');}
function artHtml(a,compact){
  var tb=a.timezone_basis&&a.timezone_basis!=='SOURCE_RFC822'?'（時間依據：'+(a.timezone_basis==='ASSUMED_ASIA_TAIPEI'?'推定台灣時間':'擷取時間')+'）':'';
  return '<div class="nart" style="border-top:1px solid var(--line);padding:6px 0;display:flex;flex-direction:column;gap:2px;min-width:0">'+
    '<div style="display:flex;gap:6px;align-items:baseline;min-width:0">'+(a.citation?'<span class="cite2">〔'+esc(a.citation)+'〕</span>':'')+
    (safeUrl(a.url)!=='#'?'<a href="'+esc(safeUrl(a.url))+'" target="_blank" rel="noopener noreferrer" style="min-width:0;overflow:hidden;text-overflow:ellipsis'+(compact?';white-space:nowrap':'')+'">'+esc(a.title)+'</a>':'<span title="連結不是 https，不提供開啟" style="min-width:0;overflow:hidden;text-overflow:ellipsis'+(compact?';white-space:nowrap':'')+'">'+esc(a.title)+'</span>')+'</div>'+
    '<div class="sub">'+esc(a.source_name||a.source_id||'')+'｜'+esc(tpTime(a.published_at_taipei||a.published_at_utc))+esc(tb)+(a.matched_keywords&&a.matched_keywords.length&&!compact?'｜符合：'+esc(a.matched_keywords.join('、')):'')+'</div>'+
    (compact?(a.summary_15?'<div style="font-size:12px;color:var(--text2)">'+esc(a.summary_15)+'</div>':''):(a.summary_30?'<div style="font-size:12px;color:var(--text2)">'+esc(a.summary_30)+'</div>':''))+'</div>';
}
function indNews(g,then){return cached(NC,'i|'+g.id+'|'+ymdOff(0)+'|'+nSpan(),'/news/industry?group='+encodeURIComponent(g.id)+'&date='+ymdOff(0)+'&span='+nSpan(),then);}
function newsList(c,n,compact){
  if(c.loading)return '<span class="placeholder">新聞載入中…</span>';
  if(!c.r.ok)return '<span class="placeholder">'+esc(newsErr(c.r))+'</span>';
  var d=c.r.data||{},arts=d.articles||[];
  if(!arts.length)return '<span class="placeholder">此區間沒有符合關鍵字的新聞。</span> '+limitTags(d.retrieval_limitations);
  return arts.slice(0,n).map(function(a){return artHtml(a,compact);}).join('')+(arts.length>n?'<span class="sub">另有 '+(arts.length-n)+' 則，見新聞頁</span>':'');
}
var _hMNews=hMNews;
hMNews=function(){
  if(!NEWS_ON){_hMNews();return;}
  var gs=NS.groups;$('h-mnews-s').textContent='產業新聞（'+gs.length+' 組｜'+nSpan()+' 天）';
  $('h-mnews-b').innerHTML='<div class="nhead">顯示區間 '+segHtml()+'</div>'+(gs.length?gs.map(function(g){
    var c=indNews(g,function(){if(curPage==='home')hNews();});
    return '<div style="display:flex;flex-direction:column;gap:4px;border-top:1px solid var(--line);padding-top:6px"><span class="kw" style="color:var(--text2)">'+esc(g.kw.join('、')||'（尚未設定關鍵字）')+'</span>'+newsList(c,3,true)+'</div>';
  }).join(''):'<span class="placeholder">尚未設定產業新聞關鍵字組，可到「新聞關鍵字設定」新增。</span>');
};
var _hNews=hNews;
hNews=function(){
  _hNews();
  if(!NEWS_ON)return;
  $('h-news').innerHTML=NS.groups.map(function(g){
    var c=indNews(g,function(){if(curPage==='home')hNews();});
    return '<div class="card"><div style="display:flex;align-items:baseline;gap:8px;min-width:0"><h2 style="white-space:nowrap">產業新聞</h2><span class="kw" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">｜'+esc(g.kw.join('、')||'（尚未設定關鍵字）')+'</span></div>'+newsList(c,5,false)+'<div style="display:flex;gap:8px;align-items:center"><a href="#/news/g'+esc(g.id)+'" style="font-size:12px">新聞頁</a><span class="sub">'+(PAGES?NEWS_SRC:'規則式整理（非 AI）')+'</span></div></div>';
  }).join('')||'<div class="placeholder">尚未設定產業新聞關鍵字組，可到「新聞關鍵字設定」新增。</div>';
};
var _sNews=sNews;
sNews=function(id){
  if(!NEWS_ON||!groupOf(id)){_sNews(id);return;}
  var c=cached(NC,'s|'+id+'|'+ymdOff(0),'/news/stock/'+encodeURIComponent(id)+'?date='+ymdOff(0)+'&days=5',function(){if(curPage==='stock'&&SP.id===id)sNews(id);});
  $('s-news').innerHTML='<div style="display:flex;align-items:center;gap:10px"><h2>個股新聞</h2><span class="sub">近 5 日｜關鍵字：'+esc(stockKw(id).kw.join('、')||'載入中')+'</span><span class="grow"></span><a href="#/news/s'+esc(id)+'" style="font-size:12px">新聞頁</a></div>'+newsList(c,5,false);
};
var _nRender=nRender;
nRender=function(kw){
  _nRender(kw);
  if(!NEWS_ON){$('n-banner2').textContent=NEWS_OFF;$('n-main').innerHTML='<div class="placeholder">'+esc(NEWS_OFF)+'</div>';return;}
  if(PAGES){nsrcLoad(function(){if(curPage==='news')nRender(NP.kw);});$('n-banner2').textContent=NSRC.r&&!NSRC.r.ok&&NSRC.r.data&&NSRC.r.data.error_code==='NOT_PROVIDED'?'新聞尚未提供（後端尚未開通）。':NEWS_SRC+'；只列標題與連結，不保存新聞全文';}
  else $('n-banner2').textContent='規則式整理（不是 AI 摘要）；只保存標題、RSS 摘要與連結，不保存新聞全文';
  var isStock=NP.kw.charAt(0)==='s',date=ymdOff(+$('n-date').value||0),c,title;
  if(isStock){
    var sid=NP.kw.slice(1),inW=watchIds().indexOf(sid)>=0;title=(BYID[sid]?sid+' '+BYID[sid].name:sid)+'｜'+(inW?stockKw(sid).kw.join('、'):'未追蹤');
    if(!inW){$('n-main').innerHTML='<h2 class="kw">'+esc(title)+'</h2><div class="placeholder">此公司不在自選群組，沒有個股新聞。</div>';$('n-src').innerHTML='';return;}
    c=cached(NC,'s|'+sid+'|'+date,'/news/stock/'+encodeURIComponent(sid)+'?date='+date+'&days=5',function(){if(curPage==='news')nRender(NP.kw);});
  }else{
    var g=NS.groups.filter(function(x){return 'g'+x.id===NP.kw;})[0];title=g?(g.kw.join('、')||'（尚未設定關鍵字）'):'（尚未設定關鍵字組）';
    if(!g){$('n-main').innerHTML='<div class="placeholder">尚未設定產業新聞關鍵字組。</div>';$('n-src').innerHTML='';return;}
    c=cached(NC,'i|'+g.id+'|'+date+'|'+nSpan(),'/news/industry?group='+encodeURIComponent(g.id)+'&date='+date+'&span='+nSpan(),function(){if(curPage==='news')nRender(NP.kw);});
  }
  var h='<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><h2 class="kw">'+esc(title)+'</h2></div>';
  if(c.loading||!c.r.ok){$('n-main').innerHTML=h+newsList(c,0,false);$('n-src').innerHTML='';return;}
  var d=c.r.data||{},arts=d.articles||[],ex=d.excluded||[];
  h+='<div style="display:flex;gap:6px;flex-wrap:wrap;margin:4px 0">'+limitTags(d.retrieval_limitations)+'</div>';
  if(d.summary)h+='<div class="report" style="border:1px solid var(--line);border-radius:6px;padding:8px;margin:6px 0"><span class="sub">規則式彙整（依發布時間列出前 5 則標題，非 AI 摘要）</span><p>'+esc(d.summary).replace(/〔(S\d+)〕/g,'<span class="cite">〔$1〕</span>')+'</p></div>';
  h+=arts.length?arts.map(function(a){return artHtml(a,false);}).join(''):'<div class="placeholder">此區間沒有符合關鍵字的新聞。</div>';
  if(ex.length)h+='<details style="margin-top:8px"><summary class="sub">已排除 '+ex.length+' 則（標題含排除字）</summary>'+ex.map(function(a){return '<div class="sub" style="padding:2px 0">'+esc(a.title)+'｜排除字：'+esc((a.matched_excludes||[]).join('、'))+'</div>';}).join('')+'</details>';
  h+='<div class="sub" style="margin-top:6px">產生時間 '+esc(tpTime(d.generated_at))+'</div>';
  $('n-main').innerHTML=h;
  var srcCount={};arts.forEach(function(a){var k=a.source_name||a.source_id;srcCount[k]=(srcCount[k]||0)+1;});
  $('n-src').innerHTML=Object.keys(srcCount).map(function(k){return '<div style="display:flex;gap:6px"><span>'+esc(k)+'</span><span class="grow"></span><span class="mono">'+srcCount[k]+' 則</span></div>';}).join('')||'<div class="placeholder">本區間沒有收錄來源。</div>';
};
$('n-date').addEventListener('change',function(){if(curPage==='news'&&NEWS_ON)nRender(NP.kw);});
/* 新聞來源清單：整頁共用一次（新聞頁的「尚未提供」判斷與新聞設定頁都用） */
var NSRC_CB=[];
function nsrcLoad(then){if(NSRC.r)return;if(then)NSRC_CB.push(then);if(NSRC.loading)return;NSRC.loading=true;
  var done=function(r){NSRC.loading=false;NSRC.r=r;var cb=NSRC_CB;NSRC_CB=[];cb.forEach(function(f){f();});};
  KupeiAPI.req('GET','/news/sources').then(done,function(){done({ok:false,status:0});});}
var _nsRender=nsRender;
nsRender=function(){
  _nsRender();
  if(!NEWS_ON){$('ns-src').innerHTML='<div class="placeholder">'+esc(NEWS_OFF)+'</div>';return;}
  if(curPage!=='news-settings'&&!NSRC.loading)NSRC.r=null; /* 每次進設定頁重讀：清單是目前新聞結果中出現過的媒體，會隨瀏覽的新聞增加 */
  nsrcLoad(function(){if(curPage==='news-settings')nsRender();});
  if(!NSRC.r){$('ns-src').innerHTML='<div class="placeholder">來源清單載入中…</div>';return;}
  if(!NSRC.r.ok){$('ns-src').innerHTML='<div class="placeholder">'+esc(newsErr(NSRC.r))+'</div>';return;}
  var all=(NSRC.r.data&&NSRC.r.data.sources)||[],fetched=all.filter(function(s){return s.enabled===true;}),links=all.filter(function(s){return s.enabled!==true;});
  /* Pages：enabled＝新聞結果中出現過的媒體（依名稱停用）；其餘＝新聞聚合來源（Google／Bing 新聞），只列出、不能停用 */
  $('ns-src').innerHTML=(fetched.length?fetched.map(function(s){var off=(NS.disabled||[]).indexOf(s.source_id)>=0;
    return '<label class="chk" title="'+esc(s.usage||'')+'"><input type="checkbox" data-nsrc="'+esc(s.source_id)+'"'+(off?'':' checked')+'>'+esc(s.name)+(PAGES?(s.usage?'<span class="sub">（'+esc(s.usage)+'）</span>':''):'<span class="sub">（'+esc(LIMIT_ZH[s.content_scope]||s.content_scope||'')+'）</span>')+(PAGES&&safeUrl(s.url)!=='#'?' <a href="'+esc(safeUrl(s.url))+'" target="_blank" rel="noopener noreferrer" class="sub">網站</a>':'')+'</label>';}).join(''):'<div class="placeholder">'+(PAGES?'目前的新聞結果中還沒有媒體來源；瀏覽產業或個股新聞後，出現過的媒體會列在這裡。':'目前沒有可自動擷取的來源。')+'</div>')+
    '<div class="placeholder">'+(PAGES?'取消勾選即停用該媒體：依媒體名稱過濾，只影響這台瀏覽器與帳號的顯示；清單是目前新聞結果中出現過的媒體（'+NEWS_SRC+'）。':'取消勾選即停用該來源；擷取白名單由後端維護，這裡不能新增。')+'</div>'+
    (links.length?'<div style="grid-column:1/-1;margin-top:6px"><span class="sub">'+(PAGES?'新聞聚合來源（新聞經由它們取得，不能停用）':'外部連結（不自動擷取，只提供網站入口）')+'</span>'+links.map(function(s){return '<div style="font-size:12px;padding:2px 0">'+(safeUrl(s.url)!=='#'?'<a href="'+esc(safeUrl(s.url))+'" target="_blank" rel="noopener noreferrer">'+esc(s.name)+'</a>':esc(s.name))+'<span class="sub">｜'+esc(s.usage||'')+'</span></div>';}).join('')+'</div>':'');
};
document.addEventListener('change',function(e){var t=e.target;if(!t.dataset||!t.dataset.nsrc)return;var id=t.dataset.nsrc;NS.disabled=(NS.disabled||[]).filter(function(x){return x!==id;});if(!t.checked)NS.disabled.push(id);saveNS();});
var _saveNS3=saveNS;saveNS=function(){NC={};_saveNS3();};
/* ---------- 報告與參考資料 ---------- */
function repErr(r){
  var code=r&&r.data&&r.data.error_code;
  if(!r||!r.status)return '連線中斷，請稍後重新整理。';
  return {NOT_PROVIDED:'報告尚未提供（後端尚未開通）。',QUOTA_EXCEEDED:'報告請求已達上限（最多 20 筆），請等現有請求完成後再試。',UNAUTHENTICATED:'需要登入帳號。',RATE_LIMITED:'請求太頻繁，請稍後再試。',REPORTS_DISABLED:'報告服務尚未啟用（主機尚未設定報告根目錄）。',REPORT_NOT_FOUND:'找不到已發布報告。',STOCK_NOT_WATCHED:'此公司不在自選群組。',REPORT_ALREADY_ACTIVE:'此公司已有進行中的報告工作。',REPORT_PERIOD_UNAVAILABLE:'期別不在正式發布資料中。',INPUT_TOO_LARGE:'檔案超過 20 MB 上限。',INPUT_TYPE_NOT_ALLOWED:'不支援的檔案類型。',INPUT_TYPE_MISMATCH:'檔案內容與副檔名不符，請確認檔案格式。',PAYLOAD_TOO_LARGE:'檔案超過 20 MB 上限。',INVALID_FILENAME:'檔名不正確。',INPUT_FILE_REQUIRED:'請選擇檔案。',INPUT_NOT_FOUND:'找不到參考資料。'}[code]||(r.status===413?'檔案過大。':errMsg(r));
}
function repLoad(id,force,then){if(force)delete RC[id];return cached(RC,id,'/reports/'+encodeURIComponent(id),then);}
function inLoad(id,force,then){if(force)delete IC[id];return cached(IC,id,'/reports/'+encodeURIComponent(id)+'/inputs',then);}
function pubLoad(id,p,rev,then){return cached(PC,id+'|'+p+'|'+rev,'/reports/'+encodeURIComponent(id)+'/'+encodeURIComponent(p)+'/'+encodeURIComponent(rev),then);}
function reqLine(q){if(!q)return '';return '目前工作：'+esc(REQ_ZH[q.status]||q.status)+'｜期別 '+esc(q.period)+'｜送出 '+esc(tpTime(q.created_at))+(q.status==='SUBMITTED'?'｜AI 初稿尚未接入，由人工交接處理':'')+(q.message?'｜'+esc(reqMsg(q.message)):'');}
var REP_ST={DRAFT:'（草稿）',FAILED:'（失敗）'};
function repLabel(p){return esc(p.period)+' '+esc(p.revision)+(REP_ST[p.status]||'');}
function fmtSize(n){return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';}
var _sReport=sReport;
sReport=function(id){
  if(!REP_ON){_sReport(id);$('s-reptag').textContent=PAGES?'尚未提供':(SRV.mode!=='server'?'需主機':'未啟用');$('s-report').innerHTML='<div class="placeholder">'+(PAGES?OFFZH:SRV.mode!=='server'?'報告需連上主機才能使用（目前為本機模式）。':'報告服務尚未啟用（主機尚未設定報告根目錄）。')+'</div>';return;}
  var c=repLoad(id,false,function(){if(curPage==='stock'&&SP.id===id)sReport(id);});
  if(c.loading){$('s-reptag').textContent='載入中';$('s-period').innerHTML='<option>—</option>';$('s-period').disabled=true;$('s-report').innerHTML='<div class="placeholder">報告載入中…</div>';return;}
  if(!c.r.ok){$('s-reptag').textContent='錯誤';$('s-period').innerHTML='<option>—</option>';$('s-period').disabled=true;$('s-report').innerHTML='<div class="placeholder">'+esc(repErr(c.r))+'</div>';return;}
  var d=c.r.data||{},ps=d.periods||[],q=d.current_request,sel=Math.min(c.sel||0,Math.max(0,ps.length-1));
  $('s-reptag').textContent=q&&REQ_ACTIVE.indexOf(q.status)>=0?(REQ_ZH[q.status]||q.status):(ps.length?'已發布':'尚無報告');
  $('s-period').innerHTML=ps.length?ps.map(function(p,i){return '<option value="'+i+'"'+(i===sel?' selected':'')+'>'+repLabel(p)+'</option>';}).join(''):'<option>—</option>';
  $('s-period').disabled=ps.length<2;
  var h=q&&REQ_ACTIVE.indexOf(q.status)>=0?'<div class="sub">'+reqLine(q)+'</div>':'';
  var p=ps[sel];
  if(!p){$('s-report').innerHTML=h+'<div class="placeholder">尚無已發布報告。'+(groupOf(id)?'可到「報告設定」產生。':'此公司不在自選群組，無法產生報告。')+'</div>';return;}
  var pc=pubLoad(id,p.period,p.revision,function(){if(curPage==='stock'&&SP.id===id)sReport(id);});
  h+=pc.loading?'<div class="placeholder">摘要載入中…</div>':(!pc.r.ok?'<div class="placeholder">'+esc(repErr(pc.r))+'</div>':'<div class="report"><p>'+esc((pc.r.data&&pc.r.data.summary)||'').replace(/\n/g,'<br>')+'</p></div>');
  h+='<div style="display:flex;gap:10px;align-items:center"><a href="#/report/'+esc(id)+'/'+esc(p.period)+'/'+esc(p.revision)+'">閱讀全文</a><span class="sub">發布 '+esc(tpTime(p.published_at))+'</span></div>';
  $('s-report').innerHTML=h;
};
$('s-period').addEventListener('change',function(){if(curPage==='stock'&&RC[SP.id]){RC[SP.id].sel=+this.value||0;sReport(SP.id);}});
function mdHtml(md,toc){
  var out=[],inList=false,n=0;
  function inline(s){return esc(s).replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/〔(S\d+)〕|\[(S\d+)\]/g,function(m,a,b){return '<span class="cite">〔'+(a||b)+'〕</span>';});}
  String(md||'').split(/\r?\n/).forEach(function(l){
    var m=l.match(/^(#{1,4})\s+(.*)$/);
    if(m){if(inList){out.push('</ul>');inList=false;}var lv=m[1].length<=2?2:3,hid='rh'+(++n);out.push('<h'+lv+' id="'+hid+'">'+inline(m[2])+'</h'+lv+'>');if(lv===2)toc.push([hid,m[2]]);return;}
    var li=l.match(/^\s*[-*]\s+(.*)$/);
    if(li){if(!inList){out.push('<ul>');inList=true;}out.push('<li>'+inline(li[1])+'</li>');return;}
    if(inList){out.push('</ul>');inList=false;}
    if(l.trim())out.push('<p>'+inline(l)+'</p>');
  });
  if(inList)out.push('</ul>');
  return out.join('');
}
var _rRender=rRender;
rRender=function(id){
  _rRender(id);
  if(!REP_ON){$('r-body').innerHTML='<div class="placeholder">'+(PAGES?OFFZH:SRV.mode!=='server'?'報告需連上主機才能閱讀（目前為本機模式）。':'報告服務尚未啟用。')+'</div>';return;}
  var parts=location.hash.split('/'),p=parts[3],rev=parts[4];
  if(!p||!rev){
    var c=repLoad(id,false,function(){if(curPage==='report')rRender(id);});
    if(c.loading){$('r-body').innerHTML='<div class="placeholder">報告載入中…</div>';return;}
    var ps=c.r.ok&&c.r.data?c.r.data.periods||[]:[];
    if(!ps.length){$('r-body').innerHTML='<div class="placeholder">'+esc(c.r.ok?'此公司尚無已發布報告。':repErr(c.r))+'</div>';return;}
    p=ps[0].period;rev=ps[0].revision;
  }
  var pc=pubLoad(id,p,rev,function(){if(curPage==='report')rRender(id);});
  if(pc.loading){$('r-body').innerHTML='<div class="placeholder">報告載入中…</div>';return;}
  if(!pc.r.ok){$('r-body').innerHTML='<div class="placeholder">'+esc(repErr(pc.r))+'</div>';return;}
  var d=pc.r.data||{},toc=[],pt=d.pointer||{};
  if(PAGES){
    /* Pages：summary 一律當純文字（跳脫後只把換行轉 <br>，不解析 markdown）；連結只放 https */
    $('r-sub').textContent=p+'｜'+rev+(REP_ST[d.status]||'')+'｜產生 '+tpTime(pt.published_at)+'｜'+(d.title||'—');
    var fl=(d.files||[]).map(function(f){return '<li>'+(safeUrl(f.url)!=='#'?'<a href="'+esc(safeUrl(f.url))+'" target="_blank" rel="noopener noreferrer">'+esc(f.name)+'</a>':esc(f.name))+'</li>';}).join('');
    var ruleRep=/規則式/.test(d.title||'')||/REPORT_RULE_V\d/.test(d.summary||'');
    $('r-body').innerHTML=(ruleRep?'<div class="sub" style="margin-bottom:6px">這份報告由規則式管線依正式發布資料整理，<b>不是 AI 撰寫</b>，也不構成買賣建議；參考檔只列檔名與雜湊、內容未解析；若要求前期比較但資料缺少，報告會寫明、不自行推算。</div>':'')+'<div style="border:1px solid var(--line);border-radius:6px;padding:8px"><b>摘要</b><p class="rep-text">'+(d.summary?esc(d.summary).replace(/\r?\n/g,'<br>'):'—')+'</p></div>'+
      (safeUrl(d.url)!=='#'?'<p><a href="'+esc(safeUrl(d.url))+'" target="_blank" rel="noopener noreferrer">開啟完整報告</a></p>':'')+
      (fl?'<h2 id="rh-files">檔案</h2><ul>'+fl+'</ul>':'');
    $('r-toc').innerHTML=fl?'<a href="#" data-rtoc="rh-files">檔案</a>':'<span class="placeholder">無章節</span>';
    return;
  }
  $('r-sub').textContent=p+'｜'+rev+'｜發布 '+tpTime(pt.published_at)+'｜分析資料 '+(d.meta&&d.meta.calculation_version||'—');
  var srcs=(d.sources||[]).map(function(s){return '<li><span class="cite">〔'+esc(s.id)+'〕</span> '+(s.url?'<a href="'+esc(safeUrl(s.url))+'" target="_blank" rel="noopener noreferrer">'+esc(s.title||s.url)+'</a>':esc(s.title||''))+'</li>';}).join('');
  $('r-body').innerHTML='<div style="border:1px solid var(--line);border-radius:6px;padding:8px"><b>摘要</b><p>'+esc(d.summary||'').replace(/\n/g,'<br>')+'</p></div>'+mdHtml(d.report,toc)+(srcs?'<h2 id="rh-src">資料來源</h2><ul>'+srcs+'</ul>':'');
  if(srcs)toc.push(['rh-src','資料來源']);
  $('r-toc').innerHTML=toc.map(function(t){return '<a href="#" data-rtoc="'+t[0]+'">'+esc(t[1])+'</a>';}).join('')||'<span class="placeholder">無章節</span>';
};
var _rsRender=rsRender;
rsRender=function(){
  _rsRender();
  if(!RP.id||!$('rs-genbox'))return;
  if(!REP_ON){
    var why=PAGES?'尚未提供':(SRV.mode!=='server'?'需連上主機':'報告服務尚未啟用');
    $('rs-genbox').innerHTML='<button class="btn primary" disabled>產生報告（'+why+'）</button>';
    $('rs-inputs').innerHTML='<div class="placeholder">參考資料'+why+'。</div>';$('rs-history').innerHTML='<div class="placeholder">'+why+'。</div>';return;
  }
  var id=RP.id,re=function(){if(curPage==='report-settings'&&RP.id===id)rsRender();};
  if(PAGES){rsRenderPages(id,re);return;}
  var c=repLoad(id,false,re),ic=inLoad(id,false,re);
  var q=c.r&&c.r.ok&&c.r.data?c.r.data.current_request:null,busy=!!(q&&REQ_ACTIVE.indexOf(q.status)>=0);
  $('rs-genbox').innerHTML='<button class="btn primary" data-repgen="'+esc(id)+'"'+(busy||c.loading?' disabled':'')+' title="'+(busy?'此公司已有進行中的報告工作':'以目前正式分析期別 '+esc(BYID[id].period||'')+' 產生報告')+'">'+(busy?'工作進行中':'產生報告')+'</button>';
  $('rs-reqstate').innerHTML=busy?reqLine(q):(c.r&&!c.r.ok?esc(repErr(c.r)):'');
  var ih;
  if(ic.loading)ih='<div class="placeholder">參考資料載入中…</div>';
  else if(!ic.r.ok)ih='<div class="placeholder">'+esc(repErr(ic.r))+'</div>';
  else{var fs=(ic.r.data&&ic.r.data.files)||[];
    ih=fs.length?fs.map(function(f){return '<div style="display:flex;gap:8px;align-items:center;border-top:1px solid var(--line);padding:4px 0"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis">'+esc(f.name)+'</span><span class="grow"></span><span class="sub">'+fmtSize(f.size)+'｜'+esc(tpTime(f.added_at))+'</span><button class="btn sm" data-inrm="'+esc(f.name)+'" aria-label="移除 '+esc(f.name)+'">移除</button></div>';}).join(''):'<div class="placeholder">尚無參考資料。</div>';}
  ih+='<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px"><label class="sr" for="rs-file">選擇參考資料檔案</label><input type="file" id="rs-file" accept="'+IN_ALLOW.join(',')+'"><button class="btn sm" data-inadd="'+esc(id)+'">加入檔案</button><span class="sub">單檔 20 MB 以內；'+IN_ALLOW.join('、')+'</span></div>';
  $('rs-inputs').innerHTML=ih;
  var hh;
  if(c.loading)hh='<div class="placeholder">載入中…</div>';
  else if(!c.r.ok)hh='<div class="placeholder">'+esc(repErr(c.r))+'</div>';
  else{var ps=(c.r.data&&c.r.data.periods)||[];hh=ps.length?ps.map(function(p){return '<div style="display:flex;gap:8px"><a href="#/report/'+esc(id)+'/'+esc(p.period)+'/'+esc(p.revision)+'">'+esc(p.period)+' '+esc(p.revision)+'</a><span class="sub">發布 '+esc(tpTime(p.published_at))+'</span></div>';}).join(''):'<div class="placeholder">尚無已發布報告。</div>';}
  $('rs-history').innerHTML=hh;
};
/* Pages 報告參考檔（C-05）：只限登入；只看得到、下載、刪除自己上傳的。檔案存在後端私人儲存，頁面不顯示上傳者或永久網址。
   清單狀態 PIN[代號]={loading,list,err,busy}；換帳號（或登出）整份清掉，避免看到上一位的清單。 */
var PIN={},PIN_WHO=null,PIN_EXT=['.pdf','.txt','.md','.csv','.xlsx','.png','.jpg','.jpeg'],PIN_MAX=20*1024*1024;
function pinErr(r){
  var c=r&&r.data&&r.data.error_code;
  if(!r||!r.status)return '連線中斷，請稍後再試。';
  if(r.status===401)return '登入已過期，請重新登入。';
  if(r.status===429)return '請求太頻繁，請稍後再試。';
  var m={UNSUPPORTED_TYPE:'不支援的檔案類型或內容（只接受 PDF、TXT、MD、CSV、XLSX、PNG、JPEG；文字檔須為 UTF-8）。',TOO_LARGE:'檔案超過單檔 20 MiB 上限。',QUOTA_EXCEEDED:'參考檔已達上限（每人最多 50 個或 200 MiB），請先刪除不需要的檔案。',CHECKSUM_MISMATCH:'檔案傳輸時損毀，請重新上傳。',INPUT_LOCKED:'這個檔案已被報告引用，不能刪除。'}[c];
  if(m)return m;
  return r.status===404?'找不到這個檔案（可能已被刪除）。':'操作失敗（'+r.status+'）。';
}
function pinLoad(id,force,re){
  var s=PIN[id];
  if(!s||force){
    s=PIN[id]={loading:true,list:null,err:null,busy:false};
    var me=s;
    window.KupeiInputs.list(id).then(function(r){if(PIN[id]!==me)return;me.loading=false;if(r.ok)me.list=r.data||[];else me.err=r;re();},function(){if(PIN[id]!==me)return;me.loading=false;me.err={status:0};re();});
  }
  return s;
}
function pinRefresh(id){pinLoad(id,true,function(){if(curPage==='report-settings'&&RP.id===id)rsRender();});}
function pinRender(id,re,login){
  var A=window.KupeiAuth,who=login&&A.session&&A.session()?A.session().username:'';
  if(PIN_WHO!==who){PIN={};PIN_WHO=who;}
  $('rs-infield').hidden=false;
  var box=$('rs-inputs');
  if(!login||!window.KupeiInputs){box.innerHTML='<div class="placeholder">參考檔需要登入帳號（左側「帳號」）；只有你自己看得到、下載與刪除自己上傳的檔案。</div>';return;}
  var s=pinLoad(id,false,re),h;
  if(s.loading)h='<div class="placeholder">參考檔載入中…</div>';
  else if(s.err)h='<div class="placeholder">'+esc(pinErr(s.err))+' <button class="btn sm" data-pin-retry="1">重試</button></div>';
  else h=s.list.length?s.list.map(function(f){
    return '<div class="pin-row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line);padding:4px 0"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis">'+esc(f.name)+'</span>'+(f.locked?'<span class="badge b-fin" title="已被報告引用，不能刪除">已鎖定</span>':'')+'<span class="grow"></span><span class="sub" title="SHA-256 '+esc(f.sha256)+'">'+fmtSize(f.bytes)+'｜SHA-256 '+esc(String(f.sha256).slice(0,12))+'…｜'+esc(tpTime(f.createdAt))+'</span><button class="btn sm" data-pin-dl="'+esc(f.id)+'" aria-label="下載 '+esc(f.name)+'">下載</button><button class="btn sm" data-pin-rm="'+esc(f.id)+'"'+(f.locked?' disabled title="已被報告引用，不能刪除"':'')+' aria-label="刪除 '+esc(f.name)+'">刪除</button></div>';
  }).join(''):'<div class="placeholder">尚無參考檔。</div>';
  h+='<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px"><label class="sr" for="rs-file">選擇參考檔</label><input type="file" id="rs-file" accept="'+PIN_EXT.join(',')+'"'+(s.busy?' disabled':'')+'><button class="btn sm" data-pin-add="'+esc(id)+'"'+(s.busy?' disabled':'')+'>'+(s.busy?'上傳中…':'加入檔案')+'</button><span class="sub">單檔 20 MiB 以內；PDF、TXT、MD、CSV、XLSX、PNG、JPEG；每人最多 50 個或 200 MiB。報告 V1 只列出檔名與雜湊，不會讀取檔案內容。</span></div>';
  box.innerHTML=h;
}
function pinUpload(id,file){
  if(!file){toast('請先選擇檔案');return;}
  var ext=((file.name||'').match(/\.[^.]+$/)||[''])[0].toLowerCase();
  if(PIN_EXT.indexOf(ext)<0){toast('不支援的檔案類型'+(ext?'：'+ext:''));return;}
  if(file.size>PIN_MAX){toast('檔案超過單檔 20 MiB 上限');return;}
  var s=PIN[id];if(!s||s.busy)return;s.busy=true;rsRender();
  window.KupeiInputs.upload(id,file).then(function(r){
    s.busy=false;
    if(r.ok)toast('已加入 '+((r.data&&r.data.name)||file.name));
    else{toast('上傳失敗：'+pinErr(r));if(r.status===401&&window.KupeiAuth&&window.KupeiAuth.openLogin)window.KupeiAuth.openLogin();}
    pinRefresh(id);
  },function(){s.busy=false;toast('上傳結果不明（連線中斷），已重新查詢');pinRefresh(id);});
}
function pinDownload(id,fid){
  var f=((PIN[id]&&PIN[id].list)||[]).filter(function(x){return x.id===fid;})[0];if(!f)return;
  window.KupeiInputs.download(id,fid).then(function(r){
    if(!r.ok){toast('下載失敗：'+pinErr(r));if(r.status===404)pinRefresh(id);return;}
    var url=URL.createObjectURL(r.data),a=document.createElement('a');a.href=url;a.download=f.name;a.rel='noopener';document.body.appendChild(a);a.click();a.remove();
    setTimeout(function(){URL.revokeObjectURL(url);},2000);
  },function(){toast('下載失敗：連線中斷');});
}
function pinRemove(id,fid){
  var f=((PIN[id]&&PIN[id].list)||[]).filter(function(x){return x.id===fid;})[0];if(!f)return;
  if(f.locked){toast('這個檔案已被報告引用，不能刪除');return;}
  if(!window.confirm('刪除參考檔「'+f.name+'」？檔案會立即從儲存空間刪除，無法復原。'))return;
  window.KupeiInputs.remove(id,fid).then(function(r){
    if(r.ok)toast('已刪除 '+f.name);else toast('刪除失敗：'+pinErr(r));
    pinRefresh(id);
  },function(){toast('刪除結果不明（連線中斷），已重新查詢');pinRefresh(id);});
}
/* Pages 報告設定：產生請求（只限登入帳號）、歷次報告、自己的請求、參考檔（只限登入） */
function rsRenderPages(id,re){
  var c=repLoad(id,false,re),A=window.KupeiAuth,login=!!(A&&A.loggedIn&&A.loggedIn());
  if(c.lg==null)c.lg=login;else if(c.lg!==login){c=repLoad(id,true,re);c.lg=login;} /* 登入狀態變了：重讀（自己的請求只有登入後讀得到） */
  var d=c.r&&c.r.ok&&c.r.data?c.r.data:null,q=d?d.current_request:null,busy=!!(q&&REQ_ACTIVE.indexOf(q.status)>=0);
  $('rs-genbox').innerHTML='<button class="btn primary" data-repgen="'+esc(id)+'"'+(busy||c.loading?' disabled':'')+' title="'+(busy?'此公司已有排隊中的報告請求':'以目前正式分析期別 '+esc(BYID[id].period||'')+' 送出產生請求')+'">'+(busy?'請求排隊中':login?'產生報告':'產生報告（需登入）')+'</button>';
  $('rs-reqstate').innerHTML=busy?reqLine(q):(c.r&&!c.r.ok?esc(repErr(c.r)):(login?'':'送出產生請求需要登入帳號（左側「帳號」）。'));
  pinRender(id,re,login);
  var hh;
  if(c.loading)hh='<div class="placeholder">載入中…</div>';
  else if(!c.r.ok)hh='<div class="placeholder">'+esc(repErr(c.r))+'</div>';
  else{var ps=d.periods||[],fs=d.failed||[];
    hh=ps.length?ps.map(function(p){return '<div style="display:flex;gap:8px"><a href="#/report/'+esc(id)+'/'+esc(p.period)+'/'+esc(p.revision)+'">'+repLabel(p)+'</a><span class="sub">產生 '+esc(tpTime(p.published_at))+(p.title?'｜'+esc(p.title):'')+'</span></div>';}).join(''):'<div class="placeholder">尚無報告。</div>';
    if(fs.length)hh+='<div class="sub">另有 '+fs.length+' 份產生失敗：'+fs.map(function(p){return repLabel(p);}).join('、')+'</div>';
    var rq=d.requests;
    hh+='<div class="sub" style="margin-top:6px">我的請求</div>'+(rq==null?'<div class="placeholder">'+(login?'請求紀錄暫時無法讀取。':'登入帳號後顯示自己的請求。')+'</div>':rq.length?rq.slice(0,20).map(function(r){return '<div class="sub" style="padding:2px 0">'+esc(r.period)+'｜'+esc(REQ_ZH[r.status]||r.status)+'｜送出 '+esc(tpTime(r.created_at))+(r.updated_at?'｜更新 '+esc(tpTime(r.updated_at)):'')+(r.message?'｜'+esc(reqMsg(r.message)):'')+'</div>';}).join(''):'<div class="placeholder">尚無請求。</div>');}
  $('rs-history').innerHTML=hh;
}
function repGenPages(id,btn){
  var A=window.KupeiAuth;
  if(!A||!A.loggedIn||!A.loggedIn()){toast('產生報告需要登入帳號');btn.disabled=false;if(A&&A.openLogin)A.openLogin();return;}
  KupeiAPI.req('POST','/reports/'+encodeURIComponent(id)+'/requests',{period:BYID[id].period,trigger:'MANUAL'}).then(function(r){
    if(r.ok)toast(r.status===202?'已送出報告請求（排隊中）':'已有排隊中的同期別請求，沿用同一筆');
    else if(r.status===401){toast('登入已過期，請重新登入');if(A.openLogin)A.openLogin();}
    else toast('無法送出：'+repErr(r));
    repRefresh(id);
  },function(){toast('送出結果不明（連線中斷），已重新查詢');repRefresh(id);});
}
function repRefresh(id){repLoad(id,true,function(){if(curPage==='report-settings')rsRender();});}
function inRefresh(id){inLoad(id,true,function(){if(curPage==='report-settings')rsRender();});}
function upload(id,file){
  var ext=((file.name||'').match(/\.[^.]+$/)||[''])[0].toLowerCase();
  if(IN_ALLOW.indexOf(ext)<0){toast('不支援的檔案類型'+(ext?'：'+ext:''));return;}
  if(file.size>IN_MAX){toast('檔案超過 20 MB 上限');return;}
  if(!SRV.auth){showLogin(function(){upload(id,file);});return;}
  var fd=new FormData();fd.append('file',file,file.name);
  fetch(KupeiAPI.base+'/reports/'+encodeURIComponent(id)+'/inputs',{method:'POST',body:fd,credentials:'same-origin',headers:{'X-KuPei-Request':'1',Accept:'application/json'}})
    .then(function(res){return res.text().then(function(t){var d=null;try{d=t?JSON.parse(t):null;}catch(e){d=null;}return {ok:res.ok,status:res.status,data:d};});})
    .then(function(r){
      if(r.status===401){SRV.auth=false;showLogin(function(){upload(id,file);});return;}
      if(!r.ok){toast('上傳失敗：'+repErr(r));return;}
      toast('已加入 '+((r.data&&r.data.file&&r.data.file.name)||file.name));inRefresh(id);
    },function(){toast('上傳結果不明（連線中斷），已重新查詢');inRefresh(id);});
}
document.addEventListener('click',function(e){
  var t=e.target.closest('[data-repgen],[data-inrm],[data-inadd],[data-pin-add],[data-pin-dl],[data-pin-rm],[data-pin-retry]');if(!t)return;var d=t.dataset;
  if(PAGES){
    var pid=RP.id;if(!pid)return;
    if(d.pinAdd!==undefined){var pf=$('rs-file');pinUpload(d.pinAdd,pf&&pf.files[0]);return;}
    if(d.pinDl!==undefined){pinDownload(pid,d.pinDl);return;}
    if(d.pinRm!==undefined){pinRemove(pid,d.pinRm);return;}
    if(d.pinRetry!==undefined){pinRefresh(pid);return;}
  }
  if(d.repgen){
    var id=d.repgen;t.disabled=true;
    if(PAGES){repGenPages(id,t);return;}
    srvWrite('POST','/reports/'+encodeURIComponent(id)+'/requests',{period:BYID[id].period,trigger:'MANUAL'},
      {idem:uuid(),onConflict:function(){repRefresh(id);},onFail:function(r){toast('無法送出：'+repErr(r));repRefresh(id);}},
      function(){toast('已送出報告請求（等待人工／AI 初稿）');repRefresh(id);});
    return;
  }
  if(d.inadd){var f=$('rs-file').files[0];if(!f){toast('請先選擇檔案');return;}upload(d.inadd,f);return;}
  if(d.inrm){var rid=RP.id,name=d.inrm;if(!window.confirm('移除參考資料「'+name+'」？檔案會移到 _removed 保留一年。'))return;
    srvWrite('DELETE','/reports/'+encodeURIComponent(rid)+'/inputs/'+encodeURIComponent(name),null,{onConflict:function(){inRefresh(rid);},onFail:function(){inRefresh(rid);}},function(){toast('已移除（保留於 _removed）');inRefresh(rid);});}
});
curPage='';route();
}
})();
