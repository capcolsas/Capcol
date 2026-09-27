import { supabase } from './client.js';

async function result(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}
async function rows(table, contract, order) {
  const all = [];
  for (let from = 0; ; from += 500) {
    let query = supabase.from(table).select('*').eq('contrato_codigo', contract).order(order);
    if (table === 'inventory_balances') query = query.order('location');
    const page = await result(query.range(from, from + 499));
    all.push(...page);
    if (page.length < 500) return all;
  }
}
export async function loadInventory(contract) {
  const [products, balances, events, sites] = await Promise.all([
    rows('inventory_products', contract, 'id'), rows('inventory_balances', contract, 'product_id'),
    rows('inventory_events', contract, 'number'), rows('sedes', contract, 'codigo')
  ]);
  return { products, balances, events, sites };
}
export function createInventoryProduct(contract, data) {
  return result(supabase.rpc('inventory_product_create', { p_contract: contract, p_data: data }));
}
export function postInventory(contract, id, type, data, parent = null) {
  return result(supabase.rpc('inventory_post', { p_contract: contract, p_id: id, p_type: type, p_data: data, p_parent: parent }));
}
