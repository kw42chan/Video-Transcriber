import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  transpilePackages: ['@video-transcriber/shared'],
};

export default nextConfig;
