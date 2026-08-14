/**
 * Liveness endpoint for platform healthchecks.
 *
 * `/` is not suitable: the global auth middleware SSR-redirects anonymous
 * requests to /login (302), which most healthcheckers count as down.
 * Deliberately no DB ping — a transient database blip should not make the
 * platform kill and restart app instances (migrate-on-boot would only add
 * load); liveness means "the process serves HTTP".
 */
export default defineEventHandler(() => ({ status: "ok" }));
