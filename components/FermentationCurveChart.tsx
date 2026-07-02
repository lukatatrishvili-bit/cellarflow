'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import * as d3 from 'd3';
import type { DailyFermLog } from '../lib/wineryState';

interface FermentationCurveChartProps {
  logs: DailyFermLog[];
  selectedLotId: string;
}

export default function FermentationCurveChart({ logs, selectedLotId }: FermentationCurveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [hoveredPoint, setHoveredPoint] = useState<DailyFermLog | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Filter and sort logs chronologically for the selected lot
  const activeLogs = useMemo(() => {
    return logs
      .filter((log) => log.lotId === selectedLotId)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [logs, selectedLotId]);

  // Content fingerprint: the D3 redraw must key on WHAT the data is, not the
  // array identity — sync responses replace arrays with identical content, and
  // an identity-keyed effect would wipe the SVG and replay the 1.2s draw
  // animation on every pass (visible as a flashing chart).
  const activeLogsKey = useMemo(() => JSON.stringify(activeLogs), [activeLogs]);

  // Calculate forecast metrics
  const forecastInfo = useMemo(() => {
    const latestLog = activeLogs[activeLogs.length - 1];
    if (!latestLog) return null;

    let slope = -0.008; // default
    let isStuck = false;
    let slopeValForDisplay = 0.008;

    if (activeLogs.length >= 2) {
      const logsForSlope = activeLogs.slice(-3);
      const first = logsForSlope[0];
      const last = logsForSlope[logsForSlope.length - 1];
      const timeDiffDays = (new Date(last.date).getTime() - new Date(first.date).getTime()) / (24 * 60 * 60 * 1000);
      if (timeDiffDays > 0) {
        const calcSlope = (last.density - first.density) / timeDiffDays;
        slopeValForDisplay = Math.abs(calcSlope);
        if (calcSlope < 0) {
          slope = calcSlope;
        } else {
          isStuck = true;
        }
      }
    }

    let daysToDryVal = 0;
    if (latestLog.density <= 0.990) {
      daysToDryVal = 0;
    } else if (!isStuck) {
      daysToDryVal = (latestLog.density - 0.990) / Math.abs(slope);
    }

    const dryDate = new Date(new Date(latestLog.date).getTime() + daysToDryVal * 24 * 60 * 60 * 1000);
    const dateOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    const dateStr = dryDate.toLocaleDateString('en-US', dateOptions);

    return {
      isStuck,
      days: daysToDryVal.toFixed(1),
      dateStr,
      slopeText: `-${slopeValForDisplay.toFixed(4)}`,
      latestDensity: latestLog.density,
      daysToDryVal
    };
  }, [activeLogs]);

  // Listen to window / container sizing
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width } = entries[0].contentRect;
      const roundedWidth = Math.max(100, Math.round(width));
      setDimensions((prev) => {
        if (prev.width === roundedWidth && prev.height === 320) {
          return prev;
        }
        return { width: roundedWidth, height: 320 };
      });
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Render D3 chart
  useEffect(() => {
    if (!svgRef.current || dimensions.width === 0 || dimensions.height === 0 || activeLogs.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Responsive margins supporting double Y-Axis
    const margin = { top: 30, right: 60, bottom: 40, left: 60 };
    const width = dimensions.width - margin.left - margin.right;
    const height = dimensions.height - margin.top - margin.bottom;

    if (width <= 0 || height <= 0) return;

    // Outer holder g element
    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    // Parse Dates & calculate expected curve
    const parseTime = d3.timeParse('%Y-%m-%d');
    const startTime = parseTime(activeLogs[0].date)?.getTime() || new Date(activeLogs[0].date).getTime();
    const startDensity = activeLogs[0].density;

    const formattedData = activeLogs.map((d) => {
      const parsedDate = parseTime(d.date) || new Date(d.date);
      const daysElapsed = (parsedDate.getTime() - startTime) / (24 * 60 * 60 * 1000);
      const targetDuration = 14;
      const f = 0.5 * (1 - Math.cos(Math.min(1, daysElapsed / targetDuration) * Math.PI));
      const targetDensity = startDensity - (startDensity - 0.990) * f;
      
      return {
        ...d,
        parsedDate,
        targetDensity
      };
    });

    // Calculate forecast metrics for D3 drawing
    const latestLog = activeLogs[activeLogs.length - 1];
    let slope = -0.008; // default
    let isStuck = false;
    let slopeValForDisplay = 0.008;

    if (activeLogs.length >= 2) {
      const logsForSlope = activeLogs.slice(-3);
      const first = logsForSlope[0];
      const last = logsForSlope[logsForSlope.length - 1];
      const timeDiffDays = (new Date(last.date).getTime() - new Date(first.date).getTime()) / (24 * 60 * 60 * 1000);
      if (timeDiffDays > 0) {
        const calcSlope = (last.density - first.density) / timeDiffDays;
        slopeValForDisplay = Math.abs(calcSlope);
        if (calcSlope < 0) {
          slope = calcSlope;
        } else {
          isStuck = true;
        }
      }
    }

    let daysToDryVal = 0;
    if (latestLog && latestLog.density > 0.990 && !isStuck) {
      daysToDryVal = (latestLog.density - 0.990) / Math.abs(slope);
    }

    const dryDate = new Date(new Date(latestLog ? latestLog.date : Date.now()).getTime() + daysToDryVal * 24 * 60 * 60 * 1000);

    // Scales
    // X Scale: Time
    const dateExtent = d3.extent(formattedData, (d) => d.parsedDate) as [Date, Date];
    let endDomainDate = d3.timeDay.offset(dateExtent[1], 0.2);
    
    // Extend xDomain to forecasted dryDate if within reasonable limits (e.g. 25 days)
    const showForecastLine = !isStuck && daysToDryVal > 0 && latestLog && latestLog.density > 0.990 && daysToDryVal <= 25;
    if (showForecastLine) {
      endDomainDate = d3.timeDay.offset(dryDate, 0.5);
    }

    // Add tiny pad to ends
    const xScale = d3.scaleTime()
      .domain([
        d3.timeDay.offset(dateExtent[0], -0.2),
        endDomainDate,
      ])
      .range([0, width]);

    // Left Y Scale: Sugar (g/L)
    const maxSugar = d3.max(formattedData, (d) => d.sugar) || 250;
    const ySugarScale = d3.scaleLinear()
      .domain([0, maxSugar + 15])
      .range([height, 0]);

    // Right Y Scale: Density Specific Gravity (SG)
    const minSG = d3.min(formattedData, (d) => d.density) || 0.990;
    const maxSG = d3.max(formattedData, (d) => d.density) || 1.110;
    const yDensityScale = d3.scaleLinear()
      .domain([minSG - 0.005, maxSG + 0.005])
      .range([height, 0]);

    // Draw grid background lines
    const yGrid = d3.axisLeft(ySugarScale)
      .tickSize(-width)
      .tickFormat(() => '');

    g.append('g')
      .attr('class', 'y-grid-lines')
      .style('color', '#f1f5f9')
      .style('stroke-dasharray', '3, 3')
      .call(yGrid)
      .select('.domain').remove();

    // Line and Area generators
    // Sugar Curve (crimson/wine)
    const sugarLineGen = d3.line<any>()
      .x((d) => xScale(d.parsedDate))
      .y((d) => ySugarScale(d.sugar))
      .curve(d3.curveMonotoneX);

    const sugarAreaGen = d3.area<any>()
      .x((d) => xScale(d.parsedDate))
      .y0(height)
      .y1((d) => ySugarScale(d.sugar))
      .curve(d3.curveMonotoneX);

    // Density Curve (gold/amber)
    const densityLineGen = d3.line<any>()
      .x((d) => xScale(d.parsedDate))
      .y((d) => yDensityScale(d.density))
      .curve(d3.curveMonotoneX);

    // Render gradients
    const svgDefs = svg.append('defs');

    // Sugar Area linear gradient
    const sugarGrad = svgDefs.append('linearGradient')
      .attr('id', 'sugar-area-gradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    sugarGrad.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#801323')
      .attr('stop-opacity', 0.2);

    sugarGrad.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#801323')
      .attr('stop-opacity', 0.0);

    // Draw Sugar Area Path (underneath the lines)
    const sugarArea = g.append('path')
      .datum(formattedData)
      .attr('fill', 'url(#sugar-area-gradient)')
      .attr('d', sugarAreaGen)
      .style('opacity', 0);

    sugarArea.transition()
      .delay(200)
      .duration(1200)
      .style('opacity', 1);

    // Draw Sugar Curve Path
    const sugarPath = g.append('path')
      .datum(formattedData)
      .attr('fill', 'none')
      .attr('stroke', '#801323') // Classic Georgian wine crimson
      .attr('stroke-width', 3)
      .attr('className', 'sugar-path')
      .attr('d', sugarLineGen);

    // Dash array reveal animation for Sugar line
    const totalLengthSugar = sugarPath.node() ? (sugarPath.node() as SVGPathElement).getTotalLength() : 0;
    sugarPath
      .attr('stroke-dasharray', `${totalLengthSugar} ${totalLengthSugar}`)
      .attr('stroke-dashoffset', totalLengthSugar)
      .transition()
      .duration(1200)
      .ease(d3.easeCubicOut)
      .attr('stroke-dashoffset', 0);

    // Draw Density Curve Path
    const densityPath = g.append('path')
      .datum(formattedData)
      .attr('fill', 'none')
      .attr('stroke', '#d97706') // Amber Kakhuri clay gold
      .attr('stroke-width', 2.5)
      .attr('stroke-dasharray', '5, 3') // Dashed to distinguish
      .attr('d', densityLineGen);

    // Draw Target Reference Density Curve Path
    const targetDensityLineGen = d3.line<any>()
      .x((d) => xScale(d.parsedDate))
      .y((d) => yDensityScale(d.targetDensity))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(formattedData)
      .attr('fill', 'none')
      .attr('stroke', '#94a3b8') // Soft slate gray
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '2, 3')
      .attr('d', targetDensityLineGen);

    const totalLengthDensity = densityPath.node() ? (densityPath.node() as SVGPathElement).getTotalLength() : 0;
    densityPath
      .attr('stroke-dashoffset', totalLengthDensity)
      .attr('stroke-dasharray', `${totalLengthDensity} ${totalLengthDensity}`)
      .transition()
      .delay(200)
      .duration(1200)
      .ease(d3.easeCubicOut)
      .attr('stroke-dashoffset', 0);

    // Draw Forecast Projection Line (Dotted)
    if (showForecastLine && latestLog) {
      const forecastPoints = [
        { parsedDate: new Date(latestLog.date), density: latestLog.density },
        { parsedDate: dryDate, density: 0.990 }
      ];

      const forecastLineGen = d3.line<any>()
        .x((d) => xScale(d.parsedDate))
        .y((d) => yDensityScale(d.density));

      g.append('path')
        .datum(forecastPoints)
        .attr('fill', 'none')
        .attr('stroke', '#d97706')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '3, 4')
        .attr('d', forecastLineGen);

      // Add a small node at the dry point
      g.append('circle')
        .attr('cx', xScale(dryDate))
        .attr('cy', yDensityScale(0.990))
        .attr('r', 4.5)
        .style('fill', '#ffffff')
        .style('stroke', '#d97706')
        .style('stroke-width', 2);

      // Add a text label above the dry point
      g.append('text')
        .attr('x', xScale(dryDate))
        .attr('y', yDensityScale(0.990) - 10)
        .attr('text-anchor', 'middle')
        .style('font-family', 'var(--font-mono), monospace')
        .style('font-size', '8px')
        .style('fill', '#d97706')
        .style('font-weight', 'bold')
        .text('Est. Dry');
    }

    // Draw Axes
    // X-Axis (Date)
    const xAxis = d3.axisBottom(xScale)
      .ticks(Math.min(activeLogs.length, 8))
      .tickFormat(d3.timeFormat('%b %d') as any);

    g.append('g')
      .attr('transform', `translate(0, ${height})`)
      .style('font-family', 'var(--font-mono), monospace')
      .style('font-size', '9px')
      .style('color', '#64748b')
      .call(xAxis)
      .select('.domain').style('stroke', '#cbd5e1');

    // Left Axis: Sugar (g/L)
    const yLeftAxis = d3.axisLeft(ySugarScale)
      .ticks(6)
      .tickFormat((v) => `${v} g/L`);

    g.append('g')
      .style('font-family', 'var(--font-mono), monospace')
      .style('font-size', '9px')
      .style('color', '#801323')
      .call(yLeftAxis)
      .select('.domain').remove();

    // Right Axis: Density (SG)
    const yRightAxis = d3.axisRight(yDensityScale)
      .ticks(6)
      .tickFormat((v) => d3.format('.3f')(v));

    g.append('g')
      .attr('transform', `translate(${width}, 0)`)
      .style('font-family', 'var(--font-mono), monospace')
      .style('font-size', '9px')
      .style('color', '#d97706')
      .call(yRightAxis)
      .select('.domain').remove();

    // Append beautiful interactive scatter points
    // Sugar nodes (Ruby circles)
    g.selectAll('.sugar-point')
      .data(formattedData)
      .enter()
      .append('circle')
      .attr('class', 'sugar-point')
      .attr('cx', (d) => xScale(d.parsedDate))
      .attr('cy', (d) => ySugarScale(d.sugar))
      .attr('r', 5)
      .style('fill', '#ffffff')
      .style('stroke', '#801323')
      .style('stroke-width', 2)
      .style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select(this).transition().duration(150).attr('r', 8);
        setHoveredPoint(d);
        // Calculate tooltip position
        const [x, y] = d3.pointer(event, svgRef.current);
        setTooltipPos({ x: x + 15, y: y - 10 });
      })
      .on('mousemove', function (event) {
        const [x, y] = d3.pointer(event, svgRef.current);
        setTooltipPos({ x: x + 15, y: y - 10 });
      })
      .on('mouseleave', function () {
        d3.select(this).transition().duration(150).attr('r', 5);
        setHoveredPoint(null);
      });

    // Density nodes (Amber circles)
    g.selectAll('.density-point')
      .data(formattedData)
      .enter()
      .append('circle')
      .attr('class', 'density-point')
      .attr('cx', (d) => xScale(d.parsedDate))
      .attr('cy', (d) => yDensityScale(d.density))
      .attr('r', 4.5)
      .style('fill', '#ffffff')
      .style('stroke', '#d97706')
      .style('stroke-width', 2)
      .style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select(this).transition().duration(150).attr('r', 7.5);
        setHoveredPoint(d);
        const [x, y] = d3.pointer(event, svgRef.current);
        setTooltipPos({ x: x + 15, y: y - 10 });
      })
      .on('mousemove', function (event) {
        const [x, y] = d3.pointer(event, svgRef.current);
        setTooltipPos({ x: x + 15, y: y - 10 });
      })
      .on('mouseleave', function () {
        d3.select(this).transition().duration(150).attr('r', 4.5);
        setHoveredPoint(null);
      });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLogsKey, dimensions]);

  return (
    <div className="w-full relative select-none">
      {activeLogs.length === 0 ? (
        <div className="h-48 border border-[#e8dfd5] border-dashed rounded-xl bg-[#FAF8F5] flex flex-col items-center justify-center text-slate-400 p-4">
          <p className="text-xs font-semibold">No fermentation tracking records found on selected Wine Lot.</p>
          <p className="text-[10px] mt-1">Select an active fermenting lot or post a Daily Log to trace curves.</p>
        </div>
      ) : (
        <div ref={containerRef} className="w-full bg-[#FCFAF8] border border-[#f0e6da] rounded-xl p-3 relative pt-14">
          {/* Overlay forecast badge */}
          {forecastInfo && (
            <div className="absolute top-3 left-3 flex items-center gap-2 z-10 animate-fade-in">
              {forecastInfo.latestDensity <= 0.990 ? (
                <div className="bg-emerald-950/90 text-emerald-300 text-[10px] font-mono px-3 py-1.5 rounded-xl border border-emerald-800 shadow-md backdrop-blur-xs flex items-center gap-2 font-bold">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
                  <span>Lot is Dry (SG ≤ 0.990)</span>
                </div>
              ) : forecastInfo.isStuck ? (
                <div className="bg-rose-950/90 text-rose-300 text-[10px] font-mono px-3 py-1.5 rounded-xl border border-rose-800 shadow-md backdrop-blur-xs flex items-center gap-2 font-bold animate-pulse">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                  <span>Fermentation Stuck / Flatline (Slope: {forecastInfo.slopeText} SG/day)</span>
                </div>
              ) : (
                <div className="bg-[#1e2f23]/95 text-emerald-250 text-[10px] font-mono px-3 py-1.5 rounded-xl border border-emerald-900 shadow-md backdrop-blur-xs flex items-center gap-2 font-bold">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
                  <span>Projected Dry: {forecastInfo.days} days ({forecastInfo.dateStr}) | Rate: {forecastInfo.slopeText} SG/day</span>
                </div>
              )}
            </div>
          )}

          <svg 
            ref={svgRef} 
            width={dimensions.width} 
            height={dimensions.height}
            className="overflow-visible block max-w-full"
          />

          {/* D3 Multi-axis Legends */}
          <div className="flex items-center justify-center gap-6 mt-2 text-[10px] font-mono font-semibold text-slate-500">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-[#801323] inline-block"></span>
              <span className="w-2 h-2 rounded-full border border-[#801323] bg-white inline-block -ml-3 mr-1"></span>
              <span className="text-[#801323]">Sugar Depletion (g/L)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-[#d97706] border-dashed border-t-2 border-spacing-2 inline-block"></span>
              <span className="w-2 h-2 rounded-full border border-[#d97706] bg-white inline-block -ml-3 mr-1"></span>
              <span className="text-[#d97706]">Alcohol Density (SG Gravity)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-[#94a3b8] border-dashed inline-block"></span>
              <span className="text-[#94a3b8]">Target Kinetic Profile (SG)</span>
            </div>
          </div>
        </div>
      )}

      {/* Floating Interactive Hover Tooltip Card */}
      {hoveredPoint && (
        <div 
          className="absolute z-50 pointer-events-none bg-stone-900/95 text-stone-100 p-3 rounded-lg shadow-xl border border-stone-850 text-xs w-64 space-y-2 backdrop-blur-xs font-sans"
          style={{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px` }}
        >
          <div className="flex items-center justify-between border-b border-stone-800 pb-1 font-mono text-[10px] text-stone-400">
            <span>Date: {hoveredPoint.date}</span>
            <span>Tank: {hoveredPoint.tankId}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            <div>
              <span className="text-stone-400 text-[10px] block">Sugar:</span>
              <strong className="text-rose-400 font-bold">{hoveredPoint.sugar} g/L</strong>
            </div>
            <div>
              <span className="text-stone-400 text-[10px] block">Density:</span>
              <strong className="text-amber-400 font-mono font-bold">
                {hoveredPoint.density} SG <span className="text-stone-500 font-normal">({(hoveredPoint as any).targetDensity?.toFixed(3)} target)</span>
              </strong>
            </div>
            <div>
              <span className="text-stone-400 text-[10px] block">Temperature:</span>
              <strong className="text-stone-200">{hoveredPoint.temperature} °C</strong>
            </div>
            <div>
              <span className="text-stone-400 text-[10px] block">pH Level:</span>
              <strong className="text-stone-200">{hoveredPoint.ph} pH</strong>
            </div>
          </div>
          {hoveredPoint.tastingNotes && (
            <div className="border-t border-stone-800 pt-1 text-[11px] text-stone-300 italic font-serif">
              &quot;{hoveredPoint.tastingNotes}&quot;
            </div>
          )}
          <div className="text-[10px] text-stone-400 flex flex-wrap gap-x-2 border-t border-stone-800 pt-1">
            <span>Cap: {hoveredPoint.capManagement || 'None'}</span>
            {hoveredPoint.additives && hoveredPoint.additives !== 'None' && (
              <span className="text-orange-400">Nutrients: {hoveredPoint.additives}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
