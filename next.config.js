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
    async rewrites() {
        return [
            {
                source: "/api/:path*",
                destination: "http://127.0.0.1:8080/:path*",
            },
        ];
    }
}

module.exports = nextConfig
