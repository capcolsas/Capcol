import { el, qs, infoIcon, moreIcon, viewIcon } from '../utils/dom.js';
import { showInfoModal } from '../utils/infoModal.js';
import { showActionModal } from '../utils/actionModal.js';
import { createTablePagination } from '../utils/pagination.js';
import { can, PERMS } from '../permissions.js';
export const EmployeesAdmin=(mount,deps={})=>{
  const canEdit=can(PERMS.EDIT_EMPLOYEES);
  const ui=el('section',{className:'main-card'},[
    el('h2',{},['Empleados']),
    el('div',{id:'listPanel'},[
      el('div',{className:'form-row'},[
        el('div',{},[ el('label',{className:'label'},['Buscar']), el('input',{id:'txtSearch',className:'input',placeholder:'Codigo, documento, nombre o sede...'}) ]),
        el('div',{},[ el('label',{className:'label'},['Sede']), el('select',{id:'selSede',className:'select'},[ el('option',{value:''},['Todas']) ]) ]),
        el('div',{},[ el('label',{className:'label'},['Estado']), el('select',{id:'selStatus',className:'select'},[ el('option',{value:''},['Todos']), el('option',{value:'activo'},['Activos']), el('option',{value:'inactivo'},['Inactivos']) ]) ])
      ]),
      el('div',{className:'responsive-records mt-2'},[
        el('div',{className:'table-wrap responsive-table-view'},[
          el('table',{className:'table',id:'tbl'},[
            el('thead',{},[ el('tr',{},[
              el('th',{'data-sort':'codigo',style:'cursor:pointer'},['Codigo']),
              el('th',{'data-sort':'documento',style:'cursor:pointer'},['Documento']),
              el('th',{'data-sort':'nombre',style:'cursor:pointer'},['Nombre']),
              el('th',{'data-sort':'telefono',style:'cursor:pointer'},['Telefono']),
              el('th',{'data-sort':'cargoNombre',style:'cursor:pointer'},['Cargo']),
              el('th',{'data-sort':'sedeNombre',style:'cursor:pointer'},['Sede']),
              el('th',{'data-sort':'estado',style:'cursor:pointer'},['Estado']),
              el('th',{'data-sort':'fechaIngreso',style:'cursor:pointer'},['Ingreso']),
              el('th',{'data-sort':'fechaRetiro',style:'cursor:pointer'},['Retiro']),
              el('th',{},['Acciones'])
            ]) ]),
            el('tbody',{})
          ])
        ]),
        el('div',{id:'employeeCards',className:'record-card-list'},[])
      ]),
      el('p',{id:'msg',className:'text-muted mt-2'},[' '])
    ]),
    el('datalist',{id:'eSedeList'},[])
  ]);

  let sedeList=[]; let cargoList=[];
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
  function renderSedeFilter(){
    const select=qs('#selSede',ui);
    if(!select) return;
    const cur=select.value;
    const opts=[
      el('option',{value:''},['Todas']),
      ...sedeList
        .filter((s)=> String(s.codigo||'').trim())
        .sort((a,b)=> String(a.nombre||a.codigo||'').localeCompare(String(b.nombre||b.codigo||'')))
        .map((s)=>{
          const code=String(s.codigo||'').trim();
          return el('option',{value:code, selected:code===cur},[`${s.nombre||code} (${code})`]);
        })
    ];
    select.replaceChildren(...opts);
    if(cur && !sedeList.some((s)=> String(s.codigo||'').trim()===cur)) select.value='';
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
  function sedeOptions(){
    return sedeList
      .map((s)=> sedeLabelByCode(s.codigo))
      .filter((value, index, arr)=> value && arr.indexOf(value)===index);
  }
  function cargoOptions(){
    return [
      { value:'', label:'Seleccione...' },
      ...cargoList.map((cargo)=>({
        value:cargo.codigo||'',
        label:`${cargo.nombre||cargo.codigo||'-'} (${cargo.codigo||'-'})`
      }))
    ];
  }
  async function openCreateModal(){
    const modal=await showActionModal({
      title:'Crear empleado',
      message:'Completa la informacion para crear un empleado.',
      confirmText:'Crear empleado',
      fields:[
        { id:'doc', label:'Documento', type:'text', required:true, placeholder:'Documento del empleado' },
        { id:'name', label:'Nombre completo', type:'text', required:true, placeholder:'Nombre completo' },
        { id:'phone', label:'Telefono', type:'text', required:true, placeholder:'Telefono' },
        { id:'cargo', label:'Cargo', type:'select', required:true, options:cargoOptions() },
        { id:'sede', label:'Sede', type:'datalist', required:true, placeholder:'Selecciona o escribe sede', options:sedeOptions() },
        { id:'ingreso', label:'Fecha ingreso', type:'date', required:true }
      ]
    });
    if(!modal.confirmed) return;
    const doc=String(modal.values.doc||'').trim();
    const name=String(modal.values.name||'').trim();
    const phone=String(modal.values.phone||'').trim();
    const cargoCode=String(modal.values.cargo||'').trim();
    const sedeCode=resolveSedeCode(modal.values.sede);
    const ingreso=String(modal.values.ingreso||'').trim();
    if(!doc){ alert('Escribe el documento.'); return; }
    if(!name){ alert('Escribe el nombre completo.'); return; }
    if(!phone){ alert('Escribe el telefono.'); return; }
    if(!cargoCode){ alert('Selecciona un cargo.'); return; }
    if(!sedeCode){ alert('Selecciona una sede valida.'); return; }
    if(!/^\d{4}-\d{2}-\d{2}$/.test(ingreso)){ alert('Selecciona la fecha de ingreso.'); return; }
    try{
      const dupDoc=await deps.findEmployeeByDocument?.(doc);
      if(dupDoc) {
        if(String(dupDoc.estado||'').trim().toLowerCase()==='inactivo') {
          alert('Ya existe un empleado inactivo con ese documento. Se abrira el reingreso.');
          return openRehireEmployeeModal(dupDoc,{ nombre:name, telefono:phone, cargoCodigo:cargoCode, sedeCodigo:sedeCode, fechaIngreso:ingreso });
        }
        alert('Ya existe un empleado activo con ese documento.');
        return;
      }
      const code=await deps.getNextEmployeeCode?.();
      const cargo=cargoList.find(c=>c.codigo===cargoCode);
      const sede=sedeList.find(s=>s.codigo===sedeCode);
      const id=await deps.createEmployee?.({
        codigo:code,
        documento:doc,
        nombre:name,
        telefono:phone,
        cargoCodigo:cargoCode,
        cargoNombre:cargo?.nombre||null,
        sedeCodigo:sedeCode,
        sedeNombre:sede?.nombre||null,
        fechaIngreso: new Date(`${ingreso}T00:00:00`)
      });
      await deps.addAuditLog?.({ targetType:'employee', targetId:id, action:'create_employee', after:{ codigo:code, documento:doc, nombre:name, sedeCodigo:sedeCode, estado:'activo' } });
      alert('Empleado creado OK');
    }catch(e){ alert('Error: '+(e?.message||e)); }
  }
  if(canEdit){
    const btnOpenCreate=el('button',{id:'btnOpenCreate',className:'btn btn--primary right',type:'button'},['Crear empleado']);
    qs('#listPanel .form-row',ui)?.append(btnOpenCreate);
    btnOpenCreate.addEventListener('click',openCreateModal);
  }
  let snapshot=[]; let historyRows=[]; let totalRows=0; let loading=false; const tbody=ui.querySelector('tbody'); const cards=qs('#employeeCards',ui);
  let sortKey=''; let sortDir=1;
  const paginator=createTablePagination(ui,{id:'employees',after:'#listPanel .responsive-records',onChange:()=> scheduleLoadPage(0)});
  let loadTimer=null;
  let loadToken=0;
  let unSedes=()=>{};
  let unCargos=()=>{};
  let unSup=()=>{};
  let unSupn=()=>{};
  let unHistory=()=>{};
  let supervisors=[]; let supernumerarios=[];
  const sedeNameByCode=(code)=> sedeList.find(s=>s.codigo===code)?.nombre || '-';
  const cargoNameByCode=(code)=> cargoList.find(c=>c.codigo===code)?.nombre || '-';
  const isLinkedByDoc=(doc)=>{
    const d=String(doc||'').trim();
    if(!d) return false;
    const inSup=supervisors.some((s)=> s.estado!=='inactivo' && String(s.documento||'').trim()===d);
    const inSupn=supernumerarios.some((s)=> s.estado!=='inactivo' && String(s.documento||'').trim()===d);
    return inSup || inSupn;
  };

  const search=()=> qs('#txtSearch',ui).value.trim().toLowerCase();
  const filterSede=()=> qs('#selSede',ui)?.value||'';
  const filterStatus=()=> qs('#selStatus',ui).value;
  function toSortableDate(ts){
    try{
      const d=ts?.toDate? ts.toDate(): (ts? new Date(ts): null);
      return d? d.getTime(): 0;
    }catch{ return 0; }
  }
  function getSortValue(e,key){
    const view=employeeAssignmentView(e);
    if(key==='cargoNombre') return (view.current?.cargoNombre||cargoNameByCode(view.current?.cargoCodigo)||'').toLowerCase();
    if(key==='sedeNombre') return (view.current?.sedeNombre||sedeNameByCode(view.current?.sedeCodigo)||'').toLowerCase();
    if(key==='fechaIngreso') return toSortableDate(view.current?.fechaIngreso||e.fechaIngreso);
    if(key==='fechaRetiro') return toSortableDate(e[key]);
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
        scheduleLoadPage(0);
      });
    });
  }
  function currentPageOffset(){
    return paginator.state.showAll ? 0 : (Math.max(1,paginator.state.currentPage)-1)*Math.max(1,paginator.state.pageSize);
  }
  function updateServerPagination(){
    const pageSize=paginator.state.showAll ? Math.max(totalRows,1) : Math.max(1,paginator.state.pageSize);
    const totalPages=Math.max(1,Math.ceil(totalRows/pageSize));
    paginator.update?.(totalRows,snapshot.length,currentPageOffset(),totalPages);
  }
  function scheduleLoadPage(delay=250){
    clearTimeout(loadTimer);
    loadTimer=setTimeout(()=> loadPage(),delay);
  }
  async function loadPage(){
    const token=++loadToken;
    loading=true;
    render();
    try{
      const result=typeof deps.listEmployeesAdminPage==='function'
        ? await deps.listEmployeesAdminPage({
          search:search(),
          sedeCodigo:filterSede(),
          estado:filterStatus(),
          sortKey,
          sortDir,
          page:paginator.state.currentPage,
          pageSize:paginator.state.pageSize,
          showAll:paginator.state.showAll
        })
        : await loadEmployeesPageFallback();
      if(token!==loadToken) return;
      snapshot=result.rows||[];
      totalRows=Number(result.total||snapshot.length||0);
      const pageSize=paginator.state.showAll ? Math.max(totalRows,1) : Math.max(1,paginator.state.pageSize);
      const totalPages=Math.max(1,Math.ceil(totalRows/pageSize));
      if(totalRows>0 && !snapshot.length && paginator.state.currentPage>totalPages){
        paginator.state.currentPage=totalPages;
        loading=false;
        scheduleLoadPage(0);
        return;
      }
      historyRows=await loadHistoryForPage(snapshot);
    }catch(e){
      if(token!==loadToken) return;
      snapshot=[];
      historyRows=[];
      totalRows=0;
      const msg=qs('#msg',ui); if(msg) msg.textContent='Error cargando empleados: '+(e?.message||e);
    }finally{
      if(token===loadToken){
        loading=false;
        render();
      }
    }
  }
  async function loadEmployeesPageFallback(){
    const rows=await streamOnce((ok)=> deps.streamEmployees?.(ok));
    const term=search(); const sedeCode=filterSede(); const st=filterStatus();
    const filtered=rows.filter(e=>{
      const text=[e.codigo,e.documento,e.nombre,e.telefono,e.cargoNombre,e.cargoCodigo,e.sedeNombre,e.sedeCodigo].join(' ').toLowerCase();
      return (!term || text.includes(term)) && (!sedeCode || String(e.sedeCodigo||'')===sedeCode) && (!st || e.estado===st);
    });
    const sorted=sortData(filtered);
    const pageSize=paginator.state.showAll ? Math.max(sorted.length,1) : Math.max(1,paginator.state.pageSize);
    const start=paginator.state.showAll ? 0 : (Math.max(1,paginator.state.currentPage)-1)*pageSize;
    return { rows:sorted.slice(start,start+pageSize), total:sorted.length };
  }
  async function loadHistoryForPage(rows=[]){
    const ids=rows.map((row)=>String(row?.id||'').trim()).filter(Boolean);
    const documentos=rows.map((row)=>String(row?.documento||'').trim()).filter(Boolean);
    if(typeof deps.listEmployeeCargoHistoryForEmployees==='function'){
      return deps.listEmployeeCargoHistoryForEmployees({ ids, documentos });
    }
    return streamOnce((ok)=> deps.streamEmployeeCargoHistoryAll?.(ok));
  }
  function streamOnce(factory,timeoutMs=10000){
    return new Promise((resolve)=>{
      let settled=false;
      let unsub=()=>{};
      const finish=(rows)=>{
        if(settled) return;
        settled=true;
        clearTimeout(timer);
        try{ unsub?.(); }catch{}
        resolve(Array.isArray(rows)?rows:[]);
      };
      const timer=setTimeout(()=>finish([]),timeoutMs);
      try{ unsub=factory((rows)=>finish(rows))||(()=>{}); }catch{ finish([]); }
    });
  }
  function render(){
    const pageRows=snapshot;
    updateServerPagination();
    tbody.replaceChildren(...pageRows.map(e=> row(e)));
    cards.replaceChildren(...(pageRows.length ? pageRows.map(e=> employeeCard(e)) : [el('p',{className:'text-muted record-card__empty'},['Sin empleados para mostrar.'])]));
    const msg=qs('#msg',ui); if(msg) msg.textContent=loading ? 'Cargando empleados...' : `Total registros filtrados: ${totalRows}`;
    updateSortIndicators();
  }
  function row(e){
    const view=employeeAssignmentView(e);
    const tr=el('tr',{'data-id':e.id});
    const tdCodigo=el('td',{},[e.codigo||'-']);
    const linked=isLinkedByDoc(e.documento);
    const tdDoc=el('td',{}, linked ? [e.documento||'-',' ',el('span',{className:'badge'},['Vinculado'])] : [e.documento||'-']);
    const tdNombre=el('td',{},[e.nombre||'-']);
    const tdTel=el('td',{},[e.telefono||'-']);
    const tdCargo=el('td',{},[ assignmentCellText(view.current,'cargo'), programmedBadge(view.programmed,'cargo') ].filter(Boolean));
    const tdSede=el('td',{},[ assignmentCellText(view.current,'sede'), programmedBadge(view.programmed,'sede') ].filter(Boolean));
    const tdEstado=el('td',{},[ statusBadge(e.estado) ]);
    const tdIngreso=el('td',{},[ formatDate(view.current?.fechaIngreso||e.fechaIngreso) ]);
    const tdRetiro=el('td',{},[ formatDate(e.fechaRetiro) ]);
    const tdAcc=el('td',{},[ actionsCell(e) ]);
    tr.append(tdCodigo,tdDoc,tdNombre,tdTel,tdCargo,tdSede,tdEstado,tdIngreso,tdRetiro,tdAcc);
    return tr;
  }
  function employeeCard(e){
    const view=employeeAssignmentView(e);
    const linked=isLinkedByDoc(e.documento);
    const docValue=linked ? [e.documento||'-',' ',el('span',{className:'badge'},['Vinculado'])] : [e.documento||'-'];
    const cargoValue=[assignmentCellText(view.current,'cargo'),programmedBadge(view.programmed,'cargo')].filter(Boolean);
    const sedeValue=[assignmentCellText(view.current,'sede'),programmedBadge(view.programmed,'sede')].filter(Boolean);
    return recordCard(e,{
      title:e.nombre||'-',
      subtitle:`Codigo: ${e.codigo||'-'}`,
      meta:[
        ['Documento',docValue],
        ['Telefono',e.telefono||'-'],
        ['Cargo',cargoValue.length?cargoValue:['-']],
        ['Sede',sedeValue.length?sedeValue:['-']],
        ['Ingreso',formatDate(view.current?.fechaIngreso||e.fechaIngreso)],
        ['Retiro',formatDate(e.fechaRetiro)]
      ],
      actions:actionsCell(e)
    });
  }
  function recordCard(item,{title,subtitle,meta=[],actions}){
    return el('article',{className:'record-card'},[
      el('div',{className:'record-card__header'},[
        el('div',{className:'record-card__identity'},[
          el('strong',{className:'record-card__title'},[title]),
          el('span',{className:'record-card__subtitle'},[subtitle])
        ]),
        statusBadge(item.estado)
      ]),
      el('dl',{className:'record-card__meta'},meta.map(([label,value])=> el('div',{className:'record-card__meta-item'},[
        el('dt',{},[label]),
        el('dd',{},Array.isArray(value)?value:[value||'-'])
      ]))),
      el('div',{className:'record-card__actions'},[actions])
    ]);
  }
  function statusBadge(st){ return el('span',{className:'badge '+(st==='activo'?'badge--ok':'badge--off')},[st||'-']); }
  function assignmentCellText(assignment={},kind='sede'){
    if(kind==='cargo') return assignment?.cargoNombre||cargoNameByCode(assignment?.cargoCodigo)||assignment?.cargoCodigo||'-';
    const catalogName = sedeNameByCode(assignment?.sedeCodigo);
    return catalogName !== '-' ? catalogName : (assignment?.sedeNombre||assignment?.sedeCodigo||'-');
  }
  function programmedBadge(assignment=null,kind='sede'){
    if(!assignment) return null;
    const target=assignmentCellText(assignment,kind);
    const label=`Programado desde ${formatInputDate(assignment.fechaIngreso)}: ${target}`;
    return el('span',{className:'badge',title:label,'aria-label':label,style:'margin-left:.35rem;cursor:help;'},['Programado']);
  }
  function employeeAssignmentView(e={}){
    const today=todayInputDate();
    const rows=historyRowsByEmployee(e);
    const current=resolveAssignmentOnDate(e,today,rows) || employeeAssignmentData(e);
    const programmed=nextProgrammedAssignment(today,rows);
    return { current, programmed };
  }
  function historyRowsByEmployee(e={}){
    const employeeId=String(e?.id||'').trim();
    const doc=String(e?.documento||'').trim();
    return (historyRows||[]).filter((row)=>{
      const rowEmployeeId=String(row?.employeeId||'').trim();
      const rowDoc=String(row?.documento||'').trim();
      return (employeeId && rowEmployeeId===employeeId) || (doc && rowDoc===doc);
    });
  }
  function employeeAssignmentData(e={}){
    return {
      cargoCodigo:e.cargoCodigo||null,
      cargoNombre:e.cargoNombre||null,
      sedeCodigo:e.sedeCodigo||null,
      sedeNombre:e.sedeNombre||null,
      fechaIngreso:e.fechaIngreso||null,
      fechaRetiro:e.fechaRetiro||null
    };
  }
  function resolveAssignmentOnDate(e={},day,rows=[]){
    const matching=(rows||[]).filter((row)=>{
      const ingreso=toISODateValue(row?.fechaIngreso);
      if(!ingreso || ingreso>day) return false;
      const retiro=toISODateValue(row?.fechaRetiro);
      return !retiro || retiro>=day;
    });
    if(!matching.length) return null;
    matching.sort((a,b)=>{
      const ai=toISODateValue(a.fechaIngreso)||'';
      const bi=toISODateValue(b.fechaIngreso)||'';
      if(ai!==bi) return bi.localeCompare(ai);
      return String(b.createdAt||'').localeCompare(String(a.createdAt||''));
    });
    return matching[0];
  }
  function nextProgrammedAssignment(day,rows=[]){
    const future=(rows||[]).filter((row)=>{
      const ingreso=toISODateValue(row?.fechaIngreso);
      return ingreso && ingreso>day && !row?.fechaRetiro;
    });
    if(!future.length) return null;
    future.sort((a,b)=>{
      const ai=toISODateValue(a.fechaIngreso)||'';
      const bi=toISODateValue(b.fechaIngreso)||'';
      if(ai!==bi) return ai.localeCompare(bi);
      return String(a.createdAt||'').localeCompare(String(b.createdAt||''));
    });
    return future[0];
  }
  function programmedAssignmentsAfterDate(e={},day=''){
    const cleanDay=String(day||'').trim();
    return historyRowsByEmployee(e)
      .filter((row)=>{
        const ingreso=toISODateValue(row?.fechaIngreso);
        return ingreso && cleanDay && ingreso>cleanDay && !row?.fechaRetiro;
      })
      .sort((a,b)=>{
        const ai=toISODateValue(a.fechaIngreso)||'';
        const bi=toISODateValue(b.fechaIngreso)||'';
        if(ai!==bi) return ai.localeCompare(bi);
        return String(a.createdAt||'').localeCompare(String(b.createdAt||''));
      });
  }
  function programmedAssignmentLine(row={}){
    const cargo=row.cargoNombre||cargoNameByCode(row.cargoCodigo)||row.cargoCodigo||'-';
    const sede=row.sedeNombre||sedeNameByCode(row.sedeCodigo)||row.sedeCodigo||'-';
    return `${formatInputDate(row.fechaIngreso)} | Cargo: ${cargo} | Sede: ${sede}`;
  }
  function formatDate(ts){
    try{
      const d=ts?.toDate? ts.toDate(): (ts? new Date(ts): null);
      return d? new Date(d).toLocaleDateString(): '-';
    }catch{ return '-'; }
  }
  async function openCargoHistoryModal(e){
    const employeeId=String(e?.id||'').trim();
    if(!employeeId || typeof deps.streamEmployeeCargoHistory!=='function'){
      showInfoModal('Historial del empleado',['No hay historial disponible para este empleado.']);
      return;
    }
    showInfoModal(`Historial del empleado - ${e?.nombre||'-'}`,['Cargando...']);
    let done=false;
    const un=deps.streamEmployeeCargoHistory(employeeId,(rows)=>{
      if(done) return;
      done=true;
      const list=Array.isArray(rows)? rows:[];
      if(!list.length){
        showInfoModal(`Historial del empleado - ${e?.nombre||'-'}`,['Sin registros.']);
        un?.();
        return;
      }
      const lines=list.map((row,idx)=>{
        const ingreso=formatDate(row.fechaIngreso);
        const retiro=row.fechaRetiro ? formatDate(row.fechaRetiro) : 'Activo';
        const cargo=row.cargoNombre||row.cargoCodigo||'-';
        const sede=row.sedeNombre||row.sedeCodigo||'-';
        return `${idx+1}. Cargo: ${cargo} | Sede: ${sede} | Ingreso: ${ingreso} | Retiro: ${retiro}`;
      });
      showInfoModal(`Historial del empleado - ${e?.nombre||'-'}`,lines);
      un?.();
    });
    setTimeout(()=>{
      if(done) return;
      done=true;
      showInfoModal(`Historial del empleado - ${e?.nombre||'-'}`,['No se pudo cargar el historial. Intenta de nuevo.']);
      un?.();
    },5000);
  }
  async function openMoreOptionsModal(e){
    const inactive=String(e?.estado||'').trim().toLowerCase()==='inactivo';
    const modal=await showActionModal({
      title:'Mas opciones',
      message:`Empleado: ${e.nombre||'-'}`,
      confirmText:'Continuar',
      fields:[{
        id:'action',
        label:'Accion',
        type:'select',
        required:true,
        options:[
          { value:'', label:'Seleccione...' },
          { value:'edit', label:'Editar' },
          { value:'transfer', label:'Trasladar empleado' },
          { value:'cargo', label:'Cambiar cargo' },
          { value:'certificate', label:'Generar certificado' },
          inactive ? { value:'rehire', label:'Reingresar empleado' } : null,
          { value:'retire', label:'Retirar empleado' }
        ].filter(Boolean)
      }]
    });
    if(!modal.confirmed) return;
    if(modal.values.action==='edit') return openEditEmployeeModal(e);
    if(modal.values.action==='transfer') return openTransferEmployeeModal(e);
    if(modal.values.action==='cargo') return openChangeCargoModal(e);
    if(modal.values.action==='certificate') return openCertificateModal(e);
    if(modal.values.action==='rehire') return openRehireEmployeeModal(e);
    if(modal.values.action==='retire') return openRetireEmployeeModal(e);
  }
  async function openCertificateModal(e){
    if(e.estado!=='activo') return alert('Solo puedes generar certificados de empleados activos.');
    const modal=await showActionModal({
      title:'Generar certificado',
      message:`Empleado: ${e.nombre||'-'}`,
      confirmText:'Descargar PDF',
      fields:[{
        id:'type',
        label:'Tipo de certificado',
        type:'select',
        required:true,
        options:[
          { value:'basic', label:'Laboral basico' },
          { value:'with_salary', label:'Laboral con salario' }
        ]
      }]
    });
    if(!modal.confirmed) return;
    try{
      await deps.generateEmployeeCertificate?.(e.id, modal.values.type||'basic');
      await deps.addAuditLog?.({ targetType:'employee', targetId:e.id, action:'generate_employee_certificate', after:{ documento:e.documento||null, type:modal.values.type||'basic' } });
    }catch(err){ alert('Error: '+(err?.message||err)); }
  }
  async function openEditEmployeeModal(e){
    const modal=await showActionModal({
      title:'Editar empleado',
      message:`Empleado: ${e.nombre||'-'}`,
      confirmText:'Guardar cambios',
      fields:[
        { id:'codigo', label:'Codigo', type:'text', required:true, value:e.codigo||'' },
        { id:'documento', label:'Documento', type:'text', required:true, value:e.documento||'' },
        { id:'nombre', label:'Nombre completo', type:'text', required:true, value:e.nombre||'' },
        { id:'telefono', label:'Telefono', type:'text', required:true, value:e.telefono||'' },
        { id:'fechaNacimiento', label:'Fecha nacimiento', type:'date', value:toInputDate(e.fechaNacimiento) },
        { id:'eps', label:'EPS', type:'text', value:e.eps||'' },
        { id:'afp', label:'AFP', type:'text', value:e.afp||'' },
        { id:'arlRiesgo', label:'Riesgo ARL', type:'text', value:e.arlRiesgo||'' },
        { id:'dotacionCamisa', label:'Camisa', type:'text', value:e.dotacionCamisa||'' },
        { id:'dotacionPantalon', label:'Pantalon', type:'text', value:e.dotacionPantalon||'' },
        { id:'dotacionZapatos', label:'Zapatos', type:'text', value:e.dotacionZapatos||'' },
        { id:'fechaIngreso', label:'Fecha ingreso', type:'date', required:true, value:toInputDate(e.fechaIngreso) },
        { id:'detail', label:'Detalle de la modificacion', type:'textarea', required:true, placeholder:'Describe brevemente el cambio realizado' }
      ]
    });
    if(!modal.confirmed) return;
    const newCode=String(modal.values.codigo||'').trim();
    const newDoc=String(modal.values.documento||'').trim();
    const newName=String(modal.values.nombre||'').trim();
    const newPhone=String(modal.values.telefono||'').trim();
    const newFechaNacimiento=String(modal.values.fechaNacimiento||'').trim();
    const newEps=String(modal.values.eps||'').trim();
    const newAfp=String(modal.values.afp||'').trim();
    const newArlRiesgo=String(modal.values.arlRiesgo||'').trim();
    const newDotacionCamisa=String(modal.values.dotacionCamisa||'').trim();
    const newDotacionPantalon=String(modal.values.dotacionPantalon||'').trim();
    const newDotacionZapatos=String(modal.values.dotacionZapatos||'').trim();
    const newIngreso=String(modal.values.fechaIngreso||'').trim();
    if(newFechaNacimiento && !validInputDate(newFechaNacimiento)) return alert('Selecciona una fecha de nacimiento valida.');
    if(newFechaNacimiento && newFechaNacimiento>todayInputDate()) return alert('La fecha de nacimiento no puede ser futura.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(newIngreso)) return alert('Selecciona la fecha de ingreso.');
    const currentRetiro=toInputDate(e.fechaRetiro);
    if(currentRetiro && newIngreso>currentRetiro) return alert('La fecha de ingreso no puede ser posterior a la fecha de retiro.');
    try{
      if(newCode!==String(e.codigo||'')){ const dup=await deps.findEmployeeByCode?.(newCode); if(dup && dup.id!==e.id) return alert('Ya existe un empleado con ese codigo.'); }
      if(newDoc!==String(e.documento||'')){ const dupDoc=await deps.findEmployeeByDocument?.(newDoc); if(dupDoc && dupDoc.id!==e.id) return alert('Ya existe un empleado con ese documento.'); }
      await deps.updateEmployee?.(e.id,{
        codigo:newCode,
        documento:newDoc,
        nombre:newName,
        telefono:newPhone,
        fechaNacimiento:newFechaNacimiento||null,
        eps:newEps||null,
        afp:newAfp||null,
        arlRiesgo:newArlRiesgo||null,
        dotacionCamisa:newDotacionCamisa||null,
        dotacionPantalon:newDotacionPantalon||null,
        dotacionZapatos:newDotacionZapatos||null,
        fechaIngreso:new Date(`${newIngreso}T00:00:00`)
      });
      await deps.addAuditLog?.({ targetType:'employee', targetId:e.id, action:'update_employee', before:{ codigo:e.codigo, documento:e.documento, nombre:e.nombre, telefono:e.telefono, fechaNacimiento:e.fechaNacimiento||null, eps:e.eps||null, afp:e.afp||null, arlRiesgo:e.arlRiesgo||null, dotacionCamisa:e.dotacionCamisa||null, dotacionPantalon:e.dotacionPantalon||null, dotacionZapatos:e.dotacionZapatos||null, fechaIngreso:e.fechaIngreso||null }, after:{ codigo:newCode, documento:newDoc, nombre:newName, telefono:newPhone, fechaNacimiento:newFechaNacimiento||null, eps:newEps||null, afp:newAfp||null, arlRiesgo:newArlRiesgo||null, dotacionCamisa:newDotacionCamisa||null, dotacionPantalon:newDotacionPantalon||null, dotacionZapatos:newDotacionZapatos||null, fechaIngreso:newIngreso }, note:modal.values.detail||null });
    }catch(err){ alert('Error: '+(err?.message||err)); }
  }
  async function openTransferEmployeeModal(e){
    if(e.estado!=='activo') return alert('Solo puedes trasladar empleados activos.');
    const suggestedEnd=toInputDate(new Date()) || '';
    const suggestedStart=addOneDayToInputDate(suggestedEnd);
    const todayBogota=todayInputDate();
    const modal=await showActionModal({
      title:'Trasladar empleado',
      message:`Empleado: ${e.nombre||'-'}`,
      confirmText:'Trasladar',
      fields:[
        { id:'currentSede', label:'Sede actual', type:'text', value:sedeLabelByCode(e.sedeCodigo)||e.sedeNombre||e.sedeCodigo||'-', readonly:true },
        { id:'sede', label:'Nueva sede', type:'datalist', required:true, placeholder:'Selecciona o escribe sede', options:sedeOptions() },
        { id:'historyRetiroDate', label:'Fecha de retiro en sede anterior', type:'date', required:true, value:suggestedEnd },
        { id:'historyIngresoDate', label:'Fecha de ingreso en nueva sede', type:'date', required:true, value:suggestedStart, min:todayBogota },
        { id:'detail', label:'Detalle', type:'textarea', required:true, placeholder:'Describe brevemente el traslado' }
      ]
    });
    if(!modal.confirmed) return;
    const newSedeCode=resolveSedeCode(modal.values.sede);
    const historyRetiroDate=String(modal.values.historyRetiroDate||'').trim();
    const historyIngresoDate=String(modal.values.historyIngresoDate||'').trim();
    if(!newSedeCode) return alert('Selecciona una sede valida.');
    if(newSedeCode===String(e.sedeCodigo||'')) return alert('Selecciona una sede diferente.');
    if(!validInputDate(historyRetiroDate) || !validInputDate(historyIngresoDate)) return alert('Fechas invalidas.');
    if(historyIngresoDate<todayBogota) return alert(`La fecha de inicio en nueva sede no puede ser anterior a hoy (${todayBogota}).`);
    if(addOneDayToInputDate(historyRetiroDate)!==historyIngresoDate) return alert('La nueva asignacion debe iniciar el dia siguiente al fin del tramo anterior.');
    try{
      const newSede=sedeList.find(s=>s.codigo===newSedeCode);
      await deps.updateEmployee?.(e.id,{
        sedeCodigo:newSedeCode,
        sedeNombre:newSede?.nombre||null,
        assignmentFechaIngreso:new Date(`${historyIngresoDate}T00:00:00`),
        assignmentFechaRetiro:new Date(`${historyRetiroDate}T00:00:00`),
        historialFechaRetiro:new Date(`${historyRetiroDate}T00:00:00`)
      });
      await deps.addAuditLog?.({ targetType:'employee', targetId:e.id, action:'transfer_employee', before:{ sedeCodigo:e.sedeCodigo, sedeNombre:e.sedeNombre||null }, after:{ sedeCodigo:newSedeCode, sedeNombre:newSede?.nombre||null, assignmentFechaIngreso:historyIngresoDate, assignmentFechaRetiro:historyRetiroDate }, note:modal.values.detail||null });
    }catch(err){ alert('Error: '+(err?.message||err)); }
  }
  async function openChangeCargoModal(e){
    if(e.estado!=='activo') return alert('Solo puedes cambiar el cargo de empleados activos.');
    const suggestedEnd=toInputDate(new Date()) || '';
    const suggestedStart=addOneDayToInputDate(suggestedEnd);
    const modal=await showActionModal({
      title:'Cambiar cargo',
      message:`Empleado: ${e.nombre||'-'}`,
      confirmText:'Cambiar cargo',
      fields:[
        { id:'currentCargo', label:'Cargo actual', type:'text', value:e.cargoNombre||cargoNameByCode(e.cargoCodigo)||e.cargoCodigo||'-', readonly:true },
        { id:'cargo', label:'Nuevo cargo', type:'select', required:true, options:cargoOptions() },
        { id:'historyRetiroDate', label:'Fecha fin de cargo anterior', type:'date', required:true, value:suggestedEnd },
        { id:'historyIngresoDate', label:'Fecha inicio de nuevo cargo', type:'date', required:true, value:suggestedStart },
        { id:'detail', label:'Detalle', type:'textarea', required:true, placeholder:'Describe brevemente el cambio de cargo' }
      ]
    });
    if(!modal.confirmed) return;
    const newCargoCode=String(modal.values.cargo||'').trim();
    const historyRetiroDate=String(modal.values.historyRetiroDate||'').trim();
    const historyIngresoDate=String(modal.values.historyIngresoDate||'').trim();
    if(!newCargoCode) return alert('Selecciona un cargo.');
    if(newCargoCode===String(e.cargoCodigo||'')) return alert('Selecciona un cargo diferente.');
    if(!validInputDate(historyRetiroDate) || !validInputDate(historyIngresoDate)) return alert('Fechas invalidas.');
    if(addOneDayToInputDate(historyRetiroDate)!==historyIngresoDate) return alert('La nueva asignacion debe iniciar el dia siguiente al fin del tramo anterior.');
    try{
      const newCargo=cargoList.find(c=>c.codigo===newCargoCode);
      await deps.updateEmployee?.(e.id,{
        cargoCodigo:newCargoCode,
        cargoNombre:newCargo?.nombre||null,
        fechaIngreso:new Date(`${historyIngresoDate}T00:00:00`),
        assignmentFechaIngreso:new Date(`${historyIngresoDate}T00:00:00`),
        assignmentFechaRetiro:new Date(`${historyRetiroDate}T00:00:00`),
        historialFechaRetiro:new Date(`${historyRetiroDate}T00:00:00`)
      });
      await deps.addAuditLog?.({ targetType:'employee', targetId:e.id, action:'change_employee_cargo', before:{ cargoCodigo:e.cargoCodigo, cargoNombre:e.cargoNombre||null }, after:{ cargoCodigo:newCargoCode, cargoNombre:newCargo?.nombre||null, assignmentFechaIngreso:historyIngresoDate, assignmentFechaRetiro:historyRetiroDate }, note:modal.values.detail||null });
    }catch(err){ alert('Error: '+(err?.message||err)); }
  }
  async function openRetireEmployeeModal(e){
    if(e.estado!=='activo') return alert('Este empleado ya esta retirado.');
    const suggested=toInputDate(new Date()) || '';
    const modal=await showActionModal({
      title:'Retirar empleado',
      message:`Empleado: ${e.nombre||'-'}`,
      confirmText:'Retirar',
      fields:[
        { id:'retiroDate', label:'Fecha de retiro', type:'date', required:true, value:suggested },
        { id:'detail', label:'Detalle', type:'textarea', required:true, placeholder:'Escribe el motivo o detalle de esta accion' }
      ]
    });
    if(!modal.confirmed) return;
    let retiro=String(modal.values.retiroDate||'').trim();
    if(!validInputDate(retiro)) return alert('Fecha invalida. Usa formato AAAA-MM-DD.');
    const ingreso=toInputDate(e.fechaIngreso);
    if(ingreso && retiro<ingreso) return alert('La fecha de retiro no puede ser anterior a la fecha de ingreso.');
    const originalRetiro=retiro;
    const lastAttendance=await resolveLastAttendanceForRetirement(e);
    if(lastAttendance?.fecha && retiro<lastAttendance.fecha){
      const sedeLabel=lastAttendance.sedeNombre||lastAttendance.sedeCodigo||'una sede';
      const adjust=await showActionModal({
        title:'Ajustar fecha de retiro',
        message:[
          `La fecha seleccionada (${formatInputDate(retiro)}) queda antes del ultimo registro de asistencia.`,
          `Ultima asistencia: ${formatInputDate(lastAttendance.fecha)} en ${sedeLabel}.`,
          'Para conservar el historico operativo, el retiro debe quedar como minimo en esa fecha.'
        ].join('\n'),
        confirmText:'Usar ultima asistencia',
        fields:[
          { id:'finalDate', label:'Fecha final de retiro', type:'text', readonly:true, value:lastAttendance.fecha }
        ]
      });
      if(!adjust.confirmed) return;
      retiro=lastAttendance.fecha;
    }
    const programmed=programmedAssignmentsAfterDate(e,retiro);
    if(programmed.length){
      const confirmCancel=await showActionModal({
        title:'Cancelar cambios programados',
        message:[
          `El empleado tiene ${programmed.length} cambio(s) programado(s) posterior(es) al retiro ${formatInputDate(retiro)}.`,
          ...programmed.map((row,idx)=>`${idx+1}. ${programmedAssignmentLine(row)}`),
          'Si continuas, se cancelaran estos cambios y el empleado quedara retirado en su asignacion actual.'
        ].join('\n'),
        confirmText:'Cancelar y retirar',
        fields:[
          { id:'detail', label:'Detalle', type:'textarea', required:true, value:modal.values.detail||'', placeholder:'Confirma el motivo de la cancelacion y retiro' }
        ]
      });
      if(!confirmCancel.confirmed) return;
      modal.values.detail=confirmCancel.values.detail||modal.values.detail||'';
    }
    try{
      const retiroDate=new Date(`${retiro}T00:00:00`);
      for(const row of programmed){
        if(row?.id) await deps.cancelProgrammedEmployeeAssignment?.(row.id);
      }
      await deps.setEmployeeStatus?.(e.id,'inactivo',{ fechaRetiro:retiroDate, cancelProgrammedAssignments:true });
      await deps.addAuditLog?.({ targetType:'employee', targetId:e.id, action:'retire_employee', before:{estado:e.estado, fechaRetiro:e.fechaRetiro||null}, after:{estado:'inactivo', fechaRetiro:retiro, fechaRetiroSolicitada:originalRetiro!==retiro?originalRetiro:null, ultimaAsistencia:lastAttendance||null, cancelledProgrammedAssignments:programmed.map((row)=>({ id:row.id, fechaIngreso:row.fechaIngreso, sedeCodigo:row.sedeCodigo, sedeNombre:row.sedeNombre, cargoCodigo:row.cargoCodigo, cargoNombre:row.cargoNombre }))}, note:modal.values.detail||null });
    }catch(err){ alert('Error: '+(err?.message||err)); }
  }
  async function resolveLastAttendanceForRetirement(e){
    if(typeof deps.getEmployeeLastAttendanceDay!=='function') return null;
    try{
      return await deps.getEmployeeLastAttendanceDay({ id:e.id, documento:e.documento });
    }catch(error){
      console.error('No se pudo consultar ultima asistencia del empleado:', error);
      return null;
    }
  }
  async function openRehireEmployeeModal(e, defaults={}){
    if(String(e?.estado||'').trim().toLowerCase()!=='inactivo') return alert('Solo puedes reingresar empleados inactivos.');
    const lastRetiro=lastRetiroDateForEmployee(e);
    const minIngreso=lastRetiro||'';
    const modal=await showActionModal({
      title:'Reingresar empleado',
      message:`Empleado: ${e.nombre||'-'}${lastRetiro ? `\nUltimo retiro: ${formatInputDate(lastRetiro)}` : ''}`,
      confirmText:'Reingresar',
      fields:[
        { id:'documento', label:'Documento', type:'text', value:e.documento||'', readonly:true },
        { id:'nombre', label:'Nombre completo', type:'text', required:true, value:defaults.nombre||e.nombre||'' },
        { id:'telefono', label:'Telefono', type:'text', required:true, value:defaults.telefono||e.telefono||'' },
        { id:'cargo', label:'Cargo', type:'select', required:true, value:defaults.cargoCodigo||e.cargoCodigo||'', options:cargoOptions() },
        { id:'sede', label:'Sede', type:'datalist', required:true, placeholder:'Selecciona o escribe sede', value:sedeLabelByCode(defaults.sedeCodigo||e.sedeCodigo)||'', options:sedeOptions() },
        { id:'fechaIngreso', label:'Nueva fecha ingreso', type:'date', required:true, value:defaults.fechaIngreso||minIngreso, min:minIngreso },
        { id:'detail', label:'Detalle', type:'textarea', required:true, placeholder:'Describe brevemente el reingreso' }
      ]
    });
    if(!modal.confirmed) return;
    const newName=String(modal.values.nombre||'').trim();
    const newPhone=String(modal.values.telefono||'').trim();
    const newCargoCode=String(modal.values.cargo||'').trim();
    const newSedeCode=resolveSedeCode(modal.values.sede);
    const newIngreso=String(modal.values.fechaIngreso||'').trim();
    if(!newName) return alert('Escribe el nombre completo.');
    if(!newPhone) return alert('Escribe el telefono.');
    if(!newCargoCode) return alert('Selecciona un cargo.');
    if(!newSedeCode) return alert('Selecciona una sede valida.');
    if(!validInputDate(newIngreso)) return alert('Selecciona una fecha de ingreso valida.');
    if(lastRetiro && newIngreso<lastRetiro) return alert(`La nueva fecha de ingreso no puede ser anterior al ultimo retiro (${lastRetiro}).`);
    try{
      const cargo=cargoList.find(c=>c.codigo===newCargoCode);
      const sede=sedeList.find(s=>s.codigo===newSedeCode);
      const updated=await deps.rehireEmployee?.(e.id,{
        nombre:newName,
        telefono:newPhone,
        cargoCodigo:newCargoCode,
        cargoNombre:cargo?.nombre||null,
        sedeCodigo:newSedeCode,
        sedeNombre:sede?.nombre||null,
        fechaIngreso:new Date(`${newIngreso}T00:00:00`)
      });
      await deps.addAuditLog?.({ targetType:'employee', targetId:e.id, action:'rehire_employee', before:{ estado:e.estado, fechaRetiro:e.fechaRetiro||null }, after:{ estado:'activo', fechaIngreso:newIngreso, cargoCodigo:newCargoCode, sedeCodigo:newSedeCode }, note:modal.values.detail||null });
      alert(`Empleado reingresado OK: ${updated?.nombre||newName}`);
    }catch(err){ alert('Error: '+(err?.message||err)); }
  }
  function actionsCell(e){
    const box=el('div',{className:'row-actions'},[]);
    if(canEdit){
      const btnMore=el('button',{className:'btn btn--icon',type:'button',title:'Mas opciones','aria-label':'Mas opciones'},[moreIcon()]);
      btnMore.addEventListener('click',()=> openMoreOptionsModal(e));
      box.append(btnMore);
    }
    const btnView=el('button',{className:'btn btn--icon',type:'button',title:'Ver ficha','aria-label':'Ver ficha'},[viewIcon()]);
    btnView.addEventListener('click',()=>{ openEmployeeDetailModal(e); });
    const btnInfo=el('button',{className:'btn btn--icon',type:'button',title:'Ver informacion','aria-label':'Ver informacion'},[infoIcon()]);
    btnInfo.addEventListener('click',()=>{ openCargoHistoryModal(e); });
    box.append(btnView,btnInfo);
    return box;
  }
  function openEmployeeDetailModal(e){
    showInfoModal(`Ficha del empleado - ${e?.nombre||'-'}`,[employeeDetailContent(e)]);
  }
  function employeeDetailContent(e){
    const view=employeeAssignmentView(e);
    const current=view.current||{};
    return el('div',{className:'employee-detail'},[
      detailSection('Datos basicos',[
        ['Codigo',e.codigo],
        ['Documento',e.documento],
        ['Nombre',e.nombre],
        ['Telefono',e.telefono],
        ['Fecha nacimiento',formatInputDate(e.fechaNacimiento)],
        ['Estado',e.estado],
        ['Cargo actual',assignmentCellText(current,'cargo')],
        ['Sede actual',assignmentCellText(current,'sede')],
        ['Ingreso',formatDate(current.fechaIngreso||e.fechaIngreso)],
        ['Retiro',formatDate(e.fechaRetiro)]
      ]),
      detailSection('Seguridad social',[
        ['EPS',e.eps],
        ['AFP',e.afp],
        ['Riesgo ARL',e.arlRiesgo]
      ]),
      detailSection('Dotacion',[
        ['Camisa',e.dotacionCamisa],
        ['Pantalon',e.dotacionPantalon],
        ['Zapatos',e.dotacionZapatos]
      ])
    ]);
  }
  function detailSection(title,items=[]){
    return el('section',{className:'employee-detail__section'},[
      el('h4',{className:'employee-detail__heading'},[title]),
      el('dl',{className:'employee-detail__grid'},items.map(([label,value])=> el('div',{className:'employee-detail__item'},[
        el('dt',{},[label]),
        el('dd',{},[detailValue(value)])
      ])))
    ]);
  }
  function detailValue(value){
    const text=String(value ?? '').trim();
    return text || '-';
  }
  function toInputDate(ts){
    try{
      if(typeof ts==='string'){
        const raw=ts.trim();
        if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
      }
      const d=ts?.toDate? ts.toDate(): (ts? new Date(ts): null);
      if(!d) return '';
      const pad=(n)=> String(n).padStart(2,'0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    }catch{ return ''; }
  }
  function todayInputDate(){
    return new Intl.DateTimeFormat('en-CA',{ timeZone:'America/Bogota' }).format(new Date());
  }
  function toISODateValue(value){
    if(!value) return '';
    if(typeof value==='string'){
      const raw=value.trim();
      if(/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
      const parsed=new Date(raw);
      return Number.isNaN(parsed.getTime())?'':parsed.toISOString().slice(0,10);
    }
    const parsed=value?.toDate?value.toDate():(value instanceof Date?value:null);
    return parsed && !Number.isNaN(parsed.getTime())?parsed.toISOString().slice(0,10):'';
  }
  function formatInputDate(value){
    const iso=toISODateValue(value);
    if(!iso) return '-';
    const [year,month,day]=iso.split('-').map((part)=>Number(part));
    const date=new Date(year,(month||1)-1,day||1);
    return date.toLocaleDateString();
  }
  function validInputDate(value){
    const raw=String(value||'').trim();
    if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
    return !Number.isNaN(new Date(`${raw}T00:00:00`).getTime());
  }
  function addOneDayToInputDate(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'').trim())) return '';
    const dt=new Date(`${value}T00:00:00`);
    if(Number.isNaN(dt.getTime())) return '';
    dt.setDate(dt.getDate()+1);
    return toInputDate(dt);
  }
  function lastRetiroDateForEmployee(e={}){
    const dates=[
      toISODateValue(e?.fechaRetiro),
      ...historyRowsByEmployee(e).map((row)=>toISODateValue(row?.fechaRetiro))
    ].filter(Boolean).sort();
    return dates.length ? dates[dates.length-1] : '';
  }
  qs('#txtSearch',ui).addEventListener('input',()=>{ paginator.reset(); scheduleLoadPage(); });
  qs('#selSede',ui).addEventListener('change',()=>{ paginator.reset(); scheduleLoadPage(0); });
  qs('#selStatus',ui).addEventListener('change',()=>{ paginator.reset(); scheduleLoadPage(0); });
  initSorting();
  mount.replaceChildren(ui);
  let unWatch=()=>{};
  try{
    unSedes=deps.streamSedes?.((arr)=>{ sedeList=(arr||[]).filter(s=>s.estado!=='inactivo'); renderSedeSelect(); renderSedeFilter(); render(); }) || (()=>{});
    unCargos=deps.streamCargos?.((arr)=>{ cargoList=(arr||[]).filter(c=>c.estado!=='inactivo'); render(); }) || (()=>{});
    unSup=deps.streamSupervisors?.((arr)=>{ supervisors=arr||[]; render(); }) || (()=>{});
    unSupn=deps.streamSupernumerarios?.((arr)=>{ supernumerarios=arr||[]; render(); }) || (()=>{});
    unWatch=deps.watchEmployeesAdminChanges?.(()=> scheduleLoadPage(0)) || (()=>{});
    scheduleLoadPage(0);
  }catch(e){
    const msg=qs('#msg',ui); if(msg) msg.textContent='Error cargando empleados: '+(e?.message||e);
  }
  return ()=>{ clearTimeout(loadTimer); unWatch?.(); unSedes?.(); unCargos?.(); unSup?.(); unSupn?.(); unHistory?.(); };
};
