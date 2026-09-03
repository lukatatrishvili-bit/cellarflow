import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import VesselFill from '../components/VesselFill';

describe('VesselFill', () => {
  it('renders a Georgian qvevri silhouette with a narrow rim and pointed base', () => {
    const markup = renderToStaticMarkup(
      <VesselFill fillPct={65} wineClass="red" qvevri />,
    );

    expect(markup).toContain('M42 8 Q50 5 58 8');
    expect(markup).toContain('70 108 50 128 C30 108');
    expect(markup).toContain('cx="50" cy="8.5" rx="8"');
    expect(markup).toContain('#b96f3e');
  });

  it('uses unique SVG clip paths for multiple vessels on the same screen', () => {
    const markup = renderToStaticMarkup(
      <>
        <VesselFill fillPct={25} qvevri />
        <VesselFill fillPct={75} qvevri />
      </>,
    );
    const clipIds = [...markup.matchAll(/<clipPath id="([^"]+)"/g)].map(match => match[1]);

    expect(clipIds).toHaveLength(2);
    expect(new Set(clipIds).size).toBe(2);
    for (const id of clipIds) {
      expect(markup).toContain(`clip-path="url(#${id})"`);
    }
  });
});
