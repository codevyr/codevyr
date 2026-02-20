import { createServer } from "miragejs"
// eslint-disable-next-line import/no-webpack-loader-syntax
import code from '!!raw-loader!./mirage.452.c'
import queryResponse from '!!raw-loader!./query.response.json'

const demoProject = {
    id: 'demo-project',
    project_name: 'Demo Project',
    root_path: '/demo',
}

const demoTree: Record<string, Array<{ name: string; path: string; node_type: 'dir' | 'file'; has_children: boolean; file_id?: string; filetype?: string }>> = {
    '/demo': [
        { name: 'src', path: '/demo/src', node_type: 'dir', has_children: true },
        { name: 'README.md', path: '/demo/README.md', node_type: 'file', has_children: false, file_id: 'readme', filetype: '.md' },
    ],
    '/demo/src': [
        { name: 'main.c', path: '/demo/src/main.c', node_type: 'file', has_children: false, file_id: 'main-c', filetype: '.c' },
        { name: 'lib', path: '/demo/src/lib', node_type: 'dir', has_children: true },
    ],
    '/demo/src/lib': [
        { name: 'util.c', path: '/demo/src/lib/util.c', node_type: 'file', has_children: false, file_id: 'util-c', filetype: '.c' },
    ],
};

export function makeServer({ environment = 'test' }) {
    return createServer({
        environment,

        routes() {
            this.get("/v1/index/projects", () => {
                return [demoProject];
            });

            this.get("/v1/index/projects/:id", () => {
                return {
                    ...demoProject,
                    modules: 1,
                    file_count: 3,
                    symbol_count: 10,
                };
            });

            this.get("/v1/index/projects/:id/tree", (_schema, request) => {
                const pathParam = request.queryParams.path;
                const path = Array.isArray(pathParam) ? pathParam[0] : pathParam ?? '/demo';
                const expandParam = (request.queryParams['expand[]'] ??
                    request.queryParams.expand) as string | string[] | undefined;
                const expandPaths = Array.isArray(expandParam) ? expandParam : expandParam ? [expandParam] : [];
                const expanded: Record<string, typeof demoTree['/demo']> = {};
                expandPaths.forEach((expandPath) => {
                    expanded[expandPath] = demoTree[expandPath] ?? [];
                });
                return {
                    base_path: path,
                    nodes: demoTree[path] ?? [],
                    expanded,
                };
            });

            this.get("/v1/index/projects/:id/resolve", (_schema, request) => {
                const pathParam = request.queryParams.path;
                const path = Array.isArray(pathParam) ? pathParam[0] : pathParam;
                const fileIdParam = request.queryParams.file_id;
                const fileId = Array.isArray(fileIdParam) ? fileIdParam[0] : fileIdParam;
                const resolvedPath = path ?? (fileId ? `/demo/src/${fileId}.c` : '/demo');
                const segments = resolvedPath.split('/').filter(Boolean);
                const ancestors = segments.map((segment, index) => ({
                    name: segment,
                    path: `/${segments.slice(0, index + 1).join('/')}`,
                }));
                return ancestors;
            });

            this.get("/v1/index/projects/:id/source", () => {
                return code;
            });

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
