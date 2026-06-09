export interface AnalyticsMaster {
  _metadata: Metadata;
  profile: Profile;
  posts: Post[];
  daily_engagement: DailyEntry[];
}

export interface Metadata {
  version: string;
  created: string;
  last_updated: string;
  data_period: string;
  total_posts: number;
  posts_with_official_data: number;
  how_to_update: string;
}

export interface Profile {
  name: string;
  title: string;
  total_followers: number;
  follower_growth_12mo: number;
  total_impressions_12mo: number;
  total_engagements_12mo: number;
}

export interface Post {
  activity_id: string;
  post_content: string;
  post_date: string;
  publish_time: string;
  post_url: string;
  has_link: boolean;
  has_image: boolean;
  has_bold_unicode: boolean;
  has_emoji: boolean;
  has_bullet_points: boolean;
  has_question: boolean;
  word_count: number;
  paragraph_count: number;
  topic: string;
  style: string;
  image_type: string;
  feature_count: number;
  impressions: number;
  members_reached: number;
  social_engagements: number;
  reactions: number;
  comments: number;
  reposts: number;
  saves: number;
  sends: number;
  profile_viewers: number;
  followers_gained: number;
  demographics: Demographics | null;
  data_source: 'official_single_post_analytics' | 'scraped';
  engagement_rate: number;
}

export interface Demographics {
  job_title: DemographicEntry[];
  location: DemographicEntry[];
  seniority: DemographicEntry[];
  company: DemographicEntry[];
  industry: DemographicEntry[];
  company_size: DemographicEntry[];
}

export interface DemographicEntry {
  value: string;
  pct: string;
}

export interface DailyEntry {
  date: string;
  impressions: number;
  engagements: number;
  day_of_week: string;
}

// Connection from LinkedIn export CSV
export interface Connection {
  firstName: string;
  lastName: string;
  url: string;
  email: string;
  company: string;
  position: string;
  connectedOn: string;
}

// Calculated metrics
export interface PostMetrics {
  avgImpressions: number;
  avgEngagementRate: number;
  avgReactions: number;
  avgComments: number;
  avgFollowersGained: number;
  avgEngagements: number;
  totalImpressions: number;
  totalEngagements: number;
  topPostByImpressions: Post;
  topPostByEngagement: Post;
  topPostByFollowers: Post;
}

export interface TopicMetrics {
  topic: string;
  count: number;
  avgImpressions: number;
  avgEngagementRate: number;
  avgFollowersGained: number;
  totalImpressions: number;
}

export interface FeatureImpact {
  feature: string;
  withFeature: { count: number; avgImpressions: number; avgEngagement: number };
  withoutFeature: { count: number; avgImpressions: number; avgEngagement: number };
  impactPct: number;
}
