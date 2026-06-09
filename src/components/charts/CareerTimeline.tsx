'use client';

import React from 'react';

interface Position {
  company: string;
  title: string;
  startDate: string;
  endDate: string;
}

export function CareerTimeline({ positions }: { positions: Position[] }) {
  // Sort by start date descending (most recent first) for display
  const sortedPositions = [...positions].sort((a, b) => {
    const aYear = parseInt(a.startDate.split(' ')[1]);
    const bYear = parseInt(b.startDate.split(' ')[1]);
    return bYear - aYear;
  });

  // Find min and max years for timeline scale
  const years = sortedPositions.flatMap(p => [
    parseInt(p.startDate.split(' ')[1]),
    parseInt(p.endDate.split(' ')[1]),
  ]);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const yearRange = maxYear - minYear + 1;

  const getPositionWidth = (pos: Position) => {
    const startYear = parseInt(pos.startDate.split(' ')[1]);
    const endYear = parseInt(pos.endDate.split(' ')[1]);
    return ((endYear - startYear + 1) / yearRange) * 100;
  };

  const getPositionLeft = (pos: Position) => {
    const startYear = parseInt(pos.startDate.split(' ')[1]);
    return ((startYear - minYear) / yearRange) * 100;
  };

  const colors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-purple-500',
    'bg-orange-500',
    'bg-pink-500',
    'bg-cyan-500',
    'bg-red-500',
    'bg-yellow-500',
  ];

  return (
    <div className="card">
      <h3 className="section-title">Career Timeline</h3>

      {/* Year labels */}
      <div className="mb-8">
        <div className="flex justify-between text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
          {Array.from({ length: Math.min(6, yearRange) }).map((_, i) => {
            const year = minYear + Math.floor((i / 5) * yearRange);
            return (
              <span key={year}>{year}</span>
            );
          })}
        </div>

        {/* Timeline bars */}
        <div className="space-y-3">
          {sortedPositions.map((pos, idx) => (
            <div key={`${pos.company}-${pos.startDate}`} className="relative h-16 flex items-center">
              {/* Company/Title label */}
              <div className="w-32 pr-3 flex-shrink-0">
                <p className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                  {pos.title}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {pos.company}
                </p>
              </div>

              {/* Timeline bar container */}
              <div className="flex-1 relative h-8 rounded-full border" style={{ borderColor: 'var(--border)' }}>
                {/* Bar */}
                <div
                  className={`absolute h-8 rounded-full ${colors[idx % colors.length]} opacity-80 flex items-center px-2`}
                  style={{
                    left: `${getPositionLeft(pos)}%`,
                    width: `${getPositionWidth(pos)}%`,
                  }}
                >
                  <span className="text-xs font-medium text-white truncate">
                    {pos.startDate} - {pos.endDate}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="mt-6 pt-6 border-t" style={{ borderColor: 'var(--border)' }}>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {positions.length} positions
          </span>{' '}
          across {Math.max(...years) - Math.min(...years) + 1} years of professional experience
        </p>
      </div>
    </div>
  );
}
