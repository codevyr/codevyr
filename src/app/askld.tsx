export const askldUrl = 'api'

export function fetchQuery(query: string) : Promise<Response> {
    return fetch(`${askldUrl}/query`, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain'
        },
        body: query
    })
}