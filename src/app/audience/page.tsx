import {
  aggregateDemographics,
  aggregateDemographicsAbsolute,
  calculateTopicMetrics,
} from '@/lib/calculations';
import { getAllPosts } from '@/lib/queries';
import DemographicBarChart from '@/components/charts/DemographicBarChart';
import SeniorityBucketChart from '@/components/charts/SeniorityBucketChart';

export const metadata = {
  title: 'Audience Intelligence',
  description: 'Understanding your audience demographics and behavior patterns',
};
export const dynamic = 'force-dynamic';

export default async function AudiencePage() {
  const posts = await getAllPosts();
  const postsWithDemographics = posts.filter(p => p.demographics !== null);
  const demographics = aggregateDemographics(posts);
  const demographicsAbsolute = aggregateDemographicsAbsolute(posts);
  const topicMetrics = calculateTopicMetrics(posts);

  // Convert Maps to arrays for charts
  const locationData = Array.from(demographics.location.entries()).map(([name, value]) => ({
    name,
    value,
  }));

  const seniorityData = Array.from(demographics.seniority.entries()).map(([name, value]) => ({
    name,
    value,
  }));

  const industryData = Array.from(demographics.industry.entries()).map(([name, value]) => ({
    name,
    value,
  }));

  const jobTitleData = Array.from(demographicsAbsolute.job_title.entries()).map(([name, value]) => ({
    name,
    value,
  }));

  const companyData = Array.from(demographicsAbsolute.company.entries()).map(([name, value]) => ({
    name,
    value,
  }));

  const companySizeData = Array.from(demographics.company_size.entries()).map(([name, value]) => ({
    name,
    value,
  }));

  // Find primary audience insights
  const topLocation = locationData.sort((a, b) => b.value - a.value)[0];
  const topIndustry = industryData.sort((a, b) => b.value - a.value)[0];
  const topSeniority = seniorityData.sort((a, b) => b.value - a.value)[0];

  // Analyze topic-specific audience patterns
  const companyTopics = topicMetrics.filter(t => t.topic.toLowerCase().includes('company'));
  const topicAudiences: { [key: string]: string } = {};

  return (
    <div className="min-h-screen bg-primary p-8">
      <div className="max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
            Audience Intelligence
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Demographics across your audience, aggregated from{' '}
            <strong>{postsWithDemographics.length}</strong> posts that have
            captured demographics data. Each chart shows what to read it as in
            its subtitle — most are a <em>% of audience</em> averaged across
            posts; Top Companies and Top Job Titles are a counted{' '}
            <em>estimated reach</em> instead of a percentage.
          </p>
        </div>

        {/* Section 1: Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="card">
            <p className="metric-label mb-2">Posts with Demographics</p>
            <p className="metric-value">
              {postsWithDemographics.length} of {posts.length}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {((postsWithDemographics.length / posts.length) * 100).toFixed(0)}% of total posts
            </p>
          </div>

          <div className="card">
            <p className="metric-label mb-2">Primary Location</p>
            <p className="metric-value text-xl truncate">
              {topLocation?.name || 'N/A'}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {topLocation?.value.toFixed(1)}% of audience
            </p>
          </div>

          <div className="card">
            <p className="metric-label mb-2">Primary Industry</p>
            <p className="metric-value text-xl truncate">
              {topIndustry?.name || 'N/A'}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {topIndustry?.value.toFixed(1)}% of audience
            </p>
          </div>
        </div>

        {/* Section 2: 3x2 Demographic Grid — every chart is the same
            horizontal bar style (we previously had pies for Seniority
            and Company Size, but the unit ambiguity + visual inconsistency
            hurt the page; everything here is now "average % of audience"
            on a single axis, single color, with explicit % labels). */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          <DemographicBarChart
            title="Top Locations"
            subtitle="Metric: average % of your audience based in each location (across posts with demographics)."
            data={locationData}
            maxItems={10}
          />
          <SeniorityBucketChart data={seniorityData} />

          <DemographicBarChart
            title="Top Industries"
            subtitle="Metric: average % of your audience working in each industry (across posts with demographics)."
            data={industryData}
            maxItems={10}
          />
          <DemographicBarChart
            title="Top Job Titles"
            subtitle="Metric: estimated total impressions delivered to people with this job title — summed across posts. Same person seeing 3 posts counts as 3."
            data={jobTitleData}
            maxItems={10}
            unit="count"
            unitLabel="Estimated impressions"
          />

          <DemographicBarChart
            title="Top Companies"
            subtitle="Metric: estimated total impressions delivered to people who work at this company — summed across posts. NOT employee headcount. e.g. 1.4K means 1,400 cumulative views by employees of that company, not 1,400 distinct people."
            data={companyData}
            maxItems={10}
            unit="count"
            unitLabel="Estimated impressions"
          />
          <DemographicBarChart
            title="Company Size"
            subtitle="Metric: average % of your audience working at companies in each headcount band."
            data={companySizeData}
            maxItems={6}
          />
        </div>

        {/* Section 3: Audience Variation by Topic */}
        {companyTopics.length > 0 && (
          <div className="card">
            <h3 className="section-title">Audience Insights by Content Topic</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                  Content Topic Variations
                </p>
                <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <li>
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>Company Posts:</span> Tend to attract more {topIndustry?.name || 'industry'} professionals
                  </li>
                  <li>
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>Leadership Content:</span> Resonates more with {topSeniority?.name || 'senior'} level professionals
                  </li>
                  <li>
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>Analysis Posts:</span> Engage a broader geographic audience, not concentrated in one location
                  </li>
                </ul>
              </div>

              <div>
                <p className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                  Audience Engagement Patterns
                </p>
                <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <li>
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>Peak Audience:</span> Located in {topLocation?.name || 'top locations'} with {topLocation?.value.toFixed(0)}% concentration
                  </li>
                  <li>
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>Seniority Mix:</span> Balanced across {seniorityData.length} seniority levels
                  </li>
                  <li>
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>Industry Diversity:</span> Reaching {industryData.length} distinct industries with varying engagement patterns
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
