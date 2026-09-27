import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { pendingShiftReviewItems, shiftReviewSuggestedMinutes, shiftReviewItems, shiftReviewTone, shiftReviewDecisionLabel } from '../src/assets/js/utils/shiftReview.js';

const source = await fs.readFile(new URL('../src/assets/js/components/ShiftsAdmin.js', import.meta.url),'utf8');
const row = { id:'A', nombre:'Ana', scheduledShiftId:'S', estadoTurno:'trabajado_tardio', requiresReview:true,
  entradaAt:'2026-09-25T13:15:00Z', salidaAt:'2026-09-25T22:30:00Z', lateEntryMinutes:10, lateExitMinutes:20, updatedAt:'version' };
let answers = [], calls = [], modals = [], notifications = [], reloads = 0;
const context = vm.createContext({
  canReview:true, Set, Number, String, pendingShiftReviewItems, shiftReviewSuggestedMinutes,
  reviewShiftById:new Map([['S',{startsAt:'2026-09-25T13:00:00Z',endsAt:'2026-09-25T22:00:00Z'}]]),
  employeeReviewLabel:r=>r.nombre,
  showActionModal:async options=>{modals.push(options);return answers.shift();},
  notify:(message,tone)=>notifications.push({message,tone}),
  deps:{resolveShiftReviewDecision:async data=>calls.push(data)},
  loadShiftReview:async()=>{reloads++;}
});
vm.runInContext(source.slice(source.indexOf('  async function chooseReviewCircumstance('),source.indexOf('  function shiftReviewShiftLabel(')),context);
answers=[{confirmed:true,values:{circumstance:'entrada_tardia'}},{confirmed:true,values:{minutes:'12',reason:'Descuento autorizado por supervisor'}}];
await context.authorizeShiftReviewTime(row);
assert.equal(modals[0].fields[0].options.length,2);
assert.equal(modals[1].confirmText,'Autorizar descuento');
assert.equal(modals[1].fields[0].value,'15','suggestion uses actual elapsed minutes');
assert.equal(calls[0].effect,'deduction');
assert.equal(calls[0].minutes,12);
assert.equal(calls[0].circumstance,'entrada_tardia');
assert.equal(calls[0].expectedUpdatedAt,'version');

const partial={...row,reviewDecisions:{entrada_tardia:{effect:'deduction',minutes:12,reason:'Autorizado'}}};
answers=[{confirmed:true,values:{reason:'Salida justificada sin tiempo adicional'}}];
modals=[];
await context.resolveShiftReview(partial);
assert.equal(modals.length,1,'only remaining circumstance needs no selection step');
assert.equal(modals[0].confirmText,'Aprobar sin ajuste');
assert(!modals[0].fields.some(f=>f.id==='minutes'));
assert.equal(calls[1].effect,'none');
assert.equal(calls[1].minutes,0);
assert.equal(calls[1].circumstance,'salida_tardia');

answers=[{confirmed:true,values:{minutes:'25',reason:'Entrega de turno'}}];
modals=[];
await context.authorizeShiftReviewTime(partial);
assert.equal(modals[0].confirmText,'Autorizar adicion');
assert.equal(calls[2].effect,'addition');
assert.equal(calls[2].minutes,25);
answers=[{confirmed:true,values:{minutes:'2.5',reason:'No valido'}}];
await context.authorizeShiftReviewTime(partial);
assert.equal(calls.length,3,'fractional minutes are rejected');
answers=[{confirmed:false}];
await context.authorizeShiftReviewTime(partial);
assert.equal(calls.length,3,'cancel does not persist');
assert.equal(reloads,3);

const renderContext=vm.createContext({shiftReviewItems,shiftReviewTone,shiftReviewDecisionLabel,
  shiftReviewTimeSummary:()=> '15 min · 30 min',el:(tag,props,children)=>({tag,props,children})});
vm.runInContext(source.slice(source.indexOf('  function shiftReviewColoredValues('),source.indexOf('  function shiftReviewActions(')),renderContext);
const rendered=renderContext.shiftReviewColoredValues(partial);
assert.match(rendered.children[0].children[0],/Descuento autorizado/);
assert.doesNotMatch(rendered.children[0].props.className,/--red/);
assert.match(rendered.children[2].props.className,/--orange/);
assert.equal(renderContext.shiftReviewColoredValues(partial,true).children[0].children[0],'15 min');
console.log('Shift review actions: selected circumstance, add/deduct/none, validation, cancellation, partial neutral labels and minutes-only cells passed.');
