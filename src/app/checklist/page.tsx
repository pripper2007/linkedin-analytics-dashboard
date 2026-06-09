'use client';

import React, { useState, useMemo } from 'react';

interface ChecklistItem {
  id: string;
  label: string;
  weight: number;
  insight: string;
}

const CHECKLIST_ITEMS: ChecklistItem[] = [
  {
    id: 'photo',
    label: 'Photo with people attached?',
    weight: 25,
    insight: '+280% impressions with photos',
  },
  {
    id: 'unicode',
    label: 'Bold Unicode headers?',
    weight: 10,
    insight: 'Adds visual structure',
  },
  {
    id: 'emoji',
    label: 'Emoji included?',
    weight: 10,
    insight: 'Increases engagement',
  },
  {
    id: 'question',
    label: 'Question in post body?',
    weight: 15,
    insight: '8,815 avg vs 3,406 without',
  },
  {
    id: 'no_links',
    label: 'No outbound links in body?',
    weight: 15,
    insight: 'Links reduce reach by 47%',
  },
  {
    id: 'word_count',
    label: 'Word count 150-200?',
    weight: 10,
    insight: 'Optimal length range',
  },
  {
    id: 'lists',
    label: 'Structured with lists?',
    weight: 5,
    insight: 'Structured posts perform well',
  },
  {
    id: 'timing',
    label: 'Publishing Friday evening?',
    weight: 5,
    insight: 'Best posting slot',
  },
  {
    id: 'topic',
    label: 'Topic: Payments/Fintech or AI/Tech?',
    weight: 5,
    insight: 'Highest performing topics',
  },
];

export default function ChecklistPage() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const score = useMemo(() => {
    const totalWeight = CHECKLIST_ITEMS.reduce((sum, item) => sum + item.weight, 0);
    const checkedWeight = CHECKLIST_ITEMS.reduce(
      (sum, item) => sum + (checked[item.id] ? item.weight : 0),
      0
    );
    return Math.round((checkedWeight / totalWeight) * 100);
  }, [checked]);

  const toggleCheck = (id: string) => {
    setChecked((prev) => ({
      ...prev,
      [id]: !(prev[id] || false),
    }));
  };

  const getScoreColor = () => {
    if (score < 40) return 'var(--warning)';
    if (score < 70) return '#f59e0b';
    return 'var(--success)';
  };

  const getPredictedRange = () => {
    if (score <= 30) return { range: '1,000-3,000', label: 'below average' };
    if (score <= 50) return { range: '3,000-6,000', label: 'average' };
    if (score <= 70) return { range: '6,000-12,000', label: 'above average' };
    return { range: '12,000-26,000', label: 'top performer' };
  };

  const predicted = getPredictedRange();

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Pre-Publish Content Scorecard
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Check boxes to get a predicted performance score before publishing
        </p>
      </div>

      {/* Score Display */}
      <div className="card">
        <div className="flex flex-col items-center py-8">
          {/* Circular Score Indicator */}
          <div className="relative w-48 h-48 flex items-center justify-center mb-6">
            <svg className="transform -rotate-90" width="200" height="200">
              <circle
                cx="100"
                cy="100"
                r="90"
                fill="none"
                stroke="var(--border)"
                strokeWidth="12"
              />
              <circle
                cx="100"
                cy="100"
                r="90"
                fill="none"
                stroke={getScoreColor()}
                strokeWidth="12"
                strokeDasharray={`${(score / 100) * 565.48} 565.48`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute text-center">
              <div
                style={{ color: getScoreColor() }}
                className="text-5xl font-bold"
              >
                {score}
              </div>
              <p style={{ color: 'var(--text-secondary)' }} className="text-sm mt-1">
                Performance Score
              </p>
            </div>
          </div>

          {/* Predicted Range */}
          <div className="w-full max-w-xs text-center">
            <p style={{ color: 'var(--text-secondary)' }} className="text-sm mb-2">
              Predicted Impression Range
            </p>
            <p
              className="text-xl font-bold"
              style={{ color: 'var(--accent)' }}
            >
              {predicted.range}
            </p>
            <p style={{ color: 'var(--text-secondary)' }} className="text-xs mt-1">
              {predicted.label}
            </p>
          </div>
        </div>
      </div>

      {/* Checklist */}
      <div className="card">
        <h3 className="section-title">Content Optimization Checklist</h3>
        <div className="space-y-1 divide-y" style={{ borderColor: 'var(--border)' }}>
          {CHECKLIST_ITEMS.map((item) => (
            <label
              key={item.id}
              className="flex items-start gap-4 py-4 px-4 cursor-pointer hover:bg-opacity-50 transition-colors"
              style={{
                backgroundColor: checked[item.id] ? 'rgba(5, 118, 66, 0.05)' : 'transparent',
              }}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={checked[item.id] || false}
                onChange={() => toggleCheck(item.id)}
                className="mt-1 w-5 h-5 cursor-pointer rounded"
                style={{
                  accentColor: 'var(--success)',
                }}
              />

              {/* Label and Insight */}
              <div className="flex-1 min-w-0">
                <p
                  style={{ color: 'var(--text-primary)' }}
                  className="font-medium"
                >
                  {item.label}
                </p>
                <p
                  style={{ color: 'var(--text-secondary)' }}
                  className="text-sm mt-1"
                >
                  {item.insight}
                </p>
              </div>

              {/* Weight Badge */}
              <div
                className="flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap"
                style={{
                  backgroundColor: 'var(--accent-light)',
                  color: 'var(--accent)',
                }}
              >
                +{item.weight}pt
              </div>
            </label>
          ))}
        </div>

        {/* Scoring Explanation */}
        <div
          className="mt-6 p-4 rounded-lg"
          style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
        >
          <p style={{ color: 'var(--text-secondary)' }} className="text-sm">
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              How scoring works:
            </span>{' '}
            Each item has a weight based on its impact on post performance. Check all applicable
            items to calculate your predicted impression range. The higher your score, the better
            your post is optimized for LinkedIn algorithm.
          </p>
        </div>
      </div>

      {/* Score Breakdown */}
      <div className="card">
        <h3 className="section-title">Score Categories</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Current Score Category */}
          <div
            className="p-4 rounded-lg border-l-4"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              borderLeftColor: getScoreColor(),
            }}
          >
            <p style={{ color: 'var(--text-secondary)' }} className="text-sm mb-1">
              Your Current Score
            </p>
            <p
              className="text-2xl font-bold"
              style={{ color: getScoreColor() }}
            >
              {score} / 100
            </p>
            <p style={{ color: 'var(--text-secondary)' }} className="text-xs mt-2">
              {score < 40 && 'Below Average - Focus on high-impact items'}
              {score >= 40 && score < 70 && 'Average - Improve key elements for better reach'}
              {score >= 70 && score < 100 && 'Above Average - Strong optimization'}
              {score === 100 && 'Perfect Score - Maximum optimization!'}
            </p>
          </div>

          {/* Scoring Range Legend */}
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <p style={{ color: 'var(--text-secondary)' }} className="text-sm">
                0-30
              </p>
              <p style={{ color: 'var(--text-secondary)' }} className="text-xs">
                1,000-3,000 impressions
              </p>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <p style={{ color: 'var(--text-secondary)' }} className="text-sm">
                31-50
              </p>
              <p style={{ color: 'var(--text-secondary)' }} className="text-xs">
                3,000-6,000 impressions
              </p>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <p style={{ color: 'var(--text-secondary)' }} className="text-sm">
                51-70
              </p>
              <p style={{ color: 'var(--text-secondary)' }} className="text-xs">
                6,000-12,000 impressions
              </p>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)' }}>
              <p style={{ color: 'var(--text-secondary)' }} className="text-sm">
                71-100
              </p>
              <p style={{ color: 'var(--text-secondary)' }} className="text-xs">
                12,000-26,000 impressions
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tips Section */}
      <div className="card">
        <h3 className="section-title">Pro Tips</h3>
        <ul
          className="space-y-3 text-sm"
          style={{ color: 'var(--text-secondary)' }}
        >
          <li className="flex gap-3">
            <span style={{ color: 'var(--accent)' }} className="font-bold">
              &bull;
            </span>
            <span>
              <span
                style={{ color: 'var(--text-primary)' }}
                className="font-semibold"
              >
                Photos drive engagement:
              </span>{' '}
              Posts with photos of people see significantly higher impressions. Include headshots or
              team photos when relevant.
            </span>
          </li>
          <li className="flex gap-3">
            <span style={{ color: 'var(--accent)' }} className="font-bold">
              &bull;
            </span>
            <span>
              <span
                style={{ color: 'var(--text-primary)' }}
                className="font-semibold"
              >
                Questions work:
              </span>{' '}
              Asking questions in your post body increases engagement significantly. End with a call
              to action.
            </span>
          </li>
          <li className="flex gap-3">
            <span style={{ color: 'var(--accent)' }} className="font-bold">
              &bull;
            </span>
            <span>
              <span
                style={{ color: 'var(--text-primary)' }}
                className="font-semibold"
              >
                Avoid external links:
              </span>{' '}
              Posts with outbound links see 47% lower reach. Save links for comments or use
              LinkedIn native document feature.
            </span>
          </li>
          <li className="flex gap-3">
            <span style={{ color: 'var(--accent)' }} className="font-bold">
              &bull;
            </span>
            <span>
              <span
                style={{ color: 'var(--text-primary)' }}
                className="font-semibold"
              >
                Timing matters:
              </span>{' '}
              Friday evenings show the best engagement. Schedule posts for 6-8 PM in your audience timezone.
            </span>
          </li>
          <li className="flex gap-3">
            <span style={{ color: 'var(--accent)' }} className="font-bold">
              &bull;
            </span>
            <span>
              <span
                style={{ color: 'var(--text-primary)' }}
                className="font-semibold"
              >
                Topic selection:
              </span>{' '}
              Payments, fintech, and AI/tech topics consistently outperform other categories in your
              audience.
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
