/** @type {import('next').NextConfig} */
const nextConfig = {
    webpack: (config, { buildId, dev, isServer, defaultLoaders, webpack }) => {
        config.module.rules.push(
            {
                test: /\.c$/,
                // This is the asset module.
                type: 'asset/source',
            }
        )
        config.module.rules.push(
            {
                test: /\.json$/,
                // This is the asset module.
                type: 'asset/json',
            }
        )
        return config
    },
    output: 'standalone',
}

module.exports = nextConfig
