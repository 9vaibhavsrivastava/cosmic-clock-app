import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

// Cosmic Clock — Multi‑Body (v1.3 PRE‑PROD)
// PRE‑PROD upgrades:
// • Type‑ahead timezone search over all IANA zones (validated)
// • Animated orbits (Play/Pause) with speed multipliers (1×, 10k×, 1M×)
// • Minimalist (x,y) heliocentric mini‑plot per planet
// • NEW: Interactive Heliocentric Map (pan/zoom) synced with animation
// • NEW: SPICE data‑source hooks (backend stub + graceful fallback to circular model)
// • Light theme only, auto‑wrapping tiles, soft grey background

// ===== Utilities =====
const mod = (n: number, m: number) => ((n % m) + m) % m;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;
function pad2(n: number) { return n < 10 ? `0${n}` : `${n}`; }
function formatHMS(hoursFloat: number) {
  const h = mod(Math.floor(hoursFloat), 24);
  const m = Math.floor(mod(hoursFloat * 60, 60));
  const s = Math.floor(mod(hoursFloat * 3600, 60));
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}
function formatHMS24(hoursFloat: number) { return formatHMS(mod(hoursFloat, 24)); }
function dayOfYearUTC(d: Date) { const start = Date.UTC(d.getUTCFullYear(), 0, 1); return Math.floor((d.getTime() - start)/86400000)+1; }

// Equation of Time (minutes)
function equationOfTimeMinutes(date: Date) {
  const N = dayOfYearUTC(date);
  const hours = date.getUTCHours() + date.getUTCMinutes()/60 + date.getUTCSeconds()/3600;
  const gamma = (2 * Math.PI/365)*(N-1+(hours-12)/24);
  return 229.18*(0.000075+0.001868*Math.cos(gamma)-0.032077*Math.sin(gamma)-0.014615*Math.cos(2*gamma)-0.040849*Math.sin(2*gamma));
}
function julianDateUTC(date: Date) { return date.getTime()/86400000+2440587.5; }

// Earth
function earthMeanSolarTimeHours(dateUTC: Date, lon: number) {
  const utcHours = dateUTC.getUTCHours()+dateUTC.getUTCMinutes()/60+dateUTC.getUTCSeconds()/3600+dateUTC.getUTCMilliseconds()/3.6e6;
  return mod(utcHours+lon/15,24);
}
function earthApparentSolarTimeHours(dateUTC: Date, lon: number) {
  return mod(earthMeanSolarTimeHours(dateUTC,lon)+equationOfTimeMinutes(dateUTC)/60,24);
}

// Mars
const TAI_MINUS_UTC_SECONDS=37; const TT_MINUS_UTC_SECONDS=TAI_MINUS_UTC_SECONDS+32.184;
function marsSolDate(jdUTC:number){ const jdTT=jdUTC+TT_MINUS_UTC_SECONDS/86400; return (jdTT-2405522.0028779)/1.0274912517; }
function marsMTC_Hours(msd:number){ return mod((msd%1)*24,24); }
function marsLMST_Hours(msd:number,lon:number){ return mod(marsMTC_Hours(msd)+lon/15,24); }

// Simple sparklines
function ProgressSpark({value}:{value:number}){ const pct=Math.max(0,Math.min(1,value))*100; return (<div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden"><div className="h-full bg-indigo-600" style={{width:`${pct}%`}}/></div>); }
function EotSparkline({year}:{year:number}){
  const points:number[]=[]; for(let d=1; d<=366; d++){ const date=new Date(Date.UTC(year,0,1)); date.setUTCDate(d); points.push(equationOfTimeMinutes(date)); }
  const min=Math.min(...points), max=Math.max(...points); const range=max-min || 1; const w=240,h=32;
  const path=points.map((v,i)=>{ const x=(i/(points.length-1))*w; const y=h-((v-min)/range)*h; return `${i===0?'M':'L'}${x.toFixed(1)},${y.toFixed(1)}`; }).join(' ');
  return (<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block"><rect x={0} y={0} width={w} height={h} className="fill-white"/><path d={path} className="stroke-indigo-600" fill="none" strokeWidth={1.5}/></svg>);
}

// Orbital (circular model)
const AU_KM=149597870.7;const J2000_TT=2451545.0;
function getOrbitalBodies(){return[
  {name:'Mercury',a_AU:.38709893,T_days:87.969},
  {name:'Venus',a_AU:.72333199,T_days:224.701},
  {name:'Earth',a_AU:1.00000011,T_days:365.256},
  {name:'Mars',a_AU:1.52366231,T_days:686.98},
  {name:'Jupiter',a_AU:5.20336301,T_days:4332.589},
  {name:'Saturn',a_AU:9.53707032,T_days:10759.22},
  {name:'Uranus',a_AU:19.19126393,T_days:30688.5},
  {name:'Neptune',a_AU:30.06896348,T_days:60182},
];}
function meanLongitudeDeg(jdTT:number,T:number){return mod(((jdTT-J2000_TT)/T)*360,360)}
function speedKmPerSec(a:number,T:number){return(2*Math.PI*a*AU_KM)/T/86400}

// CSS keyframes for orbit animation
const SpinStyle = () => (<style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>);

function MiniPlot({xAU,yAU}:{xAU:number;yAU:number}){
  const size=54, pad=4; const cx=size/2, cy=size/2; const scale=(size/2-pad)/Math.max(1, Math.max(Math.abs(xAU),Math.abs(yAU),1));
  const px=cx + xAU*scale; const py=cy - yAU*scale;
  return (
    <svg width={size} height={size} className="block">
      <rect x={0} y={0} width={size} height={size} fill="#f8fafc" stroke="#cbd5e1" />
      <line x1={cx} y1={pad} x2={cx} y2={size-pad} stroke="#94a3b8" strokeDasharray="2 2" />
      <line x1={pad} y1={cy} x2={size-pad} y2={cy} stroke="#94a3b8" strokeDasharray="2 2" />
      <circle cx={cx} cy={cy} r={3} fill="#f59e0b" />
      <circle cx={px} cy={py} r={3} fill="#1e40af" />
    </svg>
  );
}

function OrbitRing({thetaDeg,periodDays,animate,speedScale=1}:{thetaDeg:number;periodDays:number;animate:boolean;speedScale?:number}){
  const periodSec=periodDays*86400/speedScale; const anim=animate? `spin ${periodSec}s linear infinite` : undefined;
  return(
    <div className="relative w-20 h-20">
      <div className="absolute inset-0 rounded-full border border-slate-300"/>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">☉</div>
      <div className="absolute left-1/2 top-1/2 origin-center" style={{transform:`translate(-50%,-50%) rotate(${thetaDeg}deg)`,animation:anim}}>
        <div className="h-2 w-2 rounded-full bg-indigo-600" style={{transform:'translate(36px,0)'}}/>
      </div>
    </div>
  )}

// ===== SPICE backend hooks (stub + graceful fallback) =====
// Expected backend endpoint (example): GET /api/spice/state?utc=ISO&bodies=Mercury,Venus,...
// Response per body: { name, x_km, y_km, z_km, vx_km_s, vy_km_s, vz_km_s, epochUTC }
// Convert to AU + angle; if request fails, we fallback to circular model.
async function fetchSpiceStates(epochISO: string, bodies: string[]): Promise<Record<string, { x_AU:number; y_AU:number; thetaDeg:number; v_kms:number }>> {
  const url = `/api/spice/state?utc=${encodeURIComponent(epochISO)}&bodies=${encodeURIComponent(bodies.join(','))}`;
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json() as Array<{name:string;x_km:number;y_km:number;vx_km_s:number;vy_km_s:number}>;
    const out: Record<string, any> = {};
    for (const row of json) {
      const x_AU = row.x_km / AU_KM; const y_AU = row.y_km / AU_KM;
      const thetaDeg = mod(toDeg(Math.atan2(y_AU, x_AU)), 360);
      const v_kms = Math.hypot(row.vx_km_s, row.vy_km_s);
      out[row.name] = { x_AU, y_AU, thetaDeg, v_kms };
    }
    return out;
  } catch (e) {
    // No backend in PRE‑PROD preview — let caller handle fallback
    throw e;
  }
}

// Circular model rows builder
type OrbitalRow = { name:string; a:number; theta:number; x:number; y:number; v:number; T:number };
function circularRows(jdTT:number): OrbitalRow[] {
  return getOrbitalBodies().map(b=>{
    const theta=meanLongitudeDeg(jdTT,b.T_days); const v=speedKmPerSec(b.a_AU,b.T_days);
    const x=b.a_AU*Math.cos(toRad(theta)); const y=b.a_AU*Math.sin(toRad(theta));
    return { name:b.name, a:b.a_AU, theta, x, y, v, T:b.T_days };
  });
}

// Interactive heliocentric map (SVG, pan/zoom)
function HeliocentricMap({rows}:{rows:OrbitalRow[]}){
  const svgRef = useRef<SVGSVGElement|null>(null);
  const [zoom,setZoom]=useState(1); const [offset,setOffset]=useState({x:0,y:0});
  const maxA = Math.max(...rows.map(r=>r.a), 1);
  const size = 420; const pad = 16; const baseScale = (size/2 - pad) / (maxA*1.1);
  const scale = baseScale * zoom;
  const toPx = (xAU:number)=> size/2 + offset.x + xAU*scale;
  const toPy = (yAU:number)=> size/2 + offset.y - yAU*scale;

  // interactions
  useEffect(()=>{
    const svg = svgRef.current; if(!svg) return;
    let dragging=false; let lx=0, ly=0;
    const onWheel=(e:WheelEvent)=>{ e.preventDefault(); const factor = e.deltaY>0? 0.9 : 1.1; setZoom(z=>Math.min(20,Math.max(0.2,z*factor))); };
    const onDown=(e:MouseEvent)=>{ dragging=true; lx=e.clientX; ly=e.clientY; };
    const onMove=(e:MouseEvent)=>{ if(!dragging) return; const dx=e.clientX-lx, dy=e.clientY-ly; lx=e.clientX; ly=e.clientY; setOffset(o=>({x:o.x+dx,y:o.y+dy})); };
    const onUp=()=>{ dragging=false; };
    svg.addEventListener('wheel', onWheel, { passive:false }); svg.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    return ()=>{ svg.removeEventListener('wheel', onWheel as any); svg.removeEventListener('mousedown', onDown as any); window.removeEventListener('mousemove', onMove as any); window.removeEventListener('mouseup', onUp as any); };
  },[]);

  return (
    <svg ref={svgRef} width={size} height={size} className="rounded-2xl border border-slate-300 bg-slate-50">
      {/* grid */}
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e2e8f0" strokeWidth="1" />
        </pattern>
      </defs>
      <rect x={0} y={0} width={size} height={size} fill="url(#grid)" />
      {/* axes */}
      <line x1={toPx(-maxA)} y1={toPy(0)} x2={toPx(maxA)} y2={toPy(0)} stroke="#94a3b8" strokeDasharray="4 3" />
      <line x1={toPx(0)} y1={toPy(-maxA)} x2={toPx(0)} y2={toPy(maxA)} stroke="#94a3b8" strokeDasharray="4 3" />
      {/* Sun */}
      <circle cx={toPx(0)} cy={toPy(0)} r={5} fill="#f59e0b" stroke="#b45309" />
      {/* Orbits & planets */}
      {rows.map((r,i)=> (
        <g key={r.name}>
          <circle cx={toPx(0)} cy={toPy(0)} r={r.a*scale} fill="none" stroke="#cbd5e1" />
          <circle cx={toPx(r.x)} cy={toPy(r.y)} r={4} fill="#1e40af" />
          <text x={toPx(r.x)+6} y={toPy(r.y)+3} fontSize="10" fill="#334155">{r.name}</text>
        </g>
      ))}
    </svg>
  );
}

function OrbitalGrid({rows,animate,speedScale}:{rows:OrbitalRow[];animate:boolean;speedScale:number}){
  return(
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-600 border-b border-slate-300 bg-slate-50">
            <th className="py-2 pr-3">Body</th>
            <th className="py-2 pr-3">a (AU)</th>
            <th className="py-2 pr-3">θ (deg)</th>
            <th className="py-2 pr-3">x (AU)</th>
            <th className="py-2 pr-3">y (AU)</th>
            <th className="py-2 pr-3">v (km/s)</th>
            <th className="py-2 pr-3">Mini‑plot</th>
            <th className="py-2 pr-3">Orbit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r=> (
            <tr key={r.name} className="border-b border-slate-200">
              <td className="py-1 pr-3">{r.name}</td>
              <td className="py-1 pr-3 tabular-nums">{r.a.toFixed(6)}</td>
              <td className="py-1 pr-3 tabular-nums">{r.theta.toFixed(1)}</td>
              <td className="py-1 pr-3 tabular-nums">{r.x.toFixed(3)}</td>
              <td className="py-1 pr-3 tabular-nums">{r.y.toFixed(3)}</td>
              <td className="py-1 pr-3 tabular-nums">{r.v.toFixed(2)}</td>
              <td className="py-1 pr-3"><MiniPlot xAU={r.x} yAU={r.y}/></td>
              <td className="py-1 pr-3"><OrbitRing thetaDeg={r.theta} periodDays={r.T} animate={animate} speedScale={speedScale}/></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Tiles
function TimeTile({label,value}:{label:string;value:string}){
  return(
    <motion.div initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{duration:0.3}}
      className="rounded-2xl border border-slate-300 bg-white shadow-sm p-3 break-words">
      <div className="text-xs text-slate-600 leading-tight">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 leading-tight">{value}</div>
    </motion.div>
  )
}
function StatTile({label,value}:{label:string|React.ReactNode;value:string}){
  return(
    <motion.div initial={{opacity:0,scale:.98}} animate={{opacity:1,scale:1}} transition={{duration:.25}}
      className="rounded-2xl border border-slate-300 bg-white shadow-sm p-4 break-words">
      <div className="text-xs text-slate-600 leading-tight">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums text-slate-900 leading-tight">{value}</div>
    </motion.div>
  )
}
function PlanetTiles({name,ct,lmst,longitude,onLon,dayLabel,dayNumber}:{name:string;ct:number;lmst:number;longitude:number;onLon:(v:number)=>void;dayLabel:string;dayNumber:number}){
  return(
    <div className="rounded-2xl border border-slate-300 bg-white shadow-md p-4 break-words">
      <h4 className="font-semibold mb-2 text-slate-900 leading-tight">{name}</h4>
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
        <TimeTile label="CT (0°E)" value={formatHMS24(ct)}/>
        <TimeTile label="LMST" value={formatHMS24(lmst)}/>
        <StatTile label={dayLabel} value={`${dayNumber}`}/>
      </div>
      <div className="mt-2">
        <label className="text-xs text-slate-600">Longitude (°E)</label>
        <input type="number" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 bg-white text-slate-900" value={longitude} onChange={e=>onLon(Number(e.target.value))}/>
      </div>
    </div>
  )
}

// Major moons (educational rotation day model)
const MOONS = {
  Phobos:   { periodHours: 7.653 },
  Deimos:   { periodHours: 30.35 },
  Io:       { periodHours: 42.459 },
  Europa:   { periodHours: 85.228 },
  Ganymede: { periodHours: 171.709 },
  Callisto: { periodHours: 400.536 },
  Titan:    { periodHours: 382.68 },
  Rhea:     { periodHours: 108.45 },
  Iapetus:  { periodHours: 1903.7 },
  Enceladus:{ periodHours: 32.89 },
  Titania:  { periodHours: 208.95 },
  Oberon:   { periodHours: 323.1 },
  Triton:   { periodHours: 141.0 },
} as const;
function rotationCT_24hDial(jdTT:number, periodHours:number, epochJDTT:number=J2000_TT){ const days = (jdTT - epochJDTT) / (periodHours/24); return mod((days % 1) * 24, 24); }
function rotationCount(jdTT:number, periodHours:number, epochJDTT:number=J2000_TT){ return Math.floor((jdTT - epochJDTT) / (periodHours/24)); }

// Timezone helpers
const PRESET_TZ = [
  "UTC","Etc/UTC","Europe/London","Europe/Paris","Africa/Cairo","Europe/Berlin","Europe/Madrid","Europe/Rome","Europe/Moscow",
  "Asia/Kolkata","Asia/Dubai","Asia/Singapore","Asia/Tokyo","Asia/Seoul","Asia/Shanghai","Asia/Hong_Kong","Asia/Bangkok","Asia/Jakarta",
  "Australia/Sydney","Australia/Perth","Pacific/Auckland",
  "America/New_York","America/Toronto","America/Chicago","America/Denver","America/Los_Angeles","America/Phoenix","America/Mexico_City","America/Sao_Paulo",
  "Africa/Johannesburg","Africa/Nairobi","Atlantic/Reykjavik"
];
function getAllTimeZones(): string[] { const anyIntl = (Intl as any); if (typeof anyIntl.supportedValuesOf === 'function') { try { return anyIntl.supportedValuesOf('timeZone'); } catch {} } return PRESET_TZ; }
function isValidTimeZone(tz: string): boolean { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date()); return true; } catch { return false; } }

// ===== Main =====
export default function CosmicClock(){
  const userTZ=useMemo(()=>Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC",[]);
  const [now,setNow]=useState(new Date());
  const [compact,setCompact]=useState(false);
  const [earthTz,setEarthTz]=useState(userTZ);
  const [tzQuery,setTzQuery]=useState("");
  const [allTZ] = useState<string[]>(getAllTimeZones());

  // Orbit animation controls
  const [animateOrbits,setAnimateOrbits]=useState(true); // default 1× real-time
  const [orbitSpeedScale,setOrbitSpeedScale]=useState(1);

  // Visual time (smooth animation independent of tick)
  const [visualJDTT, setVisualJDTT] = useState(()=> julianDateUTC(new Date()) + TT_MINUS_UTC_SECONDS/86400);
  useEffect(()=>{
    let raf:number; const start = performance.now(); const base = julianDateUTC(new Date()) + TT_MINUS_UTC_SECONDS/86400;
    const loop=(t:number)=>{ const dt=(t-start)/1000; setVisualJDTT(animateOrbits? base + (dt*orbitSpeedScale)/86400 : base); raf=requestAnimationFrame(loop); };
    raf=requestAnimationFrame(loop); return ()=>cancelAnimationFrame(raf);
  },[animateOrbits, orbitSpeedScale]);

  const [earthLon,setEarthLon]=useState(77.1025);
  const [marsLon,setMarsLon]=useState(137.4);
  const [moonLon,setMoonLon]=useState(0);
  const [mercuryLon,setMercuryLon]=useState(0);
  const [venusLon,setVenusLon]=useState(0);
  const [jupiterLon,setJupiterLon]=useState(0);

  const [tests,setTests]=useState<Array<{name:string;pass:boolean;got:string;expected:string;note?:string}>>([]);

  useEffect(()=>{const id=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(id)},[]);

  const earthLMST=useMemo(()=>earthMeanSolarTimeHours(now,earthLon),[now,earthLon]);
  const earthLAST=useMemo(()=>earthApparentSolarTimeHours(now,earthLon),[now,earthLon]);
  const eotMin=useMemo(()=>equationOfTimeMinutes(now),[now]);
  const earthCivil=useMemo(()=>new Intl.DateTimeFormat("en-GB",{timeZone:earthTz,hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(now),[now,earthTz]);
  const earthDateStr=useMemo(()=>new Intl.DateTimeFormat("en-GB",{timeZone:earthTz,weekday:'short',year:'numeric',month:'short',day:'2-digit'}).format(now),[now,earthTz]);
  const utcDateStr=useMemo(()=>new Intl.DateTimeFormat("en-GB",{timeZone:'UTC',weekday:'short',year:'numeric',month:'short',day:'2-digit'}).format(now),[now]);

  const jdUTC=useMemo(()=>julianDateUTC(now),[now]);
  const msd=useMemo(()=>marsSolDate(jdUTC),[jdUTC]);
  const mtc=useMemo(()=>marsMTC_Hours(msd),[msd]);
  const marsLMSTval=useMemo(()=>marsLMST_Hours(msd,marsLon),[msd,marsLon]);
  const solNumber=useMemo(()=>Math.floor(msd),[msd]);
  const jdTT=useMemo(()=>jdUTC+TT_MINUS_UTC_SECONDS/86400,[jdUTC]);

  function genericCT(hoursPerSolarDay:number,epoch:number,jdTTlocal?:number){const base=jdTTlocal??jdTT;const days=(base-epoch)/(hoursPerSolarDay/24);return mod((days%1)*24,24)}
  const Bodies={Moon:{solarDayHours:29.530588*24,epochJDTT:2451545},Mercury:{solarDayHours:175.938*24,epochJDTT:2451545},Venus:{solarDayHours:-116.75*24,epochJDTT:2451545},Jupiter:{solarDayHours:9.925,epochJDTT:2451545}};
  const moonCT=useMemo(()=>genericCT(Bodies.Moon.solarDayHours,Bodies.Moon.epochJDTT),[jdTT]);
  const moonLMST=useMemo(()=>mod(moonCT+moonLon/15,24),[moonCT,moonLon]);
  const mercuryCT=useMemo(()=>genericCT(Bodies.Mercury.solarDayHours,Bodies.Mercury.epochJDTT),[jdTT]);
  const mercuryLMST=useMemo(()=>mod(mercuryCT+mercuryLon/15,24),[mercuryCT,mercuryLon]);
  const venusCT=useMemo(()=>genericCT(Bodies.Venus.solarDayHours,Bodies.Venus.epochJDTT),[jdTT]);
  const venusLMST=useMemo(()=>mod(venusCT+venusLon/15,24),[venusCT,venusLon]);
  const jupiterCT=useMemo(()=>genericCT(Bodies.Jupiter.solarDayHours,Bodies.Jupiter.epochJDTT),[jdTT]);
  const jupiterLMST=useMemo(()=>mod(jupiterCT+jupiterLon/15,24),[jupiterCT,jupiterLon]);

  const moonDayNum=Math.floor((jdTT-Bodies.Moon.epochJDTT)/(Bodies.Moon.solarDayHours/24));
  const mercuryDayNum=Math.floor((jdTT-Bodies.Mercury.epochJDTT)/(Bodies.Mercury.solarDayHours/24));
  const venusDayNum=Math.floor((jdTT-Bodies.Venus.epochJDTT)/(Bodies.Venus.solarDayHours/24));
  const jupiterDayNum=Math.floor((jdTT-Bodies.Jupiter.epochJDTT)/(Bodies.Jupiter.solarDayHours/24));

  // Major moons maps
  const moonCTmap = useMemo(()=>Object.fromEntries(Object.entries(MOONS).map(([k,v])=>[k, rotationCT_24hDial(jdTT, v.periodHours)])),[jdTT]);
  const moonDaymap = useMemo(()=>Object.fromEntries(Object.entries(MOONS).map(([k,v])=>[k, rotationCount(jdTT, v.periodHours)])),[jdTT]);

  const solFrac=mod(marsLMSTval/24,1);

  // Data source toggle (model vs SPICE)
  const [dataSource,setDataSource] = useState<'model'|'spice'>('model');
  const [spiceStatus,setSpiceStatus] = useState<'idle'|'loading'|'ok'|'error'>('idle');
  const [rows,setRows] = useState<OrbitalRow[]>(circularRows(visualJDTT));

  // Build rows whenever time or source changes
  useEffect(()=>{
    const bodies = getOrbitalBodies().map(b=>b.name);
    const epochISO = new Date().toISOString();
    if (dataSource==='spice') {
      setSpiceStatus('loading');
      fetchSpiceStates(epochISO, bodies)
        .then(map=>{
          const merged = getOrbitalBodies().map(b=>{
            const m = map[b.name];
            if (m) {
              const v = speedKmPerSec(b.a_AU,b.T_days); // keep mean v for now (backend can return true |v|)
              return { name:b.name, a:b.a_AU, theta:m.thetaDeg, x:m.x_AU, y:m.y_AU, v, T:b.T_days } as OrbitalRow;
            }
            return null;
          }).filter(Boolean) as OrbitalRow[];
          if (merged.length) { setRows(merged); setSpiceStatus('ok'); } else { setRows(circularRows(visualJDTT)); setSpiceStatus('error'); }
        })
        .catch(()=>{ setRows(circularRows(visualJDTT)); setSpiceStatus('error'); });
    } else {
      setRows(circularRows(visualJDTT)); setSpiceStatus('idle');
    }
  },[dataSource, visualJDTT]);

  function runSelfChecks(){
    const checks:Array<{name:string;pass:boolean;got:string;expected:string;note?:string}>=[];
    const bodies=getOrbitalBodies();
    const earth=bodies.find(b=>b.name==='Earth')!; const mercury=bodies.find(b=>b.name==='Mercury')!; const neptune=bodies.find(b=>b.name==='Neptune')!;
    const vE=speedKmPerSec(earth.a_AU,earth.T_days), vM=speedKmPerSec(mercury.a_AU,mercury.T_days), vN=speedKmPerSec(neptune.a_AU,neptune.T_days);
    function approx(name:string, got:number, expected:number, tol:number, note?:string){const pass=Math.abs(got-expected)<=tol; checks.push({name,pass,got:got.toFixed(2),expected:`${expected.toFixed(2)}±${tol}`,note});}
    approx('Earth speed',vE,29.78,0.5,'mean'); approx('Mercury speed',vM,47.36,1.0,'fast'); approx('Neptune speed',vN,5.43,0.2,'slow');
    const degPerDay=360/earth.T_days; approx('Earth deg/day',degPerDay,0.9856,0.02,'sidereal year');
    const mtcNow=marsMTC_Hours(msd); const lmst0=marsLMST_Hours(msd,0); approx('Mars: |MTC-LMST@0°E|',Math.abs(mtcNow-lmst0),0,0.005,'~18 s');
    const lmstE=earthMeanSolarTimeHours(now,earthLon); const lastE=earthApparentSolarTimeHours(now,earthLon); const eotH=equationOfTimeMinutes(now)/60; const diff=mod(lastE-lmstE-eotH,24); const err=Math.min(diff,24-diff); checks.push({name:'Earth: LAST-LMST≈EoT/60',pass:err<0.01,got:err.toFixed(4),expected:'<0.01',note:'~36 s'});
    // New: atan2/angle wrap sanity
    const ang = mod(toDeg(Math.atan2(1,0)),360); checks.push({name:'atan2(1,0) deg = 90', pass: Math.abs(ang-90)<1e-9, got: ang.toFixed(6), expected: '90.000000'});
    // New: data source reachable/fallback
    checks.push({name:`Data source: ${dataSource}`, pass: dataSource==='model' || spiceStatus!=='error', got: spiceStatus, expected: 'model or spice(ok)'});

    setTests(checks);
  }

  const filteredTZ = useMemo(()=>{
    const q = tzQuery.trim().toLowerCase(); const source = allTZ && allTZ.length ? allTZ : PRESET_TZ; return (q? source.filter(z=>z.toLowerCase().includes(q)) : source);
  },[tzQuery, allTZ]);
  const tzValid = useMemo(()=>isValidTimeZone(earthTz),[earthTz]);

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <SpinStyle/>
      <div className="relative max-w-7xl mx-auto p-4">
        <header className="flex flex-wrap gap-3 justify-between items-center mb-4">
          <h1 className="text-xl sm:text-2xl font-semibold">Cosmic Clock — Multi‑Body (v1.3 PRE‑PROD)</h1>
          <div className="flex items-center gap-3 text-xs sm:text-sm">
            <span className="text-slate-700">UTC {utcDateStr} • {new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(now)}</span>
            <button className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs bg-white hover:bg-slate-50" onClick={()=>setCompact(v=>!v)}>{compact?'Expanded':'Compact'}</button>
          </div>
        </header>

        <div className={`grid grid-cols-1 ${compact?'lg:grid-cols-3':'lg:grid-cols-2'} gap-4`}>
          {/* Earth */}
          <section className="p-4 rounded-2xl border border-slate-300 bg-white shadow-md">
            <h2 className="font-semibold mb-2">Earth</h2>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
              <TimeTile label="Local Civil Time" value={earthCivil}/>
              <TimeTile label="LMST" value={formatHMS24(earthLMST)}/>
              <TimeTile label="LAST" value={formatHMS24(earthLAST)}/>
            </div>
            <div className="mt-3 grid gap-3 grid-cols-1 sm:grid-cols-3">
              <StatTile label="Date (local)" value={earthDateStr}/>
              <StatTile label={<span>Time Zone<br/><span className="text-[11px] text-slate-500">IANA</span></span>} value={earthTz}/>
              <div className="rounded-2xl border border-slate-300 p-3 bg-white shadow-sm">
                <div className="text-xs text-slate-600 mb-1">Search Time Zone (type‑ahead)</div>
                <input className={`w-full rounded-xl border ${tzValid?'border-slate-300':'border-rose-400'} px-3 py-2 mb-2`} placeholder="e.g. Asia/Kolkata" list="tzlist" value={earthTz} onChange={e=>setEarthTz(e.target.value)} />
                <input className="w-full rounded-xl border border-slate-300 px-3 py-2 mb-2" placeholder="Filter list…" value={tzQuery} onChange={e=>setTzQuery(e.target.value)} />
                <datalist id="tzlist">{filteredTZ.slice(0,400).map(tz=> <option key={tz} value={tz} />)}</datalist>
                <div className={`text-[11px] ${tzValid?'text-emerald-700':'text-rose-700'}`}>{tzValid? 'Valid timezone' : 'Invalid timezone name'}</div>
              </div>
            </div>
            <div className="mt-3 text-sm">EoT: {eotMin.toFixed(1)} min</div>
            <div className="mt-2"><EotSparkline year={now.getUTCFullYear()} /></div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-xs">Longitude (°E)
                <input type="number" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 bg-white" value={earthLon} step={0.0001} onChange={e=>setEarthLon(Number(e.target.value))}/>
              </label>
            </div>
          </section>

          {/* Mars */}
          <section className="p-4 rounded-2xl border border-slate-300 bg-white shadow-md">
            <h2 className="font-semibold mb-2">Mars</h2>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
              <TimeTile label="MTC (0°E)" value={formatHMS24(mtc)}/>
              <TimeTile label="LMST" value={formatHMS24(marsLMSTval)}/>
              <StatTile label="Sol Number" value={`${solNumber}`}/>
            </div>
            <div className="mt-3">
              <div className="text-xs mb-1">Sol progress (LMST/24)</div>
              <ProgressSpark value={solFrac} />
            </div>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="text-xs">Longitude (°E)
                <input type="number" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 bg-white" value={marsLon} step={0.01} onChange={e=>setMarsLon(Number(e.target.value))}/>
              </label>
              <div className="text-xs self-end">MSD {msd.toFixed(5)}</div>
            </div>
          </section>

          {/* Other planets (Mars-style) */}
          <PlanetTiles name="Moon" ct={moonCT} lmst={moonLMST} longitude={moonLon} onLon={setMoonLon} dayLabel="Lunar day #" dayNumber={moonDayNum}/>
          <PlanetTiles name="Mercury" ct={mercuryCT} lmst={mercuryLMST} longitude={mercuryLon} onLon={setMercuryLon} dayLabel="Solar day #" dayNumber={mercuryDayNum}/>
          <PlanetTiles name="Venus" ct={venusCT} lmst={venusLMST} longitude={venusLon} onLon={setVenusLon} dayLabel="Solar day # (retrograde)" dayNumber={venusDayNum}/>
          <PlanetTiles name="Jupiter" ct={jupiterCT} lmst={jupiterLMST} longitude={jupiterLon} onLon={setJupiterLon} dayLabel="Rotation # (Sys III)" dayNumber={jupiterDayNum}/>
        </div>

        {/* Major moons section */}
        <section className="mt-4 p-4 rounded-2xl border border-slate-300 bg-white shadow-md">
          <h3 className="font-semibold mb-2">Major Moons (educational rotation model)</h3>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Object.keys(MOONS).map((name)=>{
              const ct = (moonCTmap as any)[name] as number; const day = (moonDaymap as any)[name] as number;
              return (
                <div key={name} className="rounded-2xl border border-slate-300 bg-white shadow-sm p-4">
                  <h4 className="font-semibold text-slate-900 mb-2 leading-tight">{name}</h4>
                  <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
                    <TimeTile label="Rotation CT" value={formatHMS24(ct)}/>
                    <StatTile label="Rotation count #" value={`${day}`}/>
                    <TimeTile label="Illustrative LMST" value={formatHMS24(ct)}/>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-2">LMST here is illustrative (24h dial mapped to rotation). For physically accurate subsolar times, a SPICE backend is required.</p>
                </div>
              )
            })}
          </div>
        </section>

        {/* Orbital metrics */}
        <section className="mt-4 p-4 rounded-2xl border border-slate-300 bg-white shadow-md">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Heliocentric position & speed</h3>
            <div className="flex items-center gap-3 text-xs">
              <button className="rounded-lg border border-slate-300 px-2 py-1 bg-white hover:bg-slate-50" onClick={()=>setAnimateOrbits(v=>!v)}>{animateOrbits? 'Pause' : 'Play'}</button>
              <span>Speed:</span>
              <select className="rounded-lg border border-slate-300 bg-white px-2 py-1" value={orbitSpeedScale} onChange={e=>setOrbitSpeedScale(Number(e.target.value))}>
                <option value={1}>1× (realtime)</option>
                <option value={10000}>10,000×</option>
                <option value={1000000}>1,000,000×</option>
              </select>
              <div className="flex items-center gap-2">
                <label className="text-slate-600">Data source:</label>
                <select className="rounded-lg border border-slate-300 bg-white px-2 py-1" value={dataSource} onChange={e=>setDataSource(e.target.value as any)}>
                  <option value="model">Circular model</option>
                  <option value="spice">SPICE (backend)</option>
                </select>
                <span className={`text-[11px] ${dataSource==='spice'?(spiceStatus==='ok'?'text-emerald-700':spiceStatus==='loading'?'text-amber-700':'text-rose-700'):'text-slate-500'}`}>
                  {dataSource==='spice'? (spiceStatus==='ok'? 'SPICE: connected' : spiceStatus==='loading'? 'SPICE: loading…' : 'SPICE: unavailable — fallback') : 'model'}
                </span>
              </div>
            </div>
          </div>
          <OrbitalGrid rows={rows} animate={animateOrbits} speedScale={orbitSpeedScale} />
          <p className="text-[11px] text-slate-600 mt-2">Angles θ are mean anomalies since J2000 (TT) for the circular model; when SPICE is selected, positions come from your backend state vectors (converted to AU). Mini‑plots show current (x,y) direction from the Sun. Use the interactive map below to pan/zoom.</p>

          <div className="mt-4 flex flex-col items-start gap-2">
            <div className="text-xs text-slate-700">Interactive heliocentric map (drag to pan, mouse‑wheel to zoom)</div>
            <HeliocentricMap rows={rows} />
          </div>

          <div className="mt-4">
            <button onClick={runSelfChecks} className="rounded-xl border border-slate-300 px-3 py-2 text-sm bg-white hover:bg-slate-50">Run self‑checks</button>
            {tests.length>0 && (
              <div className="mt-3 rounded-2xl border border-slate-300 bg-slate-50 p-3">
                <div className="text-sm font-medium mb-2">Self‑check results</div>
                <ul className="text-sm space-y-1">
                  {tests.map((t,i)=> (
                    <li key={i} className={t.pass?"text-emerald-700":"text-rose-700"}>
                      <span className="font-medium">{t.name}:</span> got {t.got}, expected {t.expected}{t.note?` — ${t.note}`:''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>

        <footer className="mt-6 text-xs text-slate-600">Built for demonstration/education. v1.3 PRE‑PROD</footer>
      </div>
    </div>
  );
}
