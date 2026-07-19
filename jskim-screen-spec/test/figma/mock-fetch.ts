import { buildPng } from '../reference-image/helpers.js';

export type MockRoute = {
  match: (url: string, init?: RequestInit) => boolean;
  handle: (url: string, init?: RequestInit) => Promise<Response> | Response;
};

export function createMockFetch(routes: MockRoute[]): typeof fetch {
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    for (const route of routes) {
      if (route.match(url, init)) {
        return route.handle(url, init);
      }
    }
    throw new Error(`未設定の fetch: ${url}`);
  }) as typeof fetch;
  return impl;
}

export function jsonResponse(
  body: unknown,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

export function pngResponse(
  png: Buffer,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  return new Response(Uint8Array.from(png), {
    status: init?.status ?? 200,
    headers: {
      'content-type': 'image/png',
      'content-length': String(png.length),
      ...(init?.headers ?? {}),
    },
  });
}

export function redirectResponse(
  location: string,
  status = 302,
): Response {
  return new Response(null, {
    status,
    headers: { location },
  });
}

export function defaultFrameNodesBody(options?: {
  nodeId?: string;
  type?: string;
  name?: string;
  width?: number;
  height?: number;
}): Record<string, unknown> {
  const nodeId = options?.nodeId ?? '1:3';
  return {
    name: 'File',
    nodes: {
      [nodeId]: {
        document: {
          id: nodeId,
          type: options?.type ?? 'FRAME',
          name: options?.name ?? 'Hero',
          absoluteBoundingBox: {
            x: 0,
            y: 0,
            width: options?.width ?? 1440,
            height: options?.height ?? 2000,
          },
        },
      },
    },
  };
}

export function defaultImagesBody(
  nodeId: string,
  imageUrl: string,
): Record<string, unknown> {
  return {
    images: {
      [nodeId]: imageUrl,
    },
  };
}

export function samplePng(width = 100, height = 200, pad = 0): Buffer {
  return buildPng(width, height, pad);
}
