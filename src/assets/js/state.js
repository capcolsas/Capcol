const LS_KEY='rockypro_state_allinone_v52';const listeners=new Map();const DEFAULT_STATE={user:null,userProfile:null,theme:'light',profileName:'',roleMatrix:{},userOverrides:{},selectedContractCode:'__all__'};const state={...DEFAULT_STATE,...(loadState()||{})};function loadState(){ try{const raw=localStorage.getItem(LS_KEY); return raw?JSON.parse(raw):null;}catch{return null;} }function persist(){ try{localStorage.setItem(LS_KEY, JSON.stringify(state));}catch{} }export const getState=()=>({...state});export const setState=(partial)=>{ const keys=Object.keys(partial); Object.assign(state, partial); persist(); for(const k of keys){ const fns=listeners.get(k); if(fns) fns.forEach(fn=>fn(state[k], getState())); } };export const subscribe=(key, fn)=>{ if(!listeners.has(key)) listeners.set(key,new Set()); listeners.get(key).add(fn); return ()=>listeners.get(key)?.delete(fn); };
// Migrate retired theme preferences without discarding session or contract state.
if (!['light', 'dark'].includes(state.theme)) {
  state.theme = 'light';
  persist();
}
