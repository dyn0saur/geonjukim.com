type D1Database = unknown;

interface Fetcher {
  fetch(input: Request): Promise<Response>;
}

declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
  };
}
