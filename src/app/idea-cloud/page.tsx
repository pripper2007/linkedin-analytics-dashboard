// Server component for /idea-cloud.
//
// Reads the period from ?period=7d|30d|90d|365d|custom&from=YYYY-MM-DD&to=YYYY-MM-DD,
// queries posts, tokenizes + stems + clusters (via Claude), and passes
// the cloud-ready data to the client shell.

import { getAllPosts } from '@/lib/queries';
import { aggregate } from '@/lib/word-cloud/aggregate';
import IdeaCloudClient from './IdeaCloudClient';

export const metadata = {
  title: 'Idea Cloud — LinkedIn Analytics',
  description: 'Semantic map of ideas across your LinkedIn posts',
};
export const dynamic = 'force-dynamic';

type Period = '7d' | '30d' | '90d' | '365d' | 'custom';

interface Props {
  searchParams: {
    period?: string;
    from?: string;
    to?: string;
  };
}

function resolveRange(
  period: Period,
  fromStr: string | undefined,
  toStr: string | undefined,
  now: Date,
): { from: Date; to: Date } {
  if (period === 'custom' && fromStr && toStr) {
    return {
      from: new Date(`${fromStr}T00:00:00Z`),
      to: new Date(`${toStr}T23:59:59Z`),
    };
  }
  const days =
    period === '7d' ? 7 : period === '90d' ? 90 : period === '365d' ? 365 : 30;
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - days);
  return { from, to: now };
}

function normalizePeriod(raw: string | undefined): Period {
  if (raw === '7d' || raw === '30d' || raw === '90d' || raw === '365d' || raw === 'custom') {
    return raw;
  }
  return '30d';
}

export default async function IdeaCloudPage({ searchParams }: Props) {
  const period = normalizePeriod(searchParams.period);
  const now = new Date();
  const { from, to } = resolveRange(period, searchParams.from, searchParams.to, now);

  const posts = await getAllPosts();
  const aggregatePosts = posts.map((p) => ({
    activity_id: p.activity_id,
    post_content: p.post_content,
    posted_at: new Date(`${p.post_date} ${p.publish_time} UTC`),
  }));

  const result = await aggregate(aggregatePosts, from, to);

  const postIndex = new Map(
    posts.map((p) => [
      p.activity_id,
      {
        activity_id: p.activity_id,
        post_content: p.post_content,
        post_date: p.post_date,
        post_url: p.post_url,
        impressions: p.impressions,
        reactions: p.reactions,
        comments: p.comments,
      },
    ]),
  );

  return (
    <IdeaCloudClient
      period={period}
      from={from.toISOString().slice(0, 10)}
      to={to.toISOString().slice(0, 10)}
      words={result.words}
      postIndex={Object.fromEntries(postIndex)}
      currentPostCount={result.currentPostCount}
      priorPostCount={result.priorPostCount}
      clustered={result.clustered}
    />
  );
}
