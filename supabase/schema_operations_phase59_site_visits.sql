-- Apply after phase 58. Private evidence and server-validated, immutable submissions.
begin;
create table public.visit_settings (
 contrato_codigo text primary key references public.contracts(codigo),
 frequency text not null check(frequency in ('weekly','fortnightly','monthly')),
 starts_on date not null, enabled boolean not null default true,
 radius_m integer not null default 200 check(radius_m between 20 and 2000),
 accuracy_m integer not null default 100 check(accuracy_m between 5 and 500),
 updated_at timestamptz not null default now(), updated_by uuid not null default auth.uid(),
 check(frequency <> 'monthly' or extract(day from starts_on)=1)
);
create table public.visit_cycles (
 id uuid primary key default gen_random_uuid(), contrato_codigo text not null references public.contracts(codigo),
 contract_name text not null, starts_on date not null, ends_on date not null,
 radius_m integer not null, accuracy_m integer not null,
 created_at timestamptz not null default now(), unique(contrato_codigo,starts_on), check(ends_on>=starts_on)
);
create table public.visit_assignments (
 id uuid primary key default gen_random_uuid(), cycle_id uuid not null references public.visit_cycles(id),
 contrato_codigo text not null, sede_codigo text not null, sede_name text not null, zone_code text,
 supervisor_id uuid, supervisor_name text not null, latitude double precision, longitude double precision,
 unique(cycle_id,sede_codigo,supervisor_id)
);
create table public.site_visits (
 id uuid primary key, assignment_id uuid not null references public.visit_assignments(id),
 created_by uuid not null default auth.uid(), started_at timestamptz not null default now(),
 latitude double precision not null, longitude double precision not null, accuracy_m double precision not null,
 distance_m double precision, gps_issue text not null default '',
 status text not null default 'draft' check(status in ('draft','valid','review','rejected')),
 has_findings boolean, findings text not null default '', recommendations text not null default '', observations text not null default '',
 photos text[] not null default '{}', submitted_at timestamptz,
 reviewed_by uuid, reviewed_at timestamptz, review_note text,
 check(latitude between -90 and 90 and longitude between -180 and 180 and accuracy_m between 0 and 100000)
);
create index visit_assignments_supervisor on public.visit_assignments(supervisor_id,cycle_id);
create index site_visits_assignment on public.site_visits(assignment_id,submitted_at);

create function public.visit_admin(p_contract text) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(public.can_read_contract_data(p_contract) and public.current_profile_has_permission('editContracts','editContracts'),false)
$$;
create function public.visit_active_user() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles where id=auth.uid() and estado='activo')
$$;
create function public.visit_assignment_read(p_assignment uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from visit_assignments a where a.id=p_assignment and
 (visit_admin(a.contrato_codigo) or (a.supervisor_id=auth.uid() and visit_active_user())))
$$;
create function public.visit_period_end(p_start date,p_frequency text) returns date language plpgsql immutable set search_path=public as $$
begin
 if p_frequency='weekly' then return p_start+6;
 elsif p_frequency='fortnightly' then return p_start+13;
 elsif p_frequency='monthly' then return (date_trunc('month',p_start)+interval '1 month - 1 day')::date;
 else raise exception 'Frecuencia inválida'; end if;
end $$;

-- Called on module load, at schedule creation, and BEFORE assignment changes.
-- Backfill sees the assignment state that existed before each change, never new assignments for old cycles.
create function public.visit_sync_cycles() returns void language plpgsql security definer set search_path=public as $$
declare s visit_settings; d date; e date; cid uuid; today date := (now() at time zone 'America/Bogota')::date;
begin
 perform pg_advisory_xact_lock(590059);
 for s in select vs.* from visit_settings vs join contracts c on c.codigo=vs.contrato_codigo where vs.enabled and c.estado='activo' loop
   select coalesce(max(ends_on)+1,s.starts_on) into d from visit_cycles where contrato_codigo=s.contrato_codigo;
   while d<=today loop
     e := visit_period_end(d,s.frequency);
     insert into visit_cycles(contrato_codigo,contract_name,starts_on,ends_on,radius_m,accuracy_m)
     select s.contrato_codigo,coalesce(nombre,codigo),d,e,s.radius_m,s.accuracy_m from contracts where codigo=s.contrato_codigo returning id into cid;
     insert into visit_assignments(cycle_id,contrato_codigo,sede_codigo,sede_name,zone_code,supervisor_id,supervisor_name,latitude,longitude)
     select cid,s.contrato_codigo,site.codigo,coalesce(site.nombre,site.codigo),site.zona_codigo,p.id,
       coalesce(to_jsonb(p)->>'nombre',p.email,'Sin supervisor'),site.qr_latitude,site.qr_longitude
     from sedes site left join profiles p on p.role::text='supervisor' and p.estado='activo' and p.supervisor_eligible=true
       and (site.zona_codigo=p.zona_codigo or site.zona_codigo=any(coalesce(p.zonas_permitidas,'{}'::text[])))
     where site.contrato_codigo=s.contrato_codigo and site.estado='activo';
     d := e+1;
   end loop;
 end loop;
end $$;
create function public.visit_before_scope_change() returns trigger language plpgsql security definer set search_path=public as $$
begin perform visit_sync_cycles(); return null; end $$;
create trigger visit_sede_snapshot before insert or update or delete on public.sedes for each statement execute function public.visit_before_scope_change();
create trigger visit_profile_snapshot before insert or update or delete on public.profiles for each statement execute function public.visit_before_scope_change();
create trigger visit_contract_snapshot before update or delete on public.contracts for each statement execute function public.visit_before_scope_change();

create function public.visit_save_settings(p_contract text,p_frequency text,p_start date,p_radius integer,p_accuracy integer) returns void
language plpgsql security definer set search_path=public as $$
declare old visit_settings; today date := (now() at time zone 'America/Bogota')::date;
begin
 if not visit_admin(p_contract) then raise exception 'Sin permiso para programar visitas'; end if;
 perform pg_advisory_xact_lock(590059);
 select * into old from visit_settings where contrato_codigo=p_contract;
 perform visit_sync_cycles();
 if exists(select 1 from visit_cycles where contrato_codigo=p_contract) and (old.frequency<>p_frequency or old.starts_on<>p_start) then
   raise exception 'El calendario ya inició. Se conservan su frecuencia y fecha; puedes ajustar los criterios GPS de los próximos ciclos.';
 end if;
 if old.contrato_codigo is null or old.starts_on<>p_start then
   if p_start < (case when p_frequency='monthly' then date_trunc('month',today)::date else today end) then raise exception 'La programación no puede iniciar en un periodo anterior'; end if;
 end if;
 insert into visit_settings(contrato_codigo,frequency,starts_on,radius_m,accuracy_m) values(p_contract,p_frequency,p_start,p_radius,p_accuracy)
 on conflict(contrato_codigo) do update set frequency=excluded.frequency,starts_on=excluded.starts_on,radius_m=excluded.radius_m,accuracy_m=excluded.accuracy_m,updated_at=now(),updated_by=auth.uid();
 perform visit_sync_cycles();
end $$;

create function public.visit_begin(p_id uuid,p_assignment uuid,p_lat double precision,p_lng double precision,p_accuracy double precision) returns uuid
language plpgsql security definer set search_path=public as $$
declare a visit_assignments; c visit_cycles; v site_visits; dist double precision; issue text := ''; today date := (now() at time zone 'America/Bogota')::date;
begin
 select * into a from visit_assignments where id=p_assignment;
 if not found or a.supervisor_id is distinct from auth.uid() or not visit_active_user() or not current_supervisor_can_read_zone(a.zone_code) then raise exception 'Sede fuera de tus asignaciones'; end if;
 select * into c from visit_cycles where id=a.cycle_id;
 if today not between c.starts_on and c.ends_on then raise exception 'El ciclo no está vigente'; end if;
 if p_lat is null or p_lng is null or p_accuracy is null or not (p_lat between -90 and 90 and p_lng between -180 and 180 and p_accuracy between 0 and 100000) or (p_lat=0 and p_lng=0) then raise exception 'GPS inválido'; end if;
 select * into v from site_visits where id=p_id;
 if found then
   if v.assignment_id<>p_assignment or v.created_by<>auth.uid() then raise exception 'Identificador ya utilizado'; end if;
   return p_id;
 end if;
 if a.latitude is null or a.longitude is null or not(a.latitude between -90 and 90 and a.longitude between -180 and 180) or (a.latitude=0 and a.longitude=0) then
   issue := 'Sede sin coordenadas válidas. ';
 else
   dist := 6371000*2*asin(sqrt(least(1.0,power(sin(radians(p_lat-a.latitude)/2),2)+cos(radians(a.latitude))*cos(radians(p_lat))*power(sin(radians(p_lng-a.longitude)/2),2))));
   if dist>c.radius_m then issue := issue || 'Fuera del radio de la sede. '; end if;
 end if;
 if p_accuracy>c.accuracy_m then issue := issue || 'Precisión GPS insuficiente. '; end if;
 insert into site_visits(id,assignment_id,latitude,longitude,accuracy_m,distance_m,gps_issue)
 values(p_id,p_assignment,p_lat,p_lng,p_accuracy,dist,trim(issue));
 return p_id;
end $$;

create function public.visit_submit(p_id uuid,p_findings boolean,p_description text,p_recommendations text,p_observations text,p_photos text[]) returns text
language plpgsql security definer set search_path=public as $$
declare v site_visits; a visit_assignments; c visit_cycles; photo text;
begin
 select * into v from site_visits where id=p_id for update;
 if not found or v.created_by is distinct from auth.uid() or not visit_active_user() then raise exception 'Sin permiso'; end if;
 if v.status<>'draft' then return v.status; end if;
 select * into a from visit_assignments where id=v.assignment_id;
 select * into c from visit_cycles where id=a.cycle_id;
 if not current_supervisor_can_read_zone(a.zone_code) then raise exception 'Tu zona asignada cambió'; end if;
 if (now() at time zone 'America/Bogota')::date not between c.starts_on and c.ends_on then raise exception 'El ciclo ya cerró'; end if;
 if now()-v.started_at>interval '30 minutes' then raise exception 'La captura GPS venció. Inicia una nueva visita.'; end if;
 if p_findings is null or (p_findings and length(trim(coalesce(p_description,'')))=0) then raise exception 'Describe las novedades encontradas'; end if;
 if greatest(length(p_description),length(p_recommendations),length(p_observations))>5000 then raise exception 'Máximo 5000 caracteres por campo'; end if;
 if coalesce(cardinality(p_photos),0) not between 1 and 6 or cardinality(p_photos)<>(select count(distinct x) from unnest(p_photos) x) then raise exception 'Adjunta entre 1 y 6 fotos diferentes'; end if;
 foreach photo in array p_photos loop
   if photo not like auth.uid()::text || '/' || p_id::text || '/%' or not exists(select 1 from storage.objects where bucket_id='visit-evidence' and name=photo) then raise exception 'Evidencia no disponible'; end if;
 end loop;
 update site_visits set status=case when gps_issue='' then 'valid' else 'review' end,has_findings=p_findings,
 findings=case when p_findings then trim(p_description) else '' end,recommendations=trim(coalesce(p_recommendations,'')),observations=trim(coalesce(p_observations,'')),photos=p_photos,submitted_at=now() where id=p_id returning status into v.status;
 return v.status;
end $$;
create function public.visit_review(p_id uuid,p_accept boolean,p_note text) returns void language plpgsql security definer set search_path=public as $$
declare v site_visits; a visit_assignments;
begin
 select * into v from site_visits where id=p_id for update;
 select * into a from visit_assignments where id=v.assignment_id;
 if not coalesce(visit_admin(a.contrato_codigo),false) then raise exception 'Sin permiso'; end if;
 if v.status<>'review' then raise exception 'La visita no está pendiente de revisión'; end if;
 if p_accept is null or length(trim(coalesce(p_note,''))) not between 1 and 5000 then raise exception 'Registra el motivo de la decisión'; end if;
 update site_visits set status=case when p_accept then 'valid' else 'rejected' end,reviewed_by=auth.uid(),reviewed_at=now(),review_note=trim(p_note) where id=p_id;
end $$;

alter table public.visit_settings enable row level security;
alter table public.visit_cycles enable row level security;
alter table public.visit_assignments enable row level security;
alter table public.site_visits enable row level security;
revoke all on public.visit_settings,public.visit_cycles,public.visit_assignments,public.site_visits from anon,authenticated;
grant select on public.visit_settings,public.visit_cycles,public.visit_assignments,public.site_visits to authenticated;
create policy visit_settings_read on public.visit_settings for select to authenticated using(visit_admin(contrato_codigo));
create policy visit_assignments_read on public.visit_assignments for select to authenticated using(visit_assignment_read(id));
create policy visit_cycles_read on public.visit_cycles for select to authenticated using(visit_admin(contrato_codigo) or exists(select 1 from visit_assignments a where a.cycle_id=visit_cycles.id and a.supervisor_id=auth.uid()));
create policy site_visits_read on public.site_visits for select to authenticated using(visit_assignment_read(assignment_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('visit-evidence','visit-evidence',false,8388608,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create function public.visit_photo_write(p_name text) returns boolean language sql stable security definer set search_path=public as $$
 select visit_active_user() and exists(select 1 from site_visits v where v.created_by=auth.uid() and v.status='draft' and now()-v.started_at<interval '30 minutes'
 and split_part(p_name,'/',1)=auth.uid()::text and split_part(p_name,'/',2)=v.id::text)
$$;
create policy visit_photo_insert on storage.objects for insert to authenticated with check(bucket_id='visit-evidence' and visit_photo_write(name));
-- No browser update/delete policy: uploaded evidence cannot race with final submission.
create policy visit_photo_read on storage.objects for select to authenticated using(bucket_id='visit-evidence' and exists(
 select 1 from public.site_visits v where v.id::text=split_part(name,'/',2) and name=any(v.photos) and public.visit_assignment_read(v.assignment_id)
));

-- No default PUBLIC execution on security-definer functions.
do $$ declare f record; begin
 for f in select oid::regprocedure sig from pg_proc where pronamespace='public'::regnamespace and proname like 'visit_%' loop
   execute format('revoke all on function %s from public,anon',f.sig);
   execute format('grant execute on function %s to authenticated',f.sig);
 end loop;
end $$;
-- Optional scheduler: sync on reads and scope changes remains available without pg_cron.
do $$ begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
   perform cron.schedule('site-visit-cycles','5 5 * * *','select public.visit_sync_cycles()');
 end if;
end $$;
commit;
