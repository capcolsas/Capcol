export function visitToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function assignmentVisitStatus(assignment, visits, cycle, today = visitToday()) {
  const records = visits.filter(visit => visit.assignment_id === assignment.id && visit.submitted_at);
  if (records.some(visit => visit.status === 'valid')) return 'completed';
  if (records.some(visit => visit.status === 'review')) return 'review';
  return cycle?.ends_on < today ? 'overdue' : 'pending';
}
export const VISIT_STATUS = { completed: 'Cumplida', review: 'En revisión', overdue: 'Incumplida', pending: 'Pendiente', valid: 'Válida', rejected: 'Rechazada', draft: 'Borrador' };
