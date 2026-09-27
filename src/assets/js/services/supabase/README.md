# Supabase services

`../../supabase.js` is kept as the public facade used by the current app entrypoints.
New code should prefer importing from a domain module in this folder when possible.

`legacy.js` contains the original monolithic implementation while behavior is migrated
in small, reviewable slices. The intended direction is:

- `client.js`: Supabase client and config validation.
- `auth.js`: authentication and profile bootstrap.
- `users.js`: users, roles, overrides, and access synchronization.
- `contracts.js`: contracts and contract access.
- `catalogs.js`: zones, dependencies, cargos, contract cargos, and novedades.
- `sedes.js`: sites and site bulk operations.
- `shifts.js`: templates, generated shifts, assignments, review, and authorizations.
- `employees.js`: employees, certificates, bulk updates, and cargo history.
- `supernumerarios.js`: replacement workers and contract coverage.
- `supervisors.js`: supervisor catalog.
- `qr.js`: QR devices and QR attendance records.
- `incapacidades.js`: incapacity records and support files.
- `operation.js`: daily operation, closures, attendance, replacements, and metrics.
