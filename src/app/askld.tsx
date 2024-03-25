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

export function fetchSource(uri: string) : Promise<Response> {
    // Remove scheme from uri
    uri = new URL(uri).pathname;
    return fetch(`${askldUrl}/source/${uri}`, {
        method: 'GET',
        headers:{
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    })
}