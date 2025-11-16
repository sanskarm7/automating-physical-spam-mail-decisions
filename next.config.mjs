
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { allowedOrigins: ['localhost:3000'] }
  },
  webpack: (config, { isServer }) => {
    // Fix for tesseract.js in Next.js server-side
    if (isServer) {
      // Exclude tesseract.js from webpack bundling on server
      config.externals = config.externals || [];
      config.externals.push({
        'tesseract.js': 'commonjs tesseract.js'
      });
    }
    
    return config;
  },
};
export default nextConfig;
