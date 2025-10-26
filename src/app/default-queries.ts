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

@preamble /* Preamble applies the following verbs globally. */
@project("kubernetes");

/*
 * Below is a simple query that requests:
 *   1. A function called "main"
 *   2. A function called "Run", which is a member of the "cli" module
 *   3. All functions called by "Run"
 *
 * Press Ctrl+Enter to execute the query.
 */

"main" {
    "cli.Run" {}
};

@preamble /* Another preamble overwrites the previous preamble. */
@project("kueue");
"main" {
    "NewTokenBucketRateLimiter"
};

`;
