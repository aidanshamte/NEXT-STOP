// The live map document, shared by the native WebView (inline) and the website, which serves
// the identical file as public/map.html in a sandboxed frame with its own narrow CSP.
// Regenerate public/map.html with `node scripts/write-map-html.mjs` after editing; a test
// fails if the two copies differ.
//
// MapLibre GL with OpenFreeMap vector tiles: no API key or billing account. Attribution
// (OpenFreeMap, OpenMapTiles, OpenStreetMap) is rendered by the map. All marker artwork is
// inline SVG built with DOM calls, so it needs no native module and works in Expo Go, installed
// builds and the website alike. Vehicle positions are only drivers' reported GPS fixes; every
// name and label arrives as JSON and is set as text, never parsed as HTML.
const MAPLIBRE = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl';
const JS_SRI = 'sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj';
const CSS_SRI = 'sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V';

const CSS = `html,body,#map{margin:0;height:100%;background:#E9EEF1;font-family:-apple-system,Roboto,sans-serif}
#map{z-index:0}
.mk{padding:0;margin:0;border:0;background:none;cursor:pointer;font:inherit;-webkit-tap-highlight-color:transparent}
.mk:focus-visible{outline:3px solid #1A73E8;outline-offset:2px;border-radius:8px}
.in{position:relative;display:block;transform-origin:50% 100%}
.sign{width:26px;height:36px}.sign svg{display:block;width:26px;height:36px;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35))}
.num{position:absolute;top:-8px;right:-10px;min-width:17px;height:17px;padding:0 3px;box-sizing:border-box;border-radius:9px;background:#fff;border:2px solid var(--c,#11243A);color:#11243A;font-size:10px;font-weight:800;line-height:13px;text-align:center;white-space:nowrap}
.od{position:absolute;top:11px;right:-8px;width:16px;height:16px;border-radius:50%;background:#EF543F;border:2px solid #fff;box-sizing:border-box;display:flex;align-items:center;justify-content:center}
.od svg{width:9px;height:9px;display:block}
.pin{width:36px;height:48px}.pin svg,.dest svg{display:block;filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))}
.dest{width:34px;height:44px}
.pill{position:absolute;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:11px;font-weight:700;line-height:15px;padding:1px 7px;border-radius:9px;color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.pin .pill{bottom:50px;background:#EF543F}.dest .pill{bottom:46px;background:#11243A}
.veh{width:46px;height:46px}.veh .in{width:46px;height:46px;transform-origin:50% 50%}
.ring{position:absolute;left:2px;top:2px;width:42px;height:42px;border-radius:50%;background:#fff;border:3px solid var(--c);box-sizing:border-box;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 5px rgba(0,0,0,.35)}
.ring svg{width:28px;height:28px;display:block}
.dir{position:absolute;left:0;top:0;width:46px;height:46px;pointer-events:none}
.dir span{position:absolute;left:16px;top:-9px;width:0;height:0;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:10px solid var(--c)}
.veh .pill{top:47px;background:#11243A;border-left:5px solid var(--c)}
.veh .st{position:absolute;left:50%;transform:translateX(-50%);top:66px;white-space:nowrap;font-size:10px;font-weight:700;line-height:14px;color:#11243A;background:#fff;border:1px solid #8A949D;border-radius:8px;padding:0 6px}
.veh.stale .ring,.veh.lost .ring{border-color:#8A949D;background:#EEF1F3}
.veh.lost .ring{border-style:dashed;opacity:.85}
.veh.stale .pill,.veh.lost .pill{background:#5C6670;border-left-color:#8A949D}
.veh.focus .ring{box-shadow:0 0 0 4px rgba(17,36,58,.22),0 1px 5px rgba(0,0,0,.35)}
#map.far .sign .in{transform:scale(.72)}#map.far .num{display:none}#map.far .veh:not(.focus) .pill{display:none}
#map.far .veh:not(.focus) .st{top:47px}
.acc{border-radius:50%;background:rgba(26,115,232,.14);border:1px solid rgba(26,115,232,.45);box-sizing:border-box;pointer-events:none}
.me{width:20px;height:20px;border-radius:50%;background:#1A73E8;border:3px solid #fff;box-sizing:border-box;box-shadow:0 0 0 1px rgba(26,115,232,.5),0 1px 4px rgba(0,0,0,.4);pointer-events:none}
.ctl{position:absolute;right:10px;z-index:2;width:38px;height:38px;border-radius:19px;border:0;padding:0;background:#fff;color:#11243A;box-shadow:0 1px 6px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;cursor:pointer}
.ctl svg{width:22px;height:22px;display:block}
#recenter{top:8px}#locate{top:52px}#locate.on{background:#E8F0FE}#locate.waiting{opacity:.7}
#zin{top:96px;border-radius:19px 19px 0 0}#zout{top:134px;border-radius:0 0 19px 19px;border-top:1px solid #E1E6EA}
#fitwalk{top:178px;display:none}#fitwalk.show{display:flex}
.ctl:focus-visible,#keybtn:focus-visible{outline:3px solid #1A73E8;outline-offset:2px}
.kline{width:26px;height:0;border-top:5px dotted #1A73E8}
#keybtn{position:absolute;left:10px;bottom:10px;z-index:2;height:30px;padding:0 12px;border-radius:15px;border:0;background:#fff;color:#11243A;font-weight:700;font-size:12px;box-shadow:0 1px 6px rgba(0,0,0,.25);cursor:pointer}
#key{position:absolute;left:10px;bottom:48px;z-index:3;width:250px;max-width:calc(100% - 20px);max-height:calc(100% - 110px);overflow:auto;box-sizing:border-box;background:#fff;border-radius:12px;padding:8px 12px;box-shadow:0 2px 10px rgba(0,0,0,.3);font-size:12px;line-height:16px;color:#11243A;display:none}
#key.open{display:block}#key h2{font-size:12px;margin:4px 0 6px}
.krow{display:flex;align-items:center;gap:8px;margin:3px 0}
.kicon{position:relative;width:30px;height:30px;flex:none;display:flex;align-items:center;justify-content:center}
.kicon .mk{pointer-events:none}.kicon .in{transform:scale(.62)}.kicon .veh .in{transform:scale(.6)}
#offmap{margin-top:6px;color:#5C6670}
#note{position:absolute;left:50%;bottom:48px;transform:translateX(-50%);z-index:3;background:#11243A;color:#fff;font-size:12px;line-height:16px;padding:6px 10px;border-radius:8px;width:max-content;max-width:75%;text-align:center;display:none}
.maplibregl-popup{z-index:10}
.maplibregl-popup-content{font-size:13px;line-height:18px;color:#11243A;padding:10px 26px 10px 12px;border-radius:10px}
.pop b{display:block;margin-bottom:3px}.pop div{margin:2px 0}
.pop button{display:block;width:100%;margin-top:6px;padding:8px;border:0;border-radius:8px;background:#11243A;color:#fff;font-weight:600;font-size:13px;cursor:pointer}`;

const SCRIPT = `
var NS='http://www.w3.org/2000/svg',NAVY='#11243A',CORAL='#EF543F',GREY='#8A949D';
function S(tag,a,kids){var e=document.createElementNS(NS,tag);for(var k in a)e.setAttribute(k,a[k]);(kids||[]).forEach(function(c){e.appendChild(c)});return e}
function H(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function color(c){return /^#[0-9a-fA-F]{6}$/.test(c||'')?c:NAVY}
// Vehicle artwork, side profile. The type is the administrator's saved setting; a vehicle
// without one gets a plain disc rather than a guessed silhouette.
function glyph(type,fill){
 var w={fill:NAVY,stroke:'#fff','stroke-width':1.6};
 if(type==='bus')return S('svg',{viewBox:'0 0 32 32','aria-hidden':'true'},[
  S('path',{fill:fill,d:'M2.5 9.6A2.6 2.6 0 0 1 5.1 7h20.6a3 3 0 0 1 2.9 2.3l1.1 4.6c.1.4.2.9.2 1.3v6.6a1.6 1.6 0 0 1-1.6 1.6H4.1a1.6 1.6 0 0 1-1.6-1.6z'}),
  S('path',{fill:'#fff',d:'M5 9.6h4.2v5H5zM10.6 9.6h4.2v5h-4.2zM16.2 9.6h4.2v5h-4.2zM21.8 9.6h4.3l1.2 5h-5.5z'}),
  S('path',{fill:'#fff','fill-opacity':'.55',d:'M2.5 17.6h27.3v1.3H2.5z'}),
  S('circle',Object.assign({cx:8.6,cy:23.6,r:2.9},w)),S('circle',Object.assign({cx:24,cy:23.6,r:2.9},w))]);
 if(type==='shuttle')return S('svg',{viewBox:'0 0 32 32','aria-hidden':'true'},[
  S('path',{fill:fill,d:'M4 12.4A2.6 2.6 0 0 1 6.6 9.8h12.6l5.4 5 3.2 1a2.2 2.2 0 0 1 1.6 2.1v4.3a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 22.2z'}),
  S('path',{fill:'#fff',d:'M6.6 12.3h4.6v3.9H6.6zM12.6 12.3h4.8v3.9h-4.8zM18.8 12.3l3.9 3.9h-3.9z'}),
  S('circle',Object.assign({cx:9.6,cy:23.4,r:2.7},w)),S('circle',Object.assign({cx:23.4,cy:23.4,r:2.7},w))]);
 return S('svg',{viewBox:'0 0 32 32','aria-hidden':'true'},[S('circle',{cx:16,cy:16,r:9,fill:fill}),S('circle',{cx:16,cy:16,r:3.5,fill:'#fff'})]);
}
function stopSign(){return S('svg',{viewBox:'0 0 26 36','aria-hidden':'true'},[
 S('ellipse',{cx:13,cy:34.4,rx:4.5,ry:1.5,fill:'rgba(17,36,58,.3)'}),
 S('rect',{x:11.8,y:19,width:2.4,height:15.5,rx:1,fill:NAVY}),
 S('rect',{x:1.8,y:1,width:22.4,height:20,rx:5,fill:NAVY,stroke:'#fff','stroke-width':1.6}),
 S('path',{fill:'#fff',d:'M8.4 5.2h9.2a2.2 2.2 0 0 1 2.2 2.2v7.4H6.2V7.4a2.2 2.2 0 0 1 2.2-2.2z'}),
 S('path',{fill:NAVY,d:'M7.9 7.3h10.2v3.8H7.9z'}),
 S('rect',{x:7.2,y:14.6,width:2.6,height:2.3,rx:.7,fill:'#fff'}),S('rect',{x:16.2,y:14.6,width:2.6,height:2.3,rx:.7,fill:'#fff'}),
 S('circle',{cx:8.9,cy:12.9,r:.9,fill:NAVY}),S('circle',{cx:17.1,cy:12.9,r:.9,fill:NAVY})])}
function bell(){return S('svg',{viewBox:'0 0 12 12','aria-hidden':'true'},[S('path',{fill:'#fff',d:'M6 1a3.2 3.2 0 0 0-3.2 3.2v2.4L1.6 8.4h8.8L9.2 6.6V4.2A3.2 3.2 0 0 0 6 1zM4.7 9.4a1.3 1.3 0 0 0 2.6 0z'})])}
function pickupPin(){return S('svg',{viewBox:'0 0 36 48',width:36,height:48,'aria-hidden':'true'},[
 S('path',{fill:CORAL,stroke:'#fff','stroke-width':2.4,d:'M18 2C9.2 2 2.4 8.6 2.4 17.2 2.4 28.8 18 46 18 46s15.6-17.2 15.6-28.8C33.6 8.6 26.8 2 18 2z'}),
 S('circle',{cx:18,cy:17,r:10,fill:'#fff'}),
 S('circle',{cx:16.6,cy:10.9,r:2,fill:CORAL}),
 S('path',{fill:CORAL,d:'M15 13.8h3l1.7 4.1 2.6 1.2-.7 1.5-3.2-1.4-.5-1.3-.6 3 2.2 2.6v3.5h-1.8v-2.8l-1.9-2-.8 3.4-1.8 1.4-1.1-1.3 1.3-1.1 1-5.3-.9.5v2.1h-1.7v-3.1z'})])}
function destFlag(){return S('svg',{viewBox:'0 0 34 44',width:34,height:44,'aria-hidden':'true'},[
 S('ellipse',{cx:9,cy:42.4,rx:5,ry:1.6,fill:'rgba(17,36,58,.3)'}),
 S('rect',{x:7.6,y:3,width:2.8,height:39.5,rx:1.2,fill:NAVY,stroke:'#fff','stroke-width':1}),
 S('path',{fill:NAVY,stroke:'#fff','stroke-width':1.6,d:'M10.4 3.6h21l-4.6 7.2 4.6 7.2h-21z'}),
 S('path',{fill:'#fff',d:'M10.4 3.6h4.4v4.8h-4.4zM19.2 3.6h4.4v4.8h-4.4zM14.8 8.4h4.4v4.8h-4.4zM23.6 8.4h3.5l-1.5 2.4 1.5 2.4h-3.5zM10.4 13.2h4.4V18h-4.4zM19.2 13.2h4.4V18h-4.4z'})])}
function crosshair(){return S('svg',{viewBox:'0 0 24 24','aria-hidden':'true'},[S('circle',{cx:12,cy:12,r:6.5,fill:'none',stroke:'currentColor','stroke-width':2}),
 S('circle',{cx:12,cy:12,r:2.6,fill:'#1A73E8'}),S('path',{stroke:'currentColor','stroke-width':2,d:'M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4'})])}
function plusIcon(minus){return S('svg',{viewBox:'0 0 24 24','aria-hidden':'true'},[S('path',{stroke:'currentColor','stroke-width':2.4,'stroke-linecap':'round',d:minus?'M6 12h12':'M6 12h12M12 6v12'})])}
function walkIcon(){return S('svg',{viewBox:'0 0 24 24','aria-hidden':'true'},[S('circle',{cx:13.5,cy:4.2,r:2,fill:'currentColor'}),
 S('path',{fill:'none',stroke:'currentColor','stroke-width':2,'stroke-linecap':'round','stroke-linejoin':'round',d:'M9 21l2.4-6.2L14 17v4M11.4 14.8l1-5.3-3 1.4-1.2 3M12.4 9.5l2.4 2.6 2.7.9'})])}
function fitIcon(){return S('svg',{viewBox:'0 0 24 24','aria-hidden':'true'},[S('path',{fill:'none',stroke:'currentColor','stroke-width':2,'stroke-linecap':'round',d:'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5'})])}

// Marker elements. Each is a button with a spoken label; children carry the artwork.
function stopEl(s,route){var b=H('button','mk '+(s.kind==='pickup'?'pin':s.kind==='dest'?'dest':'sign'));b.type='button';
 var i=H('span','in');b.appendChild(i);
 if(s.kind==='pickup'){i.appendChild(pickupPin());i.appendChild(H('span','pill','Pickup'))}
 else if(s.kind==='dest'){i.appendChild(destFlag());i.appendChild(H('span','pill','Drop-off'))}
 else{i.appendChild(stopSign());
  if(s.numbers&&s.numbers.length){var n=H('span','num',s.numbers.join('·'));if(route)n.style.setProperty('--c',color(route.color));i.appendChild(n)}
  if(s.onDemand){var o=H('span','od');o.appendChild(bell());i.appendChild(o)}}
 b.setAttribute('aria-label',s.label||s.name);b.title=s.name;return b}
function vehEl(v){var b=H('button','mk veh '+v.state+(v.focus?' focus':''));b.type='button';
 var c=v.state==='live'?color(v.color):GREY;b.style.setProperty('--c',c);
 var i=H('span','in'),r=H('span','ring');r.appendChild(glyph(v.type,c));i.appendChild(r);
 if(v.heading!=null&&v.state==='live'){var d=H('span','dir');d.style.transform='rotate('+Math.round(v.heading)+'deg)';d.appendChild(H('span'));i.appendChild(d)}
 i.appendChild(H('span','pill',v.name.length>14?v.name.slice(0,13)+'…':v.name));
 if(v.state!=='live')i.appendChild(H('span','st',v.state==='stale'?'Location out of date':'GPS lost'));
 b.appendChild(i);b.setAttribute('aria-label',v.label);b.title=v.name;return b}

var map,last=null,fitted=false,moved=false,walkKey=null,styleReady=false,stops={},vehs={},popup=null,popKey=null,meDot=null,meAcc=null,wantMe=false;
var mq=window.matchMedia?matchMedia('(prefers-reduced-motion: reduce)'):null;
function reduced(){return !!(last&&last.reduceMotion)||!!(mq&&mq.matches)}
function post(m){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(m);else if(window.parent!==window)window.parent.postMessage(m,'*')}
function note(text){var n=document.getElementById('note');n.textContent=text||'';n.style.display=text?'block':'none'}
try{
 map=new maplibregl.Map({container:'map',style:'https://tiles.openfreemap.org/styles/liberty',center:[0,0],zoom:1,attributionControl:{compact:true}});
 map.on('dragstart',function(){moved=true});
 map.on('zoomstart',function(e){if(e.originalEvent)moved=true});
 map.on('zoom',function(){document.getElementById('map').classList.toggle('far',map.getZoom()<13.5);sizeAcc()});
 map.on('load',function(){styleReady=true;if(last)drawWalk(last)});
 // Markers and the camera work before the style finishes, so data is accepted at once.
 post('ready');
}catch(e){post('error')}

function points(d){var p=d.stops.map(function(s){return[s.lng,s.lat]});d.vehicles.forEach(function(v){p.push([v.lng,v.lat])});return p}
function fit(d){var p=points(d);if(!p.length)return;
 var bb=p.reduce(function(b,x){return b.extend(x)},new maplibregl.LngLatBounds(p[0],p[0]));
 map.fitBounds(bb,{padding:64,maxZoom:16,duration:0})}

// MapLibre labels every marker element "Map marker"; restore the element's own label after.
function place(el,opts,ll){var lab=el.getAttribute('aria-label');var m=new maplibregl.Marker(Object.assign({element:el},opts)).setLngLat(ll).addTo(map);
 if(lab)el.setAttribute('aria-label',lab);else{el.removeAttribute('aria-label');el.setAttribute('aria-hidden','true')}return m}
function showPopup(key,lngLat,node,offset){if(popup)popup.remove();popKey=key;
 popup=new maplibregl.Popup({offset:offset,maxWidth:'260px',focusAfterOpen:true}).setLngLat(lngLat).setDOMContent(node).addTo(map);
 popup.on('close',function(){if(popKey===key){popKey=null;popup=null}})}
function vehNode(v){var n=H('div','pop');n.appendChild(H('b',null,v.name));v.details.forEach(function(t){n.appendChild(H('div',null,t))});return n}
function stopNode(s){var n=H('div','pop');n.appendChild(H('b',null,s.name));
 if(last.interactive&&s.ids.length>1)s.names.forEach(function(name,k){var b=H('button',null,name+': stop details');b.type='button';b.onclick=function(){post('stop:'+s.ids[k])};n.appendChild(b)});
 else n.appendChild(H('div',null,s.label));return n}
function openStop(key){var m=stops[key];if(!m)return;var s=m.data;
 if(last.interactive&&s.ids.length===1){post('stop:'+s.ids[0]);return}
 showPopup('s:'+key,[s.lng,s.lat],stopNode(s),[0,-40])}
function openVeh(id){var m=vehs[id];if(!m)return;showPopup('v:'+id,m.at,vehNode(m.data),[0,-26])}

// Glides a vehicle from where it is drawn to its new fix: only for a genuinely new fix that is
// near the last one and recent. Jumps, long gaps and reduced motion move it directly. Nothing
// is drawn beyond the latest fix.
function moveVeh(m,v){var to=[v.lng,v.lat];cancelAnimationFrame(m.anim);
 var from=m.at,gap=v.fixAt-m.fixAt;m.fixAt=v.fixAt;m.at=to;
 var near=Math.abs(from[0]-to[0])+Math.abs(from[1]-to[1])<0.004;
 if(reduced()||!near||gap>60000){m.marker.setLngLat(to);return}
 var t0=performance.now(),dur=Math.min(1200,Math.max(300,gap*0.4));
 (function step(t){var k=Math.min(1,(t-t0)/dur);
  m.marker.setLngLat([from[0]+(to[0]-from[0])*k,from[1]+(to[1]-from[1])*k]);
  if(k<1)m.anim=requestAnimationFrame(step)})(t0)}

function sizeAcc(){if(!meAcc||!last||!last.me)return;var me=last.me;
 var mpp=40075016.686*Math.cos(me.lat*Math.PI/180)/Math.pow(2,map.getZoom()+9);
 var px=Math.max(24,Math.min(3000,2*me.accuracy/mpp));var e=meAcc.getElement();e.style.width=e.style.height=Math.round(px)+'px'}

// Walking route: drawn only from coordinates the routing service returned (dotted blue, distinct
// from shuttle route colours). Fitted once per new route; realtime updates never refit it.
function walkBounds(d){var c=d.walk.coords;var bb=new maplibregl.LngLatBounds(c[0],c[0]);c.forEach(function(p){bb.extend(p)});
 if(d.me)bb.extend([d.me.lng,d.me.lat]);return bb}
function fitWalk(d){if(!d||!d.walk)return;moved=true;map.fitBounds(walkBounds(d),{padding:{top:56,bottom:56,left:40,right:64},maxZoom:17,duration:reduced()?0:600})}
function drawWalk(d){var btn=document.getElementById('fitwalk');btn.classList.toggle('show',!!d.walk);
 if(d.walk)btn.setAttribute('aria-label','Fit walking route to '+d.walk.to);
 if(!styleReady)return;
 var src=map.getSource('walk');
 if(!d.walk){if(src){map.removeLayer('walk-line');map.removeLayer('walk-casing');map.removeSource('walk')}walkKey=null;return}
 var data={type:'Feature',properties:{},geometry:{type:'LineString',coordinates:d.walk.coords}};
 if(src){if(walkKey!==d.walk.key)src.setData(data)}
 else{map.addSource('walk',{type:'geojson',data:data});
  map.addLayer({id:'walk-casing',type:'line',source:'walk',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#fff','line-width':8,'line-opacity':.9}});
  map.addLayer({id:'walk-line',type:'line',source:'walk',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#1A73E8','line-width':5,'line-dasharray':[0.1,1.6]}})}
 if(walkKey!==d.walk.key){walkKey=d.walk.key;fitWalk(d)}}

window.update=function(d){
 if(!map)return;var prev=last;last=d;
 var el=document.getElementById('map');if(d.label)el.setAttribute('aria-label',d.label);
 // Stops (one marker per physical point).
 var seen={};
 d.stops.forEach(function(s){var key=s.ids.join(',');seen[key]=1;
  var sig=[s.kind,s.numbers.join('.'),s.onDemand,s.label,d.route&&d.route.color].join('|');var m=stops[key];
  if(m&&m.sig===sig&&m.data.lat===s.lat&&m.data.lng===s.lng){m.data=s;return}
  if(m)m.marker.remove();
  var b=stopEl(s,d.route);b.style.zIndex=s.kind?3:1;b.onclick=function(e){e.stopPropagation();openStop(key)};
  stops[key]={sig:sig,data:s,marker:place(b,{anchor:'bottom'},[s.lng,s.lat])}});
 Object.keys(stops).forEach(function(k){if(!seen[k]){stops[k].marker.remove();delete stops[k]}});
 // Vehicles.
 var vseen={};
 d.vehicles.forEach(function(v){vseen[v.id]=1;var m=vehs[v.id];
  var sig=[v.state,v.type,v.color,v.focus,v.name,v.heading==null?'':Math.round(v.heading/5),v.label].join('|');
  if(!m){var b=vehEl(v);b.onclick=function(e){e.stopPropagation();openVeh(v.id)};b.style.zIndex=v.focus?6:5;
   m=vehs[v.id]={sig:sig,data:v,at:[v.lng,v.lat],fixAt:v.fixAt,anim:0,marker:place(b,{},[v.lng,v.lat])}}
  else{if(m.sig!==sig){var nb=vehEl(v);var old=m.marker.getElement();old.className=nb.className+' '+Array.prototype.filter.call(old.classList,function(c){return c.indexOf('maplibregl')===0}).join(' ');old.setAttribute('aria-label',v.label);old.title=v.name;
    old.style.setProperty('--c',nb.style.getPropertyValue('--c'));old.style.zIndex=v.focus?6:5;old.replaceChild(nb.firstChild,old.firstChild);m.sig=sig}
   m.data=v;if(v.fixAt!==m.fixAt)moveVeh(m,v)}
  if(popKey==='v:'+v.id&&popup)popup.setDOMContent(vehNode(v)).setLngLat(m.at)});
 Object.keys(vehs).forEach(function(k){if(!vseen[k]){cancelAnimationFrame(vehs[k].anim);vehs[k].marker.remove();delete vehs[k];if(popKey==='v:'+k&&popup)popup.remove()}});
 // This device's own location: drawn here only after a real fix, never sent anywhere.
 if(d.me){var ll=[d.me.lng,d.me.lat];
  if(!meDot){var a=H('div','acc');a.style.zIndex=0;meAcc=place(a,{},ll);
   var dot=H('div','me');dot.setAttribute('role','img');dot.setAttribute('aria-label','Your location, shown only on this device');dot.style.zIndex=2;
   meDot=place(dot,{},ll)}
  else{meDot.setLngLat(ll);meAcc.setLngLat(ll)}
  sizeAcc();
  if(wantMe){wantMe=false;moved=true;map.easeTo({center:ll,zoom:Math.max(map.getZoom(),15),duration:reduced()?0:600})}}
 else if(meDot){meDot.remove();meAcc.remove();meDot=meAcc=null}
 var loc=document.getElementById('locate');loc.className='ctl '+d.locate;
 loc.setAttribute('aria-pressed',d.locate==='on'||d.locate==='waiting'?'true':'false');
 loc.setAttribute('aria-label',d.locate==='on'?'Hide my location':'Show my location');
 note(d.locate==='waiting'?'Finding your location…':d.locate==='denied'?'Location permission is off. Allow it in your settings to see yourself on the map.':d.locate==='unavailable'?'Your location is not available right now.':'');
 if(d.locate!=='waiting'&&d.locate!=='on')wantMe=false;
 // Key: vehicles that are not on the map, and why.
 var off=document.getElementById('offmap');off.textContent='';
 if(d.offMap.length){off.appendChild(H('b',null,'Not on the map'));d.offMap.forEach(function(t){off.appendChild(H('div',null,t))})}
 // Camera: fit once; afterwards follow the focused vehicle only when it leaves the view and the
 // rider has not moved the map. Reconnects and refreshes never reset the view.
 drawWalk(d);
 if(d.walk)fitted=true;
 if(!fitted&&points(d).length){fit(d);fitted=true}
 else if(!moved){var f=d.vehicles.filter(function(v){return v.focus})[0];
  var pf=prev&&prev.vehicles.filter(function(v){return v.focus})[0];
  if(f&&(!pf||pf.fixAt!==f.fixAt)){var b=map.getBounds(),w=b.getEast()-b.getWest(),h=b.getNorth()-b.getSouth();
   if(f.lng<b.getWest()+w*.15||f.lng>b.getEast()-w*.15||f.lat<b.getSouth()+h*.15||f.lat>b.getNorth()-h*.15)
    map.easeTo({center:[f.lng,f.lat],duration:reduced()?0:800})}}
};

// Controls and the key.
(function(){var r=document.getElementById('recenter');r.appendChild(fitIcon());
 r.onclick=function(){moved=false;if(last)fit(last)};
 var zi=document.getElementById('zin'),zo=document.getElementById('zout'),fw=document.getElementById('fitwalk');
 zi.appendChild(plusIcon(false));zo.appendChild(plusIcon(true));fw.appendChild(walkIcon());
 zi.onclick=function(){moved=true;map.zoomIn({duration:reduced()?0:250})};
 zo.onclick=function(){moved=true;map.zoomOut({duration:reduced()?0:250})};
 fw.onclick=function(){fitWalk(last)};
 var l=document.getElementById('locate');l.appendChild(crosshair());
 l.onclick=function(){if(!last||last.locate==='off'||last.locate==='denied'||last.locate==='unavailable')wantMe=true;post('locate')};
 var k=document.getElementById('key'),kb=document.getElementById('keybtn');
 kb.onclick=function(){var open=k.classList.toggle('open');kb.setAttribute('aria-expanded',open?'true':'false');kb.textContent=open?'Close key':'Key'};
 function row(icon,text){var r=H('div','krow'),i=H('span','kicon');i.appendChild(icon);r.appendChild(i);r.appendChild(H('span',null,text));k.insertBefore(r,document.getElementById('offmap'))}
 function veh(type,state){var e=vehEl({name:'',type:type,state:state,color:NAVY,heading:null,focus:false,label:''});e.querySelector('.pill').remove();var s=e.querySelector('.st');if(s)s.remove();e.removeAttribute('aria-label');e.setAttribute('aria-hidden','true');e.tabIndex=-1;return e}
 function sign(s){var e=stopEl(Object.assign({name:'',label:'',numbers:[],onDemand:false},s),null);e.setAttribute('aria-hidden','true');e.tabIndex=-1;var p=e.querySelector('.pill');if(p)p.remove();return e}
 k.insertBefore(H('h2',null,'Map key'),k.firstChild);
 row(veh('bus','live'),'Bus (route colour, name below)');
 row(veh('shuttle','live'),'Shuttle van');
 row(veh('','live'),'Vehicle, type not set');
 var arrow=veh('bus','live');var d=H('span','dir');d.appendChild(H('span'));arrow.firstChild.appendChild(d);row(arrow,'Pointer: direction of travel, when the GPS reports it');
 row(veh('bus','stale'),'Grey: location out of date (no GPS for 30 s)');
 row(veh('bus','lost'),'Dashed: GPS lost (no GPS for 5 min)');
 row(sign({}),'Bus stop');
 row(sign({onDemand:true}),'On-demand stop: request a pickup');
 row(sign({numbers:[3]}),'Stop number on the selected route');
 row(sign({kind:'pickup'}),'Your pickup');
 row(sign({kind:'dest'}),'Your drop-off');
 var me=H('span','me');me.style.position='static';row(me,'You (only on this device)');
 row(H('span','kline'),'Your walking route (from OpenStreetMap routing)');
})();
// Website: the page sends data with postMessage; only the embedding page is listened to.
window.addEventListener('message',function(e){if(e.source===window.parent&&e.data&&e.data.type==='update')window.update(e.data.data)});
`;

export const MAP_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>Shuttle map</title>
<link rel="stylesheet" href="${MAPLIBRE}.css" integrity="${CSS_SRI}" crossorigin="anonymous">
<style>${CSS}</style></head>
<body><div id="map" role="region" aria-label="Shuttle map"></div>
<button id="recenter" class="ctl" type="button" aria-label="Show all stops and vehicles"></button>
<button id="locate" class="ctl" type="button" aria-label="Show my location" aria-pressed="false"></button>
<button id="zin" class="ctl" type="button" aria-label="Zoom in"></button>
<button id="zout" class="ctl" type="button" aria-label="Zoom out"></button>
<button id="fitwalk" class="ctl" type="button" aria-label="Fit walking route"></button>
<button id="keybtn" type="button" aria-expanded="false" aria-controls="key">Key</button>
<div id="key" role="region" aria-label="Map key"><div id="offmap"></div></div>
<div id="note" role="status" aria-live="polite"></div>
<script>
// Website only: the frame is sandboxed without same-origin access (an opaque origin), so it can
// never read the site's session. Two MapLibre assumptions break there and are adjusted:
// 1. Reading window.caches throws; MapLibre's optional tile cache checks it, so it is hidden.
// 2. MapLibre drops worker messages whose "origin" field differs from location.origin, and the
//    page and its blob worker report different origins. Messages on this channel can only come
//    from the frame's own worker, so the field is set to the receiver's origin on both sides.
var SANDBOXED=self.origin==='null';
var SYNC_ORIGIN='var a=self.addEventListener;self.addEventListener=function(t,f,o){if(t==="message"&&typeof f==="function"){var g=f;f=function(e){if(e.data&&typeof e.data==="object"&&"origin"in e.data)e.data.origin=location.origin;return g.call(this,e)}}return a.call(this,t,f,o)};';
if(SANDBOXED){try{Object.defineProperty(window,'caches',{value:undefined,configurable:true})}catch(e){}
 var wa=Worker.prototype.addEventListener;Worker.prototype.addEventListener=function(t,f,o){if(t==='message'&&typeof f==='function'){var g=f;f=function(e){if(e.data&&typeof e.data==='object'&&'origin'in e.data)e.data.origin=location.origin;return g.call(this,e)}}return wa.call(this,t,f,o)}}
</script>
<script src="${MAPLIBRE}.js" integrity="${JS_SRI}" crossorigin="anonymous"></script><script>
// Worker side: a wrapper applies the same adjustment, then loads MapLibre's own worker code.
if(SANDBOXED){try{var orig=maplibregl.getWorkerUrl();
 maplibregl.setWorkerUrl(URL.createObjectURL(new Blob([SYNC_ORIGIN+'importScripts('+JSON.stringify(orig)+')'],{type:'text/javascript'})))}catch(e){}}
</script><script>${SCRIPT}</script></body></html>
`;
