-- Inventory: apply after phase 57. All mutations are transactional RPCs.
begin;
create table public.inventory_products (
 id uuid primary key default gen_random_uuid(), contrato_codigo text not null references public.contracts(codigo),
 code text not null, name text not null, unit text not null, category text not null default '',
 kind text not null check(kind in ('consumible','bien')), minimum numeric(14,3) not null default 0 check(minimum>=0),
 created_at timestamptz not null default now(), created_by uuid not null default auth.uid(),
 unique(contrato_codigo,code), check(length(trim(code))>0 and length(trim(name))>0 and length(trim(unit))>0)
);
create table public.inventory_events (
 id uuid primary key, number bigint generated always as identity unique,
 contrato_codigo text not null references public.contracts(codigo),
 type text not null check(type in ('ingreso','borrador','despacho','recepcion','devolucion','ajuste')),
 parent_id uuid references public.inventory_events(id), data jsonb not null,
 created_at timestamptz not null default now(), created_by uuid not null default auth.uid()
);
create index inventory_events_contract on public.inventory_events(contrato_codigo,number);
create index inventory_events_parent on public.inventory_events(parent_id);
create table public.inventory_balances (
 contrato_codigo text not null references public.contracts(codigo), product_id uuid not null references public.inventory_products(id),
 location text not null, quantity numeric(14,3) not null default 0 check(quantity>=0),
 primary key(contrato_codigo,product_id,location)
);
-- Explicit new keys can be overridden in the permissions center; existing defaults are preserved.
create function public.inventory_permission(p_key text) returns boolean
language sql stable security definer set search_path=public as $$
 select public.current_profile_has_permission(p_key, case when p_key='viewInventory' then 'viewContracts' else 'editContracts' end)
$$;
do $$ declare t text; begin
 foreach t in array array['inventory_products','inventory_events','inventory_balances'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy inventory_read on public.%I for select to authenticated using (public.can_read_contract_data(contrato_codigo) and (public.inventory_permission(''viewInventory'') or public.inventory_permission(''manageInventory'') or public.inventory_permission(''dispatchInventory'') or public.inventory_permission(''receiveInventory'')))',t);
 end loop;
end $$;

create function public.inventory_product_create(p_contract text,p_data jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid; begin
 if not coalesce(public.can_read_contract_data(p_contract) and public.inventory_permission('manageInventory'),false) then raise exception 'Sin permiso'; end if;
 if coalesce((p_data->>'minimum')::numeric,0)::text in ('NaN','Infinity','-Infinity') then raise exception 'Mínimo inválido'; end if;
 insert into inventory_products(contrato_codigo,code,name,unit,category,kind,minimum)
 values(p_contract,trim(p_data->>'code'),trim(p_data->>'name'),trim(p_data->>'unit'),coalesce(p_data->>'category',''),p_data->>'kind',coalesce((p_data->>'minimum')::numeric,0)) returning id into v_id;
 return v_id;
end $$;

create function public.inventory_post(p_contract text,p_id uuid,p_type text,p_data jsonb,p_parent uuid default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare
 v_parent inventory_events; v_product inventory_products; v_line jsonb; v_lines jsonb := '[]';
 v_qty numeric; v_total numeric; v_previous numeric; v_location text; v_delta numeric;
 v_permission text; v_snapshot jsonb; v_existing inventory_events;
begin
 v_permission := case when p_type in ('borrador','despacho') then 'dispatchInventory' when p_type='recepcion' then 'receiveInventory' else 'manageInventory' end;
 if not coalesce(public.can_read_contract_data(p_contract) and public.inventory_permission(v_permission),false) then raise exception 'Sin permiso'; end if;
 -- Serialize within a contract, including retries and concurrent dispatches.
 perform 1 from contracts where codigo=p_contract for update;
 if not found then raise exception 'Contrato inexistente'; end if;
 select * into v_existing from inventory_events where id=p_id;
 if found then
   if v_existing.contrato_codigo<>p_contract or v_existing.type<>p_type or v_existing.parent_id is distinct from p_parent then raise exception 'Identificador ya utilizado'; end if;
   return p_id;
 end if;
 if p_type not in ('ingreso','borrador','despacho','recepcion','devolucion','ajuste') then raise exception 'Movimiento invalido'; end if;
 if p_parent is not null then
   select * into v_parent from inventory_events where id=p_parent and contrato_codigo=p_contract;
   if not found then raise exception 'Documento fuera del contrato'; end if;
 end if;
 if p_type='despacho' and p_parent is not null then
   if v_parent.type<>'borrador' or exists(select 1 from inventory_events where parent_id=p_parent and type='despacho') then raise exception 'Borrador ya despachado o invalido'; end if;
   p_data := v_parent.data;
 elsif p_type='devolucion' and p_parent is not null then
   if v_parent.type<>'despacho' then raise exception 'Selecciona un despacho'; end if;
   p_data:=p_data || jsonb_build_object('location',v_parent.data->>'location','site',v_parent.data->>'site');
 elsif p_type='recepcion' then
   if p_parent is null or v_parent.type<>'despacho' then raise exception 'Selecciona un despacho'; end if;
   if not exists(select 1 from jsonb_array_elements(v_parent.data->'lines') x where
     (x->>'quantity')::numeric > coalesce((select sum((y->>'quantity')::numeric) from inventory_events e cross join lateral jsonb_array_elements(e.data->'lines') y where e.parent_id=p_parent and e.type in ('recepcion','devolucion') and y->>'product'=x->>'product'),0)) then raise exception 'El despacho no tiene cantidades pendientes'; end if;
   if coalesce(p_data->>'receiver','')='' or coalesce(p_data->>'document','')='' or coalesce(p_data->>'position','')='' or coalesce((p_data->>'accepted')::boolean,false) is not true
      or coalesce(p_data->>'signature','') !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' or length(p_data->>'signature') not between 200 and 500000
      or coalesce(p_data->>'result','') not in ('satisfaccion','novedades','rechazado') then raise exception 'Completa receptor, conformidad y firma'; end if;
   if p_data->>'result'<>'satisfaccion' and length(trim(coalesce(p_data->>'notes','')))=0 then raise exception 'Describe la novedad'; end if;
 elsif p_parent is not null then raise exception 'Referencia invalida';
 end if;
 if p_type in ('ingreso','ajuste','devolucion') and length(trim(coalesce(p_data->>'reference','')))=0 then raise exception 'Indica factura o motivo'; end if;
 if p_type='ingreso' and length(trim(coalesce(p_data->>'supplier','')))=0 then raise exception 'Indica proveedor'; end if;
 if p_type='ingreso' then
   p_data:=p_data || jsonb_build_object('date',coalesce(nullif(p_data->>'date','')::date,(now() at time zone 'America/Bogota')::date));
 end if;
 if p_type in ('borrador','despacho') then
   if not exists(select 1 from sedes where codigo=p_data->>'site' and contrato_codigo=p_contract and estado='activo') then raise exception 'Sede fuera del contrato o inactiva'; end if;
   if length(trim(coalesce(p_data->>'recipient','')))=0 then raise exception 'Indica destinatario'; end if;
 end if;
 v_location:=trim(p_data->>'location');
 if p_type<>'recepcion' and coalesce(v_location,'')='' then raise exception 'Indica ubicacion de almacenamiento'; end if;
 if jsonb_typeof(p_data->'lines') is distinct from 'array' then raise exception 'Agrega productos'; end if;
 if jsonb_array_length(p_data->'lines') not between 1 and 100 then raise exception 'Agrega entre 1 y 100 productos'; end if;
 if (select count(*) from jsonb_array_elements(p_data->'lines'))<>(select count(distinct x->>'product') from jsonb_array_elements(p_data->'lines') x) then raise exception 'Producto duplicado'; end if;
 for v_line in select value from jsonb_array_elements(p_data->'lines') loop
   select * into v_product from inventory_products where id=(v_line->>'product')::uuid and contrato_codigo=p_contract;
   if not found then raise exception 'Producto fuera del contrato'; end if;
   v_qty:=(v_line->>'quantity')::numeric;
   if v_qty is null or v_qty::text in ('NaN','Infinity','-Infinity') or abs(v_qty)>99999999999 or v_qty<>round(v_qty,3)
      or (p_type='recepcion' and v_qty<0) or (p_type not in ('recepcion','ajuste') and v_qty<=0) or (p_type='ajuste' and v_qty=0) then raise exception 'Cantidad invalida'; end if;
   if p_type='ingreso' and (coalesce((v_line->>'cost')::numeric,-1)<0 or ((v_line->>'cost')::numeric)::text in ('NaN','Infinity','-Infinity')) then raise exception 'Costo invalido'; end if;
   if p_type='recepcion' or (p_type='devolucion' and p_parent is not null) then
     select (x->>'quantity')::numeric into v_total from jsonb_array_elements(v_parent.data->'lines') x where x->>'product'=v_product.id::text;
     if v_total is null then raise exception 'Producto no despachado'; end if;
     select coalesce(sum((x->>'quantity')::numeric),0) into v_previous from inventory_events e cross join lateral jsonb_array_elements(e.data->'lines') x
       where e.parent_id=p_parent and e.type in ('recepcion','devolucion') and x->>'product'=v_product.id::text;
     if v_qty>v_total-v_previous then raise exception 'Cantidad superior al pendiente'; end if;
     if p_data->>'result'='satisfaccion' and v_qty<>v_total-v_previous then raise exception 'Registra la recepción parcial como novedad'; end if;
     if p_data->>'result'='rechazado' and v_qty<>0 then raise exception 'Un rechazo no recibe unidades'; end if;
   end if;
   v_lines:=v_lines || jsonb_build_array(v_line || jsonb_build_object('code',v_product.code,'name',v_product.name,'unit',v_product.unit,'quantity',v_qty));
   if p_type in ('ingreso','despacho','devolucion','ajuste') then
     v_delta:=case when p_type='despacho' then -v_qty else v_qty end;
     insert into inventory_balances(contrato_codigo,product_id,location,quantity) values(p_contract,v_product.id,v_location,0) on conflict do nothing;
     update inventory_balances set quantity=quantity+v_delta where contrato_codigo=p_contract and product_id=v_product.id and location=v_location and quantity+v_delta>=0;
     if not found then raise exception 'Existencia insuficiente para %',v_product.name; end if;
   end if;
 end loop;
 if p_type='recepcion' and p_data->>'result'='satisfaccion' then
   if exists(select 1 from jsonb_array_elements(v_parent.data->'lines') x where
     (x->>'quantity')::numeric > coalesce((select sum((y->>'quantity')::numeric) from inventory_events e cross join lateral jsonb_array_elements(e.data->'lines') y where e.parent_id=p_parent and e.type in ('recepcion','devolucion') and y->>'product'=x->>'product'),0)
     and not exists(select 1 from jsonb_array_elements(v_lines) y where y->>'product'=x->>'product')) then raise exception 'Revisa todos los productos pendientes'; end if;
 end if;
 select jsonb_build_object('code',codigo,'name',nombre,'client',cliente_nombre,'nit',cliente_nit) into v_snapshot from contracts where codigo=p_contract;
 insert into inventory_events(id,contrato_codigo,type,parent_id,data) values(p_id,p_contract,p_type,p_parent,
   p_data || jsonb_build_object('lines',v_lines,'contract',case when p_type='recepcion' then v_parent.data->'contract' else v_snapshot end,
   'site',case when p_type='recepcion' then v_parent.data->>'site' else p_data->>'site' end,
   'consent',case when p_type='recepcion' then 'Confirmo las cantidades y el resultado registrados en esta acta y autorizo incorporar mi firma como constancia de esta recepción.' else null end));
 return p_id;
end $$;
revoke all on function public.inventory_permission(text), public.inventory_product_create(text,jsonb), public.inventory_post(text,uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.inventory_permission(text), public.inventory_product_create(text,jsonb), public.inventory_post(text,uuid,text,jsonb,uuid) to authenticated;
commit;
