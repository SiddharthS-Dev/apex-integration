/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Infographic images are served statically from /public/images.
    // If you move them to a CDN/object store, add the domain here.
    remotePatterns: [],
  },
};
module.exports = nextConfig;
