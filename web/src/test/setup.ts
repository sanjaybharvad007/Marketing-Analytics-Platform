// Integration tests run against TEST_DATABASE_URL, never against the
// development database. Point the app's client at it before anything imports
// "@/db/client".
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
