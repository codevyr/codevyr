// Default queries for the application

export const DEFAULT_QUERY = `@preamble
@ignore(package="builtin")
@ignore(package="fmt")
@ignore(package="context")
@ignore(package="os")
@ignore(package="log")
@ignore(package="runtime")
@ignore(package="internal")
@ignore(package="ioutil")
@ignore(package="golang")
@ignore(package="k8s.io/klog");

/*
 * Below is a simple query that requests:
 *   1. A function called "main"
 *   2. A function called "run", which is a member of the "run" module
 *   3. All functions called by "run"
 *
 * Press Ctrl+Enter to execute the query.
 */

"main" {
    "cli.Run" {}
};
`;
