import { el, qs } from '../utils/dom.js';
import { createTablePagination } from '../utils/pagination.js';
import { can, PERMS } from '../permissions.js';
import { downloadCsv, parseDelimitedRows } from '../utils/csv.js';

export const CargueMasivoSedesAdmin=(mount,deps={})=>{
  const canImport = can(PERMS.BULK_UPLOAD_SEDES);
  const ui=el('section',{className:'main-card'},[
    el('h2',{},['Cargue masivo de sedes']),
    el('p',{className:'text-muted mt-2'},['Columnas esperadas: nombre sede, contrato codigo, dependencia codigo, zona codigo, nro operarios, jornada, qr, latitud qr, longitud qr, radio qr. El codigo de sede se genera automaticamente. Jornada valida: lun_vie, lun_sab o lun_dom.']),
    el('div',{className:'form-row mt-2'},[
      el('button',{id:'btnTemplate',className:'btn',type:'button'},['Descargar plantilla CSV']),
      el('input',{id:'fileInput',className:'input',type:'file',accept:'.csv,.xls,.xlsx'}),
      el('button',{id:'btnValidate',className:'btn btn--primary'},['Validar archivo']),
      el('button',{id:'btnImport',className:'btn',disabled:true,title:canImport?'':'Modo consulta: no puedes importar sedes.'},['Importar sedes']),
      el('span',{id:'msg',className:'text-muted'},[' '])
    ]),
    el('div',{className:'divider'}),
    el('div',{className:'form-row'},[
      el('div',{},[ el('label',{className:'label'},['Filas leidas']), el('input',{id:'sumRows',className:'input',disabled:true}) ]),
      el('div',{},[ el('label',{className:'label'},['Validas']), el('input',{id:'sumOk',className:'input',disabled:true}) ]),
      el('div',{},[ el('label',{className:'label'},['Errores']), el('input',{id:'sumErr',className:'input',disabled:true}) ])
    ]),
    el('div',{className:'responsive-records mt-2'},[
      el('div',{className:'table-wrap responsive-table-view'},[
        el('table',{className:'table',id:'tblPreview'},[
          el('thead',{},[ el('tr',{},[
            el('th',{},['Nombre sede']),
            el('th',{},['Contrato codigo']),
            el('th',{},['Dependencia codigo']),
            el('th',{},['Zona codigo']),
            el('th',{},['Dependencia']),
            el('th',{},['Zona']),
            el('th',{},['Nro operarios']),
            el('th',{},['Jornada']),
            el('th',{},['QR']),
            el('th',{},['Latitud de la sede']),
            el('th',{},['Longitud de la sede']),
            el('th',{},['Radio QR']),
            el('th',{},['Estado'])
          ]) ]),
          el('tbody',{})
        ])
      ]),
      el('div',{id:'bulkSedePreviewCards',className:'record-card-list'},[])
    ]),
    el('div',{className:'responsive-records mt-2'},[
      el('div',{className:'table-wrap responsive-table-view'},[
        el('table',{className:'table',id:'tblErrors'},[
          el('thead',{},[ el('tr',{},[ el('th',{},['Fila']), el('th',{},['Error']) ]) ]),
          el('tbody',{})
        ])
      ]),
      el('div',{id:'bulkSedeErrorCards',className:'record-card-list'},[])
    ])
  ]);

  const msg=qs('#msg',ui);
  const btnImport=qs('#btnImport',ui);
  const fileInput=qs('#fileInput',ui);
  const btnTemplate=qs('#btnTemplate',ui);
  let sedes=[]; let contracts=[]; let depsList=[]; let zones=[];
  let validRows=[];
  let previewRows=[];
  let errorRows=[];
  const previewCards=qs('#bulkSedePreviewCards',ui);
  const errorCards=qs('#bulkSedeErrorCards',ui);
  const previewPaginator=createTablePagination(ui,{id:'bulkSedesPreview',after:'#bulkSedePreviewCards',onChange:()=> renderPreview()});
  const errorsPaginator=createTablePagination(ui,{id:'bulkSedesErrors',after:'#bulkSedeErrorCards',onChange:()=> renderErrors()});

  const unSedes=deps.streamSedes?.((arr)=>{ sedes=arr||[]; });
  const unContracts=deps.streamContracts?.((arr)=>{ contracts=arr||[]; });
  const unDeps=deps.streamDependencies?.((arr)=>{ depsList=arr||[]; });
  const unZones=deps.streamZones?.((arr)=>{ zones=arr||[]; });

  qs('#btnValidate',ui).addEventListener('click',async()=>{
    msg.textContent='Validando archivo...';
    btnImport.disabled=true;
    validRows=[];
    try{
      const file=fileInput.files?.[0];
      if(!file){ msg.textContent='Selecciona un archivo CSV/XLS/XLSX.'; return; }
      const rows=await readInputFile(file);
      const result=validateRows(rows, sedes, contracts, depsList, zones);
      renderSummary(result.rows.length, result.valid.length, result.errors.length);
      renderPreview(result.preview);
      renderErrors(result.errors);
      validRows=result.valid;
      btnImport.disabled=!canImport || result.valid.length===0;
      msg.textContent=result.errors.length
        ? 'Validacion finalizada con errores.'
        : canImport ? 'Archivo valido. Puedes importar.' : 'Archivo valido. Modo consulta: no tienes permiso para importar.';
    }catch(e){
      msg.textContent='Error: '+(e?.message||e);
    }
  });

  btnImport.addEventListener('click',async()=>{
    if(!canImport){ msg.textContent='No tienes permiso para importar sedes.'; return; }
    if(!validRows.length){ msg.textContent='No hay filas validas para importar.'; return; }
    btnImport.disabled=true;
    msg.textContent='Importando sedes...';
    try{
      const out=await deps.createSedesBulk?.(validRows);
      await deps.addAuditLog?.({
        targetType:'sede',
        action:'bulk_create_sedes',
        after:{ total: out?.created||validRows.length }
      });
      msg.textContent=`Importacion completada. Creadas: ${out?.created||validRows.length}`;
      validRows=[];
    }catch(e){
      msg.textContent='Error al importar: '+(e?.message||e);
      btnImport.disabled=false;
    }
  });

  btnTemplate.addEventListener('click',()=>{
    const headers=['nombre sede','contrato codigo','dependencia codigo','zona codigo','nro operarios','jornada','qr','latitud qr','longitud qr','radio qr'];
    const sampleA=['Sede Norte','CON-0001','DEP-0001','ZON-0001','12','lun_vie','no','','','200'];
    const sampleB=['Sede Centro','CON-0001','DEP-0002','ZON-0002','18','lun_sab','si','6.244203','-75.581212','200'];
    downloadCsv('plantilla_sedes.csv',[headers,sampleA,sampleB]);
  });

  function renderSummary(total, ok, err){
    qs('#sumRows',ui).value=String(total||0);
    qs('#sumOk',ui).value=String(ok||0);
    qs('#sumErr',ui).value=String(err||0);
  }

  function renderPreview(rows){
    if(Array.isArray(rows)){
      previewRows=rows;
      previewPaginator.reset();
    }
    const tb=qs('#tblPreview tbody',ui);
    const pageRows=previewPaginator.slice(previewRows);
    tb.replaceChildren(...pageRows.map(r=>el('tr',{},[
      el('td',{},[r.nombre||'-']),
      el('td',{},[r.contratoCodigo||'-']),
      el('td',{},[r.dependenciaCodigo||'-']),
      el('td',{},[r.zonaCodigo||'-']),
      el('td',{},[r.dependenciaNombre||'-']),
      el('td',{},[r.zonaNombre||'-']),
      el('td',{},[String(r.numeroOperarios??'-')]),
      el('td',{},[r.jornada||'-']),
      el('td',{},[r.qrEnabled===true?'Activo':'Inactivo']),
      el('td',{},[formatOptionalNumber(r.qrLatitude)]),
      el('td',{},[formatOptionalNumber(r.qrLongitude)]),
      el('td',{},[String(r.qrRadiusMeters??200)]),
      el('td',{},[r.ok? 'OK':'ERROR'])
    ])));
    previewCards.replaceChildren(...(pageRows.length ? pageRows.map((r)=> previewCard(r)) : [el('p',{className:'text-muted record-card__empty'},['Sin filas para previsualizar.'])]));
  }

  function renderErrors(errors){
    if(Array.isArray(errors)){
      errorRows=errors;
      errorsPaginator.reset();
    }
    const tb=qs('#tblErrors tbody',ui);
    const pageRows=errorsPaginator.slice(errorRows);
    tb.replaceChildren(...pageRows.map(err=>el('tr',{},[
      el('td',{},[String(err.row)]),
      el('td',{},[err.message||'Error'])
    ])));
    errorCards.replaceChildren(...(pageRows.length ? pageRows.map((err)=> errorCard(err)) : [el('p',{className:'text-muted record-card__empty'},['Sin errores para mostrar.'])]));
  }

  function previewCard(row){
    return el('article',{className:'record-card'},[
      el('div',{className:'record-card__header'},[
        el('div',{className:'record-card__identity'},[
          el('strong',{className:'record-card__title'},[row.nombre||'-']),
          el('span',{className:'record-card__subtitle'},[`Dependencia: ${row.dependenciaCodigo||'-'}`])
        ]),
        el('span',{className:`badge ${row.ok?'badge--ok':'badge--off'}`},[row.ok?'OK':'ERROR'])
      ]),
      el('dl',{className:'record-card__meta'},[
        ['Dependencia',row.dependenciaNombre||row.dependenciaCodigo||'-'],
        ['Contrato',row.contratoNombre||row.contratoCodigo||'-'],
        ['Zona',row.zonaNombre||row.zonaCodigo||'-'],
        ['Operarios',String(row.numeroOperarios??'-')],
        ['Jornada',row.jornada||'-'],
        ['QR',row.qrEnabled===true?'Activo':'Inactivo'],
        ['Ubicacion de la sede',`${formatOptionalNumber(row.qrLatitude)}, ${formatOptionalNumber(row.qrLongitude)} (${String(row.qrRadiusMeters??200)} m)`]
      ].map(([label,value])=> el('div',{className:'record-card__meta-item'},[
        el('dt',{},[label]),
        el('dd',{},[value||'-'])
      ])))
    ]);
  }

  function errorCard(err){
    return el('article',{className:'record-card'},[
      el('div',{className:'record-card__header'},[
        el('div',{className:'record-card__identity'},[
          el('strong',{className:'record-card__title'},[`Fila ${String(err.row||'-')}`]),
          el('span',{className:'record-card__subtitle'},['Validacion'])
        ]),
        el('span',{className:'badge badge--off'},['Error'])
      ]),
      el('dl',{className:'record-card__meta'},[
        ['Detalle',err.message||'Error']
      ].map(([label,value])=> el('div',{className:'record-card__meta-item'},[
        el('dt',{},[label]),
        el('dd',{},[value||'-'])
      ])))
    ]);
  }

  function validateRows(rows, sedesList, contractList, dependencies, zoneList){
    const existingNames=new Set((sedesList||[]).map(s=> String(s.nombre||'').trim().toLowerCase()).filter(Boolean));
    const localNames=new Set();
    const contractByCode=new Map((contractList||[]).map(c=> [String(c.codigo||'').trim().toLowerCase(), c]));
    const depByCode=new Map((dependencies||[]).map(d=> [String(d.codigo||'').trim().toLowerCase(), d]));
    const zoneByCode=new Map((zoneList||[]).map(z=> [String(z.codigo||'').trim().toLowerCase(), z]));
    const errors=[]; const valid=[]; const preview=[];

    rows.forEach((raw,idx)=>{
      const rowNum=idx+2;
      const nombre=String(raw.nombre||raw.sede||'').trim();
      const contractCode=String(raw.contratoCodigo||raw.contrato||'').trim().toLowerCase();
      const depCode=String(raw.dependenciaCodigo||raw.dependencia||'').trim().toLowerCase();
      const zoneCode=String(raw.zonaCodigo||raw.zona||'').trim().toLowerCase();
      const ops=Number(String(raw.numeroOperarios||raw.operarios||'').trim());
      const jornada=String(raw.jornada||raw.horario||'lun_vie').trim().toLowerCase();
      const qrEnabled=parseBooleanFlag(raw.qrEnabled ?? raw.qr ?? raw.qrActivo ?? raw.qr_activo, false);
      const qrLatitude=parseOptionalNumber(raw.qrLatitude ?? raw.latitudQr ?? raw.latitud_qr ?? raw.latitud);
      const qrLongitude=parseOptionalNumber(raw.qrLongitude ?? raw.longitudQr ?? raw.longitud_qr ?? raw.longitud);
      const qrRadiusMeters=parsePositiveInteger(raw.qrRadiusMeters ?? raw.radioQr ?? raw.radio_qr ?? raw.radio, 200);
      const issues=[];
      if(!nombre) issues.push('Nombre sede requerido.');
      if(!contractCode) issues.push('Contrato codigo requerido.');
      if(!depCode) issues.push('Dependencia codigo requerida.');
      if(!zoneCode) issues.push('Zona codigo requerida.');
      if(!Number.isFinite(ops) || ops<0 || !Number.isInteger(ops)) issues.push('Nro operarios invalido.');
      if(!['lun_vie','lun_sab','lun_dom'].includes(jornada)) issues.push('Jornada invalida (use: lun_vie, lun_sab o lun_dom).');
      if(qrEnabled && (!Number.isFinite(qrLatitude) || !Number.isFinite(qrLongitude))) issues.push('Para activar QR debes informar latitud qr y longitud qr.');
      if(!Number.isFinite(qrRadiusMeters) || qrRadiusMeters<1 || !Number.isInteger(qrRadiusMeters)) issues.push('Radio QR invalido.');
      const contract=contractByCode.get(contractCode);
      const dep=depByCode.get(depCode);
      const zone=zoneByCode.get(zoneCode);
      if(contractCode && !contract) issues.push(`Contrato no existe: ${contractCode}`);
      if(depCode && !dep) issues.push(`Dependencia no existe: ${depCode}`);
      if(zoneCode && !zone) issues.push(`Zona no existe: ${zoneCode}`);
      if(contract && dep?.contratoCodigo && dep.contratoCodigo!==contract.codigo) issues.push('La dependencia pertenece a otro contrato.');
      if(contract && zone?.contratoCodigo && zone.contratoCodigo!==contract.codigo) issues.push('La zona pertenece a otro contrato.');
      const key=nombre.toLowerCase();
      if(key && existingNames.has(key)) issues.push('Sede ya existe.');
      if(key && localNames.has(key)) issues.push('Sede duplicada en archivo.');
      if(key) localNames.add(key);

      if(issues.length){
        errors.push({ row:rowNum, message: issues.join(' ') });
        preview.push({ nombre, contratoCodigo:raw.contratoCodigo||raw.contrato||'', contratoNombre:contract?.nombre||'', dependenciaCodigo:raw.dependenciaCodigo||raw.dependencia||'', zonaCodigo:raw.zonaCodigo||raw.zona||'', dependenciaNombre:dep?.nombre||'', zonaNombre:zone?.nombre||'', numeroOperarios:ops, jornada, qrEnabled, qrLatitude, qrLongitude, qrRadiusMeters, ok:false });
        return;
      }

      valid.push({
        nombre,
        contratoCodigo:contract.codigo,
        contratoNombre:contract.nombre,
        clienteNombreSnapshot:contract.clienteNombre,
        clienteNitSnapshot:contract.clienteNit,
        dependenciaCodigo:dep.codigo,
        dependenciaNombre:dep.nombre,
        zonaCodigo:zone.codigo,
        zonaNombre:zone.nombre,
        numeroOperarios:ops,
        jornada,
        qrEnabled,
        qrLatitude,
        qrLongitude,
        qrRadiusMeters
      });
      preview.push({ nombre, contratoCodigo:contract.codigo, contratoNombre:contract.nombre, dependenciaCodigo:dep.codigo, zonaCodigo:zone.codigo, dependenciaNombre:dep.nombre, zonaNombre:zone.nombre, numeroOperarios:ops, jornada, qrEnabled, qrLatitude, qrLongitude, qrRadiusMeters, ok:true });
    });
    return { rows, valid, errors, preview };
  }

  async function readInputFile(file){
    const name=(file.name||'').toLowerCase();
    if(name.endsWith('.csv')) return parseCSVRows(await file.text());
    if(name.endsWith('.xls') || name.endsWith('.xlsx')){
      const mod=await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
      const buff=await file.arrayBuffer();
      const wb=mod.read(buff, { type:'array' });
      const first=wb.SheetNames[0];
      const ws=wb.Sheets[first];
      const rows=mod.utils.sheet_to_json(ws,{ defval:'' });
      return rows.map(r=> normalizeInputRow(r));
    }
    throw new Error('Formato no soportado. Usa CSV/XLS/XLSX.');
  }

  function parseCSVRows(text){
    const rows=parseDelimitedRows(text);
    if(!rows.length) return [];
    const headers=rows[0].map(h=> String(h||'').trim());
    return rows.slice(1).map(cols=>{
      const obj={};
      headers.forEach((h,i)=>{ obj[h]=cols[i]??''; });
      return normalizeInputRow(obj);
    });
  }

  function normalizeInputRow(obj){
    const out={ nombre:'', contratoCodigo:'', dependenciaCodigo:'', zonaCodigo:'', numeroOperarios:'', jornada:'', qrEnabled:'', qrLatitude:'', qrLongitude:'', qrRadiusMeters:'' };
    Object.keys(obj||{}).forEach((k)=>{
      const key=String(k||'').trim().toLowerCase();
      const v=String(obj[k]??'').trim();
      if(key==='nombre sede' || key==='nombre' || key==='sede') out.nombre=v;
      if(key==='contrato codigo' || key==='contrato_codigo' || key==='contrato') out.contratoCodigo=v;
      if(key==='dependencia codigo' || key==='dependencia_codigo' || key==='dependencia') out.dependenciaCodigo=v;
      if(key==='zona codigo' || key==='zona_codigo' || key==='zona') out.zonaCodigo=v;
      if(key==='nro operarios' || key==='numero operarios' || key==='operarios') out.numeroOperarios=v;
      if(key==='jornada' || key==='horario') out.jornada=v.toLowerCase();
      if(key==='qr' || key==='qr activo' || key==='qr_activo' || key==='qr enabled' || key==='qr_enabled') out.qrEnabled=v;
      if(key==='latitud qr' || key==='latitud_qr' || key==='qr latitude' || key==='qr_latitude' || key==='latitud') out.qrLatitude=v;
      if(key==='longitud qr' || key==='longitud_qr' || key==='qr longitude' || key==='qr_longitude' || key==='longitud') out.qrLongitude=v;
      if(key==='radio qr' || key==='radio_qr' || key==='qr radius' || key==='qr_radius' || key==='qr_radius_meters' || key==='radio') out.qrRadiusMeters=v;
    });
    return out;
  }

  function parseBooleanFlag(value, fallback=false){
    const raw=String(value??'').trim().toLowerCase();
    if(!raw) return fallback;
    if(['si','sí','s','true','1','activo','activa','yes','y'].includes(raw)) return true;
    if(['no','n','false','0','inactivo','inactiva'].includes(raw)) return false;
    return fallback;
  }

  function parseOptionalNumber(value){
    const raw=String(value??'').trim().replace(',','.');
    if(!raw) return null;
    const n=Number(raw);
    return Number.isFinite(n) ? n : NaN;
  }

  function parsePositiveInteger(value,fallback=200){
    const raw=String(value??'').trim();
    if(!raw) return fallback;
    const n=Number(raw);
    return Number.isFinite(n) && Number.isInteger(n) && n>=1 ? n : NaN;
  }

  function formatOptionalNumber(value){
    return Number.isFinite(Number(value)) ? String(value) : '-';
  }

  mount.replaceChildren(ui);
  return ()=>{ unSedes?.(); unContracts?.(); unDeps?.(); unZones?.(); };
};
