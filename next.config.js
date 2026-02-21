/** @type {import('next').NextConfig} */
const nextConfig = {
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
