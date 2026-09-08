declare namespace Cloudflare {
  interface Env { DB: D1Database; FILES: R2Bucket; OPENFDA_API_KEY?: string; IMPORT_TOKEN?: string; IMPORT_DATABASE_LIMIT_BYTES?: string; IMPORT_ARCHIVE_LIMIT_BYTES?: string; }
}
