export type LineageNodeType =
  | 'grape_intake'
  | 'wine_lot'
  | 'blend'
  | 'transfer'
  | 'cellar_operation'
  | 'bottling'
  | 'storage'
  | 'reservation'
  | 'dispatch'
  | 'certification';

export type LineageEdgeType =
  | 'created'
  | 'transferred'
  | 'blended'
  | 'operated'
  | 'bottled'
  | 'stored'
  | 'reserved'
  | 'sold'
  | 'certified';

export interface LineageNode {
  id: string;
  type: LineageNodeType;
  label: string;
  subtitle?: string;
  lotId?: string;
  date?: string;
  volumeL?: number;
  bottles?: number;
  emphasis?: boolean;
  metadata?: Record<string, unknown>;
}

export interface LineageEdge {
  id: string;
  from: string;
  to: string;
  type: LineageEdgeType;
  label?: string;
  volumeL?: number;
  bottles?: number;
  date?: string;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

export interface PositionedLineageNode extends LineageNode {
  x: number;
  y: number;
  depth: number;
}

export interface PositionedLineageGraph {
  nodes: PositionedLineageNode[];
  edges: LineageEdge[];
  width: number;
  height: number;
  hasCycle: boolean;
}
