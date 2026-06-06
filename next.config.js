/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Optional deps pulled in by WalletConnect / MetaMask SDK that aren't needed
    // in the browser bundle. Externalizing them silences "Module not found" noise.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // @react-native-async-storage is only used in React Native; stub it out.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

module.exports = nextConfig;
