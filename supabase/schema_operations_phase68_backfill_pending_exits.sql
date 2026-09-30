-- Phase 68: backfill pending-exit status for shifts closed by older logic.
-- Apply after phase 67.
--
-- Context: exit tracking (salida_at) via WhatsApp/QR is a newer feature. Any project upgrading
-- from before it existed already has employee_shift_status rows that a closure job finalized
-- with a terminal estado_turno ('trabajado', 'trabajado_tardio', 'ajustado', etc.) even though
-- entrada_at was set and salida_at was never captured, because the closure logic at the time
-- never checked for a missing exit. public.finalize_shift_attendance (phase 67) already fixes
-- this going forward by classifying such rows as 'salida_pendiente' with requires_review = true.
-- This phase applies that same, already-shipped rule retroactively to the rows closed before it
-- existed, so upgrading a project does not leave a backlog of misclassified "finished" shifts
-- that were never actually exited.

update public.employee_shift_status
set
  estado_turno = 'salida_pendiente',
  requires_review = true
where entrada_at is not null
  and salida_at is null
  and estado_turno not in ('salida_pendiente', 'post_cierre_pendiente', 'ausente_con_novedad', 'cancelado', 'programado');
