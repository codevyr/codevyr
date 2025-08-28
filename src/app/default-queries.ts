// Default queries for the application

export const DEFAULT_QUERY = `@preamble
@ignore("builtin")
@ignore("runtime")
@ignore("fmt")
@ignore("context")
@ignore("os")
@ignore("klog")
@ignore("log")
@ignore("ioutil")
@ignore("golang.protobuf");

/*
 * Below is a simple query that requests:
 *   1. A function called "main"
 *   2. A function called "run", which is a member of the "run" module
 *   3. All functions called by "run"
 *
 * Press Ctrl+Enter to execute the query.
 */

"main" {
    "cli.run" {}
};
`;