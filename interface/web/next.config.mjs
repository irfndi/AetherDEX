/** @type {import('next').NextConfig} */
const nextConfig = {
  // Handle external packages that may not be installed (optional peer dependencies)
  webpack: (config) => {
    // Mark optional wallet SDKs as external when not installed
    config.externals = [
      ...(config.externals || []),
      // These packages are optional dependencies of @wagmi/connectors
      '@base-org/account',
      '@gemini-wallet/core',
      'porto',
      'porto/internal'
    ]
    
    // Ignore specific modules if they're missing  
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

export default nextConfig
