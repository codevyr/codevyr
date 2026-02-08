export const askldUrl = process.env.NEXT_PUBLIC_ASKLD_URL || 'https://api.codevyr.com';

export function fetchQuery(query: string): Promise<Response> {
  console.log(`${askldUrl}`, query);
  return fetch(`${askldUrl}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain'
    },
    body: query
  })
}

export function fetchSource(file_id: string): Promise<Response> {
  // Remove scheme from uri
  return fetch(`${askldUrl}/source/${file_id}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  })
}
