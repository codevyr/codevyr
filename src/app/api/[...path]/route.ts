import { NextRequest } from 'next/server';

// The backend container hostname, overridable via env
const API_HOST = process.env.API_HOST || 'http://askld:8080';

async function proxy(req: NextRequest, path: string[]) {
    // Print API_HOST for debugging
    console.log(`Proxying request to API host: ${API_HOST}`);
    // Construct target URL
    const url = `${API_HOST}/${path.join('/')}${req.nextUrl.search}`;

    // Forward method, headers, and body
    const init: RequestInit = {
        method: req.method,
        headers: Object.fromEntries(req.headers),
        body: req.method === 'GET' || req.method === 'HEAD'
            ? undefined
            : await req.arrayBuffer(),
    };

    const resp = await fetch(url, init);

    // Return response as-is
    return new Response(resp.body, {
        status: resp.status,
        headers: resp.headers,
    });
}

// Re-export for each HTTP verb
export const GET = (req: NextRequest, ctx: { params: { path: string[] } }) =>
    proxy(req, ctx.params.path);

export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
