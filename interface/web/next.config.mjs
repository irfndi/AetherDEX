/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Handle Node.js modules that aren't available in browser
    config.resolve = {
      ...config.resolve,
      fallback: {
        ...config.resolve?.fallback,
        fs: false,
        net: false,
        tls: false,
      }
    }

    return config
  },
  // Transpile specific packages
  transpilePackages: ['@web3modal/wagmi'],
}

export default nextConfig;
