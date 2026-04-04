/**
 * script.js — Mapa de Afinidades Electorales Colombia 2026
 * v2 — Retos 1, 2 y 3 completamente integrados
 */

const API = window.location.origin + "/api";

const TIPO_COLOR = {
  candidato:          "#f5c842",
  departamento:       "#4a7fd4",
  franja_demografica: "#52c27e",
  medio:              "#e04e4e",
};
const TIPO_SHAPE_R = { candidato:14, departamento:10, franja_demografica:9, medio:11 };
const COMM_COLORS  = [
  "#f5c842","#4a7fd4","#52c27e","#e04e4e",
  "#c97ee8","#f0854a","#48d1cc","#e8a0c0",
  "#7fdb88","#f08cac","#72d4f0","#f5a742",
];

const state = {
  view:"main", graphData:null, franjaData:null, compareData:null,
  bridgeData:null, metaData:null, selectedComm:null, activeBridgeId:null,
};

// ══════ INICIALIZACIÓN ══════════════════════════════════════════
async function init() {
  await loadMeta();
  buildControls();
  await loadAndRender();
}

async function loadMeta() {
  try { state.metaData = await (await fetch(`${API}/meta`)).json(); }
  catch(e) { console.error(e); }
}

function buildControls() {
  if (!state.metaData) return;
  const sel = document.getElementById("franja-select");
  if (sel) state.metaData.subtipos_franja.forEach(sf => {
    const o = document.createElement("option");
    o.value = sf; o.textContent = capitalize(sf); sel.appendChild(o);
  });
}

// ══════ VISTA PRINCIPAL ══════════════════════════════════════════
async function loadAndRender() {
  showLoading(true); closeSimPanel();
  try {
    const qs = new URLSearchParams(getParams()).toString();
    const [gR, bR] = await Promise.all([
      fetch(`${API}/graph?${qs}`), fetch(`${API}/bridges?${qs}&top_n=8`)
    ]);
    state.graphData  = await gR.json();
    state.bridgeData = await bR.json();
    updateMetricsPanel(state.graphData.metrics);
    updateBridgesPanel(state.bridgeData.bridges);
    renderGraph(state.graphData, "graph-canvas", "main");
  } catch(e) { console.error(e); } finally { showLoading(false); }
}

// ══════ VISTA FRANJA (Reto 2) ════════════════════════════════════
async function loadFranja() {
  showLoading(true);
  try {
    const subtipo = document.getElementById("franja-select")?.value || "edad";
    const res     = document.getElementById("resolution-slider")?.value || 1.0;
    const qs = new URLSearchParams({subtipo, resolution:res}).toString();
    state.franjaData = await (await fetch(`${API}/franja?${qs}`)).json();
    if (!state.franjaData.nodes?.length) {
      showEmptyState("graph-canvas-franja","Sin datos para esta franja"); return;
    }
    renderGraph(state.franjaData, "graph-canvas-franja", "franja");
    updateMetricsPanel(state.franjaData.metrics);
  } catch(e) { console.error(e); } finally { showLoading(false); }
}

// ══════ VISTA COMPARACIÓN (Reto 3) ══════════════════════════════
async function loadCompare() {
  showLoading(true);
  ["a","b"].forEach(w => {
    document.getElementById(`btn-select-${w}`)?.classList.remove("selected");
  });
  document.getElementById("selected-config-panel")?.classList.remove("visible");
  try {
    const qs = new URLSearchParams({
      res_a:0.7, res_b:1.4,
      tipos_a:"voto_candidato_departamento",
      tipos_b:"voto_candidato_departamento,cobertura_medio_candidato,afinidad_franja_candidato"
    }).toString();
    state.compareData = await (await fetch(`${API}/compare?${qs}`)).json();
    renderGraph(state.compareData.config_a.data, "graph-canvas-a", "compare-a");
    renderGraph(state.compareData.config_b.data, "graph-canvas-b", "compare-b");
    const ma = state.compareData.config_a.data.metrics;
    const mb = state.compareData.config_b.data.metrics;
    document.getElementById("compare-label-a").textContent =
      `A · ${ma.n_communities} comunidades · Q=${ma.modularity.toFixed(3)}`;
    document.getElementById("compare-label-b").textContent =
      `B · ${mb.n_communities} comunidades · Q=${mb.modularity.toFixed(3)}`;
  } catch(e) { console.error(e); } finally { showLoading(false); }
}

// ══════ RENDER D3 FORCE GRAPH ════════════════════════════════════
function renderGraph(data, canvasId, simKey) {
  if (!data?.nodes?.length) return;
  const container = document.getElementById(canvasId);
  if (!container) return;
  const W = container.clientWidth || 800, H = container.clientHeight || 600;
  d3.select(`#${canvasId}`).selectAll("*").remove();

  const svg = d3.select(`#${canvasId}`).append("svg").attr("width",W).attr("height",H)
    .call(d3.zoom().scaleExtent([0.1,5]).on("zoom",(e)=>g.attr("transform",e.transform)));
  const g = svg.append("g");
  const maxP = d3.max(data.edges, d=>d.peso)||100;

  const link = g.append("g").attr("class","links").selectAll("line").data(data.edges).join("line")
    .attr("stroke",d=>edgeColor(d.tipo))
    .attr("stroke-width",d=>Math.max(0.5,(d.peso/maxP)*3.5))
    .attr("stroke-opacity",d=>0.15+(d.peso/maxP)*0.55);

  const node = g.append("g").attr("class","nodes").selectAll("g").data(data.nodes).join("g")
    .attr("class","node-g")
    .call(d3.drag().on("start",dragStart).on("drag",dragged).on("end",dragEnd))
    .on("mouseover",(e,d)=>showTooltip(e,d))
    .on("mousemove",(e)=>moveTooltip(e))
    .on("mouseout",()=>hideTooltip())
    .on("click",(e,d)=>onNodeClick(d));

  node.append("circle").attr("class","node-halo")
    .attr("r",d=>nodeRadius(d)+5).attr("fill","none")
    .attr("stroke",d=>commColor(d.community))
    .attr("stroke-width",2).attr("stroke-opacity",0.3);

  node.append("circle").attr("class","node-circle")
    .attr("r",d=>nodeRadius(d))
    .attr("fill",d=>TIPO_COLOR[d.tipo]||"#888")
    .attr("stroke",d=>commColor(d.community))
    .attr("stroke-width",2).attr("stroke-opacity",0.9);

  node.filter(d=>d.tipo==="candidato"||d.tipo==="medio")
    .append("text").attr("dy",d=>nodeRadius(d)+13)
    .attr("text-anchor","middle").attr("font-size","9px")
    .attr("font-family","'Space Mono',monospace")
    .attr("fill","var(--text-sec)")
    .text(d=>d.nombre.split(" ")[0]);

  const sim = d3.forceSimulation(data.nodes)
    .force("link",d3.forceLink(data.edges).id(d=>d.id)
      .distance(d=>80-d.peso*0.3).strength(d=>(d.peso/maxP)*0.8))
    .force("charge",d3.forceManyBody().strength(-180))
    .force("center",d3.forceCenter(W/2,H/2))
    .force("collision",d3.forceCollide(d=>nodeRadius(d)+8))
    .on("tick",()=>{
      link.attr("x1",d=>d.source.x).attr("y1",d=>d.source.y)
          .attr("x2",d=>d.target.x).attr("y2",d=>d.target.y);
      node.attr("transform",d=>`translate(${d.x},${d.y})`);
    });
  window[`_sim_${simKey}`] = sim;
}

function nodeRadius(d){ return (TIPO_SHAPE_R[d.tipo]||8) + (d.betweenness||0)*18; }
function commColor(id){ if(id==null)return"#888"; return COMM_COLORS[id%COMM_COLORS.length]; }
function edgeColor(tipo){
  const m={voto_candidato_departamento:"#4a7fd4",cobertura_medio_candidato:"#e04e4e",
           alcance_medio_departamento:"#52c27e",afinidad_franja_candidato:"#f5c842"};
  return m[tipo]||"#555";
}
function dragStart(e,d){ if(!e.active) window._sim_main?.alphaTarget(0.3).restart(); d.fx=d.x;d.fy=d.y; }
function dragged(e,d){ d.fx=e.x;d.fy=e.y; }
function dragEnd(e,d){ if(!e.active) window._sim_main?.alphaTarget(0); d.fx=null;d.fy=null; }
function showEmptyState(id,msg){
  const c=document.getElementById(id); if(!c)return;
  c.innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:100%;
    color:var(--text-dim);font-family:'Space Mono',monospace;font-size:12px">${msg}</div>`;
}

// ══════ TOOLTIP ══════════════════════════════════════════════════
function showTooltip(e,d){
  const tt=document.getElementById("tooltip");
  tt.innerHTML=`
    <strong>${d.nombre}</strong>
    <div class="tt-row"><span>Tipo</span>
      <span class="tt-val" style="color:${TIPO_COLOR[d.tipo]||'#888'}">${d.tipo}</span></div>
    <div class="tt-row"><span>Comunidad</span>
      <span class="tt-val" style="color:${commColor(d.community)}">#${d.community}</span></div>
    <div class="tt-row"><span>Betweenness</span>
      <span class="tt-val">${((d.betweenness||0)*100).toFixed(1)}%</span></div>
    <div class="tt-row"><span>${d.atributo_1_label||"attr1"}</span>
      <span class="tt-val">${d.atributo_1||"—"}</span></div>
    <div class="tt-row"><span>${d.atributo_2_label||"attr2"}</span>
      <span class="tt-val">${shortenVal(d.atributo_2)}</span></div>`;
  tt.classList.add("visible"); moveTooltip(e);
}
function moveTooltip(e){
  const tt=document.getElementById("tooltip");
  tt.style.left=(e.clientX+14)+"px"; tt.style.top=(e.clientY-10)+"px";
}
function hideTooltip(){ document.getElementById("tooltip").classList.remove("visible"); }
function shortenVal(v){ if(!v)return"—"; const s=String(v); return s.length>22?s.slice(0,20)+"…":s; }

// ══════ CLICK EN NODO ════════════════════════════════════════════
function onNodeClick(d){
  state.selectedComm = (state.selectedComm===d.community)?null:d.community;
  highlightCommunity(state.selectedComm);
  document.querySelectorAll(".comm-card").forEach(c=>
    c.classList.toggle("selected",c.dataset.comm==state.selectedComm));
}
function highlightCommunity(id){
  d3.selectAll(".node-circle").attr("opacity",d=>id===null?1:(d.community===id?1:0.12));
  d3.selectAll(".node-halo").attr("stroke-opacity",d=>id===null?0.3:(d.community===id?0.85:0.04));
  d3.selectAll("line").attr("stroke-opacity",d=>{
    if(id===null)return 0.15+((d.peso||0)/100)*0.55;
    return(d.source.community===id||d.target?.community===id)?0.65:0.03;
  });
}

// ══════ PANEL DE MÉTRICAS ════════════════════════════════════════
function updateMetricsPanel(metrics){
  if(!metrics)return;
  document.getElementById("metric-nodes").textContent=metrics.n_nodes||"—";
  document.getElementById("metric-edges").textContent=metrics.n_edges||"—";
  document.getElementById("metric-comms").textContent=metrics.n_communities||"—";
  const q=metrics.modularity||0;
  document.getElementById("metric-mod").textContent=q.toFixed(3);
  const qLabel=q>=0.3?"Alta":q>=0.15?"Moderada":"Baja";
  const qColor=q>=0.3?"#52c27e":q>=0.15?"#f5c842":"#e04e4e";
  const sub=document.querySelector(".metric-sub");
  if(sub) sub.innerHTML=`calidad — <span style="color:${qColor}">${qLabel}</span>`;

  const container=document.getElementById("communities-list");
  container.innerHTML="";
  const comms=metrics.communities||{};
  Object.values(comms).sort((a,b)=>b.size-a.size).forEach(c=>{
    const color=COMM_COLORS[c.id%COMM_COLORS.length];
    const tipos=Object.entries(c.tipos).map(([t,n])=>`${n} ${t.replace("_demografica","")}`).join(", ");
    const card=document.createElement("div");
    card.className="comm-card"; card.dataset.comm=c.id;
    card.innerHTML=`
      <div class="comm-header">
        <div class="comm-color" style="background:${color}"></div>
        <span class="comm-name">Comunidad ${c.id}</span>
        <span class="comm-size">${c.size} nodos</span>
      </div>
      <div class="comm-row"><span>Composición</span><span>${tipos}</span></div>
      <div class="comm-row"><span>Densidad</span>
        <span style="color:${c.density>0.1?'#52c27e':'#f5c842'}">${c.density}</span></div>
      <div class="comm-row"><span>Nodo puente</span>
        <span style="color:var(--col-rojo)">${c.bridge_nombre}</span></div>`;
    card.addEventListener("click",()=>{
      state.selectedComm=(state.selectedComm===c.id)?null:c.id;
      highlightCommunity(state.selectedComm);
      document.querySelectorAll(".comm-card").forEach(el=>
        el.classList.toggle("selected",el.dataset.comm==state.selectedComm));
    });
    container.appendChild(card);
  });
}

// ══════ RETO 1 — PANEL DE PUENTES + SIMULACIÓN ═══════════════════
function updateBridgesPanel(bridges){
  if(!bridges)return;
  state.bridgeList=bridges;
  const container=document.getElementById("bridges-list");
  container.innerHTML="";
  bridges.forEach((b,i)=>{
    const color=TIPO_COLOR[b.tipo]||"#888";
    const item=document.createElement("div");
    item.className="bridge-item"; item.dataset.nodeId=b.id;
    item.innerHTML=`
      <span class="bridge-rank">#${i+1}</span>
      <div class="bridge-info">
        <div class="bridge-name" style="color:${color}">${b.nombre}</div>
        <div class="bridge-type">${b.tipo} · com.${b.community} · grado ${b.grado}</div>
      </div>
      <span class="bridge-bc">${(b.betweenness*100).toFixed(1)}%</span>
      <button class="btn-sim" data-nodeid="${b.id}"
        onclick="runBridgeSimulation('${b.id}',this)">▶ Simular</button>`;
    container.appendChild(item);
  });
}

async function runBridgeSimulation(nodeId, btnEl){
  if(state.activeBridgeId===nodeId){ closeSimPanel(); return; }
  document.querySelectorAll(".btn-sim").forEach(b=>b.classList.remove("active"));
  btnEl.classList.add("active"); btnEl.textContent="…";
  state.activeBridgeId=nodeId;
  d3.selectAll(".node-halo").classed("bridge-pulse",d=>d&&d.id===nodeId);
  try {
    const qs=new URLSearchParams({...getParams(),node_id:nodeId}).toString();
    const data=await (await fetch(`${API}/bridge_simulation?${qs}`)).json();
    if(data.error){ showSimError(data.error); return; }
    renderSimPanel(data);
    document.getElementById("sim-panel").scrollIntoView({behavior:"smooth",block:"nearest"});
  } catch(e){ showSimError("Error de conexión."); }
  finally { btnEl.textContent="▶ Simular"; }
}

function renderSimPanel(data){
  const panel=document.getElementById("sim-panel");
  panel.classList.add("visible");
  document.getElementById("sim-title").textContent=`Si se elimina: ${data.nodo_eliminado.nombre}`;
  document.getElementById("sim-antes-comp").textContent=data.antes.n_componentes;
  document.getElementById("sim-antes-mod").textContent=data.antes.modularity.toFixed(3);
  document.getElementById("sim-despues-comp").textContent=data.despues.n_componentes;
  document.getElementById("sim-despues-mod").textContent=data.despues.modularity.toFixed(3);

  const dc=data.despues.delta_componentes, dm=data.despues.delta_modularity;
  document.getElementById("sim-deltas").innerHTML=`
    <div class="sim-delta ${dc>0?"pos":dc<0?"neg":"zero"}">
      ${dc>=0?"+":""}${dc} componentes
    </div>
    <div class="sim-delta ${dm>0?"pos":dm<0?"neg":"zero"}" style="margin-top:4px">
      ${dm>=0?"+":""}${dm.toFixed(3)} modularidad
    </div>`;

  const interp=dc>0
    ? `⚠ La red se fragmenta en ${data.despues.n_componentes} grupos. Nodo CRÍTICO.`
    : Math.abs(dm)>0.02
    ? `Eliminarlo degrada la calidad de las comunidades (Δ Q=${dm.toFixed(3)}).`
    : "Este nodo no es crítico: la red permanece conectada y estable.";
  document.getElementById("sim-interpretation").textContent=interp;

  const listEl=document.getElementById("sim-comp-list");
  listEl.innerHTML="";
  data.componentes.forEach((comp,i)=>{
    const tiposHtml=Object.entries(comp.tipos).map(([t,n])=>{
      const col=TIPO_COLOR[t]||"#888";
      return `<span class="sim-tipo-badge"
        style="background:${col}22;color:${col};border:1px solid ${col}44">
        ${n}&nbsp;${t.replace("_demografica","").substring(0,5)}</span>`;
    }).join("");
    listEl.innerHTML+=`
      <div class="sim-comp-item">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <strong style="font-family:'Space Mono',monospace;color:var(--col-amarillo)">
            Grupo ${i+1}</strong>
          <span style="font-size:10px;color:var(--text-sec)">${comp.size} nodos</span>
          <div class="sim-comp-tipos">${tiposHtml}</div>
        </div>
        <div class="sim-comp-names">${comp.nombres.join(", ")}${comp.hay_mas?" <span style='color:var(--text-dim)'>…y más</span>":""}</div>
      </div>`;
  });
}

function showSimError(msg){
  document.getElementById("sim-panel").classList.add("visible");
  document.getElementById("sim-title").textContent="Error";
  document.getElementById("sim-comp-list").innerHTML=
    `<p style="color:var(--col-rojo);font-size:11px">${msg}</p>`;
}

function closeSimPanel(){
  state.activeBridgeId=null;
  document.getElementById("sim-panel").classList.remove("visible");
  document.querySelectorAll(".btn-sim").forEach(b=>b.classList.remove("active"));
  d3.selectAll(".node-halo").classed("bridge-pulse",false);
}

// ══════ RETO 2 — COMPARACIÓN DE FRANJAS ═════════════════════════
async function loadFranjaComparison(){
  const panel=document.getElementById("franja-comparison-panel");
  const bars=document.getElementById("franja-bars");
  panel.style.display="block";
  bars.innerHTML=`<div style="text-align:center;padding:16px">
    <div class="spinner" style="margin:0 auto 8px"></div>
    <span style="font-size:11px;color:var(--text-sec)">Calculando criterios…</span></div>`;
  try {
    const res=document.getElementById("resolution-slider")?.value||1.0;
    const data=await (await fetch(`${API}/franja_comparison?resolution=${res}`)).json();
    renderFranjaBars(data.criterios);
  } catch(e){
    bars.innerHTML=`<p style="color:var(--col-rojo);font-size:11px;padding:8px">Error al calcular.</p>`;
  }
}

function renderFranjaBars(criterios){
  const bars=document.getElementById("franja-bars");
  bars.innerHTML="";
  const BAR_COLORS=["#f5c842","#52c27e","#4a7fd4","#c97ee8","#f0854a"];
  criterios.forEach((c,i)=>{
    const isBest=i===0, color=BAR_COLORS[i%BAR_COLORS.length];
    const interp=c.score_claridad>=0.25?"Partición muy clara":c.score_claridad>=0.15?"Partición moderada":"Partición débil";
    const interpColor=c.score_claridad>=0.25?"#52c27e":c.score_claridad>=0.15?"#f5c842":"#e04e4e";
    const div=document.createElement("div");
    div.className="franja-bar-row"; div.style.cursor="pointer";
    div.title=`Clic para analizar criterio: ${c.subtipo}`;
    div.innerHTML=`
      <div class="franja-bar-header">
        <div class="franja-bar-name">
          ${capitalize(c.subtipo)}&nbsp;${isBest?`<span class="franja-best-badge">✦ MEJOR</span>`:""}
        </div>
        <div class="franja-bar-score">score ${c.score_claridad.toFixed(3)}</div>
      </div>
      <div class="franja-bar-track">
        <div class="franja-bar-fill" style="width:0%;background:${color}"
             data-target="${c.pct_score}"></div>
      </div>
      <div class="franja-bar-meta">
        <div class="franja-meta-item">Mod: <span>${c.modularity.toFixed(3)}</span></div>
        <div class="franja-meta-item">Comun: <span>${c.n_comunidades}</span></div>
        <div class="franja-meta-item">Densidad: <span>${c.densidad_media.toFixed(3)}</span></div>
        <div class="franja-meta-item" style="color:${interpColor}">${interp}</div>
      </div>`;
    div.addEventListener("click",()=>selectFranjaFromComparison(c.subtipo));
    bars.appendChild(div);
  });
  requestAnimationFrame(()=>setTimeout(()=>{
    document.querySelectorAll(".franja-bar-fill").forEach(el=>{ el.style.width=el.dataset.target+"%"; });
  },60));
}

function selectFranjaFromComparison(subtipo){
  const sel=document.getElementById("franja-select");
  if(sel){ sel.value=subtipo; document.getElementById("franja-comparison-panel").style.display="none"; loadFranja(); }
}

// ══════ RETO 3 — SELECCIÓN DE CONFIGURACIÓN ═════════════════════
function selectConfig(which){
  if(!state.compareData)return;
  const config=state.compareData[`config_${which}`];
  if(!config)return;
  document.getElementById("btn-select-a").classList.toggle("selected",which==="a");
  document.getElementById("btn-select-b").classList.toggle("selected",which==="b");
  renderSelectedConfigPanel(config,which);
  document.getElementById("selected-config-panel").scrollIntoView({behavior:"smooth",block:"nearest"});
}

function renderSelectedConfigPanel(config,which){
  const panel=document.getElementById("selected-config-panel");
  const metrics=config.data.metrics;
  panel.classList.add("visible");
  document.getElementById("config-sel-label").textContent=`Config ${which.toUpperCase()} seleccionada`;
  const q=metrics.modularity, qLabel=q>=0.3?"Alta":q>=0.15?"Mod.":"Baja";
  const qColor=q>=0.3?"#52c27e":q>=0.15?"#f5c842":"#e04e4e";
  document.getElementById("config-metric-grid").innerHTML=`
    <div class="config-metric-cell"><div class="val">${metrics.n_nodes}</div><div class="lbl">Nodos</div></div>
    <div class="config-metric-cell"><div class="val">${metrics.n_edges}</div><div class="lbl">Aristas</div></div>
    <div class="config-metric-cell"><div class="val">${metrics.n_communities}</div><div class="lbl">Comunidades</div></div>
    <div class="config-metric-cell">
      <div class="val" style="color:${qColor}">${q.toFixed(3)}</div>
      <div class="lbl">Q&nbsp;<span style="color:${qColor}">(${qLabel})</span></div>
    </div>`;
  const listEl=document.getElementById("config-comm-list");
  listEl.innerHTML=`<div style="font-family:'Space Mono',monospace;font-size:9px;text-transform:uppercase;
    letter-spacing:.07em;color:var(--text-dim);margin:8px 0 6px">Detalle por comunidad</div>`;
  Object.values(metrics.communities||{}).sort((a,b)=>b.size-a.size).forEach(c=>{
    const color=COMM_COLORS[c.id%COMM_COLORS.length];
    const tipos=Object.entries(c.tipos).map(([t,n])=>`${n} ${t.replace("_demografica","").substring(0,5)}`).join(", ");
    listEl.innerHTML+=`
      <div class="config-comm-row">
        <div class="config-comm-dot" style="background:${color}"></div>
        <div class="config-comm-name">Com.${c.id}<div style="font-size:9px;color:var(--text-dim)">${tipos}</div></div>
        <div class="config-comm-stats">${c.size}n·d:${c.density}
          <div style="color:var(--col-rojo);font-size:9px">${c.bridge_nombre}</div></div>
      </div>`;
  });
  const justif=which==="a"
    ? "Solo votos territoriales. Resolución baja → comunidades grandes y estables, sin influencia mediática."
    : "Votos + medios + franjas. Resolución alta → comunidades granulares que capturan ecosistemas completos.";
  listEl.innerHTML+=`
    <div style="margin-top:10px;padding:8px 10px;background:var(--bg-deep);border-radius:5px;
                border-left:3px solid var(--col-amarillo)">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:.07em;color:var(--col-amarillo);margin-bottom:4px">
        Por qué elegir esta config</div>
      <p style="font-size:11px;color:var(--text-sec);line-height:1.6">${justif}</p>
    </div>`;
}

// ══════ PARÁMETROS UI ════════════════════════════════════════════
function getParams(){
  const resolution=parseFloat(document.getElementById("resolution-slider")?.value||1.0);
  const minPeso=parseFloat(document.getElementById("min-peso-slider")?.value||0.0);
  const tipos=Array.from(document.querySelectorAll(".tipo-arista-check:checked")).map(c=>c.value);
  return { resolution, min_peso:minPeso,
    tipos_arista:tipos.length>0?tipos.join(","):
      "voto_candidato_departamento,cobertura_medio_candidato,afinidad_franja_candidato,alcance_medio_departamento" };
}

// ══════ CAMBIO DE VISTAS ═════════════════════════════════════════
function switchView(view){
  state.view=view;
  document.querySelectorAll(".tab-btn").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  document.getElementById("main-view").style.display   =view==="main"   ?"block":"none";
  document.getElementById("franja-view").style.display =view==="franja" ?"flex" :"none";
  document.getElementById("compare-view").style.display=view==="compare"?"flex" :"none";
  const fc=document.getElementById("franja-controls");
  if(fc) fc.style.display=view==="franja"?"block":"none";
  if(view==="franja")  loadFranja();
  if(view==="compare") loadCompare();
}

function showLoading(show){
  document.getElementById("loading-overlay").style.display=show?"flex":"none";
}
function capitalize(s){ return s?s.charAt(0).toUpperCase()+s.slice(1):""; }

// ══════ ARRANQUE ════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded",()=>{
  document.getElementById("resolution-slider")?.addEventListener("input",e=>{
    document.getElementById("resolution-val").textContent=parseFloat(e.target.value).toFixed(1);
  });
  document.getElementById("min-peso-slider")?.addEventListener("input",e=>{
    document.getElementById("min-peso-val").textContent=parseFloat(e.target.value).toFixed(0);
  });
  document.querySelectorAll(".tab-btn").forEach(btn=>{
    btn.addEventListener("click",()=>switchView(btn.dataset.view));
  });
  init();
});
