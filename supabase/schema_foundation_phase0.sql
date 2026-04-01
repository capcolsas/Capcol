-- Base minima para instancias nuevas de Supabase.
-- Varias tablas del proyecto usan gen_random_uuid().
create extension if not exists pgcrypto;
