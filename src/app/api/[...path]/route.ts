// src/app/api/[...path]/route.ts
import type { NextRequest } from 'next/server';

const API_HOST = process.env.API_HOST || 'http://askld:8080';

const norm = (p: unknown): string[] =>
  p == null ? [] : Array.isArray(p) ? p as string[] : [String(p)];

async function proxy(req: NextRequest, path: string[]) {
  const url = `${API_HOST}/${path.join('/')}${req.nextUrl.search}`;
  const headers = new Headers(req.headers);
  ['host','content-length','connection','accept-encoding'].forEach(h=>headers.delete(h));

  const init: RequestInit = {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
  };

  const resp = await fetch(url, init);
  return new Response(resp.body, { status: resp.status, headers: resp.headers });
}

export async function GET(req: NextRequest, ctx: RouteContext<'/api/[...path]'>) {
  const { path } = await ctx.params;          // params is a Promise in v15
  return proxy(req, norm(path));
}

export const POST = GET;
export const PUT = GET;
export const PATCH = GET;
export const DELETE = GET;
