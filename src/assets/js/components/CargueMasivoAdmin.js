import { el, qs } from '../utils/dom.js';
import { createTablePagination } from '../utils/pagination.js';
import { can, PERMS } from '../permissions.js';

export const CargueMasivoAdmin=(mount,deps={})=>{
  const canImport = can(PERMS.BULK_UPLOAD_EMPLOYEES);
  const ui=el('section',{className:'main-card'},[
    el('h2',{},['Cargue masivo de empleados']),
    el('p',{className:'text-muted mt-2'},['Columnas esperadas: documento, nombre, telefono, cargo codigo, sede codigo, fecha ingreso. Opcionales: fecha nacimiento, eps, afp, riesgo arl, camisa, pantalon, zapatos. El codigo del empleado se genera automaticamente y el telefono se guarda con prefijo 57.']),
    el('div',{className:'form-row mt-2'},[
      el('button',{id:'btnTemplate',className:'btn',type:'button'},['Descargar plantilla CSV']),
      el('input',{id:'fileInput',className:'input',type:'file',accept:'.csv,.xls,.xlsx'}),
      el('button',{id:'btnValidate',className:'btn btn--primary'},['Validar archivo']),
      el('button',{id:'btnImport',className:'btn',disabled:true,title:canImport?'':'Modo consulta: no puedes importar empleados.'},['Importar empleados']),
      el('span',{id:'msg',className:'text-muted'},[' '])
    ]),
    el('div',{id:'importProgress',className:'bulk-progress hidden','aria-live':'polite'},[
      el('div',{className:'bulk-progress__meta'},[
        el('span',{id:'progressLabel',className:'bulk-progress__label'},['Listo para importar']),
        el('span',{id:'progressNumbers',className:'bulk-progress__numbers text-muted'},['0 / 0'])
      ]),
      el('div',{className:'bulk-progress__track',role:'progressbar','aria-valuemin':'0','aria-valuemax':'100','aria-valuenow':'0','aria-label':'Progreso de importacion'},[
        el('div',{id:'progressFill',className:'bulk-progress__fill',style:'width:0%'})
      ])
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
            el('th',{},['Documento']),
            el('th',{},['Nombre']),
            el('th',{},['Telefono']),
            el('th',{},['Cargo codigo']),
            el('th',{},['Sede codigo']),
            el('th',{},['Cargo']),
            el('th',{},['Sede']),
            el('th',{},['Fecha ingreso']),
            el('th',{},['Fecha nacimiento']),
            el('th',{},['EPS']),
            el('th',{},['AFP']),
            el('th',{},['Riesgo ARL']),
            el('th',{},['Camisa']),
            el('th',{},['Pantalon']),
            el('th',{},['Zapatos']),
            el('th',{},['Estado'])
          ]) ]),
          el('tbody',{})
        ])
      ]),
      el('div',{id:'bulkEmployeePreviewCards',className:'record-card-list'},[])
    ]),
    el('div',{className:'responsive-records mt-2'},[
      el('div',{className:'table-wrap responsive-table-view'},[
        el('table',{className:'table',id:'tblErrors'},[
          el('thead',{},[ el('tr',{},[ el('th',{},['Fila']), el('th',{},['Error']) ]) ]),
          el('tbody',{})
        ])
      ]),
      el('div',{id:'bulkEmployeeErrorCards',className:'record-card-list'},[])
    ])
  ]);

  const msg=qs('#msg',ui);
  const btnImport=qs('#btnImport',ui);
  const btnValidate=qs('#btnValidate',ui);
  const fileInput=qs('#fileInput',ui);
  const btnTemplate=qs('#btnTemplate',ui);
  const progressBox=qs('#importProgress',ui);
  const progressLabel=qs('#progressLabel',ui);
  const progressNumbers=qs('#progressNumbers',ui);
  const progressFill=qs('#progressFill',ui);
  const progressTrack=ui.querySelector('.bulk-progress__track');
  let employees=[]; let cargos=[]; let sedes=[];
  let validRows=[];
  let previewRows=[];
  let errorRows=[];
  const previewCards=qs('#bulkEmployeePreviewCards',ui);
  const errorCards=qs('#bulkEmployeeErrorCards',ui);
  const previewPaginator=createTablePagination(ui,{id:'bulkEmployeesPreview',after:'#bulkEmployeePreviewCards',onChange:()=> renderPreview()});
  const errorsPaginator=createTablePagination(ui,{id:'bulkEmployeesErrors',after:'#bulkEmployeeErrorCards',onChange:()=> renderErrors()});

  const unEmp=deps.streamEmployees?.((arr)=>{ employees=arr||[]; });
  const unCargo=deps.streamCargos?.((arr)=>{ cargos=arr||[]; });
  const unSede=deps.streamSedes?.((arr)=>{ sedes=arr||[]; });

  qs('#btnValidate',ui).addEventListener('click',async()=>{
    msg.textContent='Validando archivo...';
    btnImport.disabled=true;
    validRows=[];
    try{
      const file=fileInput.files?.[0];
      if(!file){ msg.textContent='Selecciona un archivo CSV/XLS/XLSX.'; return; }
      resetProgress();
      const rows=await readInputFile(file);
      const result=validateRows(rows, employees, cargos, sedes);
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
    if(!canImport){ msg.textContent='No tienes permiso para importar empleados.'; return; }
    if(!validRows.length){ msg.textContent='No hay filas validas para importar.'; return; }
    btnImport.disabled=true;
    btnValidate.disabled=true;
    btnTemplate.disabled=true;
    fileInput.disabled=true;
    showProgress();
    updateProgress({ created:0, total:validRows.length, percent:0, phase:'preparing' });
    msg.textContent='Importando empleados...';
    try{
      const out=await deps.createEmployeesBulk?.(validRows,{
        chunkSize:250,
        onProgress:updateProgress
      });
      await deps.addAuditLog?.({
        targetType:'employee',
        action:'bulk_create_employees',
        after:{ total: out?.created||validRows.length }
      });
      msg.textContent=`Importacion completada. Creados: ${out?.created||validRows.length}`;
      updateProgress({ created:out?.created||validRows.length, total:validRows.length, percent:100, phase:'completed' });
      validRows=[];
    }catch(e){
      msg.textContent='Error al importar: '+(e?.message||e);
      btnImport.disabled=false;
      updateProgress({ created:0, total:validRows.length, percent:0, phase:'error' });
    } finally {
      btnValidate.disabled=false;
      btnTemplate.disabled=false;
      fileInput.disabled=false;
    }
  });

  btnTemplate.addEventListener('click',()=>{
    const headers=['documento','nombre','telefono','cargo codigo','sede codigo','fecha ingreso','fecha nacimiento','eps','afp','riesgo arl','camisa','pantalon','zapatos'];
    const sampleA=['10000001','Empleado ejemplo','573000000000','CAR-0001','SED-0001','2026-02-13','1990-05-10','Sura','Proteccion','1','M','32','40'];
    const sampleB=['10000002','Empleado ejemplo 2','3000000001','CAR-0002','SED-0002','2026-02-14','','','','','','',''];
    downloadCsv('plantilla_empleados.csv',[headers,sampleA,sampleB]);
  });

  function renderSummary(total, ok, err){
    qs('#sumRows',ui).value=String(total||0);
    qs('#sumOk',ui).value=String(ok||0);
    qs('#sumErr',ui).value=String(err||0);
  }

  function showProgress(){
    progressBox.classList.remove('hidden');
  }

  function resetProgress(){
    progressLabel.textContent='Listo para importar';
    progressNumbers.textContent='0 / 0';
    progressFill.style.width='0%';
    progressTrack?.setAttribute('aria-valuenow','0');
  }

  function updateProgress({ created=0, total=0, percent=0, phase='importing' } = {}){
    const labels={
      preparing:'Preparando importacion...',
      importing:'Importando empleados...',
      refreshing:'Actualizando vista...',
      completed:'Importacion completada',
      error:'Importacion interrumpida'
    };
    showProgress();
    const safePercent=Math.max(0,Math.min(100,Number(percent)||0));
    progressLabel.textContent=labels[phase]||'Importando empleados...';
    progressNumbers.textContent=`${created} / ${total}`;
    progressFill.style.width=`${safePercent}%`;
    progressTrack?.setAttribute('aria-valuenow',String(safePercent));
  }

  function renderPreview(rows){
    if(Array.isArray(rows)){
      previewRows=rows;
      previewPaginator.reset();
    }
    const tb=qs('#tblPreview tbody',ui);
    const pageRows=previewPaginator.slice(previewRows);
    tb.replaceChildren(...pageRows.map(r=>el('tr',{},[
      el('td',{},[r.documento||'-']),
      el('td',{},[r.nombre||'-']),
      el('td',{},[r.telefono||'-']),
      el('td',{},[r.cargoCodigo||'-']),
      el('td',{},[r.sedeCodigo||'-']),
      el('td',{},[r.cargoNombre||'-']),
      el('td',{},[r.sedeNombre||'-']),
      el('td',{},[r.fechaIngreso||'-']),
      el('td',{},[r.fechaNacimiento||'-']),
      el('td',{},[r.eps||'-']),
      el('td',{},[r.afp||'-']),
      el('td',{},[r.arlRiesgo||'-']),
      el('td',{},[r.dotacionCamisa||'-']),
      el('td',{},[r.dotacionPantalon||'-']),
      el('td',{},[r.dotacionZapatos||'-']),
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
          el('span',{className:'record-card__subtitle'},[`Documento: ${row.documento||'-'}`])
        ]),
        el('span',{className:`badge ${row.ok?'badge--ok':'badge--off'}`},[row.ok?'OK':'ERROR'])
      ]),
      el('dl',{className:'record-card__meta'},[
        ['Telefono',row.telefono||'-'],
        ['Cargo',row.cargoNombre||row.cargoCodigo||'-'],
        ['Sede',row.sedeNombre||row.sedeCodigo||'-'],
        ['Fecha ingreso',row.fechaIngreso||'-'],
        ['Fecha nacimiento',row.fechaNacimiento||'-'],
        ['EPS',row.eps||'-'],
        ['AFP',row.afp||'-'],
        ['Riesgo ARL',row.arlRiesgo||'-'],
        ['Camisa',row.dotacionCamisa||'-'],
        ['Pantalon',row.dotacionPantalon||'-'],
        ['Zapatos',row.dotacionZapatos||'-']
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

  function validateRows(rows, employeesList, cargosList, sedesList){
    const existingDocs=new Set((employeesList||[]).map(e=> String(e.documento||'').trim()).filter(Boolean));
    const localDocs=new Set();
    const cargoByCode=new Map((cargosList||[]).map(c=> [String(c.codigo||'').trim().toLowerCase(), c]));
    const sedeByCode=new Map((sedesList||[]).map(s=> [String(s.codigo||'').trim().toLowerCase(), s]));
    const errors=[]; const valid=[]; const preview=[];

    rows.forEach((raw,idx)=>{
      const rowNum=idx+2;
      const documento=String(raw.documento||'').trim();
      const nombre=String(raw.nombre||'').trim();
      const telefono=String(raw.telefono||'').trim();
      const cargoCode=String(raw.cargoCodigo||raw.cargo||'').trim().toLowerCase();
      const sedeCode=String(raw.sedeCodigo||raw.sede||'').trim().toLowerCase();
      const fechaIngreso=normalizeDate(raw.fechaIngreso||raw.fecha_ingreso||raw.fecha||'');
      const fechaNacimientoRaw=String(raw.fechaNacimiento||raw.fecha_nacimiento||'').trim();
      const fechaNacimiento=fechaNacimientoRaw ? normalizeDate(fechaNacimientoRaw) : '';
      const eps=String(raw.eps||'').trim();
      const afp=String(raw.afp||'').trim();
      const arlRiesgo=String(raw.arlRiesgo||raw.riesgoArl||'').trim();
      const dotacionCamisa=String(raw.dotacionCamisa||raw.camisa||'').trim();
      const dotacionPantalon=String(raw.dotacionPantalon||raw.pantalon||'').trim();
      const dotacionZapatos=String(raw.dotacionZapatos||raw.zapatos||'').trim();
      const issues=[];
      if(!documento) issues.push('Documento requerido.');
      if(!nombre) issues.push('Nombre requerido.');
      if(!telefono) issues.push('Telefono requerido.');
      if(!cargoCode) issues.push('Cargo codigo requerido.');
      if(!sedeCode) issues.push('Sede codigo requerida.');
      if(!fechaIngreso) issues.push('Fecha ingreso invalida.');
      if(fechaNacimientoRaw && !fechaNacimiento) issues.push('Fecha nacimiento invalida.');
      if(fechaNacimiento && fechaNacimiento>todayIsoDate()) issues.push('La fecha de nacimiento no puede ser futura.');
      const cargo=cargoByCode.get(cargoCode);
      const sede=sedeByCode.get(sedeCode);
      if(cargoCode && !cargo) issues.push(`Cargo no existe: ${cargoCode}`);
      if(sedeCode && !sede) issues.push(`Sede no existe: ${sedeCode}`);
      if(documento && existingDocs.has(documento)) issues.push('Documento ya existe en empleados.');
      if(documento && localDocs.has(documento)) issues.push('Documento duplicado en archivo.');
      if(documento) localDocs.add(documento);

      if(issues.length){
        errors.push({ row:rowNum, message: issues.join(' ') });
        preview.push({ documento, nombre, telefono, cargoCodigo:raw.cargoCodigo||raw.cargo||'', sedeCodigo:raw.sedeCodigo||raw.sede||'', cargoNombre:cargo?.nombre||'', sedeNombre:sede?.nombre||'', fechaIngreso, fechaNacimiento, eps, afp, arlRiesgo, dotacionCamisa, dotacionPantalon, dotacionZapatos, ok:false });
        return;
      }

      valid.push({
        documento,
        nombre,
        telefono,
        cargoCodigo:cargo.codigo,
        cargoNombre:cargo.nombre,
        sedeCodigo:sede.codigo,
        sedeNombre:sede.nombre,
        fechaIngreso: new Date(`${fechaIngreso}T00:00:00`),
        fechaNacimiento: fechaNacimiento||null,
        eps: eps||null,
        afp: afp||null,
        arlRiesgo: arlRiesgo||null,
        dotacionCamisa: dotacionCamisa||null,
        dotacionPantalon: dotacionPantalon||null,
        dotacionZapatos: dotacionZapatos||null
      });
      preview.push({ documento, nombre, telefono, cargoCodigo:cargo.codigo, sedeCodigo:sede.codigo, cargoNombre:cargo.nombre, sedeNombre:sede.nombre, fechaIngreso, fechaNacimiento, eps, afp, arlRiesgo, dotacionCamisa, dotacionPantalon, dotacionZapatos, ok:true });
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
    const rows=[]; let row=[]; let cur=''; let inQuotes=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i]; const next=text[i+1];
      if(ch==='\"'){
        if(inQuotes && next==='\"'){ cur+='\"'; i++; } else { inQuotes=!inQuotes; }
      } else if((ch===',' || ch===';' || ch==='\t') && !inQuotes){
        row.push(cur); cur='';
      } else if((ch==='\n' || ch==='\r') && !inQuotes){
        if(cur!=='' || row.length){ row.push(cur); rows.push(row); row=[]; cur=''; }
      } else {
        cur+=ch;
      }
    }
    if(cur!=='' || row.length){ row.push(cur); rows.push(row); }
    if(!rows.length) return [];
    const headers=rows[0].map(h=> String(h||'').trim());
    return rows.slice(1).map(cols=>{
      const obj={}; headers.forEach((h,i)=>{ obj[h]=cols[i]??''; }); return normalizeInputRow(obj);
    });
  }

  function normalizeInputRow(obj){
    const out={ documento:'', nombre:'', telefono:'', cargoCodigo:'', sedeCodigo:'', fechaIngreso:'', fechaNacimiento:'', eps:'', afp:'', arlRiesgo:'', dotacionCamisa:'', dotacionPantalon:'', dotacionZapatos:'' };
    Object.keys(obj||{}).forEach((k)=>{
      const key=normalizeHeaderKey(k);
      const v=String(obj[k]??'').trim();
      if(key==='documento' || key==='doc') out.documento=v;
      if(key==='nombre' || key==='nombre completo') out.nombre=v;
      if(key==='telefono' || key==='celular' || key==='numero cel') out.telefono=v;
      if(key==='cargo codigo' || key==='cargo') out.cargoCodigo=v;
      if(key==='sede codigo' || key==='sede') out.sedeCodigo=v;
      if(key==='fecha ingreso' || key==='fecha') out.fechaIngreso=v;
      if(key==='fecha nacimiento' || key==='nacimiento') out.fechaNacimiento=v;
      if(key==='eps') out.eps=v;
      if(key==='afp') out.afp=v;
      if(key==='riesgo arl' || key==='arl riesgo' || key==='arl') out.arlRiesgo=v;
      if(key==='camisa' || key==='dotacion camisa' || key==='talla camisa') out.dotacionCamisa=v;
      if(key==='pantalon' || key==='dotacion pantalon' || key==='talla pantalon') out.dotacionPantalon=v;
      if(key==='zapatos' || key==='dotacion zapatos' || key==='talla zapatos' || key==='calzado') out.dotacionZapatos=v;
    });
    return out;
  }

  function normalizeHeaderKey(value){
    return String(value||'')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'')
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g,' ')
      .replace(/\s+/g,' ');
  }

  function normalizeDate(value){
    if(typeof value==='number' && Number.isFinite(value)){
      const excelEpoch=Date.UTC(1899,11,30);
      const d=new Date(excelEpoch + Math.round(value)*86400000);
      if(!Number.isNaN(d.getTime())) return d.toISOString().slice(0,10);
    }
    const v=String(value||'').trim();
    if(!v) return '';
    if(/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const parts=v.split(/[\/\-.]/).map(p=> p.trim()).filter(Boolean);
    if(parts.length===3){
      let d=''; let m=''; let y='';
      if(parts[0].length===4){ y=parts[0]; m=parts[1]; d=parts[2]; }
      else { d=parts[0]; m=parts[1]; y=parts[2]; }
      let yy=Number(y); const dd=Number(d); const mm=Number(m);
      if(!Number.isFinite(yy)||!Number.isFinite(dd)||!Number.isFinite(mm)) return '';
      if(y.length===2) yy=2000+yy;
      if(dd<1||dd>31||mm<1||mm>12) return '';
      return `${String(yy).padStart(4,'0')}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`;
    }
    return '';
  }

  function todayIsoDate(){
    return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota'}).format(new Date());
  }

  function downloadCsv(filename, rows){
    const csv=rows.map(r=> r.map(csvCell).join(',')).join('\n');
    const blob=new Blob([csv],{ type:'text/csv;charset=utf-8;' });
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function csvCell(value){
    const v=String(value??'');
    if(v.includes(',') || v.includes('"') || v.includes('\n')) return `"${v.replace(/"/g,'""')}"`;
    return v;
  }

  mount.replaceChildren(ui);
  resetProgress();
  return ()=>{ unEmp?.(); unCargo?.(); unSede?.(); };
};
