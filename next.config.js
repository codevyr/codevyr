/** @type {import('next').NextConfig} */
const nextConfig = {
    // React Flow v11 triggers spurious "new nodeTypes" warnings under strict mode
    // (its useNodeOrEdgeTypes hook fires useMemo twice on mount). Safe to disable
    // because the project has comprehensive E2E tests.
    reactStrictMode: false,
    turbopack: {
        root: __dirname,
        rules: {
            '*.c': {
                loaders: ['raw-loader'],
                as: '*.js',
            },
            '*.json': {
                loaders: ['raw-loader'],
                as: '*.js',
            },
        },
    },
    webpack: (config) => {
        config.module.rules.push(
            {
                test: /\.c$/,
                type: 'asset/source',
            }
        )
        config.module.rules.push(
            {
                test: /\.json$/,
                type: 'asset/json',
            }
        )
        return config
    },
    output: 'standalone',
}

module.exports = nextConfig
