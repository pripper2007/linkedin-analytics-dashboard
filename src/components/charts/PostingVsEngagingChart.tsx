'use client';

// 12-month grouped bar chart pairing posts published with engagements
// given. Two y-axes because absolute scales differ (a few posts per
// month vs. tens-to-hundreds of reactions). Left axis is blue (matches
// "your output" semantic), right axis is violet (others' content you
// engage with) — same palette as the rest of the app.

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useIsMobile } from '@/lib/use-is-mobile';

interface CorrelationPoint {
  month: string;
  posts: number;
  engagements: number;
}

export default function PostingVsEngagingChart({
  data,
}: {
  data: CorrelationPoint[];
}) {
  const isMobile = useIsMobile();
  return (
    <div className="h-[200px] md:h-[300px]"><ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="month"
          stroke="var(--text-secondary)"
          tick={{ fontSize: isMobile ? 10 : 12 }}
          interval={isMobile ? Math.max(0, Math.floor(data.length / 4)) : 0}
          angle={isMobile ? -45 : 0}
          textAnchor={isMobile ? 'end' : 'middle'}
          height={isMobile ? 50 : 30}
        />
        {/* Pin both axes to start at 0 so the dual-axis zero lines align —
            see FollowersRangeChart for the full explanation. */}
        <YAxis
          yAxisId="posts"
          stroke="var(--accent)"
          tick={{ fontSize: isMobile ? 10 : 12 }}
          width={isMobile ? 36 : 60}
          domain={[0, 'auto']}
            allowDataOverflow={true}
          label={isMobile ? undefined : {
            value: 'Posts',
            angle: -90,
            position: 'insideLeft',
            style: { fill: 'var(--accent)', fontSize: 12 },
          }}
        />
        <YAxis
          yAxisId="engagements"
          orientation="right"
          stroke="var(--chart-secondary)"
          tick={{ fontSize: isMobile ? 10 : 12 }}
          width={isMobile ? 36 : 60}
          domain={[0, 'auto']}
            allowDataOverflow={true}
          label={isMobile ? undefined : {
            value: 'Engagements',
            angle: 90,
            position: 'insideRight',
            style: { fill: 'var(--chart-secondary)', fontSize: 12 },
          }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
          }}
        />
        <Legend verticalAlign="bottom" wrapperStyle={{ paddingTop: 8 }} />
        <Bar
          yAxisId="posts"
          dataKey="posts"
          fill="var(--accent)"
          radius={[6, 6, 0, 0]}
          name="Posts published"
        />
        <Bar
          yAxisId="engagements"
          dataKey="engagements"
          fill="var(--chart-secondary)"
          radius={[6, 6, 0, 0]}
          name="Engagements given"
        />
      </BarChart>
    </ResponsiveContainer></div>
  );
}
