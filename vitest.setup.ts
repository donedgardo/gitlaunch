// Provide a deterministic encryption key for tests. Production/dev boot fails
// closed when ENCRYPTION_KEY is missing (see assertEncryptionKey), and the
// integration tests build the real app via createAppServer, so a key must be
// present here. Only set it when the environment hasn't already supplied one.
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
}

// createAppServer validates the environment through loadConfig when no config
// is injected, for the same fail-closed reason. Tests that care about a
// specific setting pass their own config; these are just the floor that lets
// the default path resolve. As above, a real environment wins.
if (!process.env.PUBLIC_URL) {
  process.env.PUBLIC_URL = "http://localhost:3050";
}
if (!process.env.MONGODB_URI) {
  process.env.MONGODB_URI = "mongodb://localhost:27017";
}
if (!process.env.COOKIE_SECRET_SIGNATURE) {
  process.env.COOKIE_SECRET_SIGNATURE = "test-cookie-secret";
}

// The PostHog singleton (src/services/observability/posthog.ts) throws on
// import outside production when unconfigured, so tests need the same floor.
if (!process.env.POSTHOG_PROJECT_TOKEN) {
  process.env.POSTHOG_PROJECT_TOKEN = "phc_test_dummy_token_for_ci";
}
if (!process.env.POSTHOG_HOST) {
  process.env.POSTHOG_HOST = "https://us.i.posthog.com";
}
