-- Phase 47: update default attendance windows for new shift template rules.

alter table if exists public.shift_template_rules
  alter column ventana_entrada_antes_minutos set default 60,
  alter column ventana_entrada_despues_minutos set default 30,
  alter column ventana_salida_antes_minutos set default 30,
  alter column ventana_salida_despues_minutos set default 60;
