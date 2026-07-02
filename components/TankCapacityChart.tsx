'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';

export interface ChartTankData {
  id: string;
  name: string;
  capacity: number;
  currentVolume: number;
  status: string;
}

interface TankCapacityChartProps {
  tanks: ChartTankData[];
  onSelectTank?: (tankId: string) => void;
  selectedTankId?: string | null;
}

export default function TankCapacityChart({ tanks, onSelectTank, selectedTankId }: TankCapacityChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoveredTank, setHoveredTank] = useState<{
    x: number;
    y: number;
    name: string;
    volume: number;
    capacity: number;
    pct: number;
  } | null>(null);

  // Content fingerprint: redraws must key on what the data IS, not the array
  // identity — sync responses replace `tanks` with identical content, and an
  // identity-keyed effect would rebuild the SVG (replaying animations) on
  // every sync pass, which reads as a flashing chart.
  const tanksKey = useMemo(() => JSON.stringify(tanks), [tanks]);

  // Monitor container size dynamically for absolute responsiveness
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width } = entries[0].contentRect;
      const roundedWidth = Math.max(100, Math.round(width));
      const dynamicHeight = Math.max(220, tanks.length * 48 + 60);
      setDimensions((prev) => {
        if (prev.width === roundedWidth && prev.height === dynamicHeight) {
          return prev;
        }
        return { width: roundedWidth, height: dynamicHeight };
      });
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [tanks.length]);

  // Redraw D3 Chart whenever dimensions or data changes
  useEffect(() => {
    if (!svgRef.current || dimensions.width === 0 || dimensions.height === 0 || tanks.length === 0) return;

    const svg = d3.select(svgRef.current);
    // Clear previous elements
    svg.selectAll('*').remove();

    const margin = { top: 20, right: 140, bottom: 40, left: 110 };
    const width = dimensions.width - margin.left - margin.right;
    const height = dimensions.height - margin.top - margin.bottom;

    if (width <= 0 || height <= 0) return;

    const g = svg
       .append('g')
       .attr('transform', `translate(${margin.left}, ${margin.top})`);

    // Select chart elements by their bound datum rather than interpolating
    // vessel IDs into CSS selectors. Real vessel names may contain spaces,
    // Georgian characters, punctuation, or other valid ID characters that are
    // not safe inside querySelectorAll().
    const selectTankRects = (tankId: string) =>
      g.selectAll<SVGRectElement, ChartTankData>('.capacity-bg, .fill-bar')
        .filter((datum) => datum?.id === tankId);
    const selectTankBackground = (tankId: string) =>
      g.selectAll<SVGRectElement, ChartTankData>('.capacity-bg')
        .filter((datum) => datum?.id === tankId);
    const selectTankBar = (tankId: string) =>
      g.selectAll<SVGRectElement, ChartTankData>('.fill-bar')
        .filter((datum) => datum?.id === tankId);

    // Define scales
    const yScale = d3.scaleBand()
      .domain(tanks.map((d) => d.name))
      .range([0, height])
      .padding(0.35);

    const maxCapacity = d3.max(tanks, (d) => d.capacity) || 1000;
    // Stretch x scale to max capacity found in winery
    const xScale = d3.scaleLinear()
      .domain([0, maxCapacity])
      .range([0, width]);

    // Color mapper based on Tank status
    const getFillColor = (status: string) => {
      switch (status) {
        case 'fermenting':
          return '#b91c1c'; // Rich cherry red
        case 'occupied':
        case 'storage':
          return '#581c1c'; // Dark wine burgundy
        case 'cleaning':
        case 'maintenance':
          return '#d97706'; // Warn amber/yellow
        default:
          return '#cbd5e1'; // Empty or unassigned (slate-300)
      }
    };

    // Draw background tracks representing maximum vessel capacity
    g.selectAll('.capacity-bg')
      .data(tanks)
      .enter()
      .append('rect')
      .attr('class', 'capacity-bg')
      .attr('data-tank-id', (d) => d.id)
      .attr('y', (d) => yScale(d.name) || 0)
      .attr('x', 0)
      .attr('width', (d) => xScale(d.capacity))
      .attr('height', yScale.bandwidth())
      .attr('rx', 6) // Rounded corners for smooth modern feel
      .attr('ry', 6)
      .style('fill', (d) => d.id === selectedTankId ? '#faf7f5' : '#f1f5f9')
      .style('stroke', (d) => {
        if (d.id === selectedTankId) return '#801323';
        return (d.capacity > 0 && d.currentVolume / d.capacity > 0.95) ? '#ef4444' : '#e2e8f0';
      })
      .style('stroke-width', (d) => {
        if (d.id === selectedTankId) return '2px';
        return (d.capacity > 0 && d.currentVolume / d.capacity > 0.95) ? '1.5px' : '1px';
      })
      .style('stroke-dasharray', (d) => {
        if (d.id === selectedTankId) return 'none';
        return (d.capacity > 0 && d.currentVolume / d.capacity > 0.95) ? '3, 2' : 'none';
      })
      .style('cursor', 'pointer')
      .on('mouseenter', function(event, d) {
        selectTankRects(d.id)
          .transition()
          .duration(150)
          .attr('height', yScale.bandwidth() + 4)
          .attr('y', (yScale(d.name) || 0) - 2);

        selectTankBackground(d.id).transition().duration(150).style('fill', '#e2e8f0');
        selectTankBar(d.id).transition().duration(150).style('opacity', 0.85);

        const [x, y] = d3.pointer(event, containerRef.current);
        setHoveredTank({
          x,
          y,
          name: d.name,
          volume: d.currentVolume,
          capacity: d.capacity,
          pct: d.capacity > 0 ? Math.round((d.currentVolume / d.capacity) * 100) : 0
        });
      })
      .on('mousemove', function(event, d) {
        const [x, y] = d3.pointer(event, containerRef.current);
        setHoveredTank({
          x,
          y,
          name: d.name,
          volume: d.currentVolume,
          capacity: d.capacity,
          pct: d.capacity > 0 ? Math.round((d.currentVolume / d.capacity) * 100) : 0
        });
      })
      .on('mouseleave', function(event, d) {
        selectTankRects(d.id)
          .transition()
          .duration(150)
          .attr('height', yScale.bandwidth())
          .attr('y', yScale(d.name) || 0);

        selectTankBackground(d.id).transition().duration(150).style('fill', '#f1f5f9');
        selectTankBar(d.id).transition().duration(150).style('opacity', 1.0);

        setHoveredTank(null);
      })
      .on('click', (event, d) => {
        onSelectTank?.(d.id);
      });
 
     // Draw foreground progress bars representing current levels
     const activeBars = g.selectAll('.fill-bar')
       .data(tanks)
       .enter()
       .append('rect')
       .attr('class', 'fill-bar')
       .attr('data-tank-id', (d) => d.id)
       .attr('y', (d) => yScale(d.name) || 0)
       .attr('x', 0)
       .attr('height', yScale.bandwidth())
       .attr('rx', 6)
       .attr('ry', 6)
       .style('fill', (d) => getFillColor(d.status))
       .style('stroke', (d) => d.id === selectedTankId ? 'rgba(255, 255, 255, 0.85)' : 'none')
       .style('stroke-width', (d) => d.id === selectedTankId ? '1.5px' : '0px')
       .style('stroke-dasharray', (d) => d.id === selectedTankId ? '2, 1' : 'none')
       .style('cursor', 'pointer')
       .on('mouseenter', function(event, d) {
         selectTankRects(d.id)
           .transition()
           .duration(150)
           .attr('height', yScale.bandwidth() + 4)
           .attr('y', (yScale(d.name) || 0) - 2);
 
         selectTankBackground(d.id).transition().duration(150).style('fill', '#e2e8f0');
         selectTankBar(d.id).transition().duration(150).style('opacity', 0.85);
 
         const [x, y] = d3.pointer(event, containerRef.current);
         setHoveredTank({
           x,
           y,
           name: d.name,
           volume: d.currentVolume,
           capacity: d.capacity,
           pct: d.capacity > 0 ? Math.round((d.currentVolume / d.capacity) * 100) : 0
         });
       })
       .on('mousemove', function(event, d) {
         const [x, y] = d3.pointer(event, containerRef.current);
         setHoveredTank({
           x,
           y,
           name: d.name,
           volume: d.currentVolume,
           capacity: d.capacity,
           pct: d.capacity > 0 ? Math.round((d.currentVolume / d.capacity) * 100) : 0
         });
       })
       .on('mouseleave', function(event, d) {
         selectTankRects(d.id)
           .transition()
           .duration(150)
           .attr('height', yScale.bandwidth())
           .attr('y', yScale(d.name) || 0);
 
         selectTankBackground(d.id).transition().duration(150).style('fill', '#f1f5f9');
         selectTankBar(d.id).transition().duration(150).style('opacity', 1.0);
 
         setHoveredTank(null);
       })
       .on('click', (event, d) => {
         onSelectTank?.(d.id);
       });

    // Simple fade-in and horizontal scale transition
    activeBars
      .transition()
      .duration(850)
      .ease(d3.easeCubicOut)
      .attr('width', (d) => xScale(d.currentVolume));

    // Text label for vessel identity with warning indicator if over 95%
    const yAxisG = g.append('g')
      .attr('class', 'y-axis')
      .style('font-family', 'var(--font-sans), system-ui, sans-serif')
      .style('font-size', '11px')
      .style('color', '#475569')
      .call(d3.axisLeft(yScale).tickSize(0));

    yAxisG.select('.domain').remove();

    yAxisG.selectAll('.tick text')
      .text((name) => {
        const d = tanks.find((t) => t.name === name);
        if (d && d.id === selectedTankId) {
          return `▶ ${name}`;
        }
        if (d && d.capacity > 0 && d.currentVolume / d.capacity > 0.95) {
          return `⚠️ ${name}`;
        }
        return (name as string) || '';
      })
      .style('fill', (name) => {
        const d = tanks.find((t) => t.name === name);
        if (d && d.id === selectedTankId) {
          return '#801323';
        }
        if (d && d.capacity > 0 && d.currentVolume / d.capacity > 0.95) {
          return '#b91c1c';
        }
        return '#334155';
      })
      .style('font-weight', (name) => {
        const d = tanks.find((t) => t.name === name);
        if (d && (d.id === selectedTankId || (d.capacity > 0 && d.currentVolume / d.capacity > 0.95))) {
          return '700';
        }
        return '600';
      })
      .style('cursor', 'pointer')
      .on('click', (event, name) => {
        const d = tanks.find((t) => t.name === name);
        if (d) {
          onSelectTank?.(d.id);
        }
      });

    // Custom formatting for X axis (Volume tick lines in liters)
    const xAxis = d3.axisBottom(xScale)
      .ticks(Math.min(5, width / 120))
      .tickFormat((v) => `${Number(v).toLocaleString()} L`);

    const xAxisG = g.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0, ${height})`)
      .style('font-family', 'var(--font-mono), monospace')
      .style('font-size', '9px')
      .style('color', '#94a3b8')
      .call(xAxis);

    xAxisG.selectAll('.tick line')
      .attr('stroke', '#f8fafc')
      .attr('y2', -height); // Grid lines behind bars

    xAxisG.select('.domain').remove(); // Hide basic axis line for floating aesthetic

    // Add labels stating the percentage and active volume counts
    const labels = g.selectAll('.volume-meta')
      .data(tanks)
      .enter()
      .append('g')
      .attr('class', 'volume-meta')
      .attr('transform', (d) => `translate(${xScale(d.capacity) + 12}, ${(yScale(d.name) || 0) + yScale.bandwidth() / 2 + 3.5})`)
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        onSelectTank?.(d.id);
      });

    labels.append('text')
      .style('font-family', 'var(--font-mono), monospace')
      .style('font-size', '10px')
      .attr('class', 'font-semibold')
      .style('fill', (d) => (d.capacity > 0 && d.currentVolume / d.capacity > 0.95) ? '#ef4444' : '#0f172a')
      .text((d) => {
        const pct = d.capacity > 0 ? Math.round((d.currentVolume / d.capacity) * 100) : 0;
        return `${pct}%`;
      });

    labels.append('text')
      .style('font-family', 'var(--font-mono), monospace')
      .style('font-size', '9px')
      .style('fill', (d) => (d.capacity > 0 && d.currentVolume / d.capacity > 0.95) ? '#ef4444' : '#64748b')
      .attr('dx', '32px')
      .text((d) => `(${(d.currentVolume ?? 0).toLocaleString()}/${(d.capacity ?? 0).toLocaleString()} L)`);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tanksKey, dimensions, selectedTankId]);

  return (
    <div className="w-full flex flex-col space-y-2">
      <div 
        ref={containerRef} 
        id="d3-tank-capacity-container" 
        className="relative w-full bg-[#FCFAF7] border border-[#f0e6da] rounded-xl p-3 overflow-hidden select-none"
      >
        <svg 
          ref={svgRef} 
          width={dimensions.width} 
          height={dimensions.height}
          className="overflow-visible block max-w-full"
        />
        {hoveredTank && (
          <div 
            className="absolute pointer-events-none bg-stone-950/95 text-white text-[11px] px-3 py-2 rounded-lg shadow-md border border-stone-800 flex flex-col gap-1.5 z-40 transition-all duration-75"
            style={{ 
              left: `${hoveredTank.x}px`, 
              top: `${hoveredTank.y}px`,
              transform: 'translate(10px, -50%)'
            }}
          >
            <span className="font-sans font-bold text-stone-200">{hoveredTank.name}</span>
            <div className="font-mono text-[10px] space-y-0.5">
              <div className="flex justify-between gap-4">
                <span className="text-stone-400">Volume:</span>
                <span className="text-amber-150 font-bold">{(hoveredTank.volume ?? 0).toLocaleString()} L</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-stone-400">Capacity:</span>
                <span className="text-amber-150 font-bold">{(hoveredTank.capacity ?? 0).toLocaleString()} L</span>
              </div>
              <div className="flex justify-between gap-4 pt-1 border-t border-stone-800">
                <span className="text-stone-400">Utilization:</span>
                <span className="text-emerald-400 font-bold">{hoveredTank.pct}%</span>
              </div>
              <div className="text-[9px] text-amber-500/80 border-t border-dashed border-stone-800 pt-1.5 text-center font-sans tracking-wide">
                <span>🖱️ Click to open detailed panel</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
