import { el, qs, infoIcon, lucideInlineIcon } from '../utils/dom.js';
import { showCatalogDetail } from '../utils/catalogDetail.js';
import { showActionModal } from '../utils/actionModal.js';
import { createTablePagination } from '../utils/pagination.js';
import { subscribe } from '../state.js';
import { can, PERMS } from '../permissions.js';
import { contractCoverageCodes, contractFilterCode, contractMatches } from '../utils/contractScope.js';
export const SupernumerariosAdmin=(mount,deps={})=>{
  const ui=el('section',{className:'main-card'},[
    el('h2',{},['Supernumerarios']),
    el('div',{id:'listPanel'},[
      el('div',{className:'form-row'},[
        el('div',{},[ el('label',{className:'label'},['Buscar']), el('input',{id:'txtSearch',className:'input',placeholder:'Codigo, documento, nombre, contrato, sede de hoy...'}) ]),
        el('div',{},[ el('label',{className:'label'},['Estado']), el('select',{id:'selStatus',className:'select'},[
          el('option',{value:''},['Todos']),
          el('option',{value:'libre'},['Libres']),
          el('option',{value:'ocupado'},['Ocupados']),
          el('option',{value:'incapacitado'},['Incapacitados']),
          el('option',{value:'inactivo'},['Inactivos'])
        ]) ])
      ]),
      el('div',{className:'responsive-records mt-2'},[
        el('div',{className:'table-wrap responsive-table-view'},[
          el('table',{className:'table',id:'tbl'},[
            el('thead',{},[ el('tr',{},[
              el('th',{'data-sort':'documento',style:'cursor:pointer'},['Documento']),
              el('th',{'data-sort':'nombre',style:'cursor:pointer'},['Nombre']),
              el('th',{'data-sort':'telefono',style:'cursor:pointer'},['Telefono']),
              el('th',{'data-sort':'coberturaContratos',style:'cursor:pointer'},['Cubre']),
              el('th',{'data-sort':'cargoNombre',style:'cursor:pointer'},['Cargo']),
              el('th',{'data-sort':'estadoOperativo',style:'cursor:pointer'},['Estado']),
              el('th',{'data-sort':'sedeHoy',style:'cursor:pointer'},['Sede hoy']),
              el('th',{},['Acciones'])
            ]) ]),
            el('tbody',{})
          ])
        ]),
        el('div',{id:'supernumerarioCards',className:'record-card-list'},[])
      ]),
      el('p',{id:'msg',className:'text-muted mt-2'},[' '])
    ]),
    el('datalist',{id:'eSedeList'},[])
  ]);

  let sedeList=[]; let allSedeList=[]; let cargoList=[]; let contractList=[];
  const sedeListNode=qs('#eSedeList',ui);
  function buildOptions(items, selected){
    const opts=[ el('option',{value:''},['Seleccione...']) ];
    items.forEach((item)=>{
      const code=item.codigo||''; const label=item.nombre||code||'-';
      opts.push(el('option',{value:code, selected: code && code===selected},[ `${label} (${code||'-'})` ]));
    });
    return opts;
  }
  function sedeLabelByCode(code){
    const sede=sedeList.find(s=>s.codigo===code);
    return sede ? `${sede.nombre||sede.codigo} (${sede.codigo||'-'})` : '';
  }
  function renderSedeSelect(){
    const opts=sedeList
      .map((s)=> sedeLabelByCode(s.codigo))
      .filter((v, i, arr)=> v && arr.indexOf(v)===i)
      .map((value)=> el('option',{value}));
    sedeListNode.replaceChildren(...opts);
  }
  function refreshScopedLists(){
    sedeList=(allSedeList||[]).filter(s=>s.estado!=='inactivo').filter((s)=>contractMatches(s));
    incapacitados=(allIncapacitados||[]).filter((row)=>contractMatches(row));
  }
  function resolveSedeCode(inputValue){
    const raw=String(inputValue||'').trim();
    if(!raw) return '';
    const byCode=sedeList.find(s=> String(s.codigo||'').toLowerCase()===raw.toLowerCase());
    if(byCode) return byCode.codigo;
    const match=raw.match(/\(([^)]+)\)\s*$/);
    if(match){
      const code=match[1].trim();
      const byLabelCode=sedeList.find(s=> String(s.codigo||'').toLowerCase()===code.toLowerCase());
      if(byLabelCode) return byLabelCode.codigo;
    }
    const byName=sedeList.find(s=> String(s.nombre||'').toLowerCase()===raw.toLowerCase());
    return byName?.codigo||'';
  }
  let snapshot=[]; const tbody=ui.querySelector('tbody'); const cards=qs('#supernumerarioCards',ui);
  let sortKey=''; let sortDir=1;
  const paginator=createTablePagination(ui,{id:'supernumerarios',after:'#listPanel .responsive-records',onChange:render});
  const today=todayBogota();
  let unContracts=()=>{};
  let unSedes=()=>{};
  let unCargos=()=>{};
  let unEmp=()=>{};
  let unIncapacitados=()=>{};
  let unReplacements=()=>{};
  let employees=[];
  let incapacitados=[];
  let allIncapacitados=[];
  let occupancyRows=[];
  let occupancyRefreshTimer=null;
  const sedeNameByCode=(code)=> sedeList.find(s=>s.codigo===code)?.nombre || '-';
  const cargoNameByCode=(code)=> cargoList.find(c=>c.codigo===code)?.nombre || '-';
  const isLinkedByDoc=(doc)=>{
    const d=String(doc||'').trim();
    if(!d) return false;
    return employees.some((e)=> e.estado!=='inactivo' && String(e.documento||'').trim()===d);
  };
  const linkedEmployeeByDoc=(doc)=>{
    const d=String(doc||'').trim();
    if(!d) return null;
    return employees.find((e)=> String(e.documento||'').trim()===d) || null;
  };
  const shouldHideInComplementaryView=(row)=>{
    const linked=linkedEmployeeByDoc(row?.documento);
    if(!linked) return false;
    if(String(linked.estado||'').trim().toLowerCase()==='inactivo') return true;
    return row?.estado==='inactivo' && isLinkedByDoc(row?.documento);
  };

  const search=()=> qs('#txtSearch',ui).value.trim().toLowerCase();
  const filterStatus=()=> qs('#selStatus',ui).value;
  function toSortableDate(ts){
    try{
      const d=ts? new Date(ts): null;
      return d? d.getTime(): 0;
    }catch{ return 0; }
  }
  function getSortValue(e,key){
    if(key==='cargoNombre') return (e.cargoNombre||cargoNameByCode(e.cargoCodigo)||'').toLowerCase();
    if(key==='contratoNombre') return contractLabel(e).toLowerCase();
    if(key==='coberturaContratos') return coverageLabel(e).toLowerCase();
    if(key==='estadoOperativo') return operationalInfo(e).label.toLowerCase();
    if(key==='sedeHoy') return operationalInfo(e).sedeLabel.toLowerCase();
    if(key==='fechaIngreso' || key==='fechaRetiro') return toSortableDate(e[key]);
    return String(e[key]??'').toLowerCase();
  }
  function sortData(data){
    if(!sortKey) return data;
    const out=[...data];
    out.sort((a,b)=>{
      const va=getSortValue(a,sortKey); const vb=getSortValue(b,sortKey);
      if(va===vb) return 0;
      return va>vb ? sortDir : -sortDir;
    });
    return out;
  }
  function updateSortIndicators(){
    ui.querySelectorAll('th[data-sort]').forEach((th)=>{
      const base=th.dataset.baseLabel||th.textContent.replace(/\s[\^v▲▼]$/,'');
      th.dataset.baseLabel=base;
      const key=th.getAttribute('data-sort');
      th.textContent=(sortKey===key)?`${base} ${sortDir===1?'▲':'▼'}`:base;
    });
  }
  function initSorting(){
    ui.querySelectorAll('th[data-sort]').forEach((th)=>{
      th.addEventListener('click',()=>{
        const key=th.getAttribute('data-sort');
        if(sortKey===key) sortDir=sortDir*-1; else { sortKey=key; sortDir=1; }
        paginator.reset();
        render();
      });
    });
  }
  function render(){
    const term=search(); const st=filterStatus();
    const data=snapshot.filter(e=>{
      if(shouldHideInComplementaryView(e)) return false;
      if(!contractMatches(e)) return false;
      const op=operationalInfo(e);
      const text=[e.codigo,e.documento,e.nombre,e.contratoCodigo,e.contratoNombre,e.clienteNombreSnapshot,coverageLabel(e),e.cargoNombre,cargoNameByCode(e.cargoCodigo),op.label,op.sedeLabel].join(' ').toLowerCase();
      return (!term || text.includes(term)) && (!st || op.key===st);
    });
    const sorted=sortData(data);
    const pageRows=paginator.slice(sorted);
    tbody.replaceChildren(...pageRows.map(e=> row(e)));
    cards.replaceChildren(...(pageRows.length?pageRows.map(e=> supernumerarioCard(e)):[el('p',{className:'text-muted record-card__empty'},['Sin supernumerarios para mostrar.'])]));
    updateSortIndicators();
  }
  function row(e){
    const tr=el('tr',{'data-id':e.id});
    const linked=isLinkedByDoc(e.documento);
    const tdDoc=el('td',{}, linked ? [e.documento||'-',' ',el('span',{className:'badge'},['Vinculado'])] : [e.documento||'-']);
    const tdNombre=el('td',{},[e.nombre||'-']);
    const tdTel=el('td',{},[e.telefono||'-']);
    const tdCobertura=el('td',{},[coverageLabel(e)]);
    const tdCargo=el('td',{},[ e.cargoNombre||cargoNameByCode(e.cargoCodigo) ]);
    const op=operationalInfo(e);
    const tdEstado=el('td',{},[ operationalBadge(op) ]);
    const tdSedeHoy=el('td',{},[ op.sedeLabel || '-' ]);
    const tdAcc=el('td',{},[ actionsCell(e) ]);
    tr.append(tdDoc,tdNombre,tdTel,tdCobertura,tdCargo,tdEstado,tdSedeHoy,tdAcc);
    return tr;
  }
  function contractLabel(e){ return e?.contratoNombre||e?.contratoCodigo||e?.clienteNombreSnapshot||'-'; }
  function coverageCodes(e){
    const codes=contractCoverageCodes(e);
    if(codes.length) return codes;
    const code=String(e?.contratoCodigo||'').trim();
    return code?[code]:[];
  }
  function contractNameByCode(code){
    return contractList.find((row)=>String(row.codigo||'').trim()===String(code||'').trim())?.nombre||'';
  }
  function coverageLabel(e){
    const codes=coverageCodes(e);
    if(!codes.length) return '-';
    const mode=coverageMode(e)==='compartido'?'Compartido':'Dedicado';
    if(codes.length===1) return `${mode}: ${contractNameByCode(codes[0])||codes[0]}`;
    return `${mode}: ${codes.length} contratos: ${codes.join(', ')}`;
  }
  function coverageMode(e){
    const codes=coverageCodes(e);
    const primary=String(e?.contratoCodigo||'').trim();
    if(codes.length>1) return 'compartido';
    if(codes.length===1 && primary && codes[0]!==primary) return 'compartido';
    return 'dedicado';
  }
  function contractOptions(){
    return (contractList||[])
      .filter((row)=>String(row.estado||'activo').trim().toLowerCase()!=='inactivo')
      .map((row)=>{
        const code=String(row.codigo||'').trim();
        const name=String(row.nombre||code||'Contrato').trim();
        const client=String(row.clienteNombre||'').trim();
        return { value:code, label:client?`${name} (${code}) - ${client}`:`${name} (${code})` };
      })
      .filter((row)=>row.value)
      .sort((a,b)=>a.label.localeCompare(b.label));
  }
  function operationalBadge(info){
    const cls={
      libre:'badge--ok',
      ocupado:'badge--busy',
      incapacitado:'badge--warn',
      inactivo:'badge--off'
    }[info.key] || 'badge--off';
    const attrs={className:`badge ${cls}`};
    if(info.title) attrs.title=info.title;
    return el('span',attrs,[info.label||'-']);
  }
  function statusBadge(st){ return el('span',{className:'badge '+(st==='activo'?'badge--ok':'badge--off')},[st||'-']); }
  function operationalInfo(e){
    if(!isActiveForDay(e,today)) return { key:'inactivo', label:'Inactivo', sedeLabel:'-', title:'Registro administrativo inactivo' };
    const incap=findActiveIncapacity(e);
    if(incap){
      const days=remainingIncapacityDays(incap,today);
      const suffix=days!=null ? ` (${days} dia${days===1?'':'s'})` : '';
      return {
        key:'incapacitado',
        label:`Incapacitado${suffix}`,
        sedeLabel:'-',
        title:`Inicio: ${incap.fechaInicio||'-'} | Fin: ${incap.fechaFin||'-'}`
      };
    }
    const occ=findOccupancy(e);
    if(occ){
      const sedeLabel=sedeDisplay(occ.sedeCodigo,occ.sedeNombre);
      return { key:'ocupado', label:'Ocupado', sedeLabel, title:sedeLabel ? `Trabajando hoy en ${sedeLabel}` : 'Ocupado hoy' };
    }
    return { key:'libre', label:'Libre', sedeLabel:'-', title:'Disponible hoy' };
  }
  function findActiveIncapacity(e){
    const doc=String(e?.documento||'').trim();
    const id=String(e?.id||'').trim();
    return (incapacitados||[]).find((row)=>{
      const rowDoc=String(row?.documento||'').trim();
      const rowId=String(row?.employeeId||'').trim();
      if(doc && rowDoc===doc) return true;
      return Boolean(id && rowId===id);
    })||null;
  }
  function findOccupancy(e){
    const doc=String(e?.documento||'').trim();
    const id=String(e?.id||'').trim();
    return (occupancyRows||[]).find((row)=>{
      if(String(row?.decision||'').trim() && String(row.decision).trim()!=='reemplazo') return false;
      const rowDoc=String(row?.supernumerarioDocumento||'').trim();
      const rowId=String(row?.supernumerarioId||'').trim();
      if(doc && rowDoc===doc) return true;
      return Boolean(id && rowId===id);
    })||null;
  }
  function sedeDisplay(code,name){
    const n=String(name||'').trim();
    const c=String(code||'').trim();
    if(n && c) return `${n} (${c})`;
    if(n) return n;
    if(c) return sedeNameByCode(c)==='-' ? c : `${sedeNameByCode(c)} (${c})`;
    return '-';
  }
  function isActiveForDay(person,day){
    const estado=String(person?.estado||'activo').trim().toLowerCase();
    if(estado==='eliminado') return false;
    const ingreso=toIsoDate(person?.fechaIngreso);
    if(ingreso && ingreso>day) return false;
    const retiro=toIsoDate(person?.fechaRetiro);
    if(estado==='inactivo') return Boolean(retiro && retiro>=day);
    return !retiro || retiro>=day;
  }
  function normalizeIsoDate(value){ const v=String(value||'').trim(); return /^\d{4}-\d{2}-\d{2}$/.test(v)?v:null; }
  function toIsoDate(value){
    if(!value) return '';
    if(typeof value==='string'){
      const raw=value.trim();
      if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
      const parsed=new Date(raw);
      return Number.isNaN(parsed.getTime())?'':parsed.toISOString().slice(0,10);
    }
    const parsed=value instanceof Date?value:null;
    return parsed && !Number.isNaN(parsed.getTime())?parsed.toISOString().slice(0,10):'';
  }
  function inclusiveDaysBetween(startDate,endDate){
    const start=normalizeIsoDate(startDate); const end=normalizeIsoDate(endDate);
    if(!start||!end||end<start) return null;
    const [sy,sm,sd]=start.split('-').map((n)=>Number(n));
    const [ey,em,ed]=end.split('-').map((n)=>Number(n));
    const sUtc=Date.UTC(sy,(sm||1)-1,sd||1);
    const eUtc=Date.UTC(ey,(em||1)-1,ed||1);
    return Math.floor((eUtc-sUtc)/86400000)+1;
  }
  function remainingIncapacityDays(row,day){
    const start=normalizeIsoDate(row?.fechaInicio);
    const end=normalizeIsoDate(row?.fechaFin);
    if(!start||!end) return null;
    const effectiveStart=day>start?day:start;
    return inclusiveDaysBetween(effectiveStart,end);
  }
  function todayBogota(){ return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota'}).format(new Date()); }
  async function refreshOccupancy(){
    try{
      if(typeof deps.listSupernumerarioReplacementOccupancy==='function'){
        occupancyRows=await deps.listSupernumerarioReplacementOccupancy(today)||[];
      }else if(typeof deps.listImportReplacementsRange==='function'){
        occupancyRows=(await deps.listImportReplacementsRange(today,today,{ contratoCodigo: contractFilterCode() })||[]).filter((row)=>String(row?.decision||'').trim()==='reemplazo');
      }
      occupancyRows=(occupancyRows||[]).filter((row)=>contractMatches(row));
      render();
    }catch(err){
      const msg=qs('#msg',ui);
      if(msg) msg.textContent='No se pudo cargar ocupacion de supernumerarios: '+(err?.message||err);
    }
  }
  function scheduleOccupancyRefresh(){
    if(occupancyRefreshTimer) clearTimeout(occupancyRefreshTimer);
    occupancyRefreshTimer=setTimeout(refreshOccupancy,250);
  }
  function formatDate(ts){
    try{
      const d=ts? new Date(ts): null;
      return d? new Date(d).toLocaleDateString(): '-';
    }catch{ return '-'; }
  }
  function openSupernumerarioInfoModal(e={}){
    const operational=operationalInfo(e);
    const sede=allSedeList.find(row=>row.codigo===e.sedeCodigo)||{};
    const coverage=coverageCodes(e);
    const contracts=coverage.length
      ? el('ul',{},coverage.map(code=>el('li',{},[`${contractNameByCode(code)||code} (${code})`])))
      : 'Sin contratos habilitados';
    showCatalogDetail(`Informacion del supernumerario - ${e.nombre||'-'}`,e,[
      ['Datos generales',[
        ['Codigo',e.codigo], ['Documento',e.documento], ['Nombre',e.nombre],
        ['Telefono',e.telefono], ['Estado',statusBadge(e.estado)]
      ]],
      ['Asignacion',[
        ['Cargo',e.cargoNombre||cargoNameByCode(e.cargoCodigo)], ['Codigo cargo',e.cargoCodigo],
        ['Sede base',e.sedeNombre||sede.nombre||e.sedeCodigo], ['Codigo sede',e.sedeCodigo],
        ['Ingreso',formatDate(e.fechaIngreso)], ['Retiro',formatDate(e.fechaRetiro)]
      ]],
      ['Contrato y cobertura',[
        ['Contrato base',contractLabel(e)], ['Codigo contrato',e.contratoCodigo],
        ['Cliente',e.clienteNombreSnapshot], ['NIT cliente',e.clienteNitSnapshot],
        ['Tipo de cobertura',coverageMode(e)==='compartido'?'Compartido':'Dedicado'],
        ['Contratos habilitados',contracts]
      ]],
      ['Disponibilidad del dia',[
        ['Fecha',today], ['Estado operativo',operationalBadge(operational)],
        ['Sede de cobertura',operational.sedeLabel], ['Detalle',operational.title]
      ]]
    ]);
  }
  function actionsCell(e){
    const box=el('div',{className:'row-actions'},[]);
    const btnInfo=el('button',{className:'btn btn--icon',title:'Ver informacion','aria-label':'Ver informacion'},[infoIcon()]);
    btnInfo.addEventListener('click',()=>openSupernumerarioInfoModal(e));
    const btnContracts=el('button',{className:'btn btn--icon',type:'button',title:'Administrar contratos habilitados','aria-label':'Administrar contratos habilitados'},[lucideInlineIcon('file-text')]);
    btnContracts.addEventListener('click',()=>openContractAccessModal(e));
    if(can(PERMS.EDIT_SUPERNUMERARIOS)) box.append(btnContracts);
    box.append(btnInfo); return box;
  }
  async function openContractAccessModal(e){
    if(!can(PERMS.EDIT_SUPERNUMERARIOS)) return;
    try{
      const options=contractOptions();
      if(!options.length) return alert('No hay contratos activos para asignar.');
      const existing=await deps.listSupernumerarioContractAccess?.({ employeeId:e.id, documento:e.documento }) || [];
      const selected=existing.length ? existing.map((row)=>row.contratoCodigo).filter(Boolean) : coverageCodes(e);
      const modal=await showActionModal({
        title:'Contratos habilitados',
        message:`Supernumerario: ${e.nombre||e.documento||'-'}`,
        confirmText:'Guardar contratos',
        fields:[
          { id:'mode', label:'Tipo', type:'select', required:true, value:coverageMode(e), options:[
            { value:'dedicado', label:'Dedicado' },
            { value:'compartido', label:'Compartido' }
          ] },
          { id:'contracts', label:'Puede cubrir', type:'checkboxes', required:true, value:selected, options },
          { id:'detail', label:'Detalle de la modificacion', type:'textarea', required:true, placeholder:'Describe brevemente el cambio realizado' }
        ]
      });
      if(!modal.confirmed) return;
      const nextCodes=Array.isArray(modal.values.contracts)?modal.values.contracts:[];
      if(modal.values.mode==='dedicado' && nextCodes.length!==1) return alert('Un supernumerario dedicado debe tener exactamente un contrato habilitado.');
      if(modal.values.mode==='compartido' && nextCodes.length<2) return alert('Un supernumerario compartido debe tener dos o mas contratos habilitados.');
      await deps.setSupernumerarioContractAccess?.({ employeeId:e.id, documento:e.documento, contratoCodigos:nextCodes });
      await deps.addAuditLog?.({ targetType:'supernumerario', targetId:e.id, action:'update_supernumerario_contract_access', before:{ tipo:coverageMode(e), contratoCodigos:selected }, after:{ tipo:modal.values.mode, contratoCodigos:nextCodes }, note:modal.values.detail||null });
      snapshot=snapshot.map((row)=>row.id===e.id?{...row,contratosHabilitados:nextCodes}:row);
      render();
    }catch(err){
      alert('Error guardando contratos: '+(err?.message||err));
    }
  }
  function supernumerarioCard(e){
    const linked=isLinkedByDoc(e.documento);
    const docValue=linked ? [e.documento||'-',' ',el('span',{className:'badge'},['Vinculado'])] : [e.documento||'-'];
    const op=operationalInfo(e);
    return recordCard(e,{
      title:e.nombre||'-',
      subtitle:`Codigo: ${e.codigo||'-'}`,
      status:operationalBadge(op),
      meta:[
        ['Documento',docValue],
        ['Telefono',e.telefono||'-'],
        ['Contrato',contractLabel(e)],
        ['Cubre',coverageLabel(e)],
        ['Cargo',e.cargoNombre||cargoNameByCode(e.cargoCodigo)],
        ['Sede hoy',op.sedeLabel||'-']
      ],
      actions:actionsCell(e)
    });
  }
  function recordCard(item,{title,subtitle,status=null,meta=[],actions}){
    return el('article',{className:'record-card'},[
      el('div',{className:'record-card__header'},[
        el('div',{className:'record-card__identity'},[
          el('strong',{className:'record-card__title'},[title]),
          el('span',{className:'record-card__subtitle'},[subtitle])
        ]),
        status||statusBadge(item.estado)
      ]),
      el('dl',{className:'record-card__meta'},meta.map(([label,value])=> el('div',{className:'record-card__meta-item'},[
        el('dt',{},[label]),
        el('dd',{},Array.isArray(value)?value:[value||'-'])
      ]))),
      el('div',{className:'record-card__actions'},[actions])
    ]);
  }
  function startEdit(tr,e){
    const cur={
      codigo:e.codigo||'',
      documento:e.documento||'',
      nombre:e.nombre||'',
      telefono:e.telefono||'',
      cargoCodigo:e.cargoCodigo||'',
      sedeCodigo:e.sedeCodigo||'',
      fechaIngreso: toInputDate(e.fechaIngreso),
      fechaRetiro: toInputDate(e.fechaRetiro)
    };
    const tds=tr.querySelectorAll('td');
    tds[0].replaceChildren(el('input',{className:'input',value:cur.codigo,style:'max-width:140px'}));
    tds[1].replaceChildren(el('input',{className:'input',value:cur.documento,style:'max-width:160px'}));
    tds[2].replaceChildren(el('input',{className:'input',value:cur.nombre,style:'max-width:220px'}));
    tds[3].replaceChildren(el('input',{className:'input',value:cur.telefono,style:'max-width:140px'}));
    tds[4].replaceChildren(el('select',{className:'select'},buildOptions(cargoList,cur.cargoCodigo)));
    tds[5].replaceChildren(el('input',{className:'input',list:'eSedeList',value:sedeLabelByCode(cur.sedeCodigo),style:'max-width:240px'}));
    tds[6].replaceChildren(statusBadge(e.estado));
    tds[7].replaceChildren(el('input',{className:'input',type:'date',value:cur.fechaIngreso||''}));
    tds[8].replaceChildren(el('input',{className:'input',type:'date',value:cur.fechaRetiro||''}));
    const box=el('div',{className:'row-actions'},[]);
    const btnSave=el('button',{className:'btn btn--primary'},['Guardar']);
    const btnCancel=el('button',{className:'btn'},['Cancelar']);
    btnSave.addEventListener('click',async()=>{
      const newCode=tds[0].querySelector('input').value.trim();
      const newDoc=tds[1].querySelector('input').value.trim();
      const newName=tds[2].querySelector('input').value.trim();
      const newPhone=tds[3].querySelector('input').value.trim();
      const newCargoCode=tds[4].querySelector('select').value;
      const newSedeCode=resolveSedeCode(tds[5].querySelector('input').value);
      const newIngreso=tds[7].querySelector('input').value.trim();
      const newRetiro=tds[8].querySelector('input').value.trim();
      if(!newCode||!newDoc||!newName||!newPhone) return alert('Completa codigo, documento, nombre y telefono.');
      if(!newCargoCode) return alert('Selecciona un cargo.');
      if(!newSedeCode) return alert('Selecciona una sede.');
      if(!newIngreso) return alert('Selecciona la fecha de ingreso.');
      if(e.estado==='inactivo' && !newRetiro) return alert('Para supernumerarios inactivos, la fecha de retiro es obligatoria.');
      const modal=await showActionModal({
        title:'Confirmar modificacion',
        message:`Supernumerario: ${e.nombre||'-'}`,
        confirmText:'Guardar cambios',
        fields:[{ id:'detail', label:'Detalle de la modificacion', type:'textarea', required:true, placeholder:'Describe brevemente el cambio realizado' }]
      });
      if(!modal.confirmed) return;
      try{
        if(newCode!==e.codigo){ const dup=await deps.findSupernumerarioByCode?.(newCode); if(dup && dup.id!==e.id) return alert('Ya existe un supernumerario con ese codigo.'); }
        if(newDoc!==e.documento){ const dupDoc=await deps.findSupernumerarioByDocument?.(newDoc); if(dupDoc && dupDoc.id!==e.id) return alert('Ya existe un supernumerario con ese documento.'); }
        const newCargo=cargoList.find(c=>c.codigo===newCargoCode);
        const newSede=sedeList.find(s=>s.codigo===newSedeCode);
        await deps.updateSupernumerario?.(e.id,{
          codigo:newCode,
          documento:newDoc,
          nombre:newName,
          telefono:newPhone,
          cargoCodigo:newCargoCode,
          cargoNombre:newCargo?.nombre||null,
          sedeCodigo:newSedeCode,
          sedeNombre:newSede?.nombre||null,
          fechaIngreso: new Date(`${newIngreso}T00:00:00`),
          fechaRetiro: newRetiro ? new Date(`${newRetiro}T00:00:00`) : null
        });
        await deps.addAuditLog?.({ targetType:'supernumerario', targetId:e.id, action:'update_supernumerario', before:{ codigo:e.codigo, documento:e.documento, nombre:e.nombre, sedeCodigo:e.sedeCodigo, fechaRetiro:e.fechaRetiro||null }, after:{ codigo:newCode, documento:newDoc, nombre:newName, sedeCodigo:newSedeCode, fechaRetiro:newRetiro||null }, note: modal.values.detail||null });
      }catch(err){ alert('Error: '+(err?.message||err)); }
    });
    btnCancel.addEventListener('click',()=> render());
    box.append(btnSave,btnCancel); tds[9].replaceChildren(box);
  }
  function toInputDate(ts){
    try{
      const d=ts? new Date(ts): null;
      if(!d) return '';
      const pad=(n)=> String(n).padStart(2,'0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    }catch{ return ''; }
  }
  qs('#txtSearch',ui).addEventListener('input',()=>{ paginator.reset(); render(); });
  qs('#selStatus',ui).addEventListener('change',()=>{ paginator.reset(); render(); });
  initSorting();
  mount.replaceChildren(ui);
  let un=()=>{};
  try{
    unContracts=deps.streamContracts?.((arr)=>{ contractList=arr||[]; render(); }) || (()=>{});
    unSedes=deps.streamSedes?.((arr)=>{ allSedeList=arr||[]; refreshScopedLists(); renderSedeSelect(); render(); }) || (()=>{});
    unCargos=deps.streamCargos?.((arr)=>{ cargoList=(arr||[]).filter(c=>c.estado!=='inactivo'); render(); }) || (()=>{});
    unEmp=deps.streamEmployees?.((arr)=>{ employees=arr||[]; render(); }) || (()=>{});
    unIncapacitados=deps.streamIncapacitadosByDate?.(today,(arr)=>{ allIncapacitados=arr||[]; refreshScopedLists(); render(); }) || (()=>{});
    if(typeof deps.streamImportReplacementsByDate==='function'){
      unReplacements=deps.streamImportReplacementsByDate(today,()=>scheduleOccupancyRefresh(),()=>scheduleOccupancyRefresh()) || (()=>{});
    }
    refreshOccupancy();
    un=deps.streamSupernumerarios?.((arr)=>{ snapshot=arr||[]; render(); }, today) || (()=>{});
  }catch(e){
    const msg=qs('#msg',ui); if(msg) msg.textContent='Error cargando supernumerarios: '+(e?.message||e);
  }
  const unSelectedContract=subscribe('selectedContractCode',()=>{ refreshScopedLists(); renderSedeSelect(); scheduleOccupancyRefresh(); render(); });
  return ()=>{ if(occupancyRefreshTimer) clearTimeout(occupancyRefreshTimer); un?.(); unContracts?.(); unSedes?.(); unCargos?.(); unEmp?.(); unIncapacitados?.(); unReplacements?.(); unSelectedContract?.(); };
};

