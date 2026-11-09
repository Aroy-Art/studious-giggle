// Error and performance monitoring, session replay and metrics. Loaded in <head>
// right after the Sentry bundle so errors from every later script are captured.
(function () {
  'use strict';
  if (typeof Sentry === 'undefined') return; // blocked by an ad blocker or offline
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  Sentry.init({
    dsn: 'https://f170e850773b8db1fd13b23a5e5d9958@o4512402766495744.ingest.de.sentry.io/4512402803261520',
    environment: local ? 'development' : 'production',
    integrations: [
      Sentry.browserTracingIntegration(),
      // Replays mask all text and inputs by default, so typed keywords and answers stay hidden.
      Sentry.replayIntegration(),
    ],
    tracesSampleRate: local ? 1.0 : 0.2,
    // Record 10% of visits in full, and every visit that hits an error.
    replaysSessionSampleRate: local ? 1.0 : 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
})();
