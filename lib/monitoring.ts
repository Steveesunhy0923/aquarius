/**
 * Error reporting.
 *
 * One call — `reportError(error, { area })` — for every failure worth knowing
 * about. It always logs to the console; when NEXT_PUBLIC_SENTRY_DSN is set it
 * also sends the error to Sentry. Unset (the default, and every local/dev
 * build), nothing leaves the device and the Sentry SDK is never downloaded:
 * it is a dynamic import, so it is its own chunk, fetched only once a DSN
 * says it is wanted. The app stays local-first with monitoring off.
 *
 * WHAT IS NEVER SENT. Aquarius holds people's notes, and an error report is
 * the easiest way for note text to leave a device by accident. So:
 *   • no user identity, cookies or headers;
 *   • no request or response bodies — a request body here is a note;
 *   • no console breadcrumbs — a logged value can be a document tree;
 *   • no query strings — the Supabase REST API puts search text and filter
 *     values in them;
 *   • no stack-frame variables, no session replay, no tracing.
 * What a report carries is the error, its stack, the `area`, and the click /
 * navigation / request-path trail that led to it.
 *
 * NEXT_PUBLIC_* is inlined at build time: a DSN has to be present when the
 * static export is BUILT (see .github/workflows/ci.yml), not at runtime.
 */

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? "";

/** The same failure repeats on a timer (the sync engine retries every minute);
 *  one report per window is enough. */
const REPEAT_WINDOW_MS = 5 * 60_000;

export interface ErrorContext {
  /** Where it happened, e.g. "sync", "editor.save", "render". Becomes a tag. */
  area: string;
  /** Small, non-content details (ids, counts, flags). Never note text. */
  extra?: Record<string, string | number | boolean | null | undefined>;
}

type Sentry = typeof import("@sentry/browser");

let sentry: Promise<Sentry | null> | null = null;
const lastReported = new Map<string, number>();

export const isMonitoringEnabled = (): boolean => DSN !== "";

function stripQuery(url: unknown): unknown {
  return typeof url === "string" ? url.split(/[?#]/, 1)[0] : url;
}

function loadSentry(): Promise<Sentry | null> {
  if (!DSN || typeof window === "undefined") return Promise.resolve(null);
  sentry ??= import("@sentry/browser")
    .then((S) => {
      S.init({
        dsn: DSN,
        environment: process.env.NODE_ENV,
        // No tracing — and no `sentry-trace` / `baggage` headers bolted onto
        // the app's own requests, which Supabase's CORS policy would reject.
        tracePropagationTargets: [],
        // EVERYTHING OFF, EXPLICITLY. In this SDK generation collection is
        // opt-OUT: user info, cookies, headers, query params, request and
        // response BODIES and stack-frame variables are all sent unless
        // refused here. An outgoing request body in this app is a note.
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: false,
          httpBodies: [],
          urlQueryParams: false,
          graphQL: { document: false, variables: false },
          genAI: { inputs: false, outputs: false },
          mcp: { inputs: false, outputs: false },
          databaseQueryData: false,
          queues: false,
          stackFrameVariables: false,
        },
        beforeBreadcrumb(crumb) {
          if (crumb.category === "console") return null;
          if (crumb.data && "url" in crumb.data) crumb.data.url = stripQuery(crumb.data.url);
          return crumb;
        },
        beforeSend(event) {
          if (event.request?.url) event.request.url = stripQuery(event.request.url) as string;
          delete event.request?.query_string;
          return event;
        },
      });
      return S;
    })
    .catch(() => null); // blocked by an extension, offline, … — stay console-only
  return sentry;
}

const toError = (e: unknown): Error => {
  if (e instanceof Error) return e;
  const message =
    typeof e === "string" ? e : String((e as { message?: unknown })?.message ?? "Unknown error");
  return new Error(message);
};

/**
 * Start monitoring: installs Sentry's handlers for uncaught errors and
 * unhandled promise rejections. A no-op without a DSN — the browser already
 * prints those to the console. Safe to call more than once.
 */
export function initMonitoring(): void {
  void loadSentry();
}

/** Record a handled failure. Never throws. */
export function reportError(error: unknown, context: ErrorContext): void {
  const err = toError(error);
  console.error(`[${context.area}]`, error, context.extra ?? "");
  if (!DSN) return;

  const key = `${context.area}:${err.message}`;
  const now = Date.now();
  if (now - (lastReported.get(key) ?? -Infinity) < REPEAT_WINDOW_MS) return;
  lastReported.set(key, now);
  if (lastReported.size > 200) lastReported.clear(); // bounded; worst case is a repeat

  void loadSentry().then((S) => {
    S?.captureException(err, { tags: { area: context.area }, extra: context.extra });
  });
}
