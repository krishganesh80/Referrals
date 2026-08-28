/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors fail the build rather than shipping. Turning this off is how a red
  // typecheck quietly reaches production.
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
