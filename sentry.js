// Error and performance monitoring. Loaded in <head> right after the Sentry
// bundle so errors from every later script are captured.
(function () {
  'use strict';
  if (typeof Sentry === 'undefined') return; // blocked by an ad blocker or offline
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  Sentry.init({
    dsn: 'https://f170e850773b8db1fd13b23a5e5d9958@o4512402766495744.ingest.de.sentry.io/4512402803261520',
    environment: local ? 'development' : 'production',
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: local ? 1.0 : 0.2,
  });
})();
