/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const apiUrl = process.env.API_URL || 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
};

module.exports = nextConfig;
