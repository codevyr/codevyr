import { createServer } from "miragejs"
// eslint-disable-next-line import/no-webpack-loader-syntax
import code from '!!raw-loader!./mirage.452.c'
import queryResponse from '!!raw-loader!./query.response.json'

export function makeServer({ environment = 'test' }) {
    return createServer({
        environment,

        routes() {
            this.namespace = "api"

            this.get("/source/:id", () => {
                return code;
            })

            this.post("/query", () => {
                console.log("Run query");
                return queryResponse;
            })
        },
    })
}