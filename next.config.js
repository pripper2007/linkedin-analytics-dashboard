/** @type {import('next').NextConfig} */
const nextConfig = {
  // `output: 'export'` removed — incompatible with API routes and with
  // server components that query Supabase at request time. The app now
  // deploys as a standard Next.js app on Vercel.
  //
  // `trailingSlash: true` also dropped; it caused 308 redirects on POST to
  // /api/ingest that stripped the request body. Extension POSTs go to
  // /api/ingest (no trailing slash) matching standard convention.
  images: { unoptimized: true },

  // The /api/analyze-post and /posts/[id] routes read
  // skills/example-linkedin-writer.md from disk at runtime (it's the
  // writing rubric the Claude critique uses). Next.js's automatic
  // file tracing can't detect the dependency because we resolve the
  // path with `path.join(process.cwd(), 'skills', ...)` — a dynamic
  // string. Explicitly including `skills/**` here makes sure the
  // file ships inside the serverless function bundle on Vercel.
  experimental: {
    outputFileTracingIncludes: {
      '/api/analyze-post/[id]': ['./skills/**'],
      '/posts/[id]': ['./skills/**'],
    },
  },
};

module.exports = nextConfig;
