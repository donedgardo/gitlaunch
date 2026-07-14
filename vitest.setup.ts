// Provide a deterministic encryption key for tests. Production/dev boot fails
// closed when ENCRYPTION_KEY is missing (see assertEncryptionKey), and the
// integration tests build the real app via createAppServer, so a key must be
// present here. Only set it when the environment hasn't already supplied one.
if (!process.env.ENCRYPTION_KEY) {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
}
