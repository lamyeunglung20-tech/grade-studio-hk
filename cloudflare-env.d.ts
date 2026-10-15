declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    FIREBASE_PROJECT_ID?: string;
    FIREBASE_API_KEY?: string;
    FIREBASE_APP_ID?: string;
    FIREBASE_AUTH_DOMAIN?: string;
  }
}
