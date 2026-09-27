import { el, qs, infoIcon, editIcon, activateIcon, deactivateIcon } from '../utils/dom.js';
import { showCatalogDetail } from '../utils/catalogDetail.js';
import { showActionModal, closeActionModal } from '../utils/actionModal.js';
import { createTablePagination } from '../utils/pagination.js';
import { can, PERMS } from '../permissions.js';
import { subscribe } from '../state.js';
import { contractFilterCode, contractMatches } from '../utils/contractScope.js';
export const ZonesAdmin=(mount,deps={})=>{
  const canEdit=can(PERMS.EDIT_ZONES);
  const ui=el('section',{className:'main-card'},[
    el('h2',{},['Zonas']),
    el('div',{id:'listPanel'},[
      el('div',{className:'form-row'},[
        el('div',{},[ el('label',{className:'label'},['Buscar']), el('input',{id:'txtSearch',className:'input',placeholder:'Codigo o nombre...'}) ]),
        el('div',{},[ el('label',{className:'label'},['Estado']), el('select',{id:'selStatus',className:'select'},[ el('option',{value:''},['Todos']), el('option',{value:'activo'},['Activos']), el('option',{value:'inactivo'},['Inactivos']) ]) ]),
      ]),
      el('div',{className:'responsive-records mt-2'},[
        el('div',{className:'table-wrap responsive-table-view'},[
          el('table',{className:'table',id:'tbl'},[
            el('thead',{},[ el('tr',{},[ el('th',{'data-sort':'codigo',style:'cursor:pointer'},['Codigo']), el('th',{'data-sort':'nombre',style:'cursor:pointer'},['Nombre']), el('th',{'data-sort':'estado',style:'cursor:pointer'},['Estado']), el('th',{},['Acciones']) ]) ]),
            el('tbody',{})
          ])
        ]),
        el('div',{id:'zoneCards',className:'record-card-list'},[])
      ])
    ])
  ]);

  let contractList=[];
  function contractNameByCode(code){
    return contractList.find(c=>c.codigo===code)?.nombre || '-';
  }
  async function openCreateModal(){
    const contractCode=contractFilterCode();
    if(!contractCode) return;
    const modal=await showActionModal({
      title:'Crear zona',
      message:'Completa la informacion para crear una zona.',
      confirmText:'Crear zona',
      fields:[
        { id:'name', label:'Nombre', type:'text', required:true, placeholder:'Nombre de la zona' },
      ]
    });
    if(!modal.confirmed) return;
    const name=String(modal.values.name||'').trim();
    if(contractFilterCode()!==contractCode) return;
    if(!name){ alert('Escribe el nombre de la zona.'); return; }
    if(!contractCode){ alert('Selecciona un contrato valido.'); return; }
    try{
      const code = await deps.getNextZoneCode?.();
      const contract=contractList.find(c=>c.codigo===contractCode);
      const id = await deps.createZone?.({ codigo: code, nombre: name, contratoCodigo:contractCode, contratoNombre:contract?.nombre||null, clienteNombreSnapshot:contract?.clienteNombre||null, clienteNitSnapshot:contract?.clienteNit||null });
      await deps.addAuditLog?.({ targetType:'zone', targetId:id, action:'create_zone', after:{ codigo:code, nombre:name, contratoCodigo:contractCode, estado:'activo' } });
      alert('Zona creada OK');
    }catch(e){ alert('Error: '+(e?.message||e)); }
  }
  if(canEdit){
    const btnOpenCreate=el('button',{id:'btnOpenCreate',className:'btn btn--primary right',type:'button'},['Crear zona']);
    qs('#listPanel .form-row',ui)?.append(btnOpenCreate);
    btnOpenCreate.addEventListener('click',openCreateModal);
  }

  let snapshot=[]; const tbody=ui.querySelector('tbody'); const cards=qs('#zoneCards',ui);
  let sortKey=''; let sortDir=1;
  const paginator=createTablePagination(ui,{id:'zones',after:'#listPanel .responsive-records',onChange:render});
  const search=()=> qs('#txtSearch',ui).value.trim().toLowerCase();
  const filterStatus=()=> qs('#selStatus',ui).value;
  function sortVal(z,key){ if(key==='createdAt'){ try{ const x=z.createdAt? new Date(z.createdAt): null; return x?x.getTime():0; }catch{return 0;} } if(key==='contratoNombre') return String(z.contratoNombre||contractNameByCode(z.contratoCodigo)||'').toLowerCase(); return String(z[key]??'').toLowerCase(); }
  function sortData(data){ if(!sortKey) return data; const out=[...data]; out.sort((a,b)=>{ const va=sortVal(a,sortKey); const vb=sortVal(b,sortKey); if(va===vb) return 0; return va>vb?sortDir:-sortDir; }); return out; }
  function updateSortIndicators(){ ui.querySelectorAll('th[data-sort]').forEach((th)=>{ const base=th.dataset.baseLabel||th.textContent.replace(/\s[\^v▲▼]$/,''); th.dataset.baseLabel=base; const key=th.getAttribute('data-sort'); th.textContent=(sortKey===key)?`${base} ${sortDir===1?'▲':'▼'}`:base; }); }
  function initSorting(){ ui.querySelectorAll('th[data-sort]').forEach((th)=> th.addEventListener('click',()=>{ const key=th.getAttribute('data-sort'); if(sortKey===key) sortDir=sortDir*-1; else { sortKey=key; sortDir=1; } paginator.reset(); render(); })); }
  function render(){ const create=qs('#btnOpenCreate',ui); if(create) create.disabled=!contractFilterCode(); const term=search(); const st=filterStatus(); const contractCode=contractFilterCode(); const data=snapshot.filter(z=>{ const text=[z.codigo,z.nombre,z.contratoCodigo,z.contratoNombre,contractNameByCode(z.contratoCodigo),z.clienteNombreSnapshot].join(' ').toLowerCase(); return (!term||text.includes(term)) && (!st || z.estado===st) && Boolean(contractCode) && contractMatches(z,contractCode); }); const sorted=sortData(data); const pageRows=paginator.slice(sorted); tbody.replaceChildren(...pageRows.map(z=> row(z))); cards.replaceChildren(...(pageRows.length?pageRows.map(z=> recordCard(z,{title:z.nombre||'-',subtitle:`Codigo: ${z.codigo||'-'}`,meta:[['Contrato',z.contratoNombre||contractNameByCode(z.contratoCodigo)],['Estado',z.estado||'-']],actions:actionsCell(z)})):[el('p',{className:'text-muted record-card__empty'},['Sin zonas para mostrar.'])])); updateSortIndicators(); }
  function row(z){ const tr=el('tr',{'data-id':z.id}); const tdCodigo=el('td',{},[z.codigo||'-']); const tdNombre=el('td',{},[z.nombre||'-']); const tdEstado=el('td',{},[ statusBadge(z.estado) ]); const tdAcc=el('td',{},[ actionsCell(z) ]); tr.append(tdCodigo,tdNombre,tdEstado,tdAcc); return tr; }
  function statusBadge(st){ return el('span',{className:'badge '+(st==='activo'?'badge--ok':'badge--off')},[st||'-']); }
  function actionsCell(z){ const box=el('div',{className:'row-actions'},[]); if(canEdit){ const btnEdit=el('button',{className:'btn btn--icon',title:'Editar','aria-label':'Editar'},[editIcon()]); btnEdit.addEventListener('click',()=> openEditModal(z)); const btnToggle=el('button',{className:'btn btn--icon '+(z.estado==='activo'?'btn--danger':'' ),title:z.estado==='activo'?'Desactivar':'Activar','aria-label':z.estado==='activo'?'Desactivar':'Activar'},[ z.estado==='activo'?deactivateIcon():activateIcon() ]); btnToggle.addEventListener('click',async()=>{ const target=z.estado==='activo'?'inactivo':'activo'; const modal=await showActionModal({ title:`${target==='inactivo'?'Desactivar':'Activar'} zona`, message:`Zona: ${z.nombre||'-'}`, confirmText:target==='inactivo'?'Desactivar':'Activar', fields:[{ id:'detail', label:'Detalle', type:'textarea', required:true, placeholder:'Escribe el motivo o detalle de esta accion' }] }); if(!modal.confirmed) return; try{ await deps.setZoneStatus?.(z.id,target); await deps.addAuditLog?.({ targetType:'zone', targetId:z.id, action: target==='activo'?'activate_zone':'deactivate_zone', before:{estado:z.estado}, after:{estado:target}, note: modal.values.detail||null }); }catch(e){ alert('Error: '+(e?.message||e)); } }); box.append(btnEdit,btnToggle); } const btnInfo=el('button',{className:'btn btn--icon',title:'Ver informacion','aria-label':'Ver informacion'},[infoIcon()]); btnInfo.addEventListener('click',()=>{ showCatalogDetail(`Informacion de la zona - ${z.nombre || '-'}`, z, [
      ['Datos generales', [['Codigo', z.codigo], ['Nombre', z.nombre], ['Estado', statusBadge(z.estado)]]],
      ['Contrato y cliente', [
        ['Contrato', z.contratoNombre || contractNameByCode(z.contratoCodigo)],
        ['Codigo contrato', z.contratoCodigo],
        ['Cliente', z.clienteNombreSnapshot],
        ['NIT cliente', z.clienteNitSnapshot]
      ]]
    ]); }); box.append(btnInfo); return box; }
  async function openEditModal(z){ const modal=await showActionModal({ title:'Editar zona', message:`Zona: ${z.nombre||'-'}`, confirmText:'Guardar cambios', fields:[{id:'code',label:'Codigo',type:'text',required:true,value:z.codigo||''},{id:'name',label:'Nombre',type:'text',required:true,value:z.nombre||''},{ id:'detail', label:'Detalle de la modificacion', type:'textarea', required:true, placeholder:'Describe brevemente el cambio realizado' }] }); if(!modal.confirmed) return; const newCode=String(modal.values.code||'').trim(); const newName=String(modal.values.name||'').trim(); const newContractCode=z.contratoCodigo; if(newContractCode!==contractFilterCode()) return; if(!newCode||!newName) return alert('Completa codigo y nombre.'); if(!newContractCode) return alert('Selecciona un contrato valido.'); try{ if(newCode!==z.codigo){ const dup=await deps.findZoneByCode?.(newCode); if(dup && dup.id!==z.id) return alert('Ya existe una zona con ese codigo.'); } const contract=contractList.find(c=>c.codigo===newContractCode); await deps.updateZone?.(z.id,{ codigo:newCode, nombre:newName, contratoCodigo:newContractCode, contratoNombre:contract?.nombre||null, clienteNombreSnapshot:contract?.clienteNombre||null, clienteNitSnapshot:contract?.clienteNit||null }); await deps.addAuditLog?.({ targetType:'zone', targetId:z.id, action:'update_zone', before:{ codigo:z.codigo, nombre:z.nombre, contratoCodigo:z.contratoCodigo }, after:{ codigo:newCode, nombre:newName, contratoCodigo:newContractCode }, note: modal.values.detail||null }); }catch(e){ alert('Error: '+(e?.message||e)); } }
  function recordCard(item,{title,subtitle,meta=[],actions}){ return el('article',{className:'record-card'},[ el('div',{className:'record-card__header'},[ el('div',{className:'record-card__identity'},[ el('strong',{className:'record-card__title'},[title]), el('span',{className:'record-card__subtitle'},[subtitle]) ]), statusBadge(item.estado) ]), el('dl',{className:'record-card__meta'},meta.map(([label,value])=> el('div',{className:'record-card__meta-item'},[el('dt',{},[label]),el('dd',{},[value||'-'])]))), el('div',{className:'record-card__actions'},[actions]) ]); }
  function startEdit(tr,z){ const cur={ codigo:z.codigo||'', nombre:z.nombre||'' }; const tds=tr.querySelectorAll('td'); tds[0].replaceChildren(el('input',{className:'input',value:cur.codigo,style:'max-width:160px'})); tds[1].replaceChildren(el('input',{className:'input',value:cur.nombre,style:'max-width:260px'})); tds[2].replaceChildren(statusBadge(z.estado));
    const box=el('div',{className:'row-actions'},[]); const btnSave=el('button',{className:'btn btn--primary'},['Guardar']); const btnCancel=el('button',{className:'btn'},['Cancelar']); btnSave.addEventListener('click',async()=>{ const newCode=tds[0].querySelector('input').value.trim(); const newName=tds[1].querySelector('input').value.trim(); if(!newCode||!newName) return alert('Completa codigo y nombre.'); const modal=await showActionModal({ title:'Confirmar modificacion', message:`Zona: ${z.nombre||'-'}`, confirmText:'Guardar cambios', fields:[{ id:'detail', label:'Detalle de la modificacion', type:'textarea', required:true, placeholder:'Describe brevemente el cambio realizado' }] }); if(!modal.confirmed) return; try{ if(newCode!==z.codigo){ const dup=await deps.findZoneByCode?.(newCode); if(dup && dup.id!==z.id) return alert('Ya existe una zona con ese codigo.'); } await deps.updateZone?.(z.id,{ codigo:newCode, nombre:newName }); await deps.addAuditLog?.({ targetType:'zone', targetId:z.id, action:'update_zone', before:{ codigo:z.codigo, nombre:z.nombre }, after:{ codigo:newCode, nombre:newName }, note: modal.values.detail||null }); }catch(e){ alert('Error: '+(e?.message||e)); } }); btnCancel.addEventListener('click',()=> render()); box.append(btnSave,btnCancel); tds[3].replaceChildren(box); }
  const unContracts=deps.streamContracts?.((arr)=>{ contractList=arr||[];  paginator.reset(); render(); }) || (()=>{});
  const un=deps.streamZones?.((arr)=>{ snapshot=arr||[]; render(); });
  qs('#txtSearch',ui).addEventListener('input',()=>{ paginator.reset(); render(); });
  qs('#selStatus',ui).addEventListener('change',()=>{ paginator.reset(); render(); });
  initSorting();
  mount.replaceChildren(ui);
  const unSelectedContract=subscribe('selectedContractCode',()=>{ closeActionModal();  paginator.reset(); render(); });
  return ()=>{ closeActionModal(); un?.(); unContracts?.(); unSelectedContract?.(); };
};
