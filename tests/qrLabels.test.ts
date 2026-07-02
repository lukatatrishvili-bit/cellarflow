import { describe, it, expect } from 'vitest';
import { vesselDeepLink, buildQrLabelSheetHtml } from '../lib/qrLabels';

describe('vessel QR labels', () => {
  it('builds a quick-operation deep link with the vessel id encoded', () => {
    expect(vesselDeepLink('https://vinos.app', 'T-1')).toBe('https://vinos.app/?tank=T-1&op=1');
    expect(vesselDeepLink('https://vinos.app/', 'T-1')).toBe('https://vinos.app/?tank=T-1&op=1');
  });

  it('URL-encodes Georgian vessel names (ids are legitimate Unicode)', () => {
    const link = vesselDeepLink('https://vinos.app', 'ქვევრი 1');
    expect(link).toBe(`https://vinos.app/?tank=${encodeURIComponent('ქვევრი 1')}&op=1`);
    expect(decodeURIComponent(new URL(link).searchParams.get('tank')!)).toBe('ქვევრი 1');
  });

  it('renders one label per vessel with id, caption and brand', () => {
    const html = buildQrLabelSheetHtml({
      wineryName: 'Kondoli Cellar',
      lang: 'en',
      labels: [
        { vesselId: 'T-1', caption: 'stainless steel · 5,000 L', dataUrl: 'data:image/png;base64,AAA' },
        { vesselId: 'ქვევრი Q-1', caption: 'qvevri · 1,500 L', dataUrl: 'data:image/png;base64,BBB' },
      ],
    });
    expect(html).toContain('T-1');
    expect(html).toContain('ქვევრი Q-1');
    expect(html).toContain('stainless steel · 5,000 L');
    expect(html).toContain('Kondoli Cellar');
    expect(html).toContain('Scan to log an operation');
    expect((html.match(/class="label"/g) || [])).toHaveLength(2);
  });

  it('escapes HTML in ids and winery names (labels are user-controlled text)', () => {
    const html = buildQrLabelSheetHtml({
      wineryName: '<script>alert(1)</script>',
      lang: 'en',
      labels: [{ vesselId: 'T<img src=x>', caption: 'x & y', dataUrl: 'data:image/png;base64,AAA' }],
    });
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('T<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('x &amp; y');
  });

  it('uses Georgian copy when lang is ka', () => {
    const html = buildQrLabelSheetHtml({
      wineryName: 'მარანი', lang: 'ka',
      labels: [{ vesselId: 'Q-1', caption: 'ქვევრი', dataUrl: 'data:image/png;base64,AAA' }],
    });
    expect(html).toContain('დაასკანერეთ ოპერაციის ჩასაწერად');
  });
});
