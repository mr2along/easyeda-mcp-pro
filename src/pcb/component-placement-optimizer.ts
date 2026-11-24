/**
 * Deterministic, geometry-aware PCB component placement optimizer.
 *
 * This is a pure proposal engine. It consumes normalized board/footprint/net data
 * and never writes to EasyEDA. All coordinates are millimetres; component x/y is
 * the footprint origin and courtyard/pad coordinates are local to that origin.
 */

export interface Point2D { x: number; y: number }
export interface PlacementPolygon { id?: string; points: Point2D[] }

export interface PlacementPad {
  id: string;
  x: number;
  y: number;
  net?: string;
}

export interface PlacementComponent {
  ref: string;
  /** Existing placement; omit x/y to request initial placement. */
  x?: number;
  y?: number;
  rotationDeg?: 0 | 90 | 180 | 270;
  courtyard: Point2D[];
  pads?: PlacementPad[];
  fixed?: boolean;
  group?: string;
  /** Larger values keep this component closer to its connected peers. */
  placementPriority?: number;
  /** Preferred distance from board edge, in mm. */
  edgeClearanceMm?: number;
}

export interface PlacementNet {
  name: string;
  pins: Array<{ ref: string; padId: string }>;
  weight?: number;
  critical?: boolean;
}

export interface PlacementBoard {
  outline: Point2D[];
  edgeClearanceMm?: number;
  componentClearanceMm?: number;
  gridMm?: number;
  keepouts?: PlacementPolygon[];
}

export interface PlacementOptions {
  iterations?: number;
  seed?: number;
  initialTemperature?: number;
  coolingRate?: number;
  maxInitialPlacementCandidates?: number;
}

export interface PlacedComponent {
  ref: string;
  x: number;
  y: number;
  rotationDeg: 0 | 90 | 180 | 270;
  fixed: boolean;
}

export interface PlacementMetrics {
  weightedHpwlMm: number;
  totalHpwlMm: number;
  estimatedNetCount: number;
  routingPressureIndex: number;
  groupDispersionMm: number;
  boardUtilization: number;
  placedCount: number;
  componentCount: number;
  objective: number;
}

export interface PlacementResult {
  status: 'PREVIEW_READY' | 'PARTIAL' | 'NO_FEASIBLE_PLACEMENT';
  placements: PlacedComponent[];
  metrics: PlacementMetrics;
  blockers: string[];
  warnings: string[];
  iterations: number;
  seed: number;
  requiresHumanApproval: true;
  nativeWritePerformed: false;
}

interface InternalPlacement {
  component: PlacementComponent;
  x: number;
  y: number;
  rotationDeg: 0 | 90 | 180 | 270;
}

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

const ROTATIONS = [0, 90, 180, 270] as const;
const EPSILON = 1e-7;

function rotatePoint(point: Point2D, rotation: number): Point2D {
  const radians = rotation * Math.PI / 180;
  const cos = Math.round(Math.cos(radians));
  const sin = Math.round(Math.sin(radians));
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

function transformPolygon(component: InternalPlacement): Point2D[] {
  return component.component.courtyard.map((point) => {
    const rotated = rotatePoint(point, component.rotationDeg);
    return { x: rotated.x + component.x, y: rotated.y + component.y };
  });
}

function transformPad(component: InternalPlacement, pad: PlacementPad): Point2D {
  const rotated = rotatePoint(pad, component.rotationDeg);
  return { x: rotated.x + component.x, y: rotated.y + component.y };
}

function boundsOf(points: Point2D[]): Bounds {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

function cross(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point2D, b: Point2D, p: Point2D): boolean {
  return Math.abs(cross(a, b, p)) < EPSILON &&
    p.x >= Math.min(a.x, b.x) - EPSILON && p.x <= Math.max(a.x, b.x) + EPSILON &&
    p.y >= Math.min(a.y, b.y) - EPSILON && p.y <= Math.max(a.y, b.y) + EPSILON;
}

function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
      ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (onSegment(a, b, point)) return true;
    const crosses = (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function distancePointSegment(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function polygonEdges(polygon: Point2D[]): Array<[Point2D, Point2D]> {
  return polygon.map((point, index) => [point, polygon[(index + 1) % polygon.length]!] as [Point2D, Point2D]);
}

function polygonsIntersect(a: Point2D[], b: Point2D[]): boolean {
  if (a.some((p) => pointInPolygon(p, b)) || b.some((p) => pointInPolygon(p, a))) return true;
  return polygonEdges(a).some(([a1, a2]) =>
    polygonEdges(b).some(([b1, b2]) => segmentsIntersect(a1, a2, b1, b2)));
}

function polygonDistance(a: Point2D[], b: Point2D[]): number {
  if (polygonsIntersect(a, b)) return 0;
  let minimum = Number.POSITIVE_INFINITY;
  for (const [a1, a2] of polygonEdges(a)) {
    for (const [b1, b2] of polygonEdges(b)) {
      minimum = Math.min(minimum, distancePointSegment(a1, b1, b2), distancePointSegment(b1, a1, a2));
    }
  }
  return minimum;
}

function polygonInsideBoard(
  footprint: Point2D[],
  outline: Point2D[],
  clearance: number,
): boolean {
  if (!footprint.every((point) => pointInPolygon(point, outline))) return false;
  const boardEdges = polygonEdges(outline);
  for (const [a, b] of polygonEdges(footprint)) {
    if (boardEdges.some(([c, d]) => segmentsIntersect(a, b, c, d))) return false;
  }
  return footprint.every((point) =>
    boardEdges.every(([a, b]) => distancePointSegment(point, a, b) + EPSILON >= clearance));
}

function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

function legalPlacement(
  candidate: InternalPlacement,
  placed: InternalPlacement[],
  board: PlacementBoard,
): boolean {
  const shape = transformPolygon(candidate);
  const edgeClearance = Math.max(board.edgeClearanceMm ?? 0, candidate.component.edgeClearanceMm ?? 0);
  if (!polygonInsideBoard(shape, board.outline, edgeClearance)) return false;
  for (const keepout of board.keepouts ?? []) {
    if (polygonsIntersect(shape, keepout.points)) return false;
  }
  const spacing = board.componentClearanceMm ?? 0;
  for (const other of placed) {
    if (other.component.ref === candidate.component.ref) continue;
    if (polygonDistance(shape, transformPolygon(other)) + EPSILON < spacing) return false;
  }
  return true;
}

function netCoordinates(
  net: PlacementNet,
  placements: InternalPlacement[],
): Point2D[] {
  const result: Point2D[] = [];
  for (const pin of net.pins) {
    const item = placements.find((placement) => placement.component.ref === pin.ref);
    const pad = item?.component.pads?.find((candidate) => candidate.id === pin.padId);
    if (item && pad) result.push(transformPad(item, pad));
  }
  return result;
}

function hpwl(points: Point2D[]): number {
  if (points.length < 2) return 0;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys);
}

function computeMetrics(
  placements: InternalPlacement[],
  components: PlacementComponent[],
  nets: PlacementNet[],
  board: PlacementBoard,
): PlacementMetrics {
  let totalHpwlMm = 0;
  let weightedHpwlMm = 0;
  let estimatedNetCount = 0;
  for (const net of nets) {
    const points = netCoordinates(net, placements);
    if (points.length < 2) continue;
    const length = hpwl(points);
    totalHpwlMm += length;
    weightedHpwlMm += length * (net.weight ?? (net.critical ? 3 : 1));
    estimatedNetCount++;
  }

  const groups = new Map<string, Point2D[]>();
  for (const placement of placements) {
    if (!placement.component.group) continue;
    const center = transformPolygon(placement);
    const box = boundsOf(center);
    const points = groups.get(placement.component.group) ?? [];
    points.push({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 });
    groups.set(placement.component.group, points);
  }
  let groupDispersionMm = 0;
  for (const points of groups.values()) {
    if (points.length < 2) continue;
    const center = {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
    };
    groupDispersionMm += points.reduce((sum, p) => sum + Math.hypot(p.x - center.x, p.y - center.y), 0);
  }

  const outlineBounds = boundsOf(board.outline);
  const boardArea = Math.abs(board.outline.reduce((sum, p, index) => {
    const next = board.outline[(index + 1) % board.outline.length]!;
    return sum + p.x * next.y - next.x * p.y;
  }, 0)) / 2;
  const componentArea = placements.reduce((sum, placement) => {
    const box = boundsOf(transformPolygon(placement));
    return sum + (box.maxX - box.minX) * (box.maxY - box.minY);
  }, 0);
  const boardUtilization = boardArea > 0 ? Math.min(1, componentArea / boardArea) : 0;
  const areaRatio = Math.max(EPSILON, (outlineBounds.maxX - outlineBounds.minX) * (outlineBounds.maxY - outlineBounds.minY));
  const routingPressureIndex = Math.min(1, weightedHpwlMm / (Math.sqrt(areaRatio) * Math.max(1, nets.length) * 8));
  const objective = weightedHpwlMm + groupDispersionMm * 0.35 + routingPressureIndex * 20;
  return {
    weightedHpwlMm,
    totalHpwlMm,
    estimatedNetCount,
    routingPressureIndex,
    groupDispersionMm,
    boardUtilization,
    placedCount: placements.length,
    componentCount: components.length,
    objective,
  };
}

function initializeMissing(
  components: PlacementComponent[],
  board: PlacementBoard,
  nets: PlacementNet[],
  maxCandidates: number,
  grid: number,
): { placements: InternalPlacement[]; unplaced: string[] } {
  const placements: InternalPlacement[] = [];
  const unplaced: string[] = [];
  const outlineBounds = boundsOf(board.outline);
  const pending = components
    .filter((component) => component.x === undefined || component.y === undefined)
    .sort((a, b) => {
      const areaA = Math.abs(boundsOf(a.courtyard).maxX - boundsOf(a.courtyard).minX) *
        Math.abs(boundsOf(a.courtyard).maxY - boundsOf(a.courtyard).minY);
      const areaB = Math.abs(boundsOf(b.courtyard).maxX - boundsOf(b.courtyard).minX) *
        Math.abs(boundsOf(b.courtyard).maxY - boundsOf(b.courtyard).minY);
      return areaB - areaA;
    });

  for (const component of components.filter((item) => item.x !== undefined && item.y !== undefined)) {
    placements.push({
      component,
      x: component.x!,
      y: component.y!,
      rotationDeg: component.rotationDeg ?? 0,
    });
  }

  for (const component of pending) {
    let best: InternalPlacement | undefined;
    let bestCost = Number.POSITIVE_INFINITY;
    let checked = 0;
    for (const rotationDeg of ROTATIONS) {
      for (let y = outlineBounds.minY; y <= outlineBounds.maxY && checked < maxCandidates; y += grid * 2) {
        for (let x = outlineBounds.minX; x <= outlineBounds.maxX && checked < maxCandidates; x += grid * 2) {
          checked++;
          const candidate: InternalPlacement = { component, x, y, rotationDeg };
          if (!legalPlacement(candidate, placements, board)) continue;
          const current = computeMetrics([...placements, candidate], components, nets, board);
          const priority = component.placementPriority ?? 1;
          const cost = current.objective - (priority - 1) * 0.1 * current.totalHpwlMm;
          if (cost < bestCost) {
            best = candidate;
            bestCost = cost;
          }
        }
      }
    }
    if (best) placements.push(best);
    else unplaced.push(component.ref);
  }
  return { placements, unplaced };
}

function choose<T>(items: T[], random: () => number): T {
  return items[Math.floor(random() * items.length)]!;
}

/**
 * Greedy seed placement followed by deterministic simulated annealing.
 * Hard geometry violations are never accepted; the optimizer only returns a
 * preview and intentionally has no EasyEDA/native mutation adapter.
 */
export function optimizeComponentPlacement(
  components: PlacementComponent[],
  nets: PlacementNet[],
  board: PlacementBoard,
  options: PlacementOptions = {},
): PlacementResult {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const seed = options.seed ?? 20261124;
  const iterations = Math.max(0, Math.floor(options.iterations ?? 12000));
  const grid = board.gridMm ?? 0.25;

  if (board.outline.length < 3) blockers.push('Board outline must contain at least three polygon points.');
  if (grid <= 0) blockers.push('Placement grid must be greater than zero.');
  if (components.length === 0) blockers.push('No components were supplied.');
  const refs = new Set<string>();
  for (const component of components) {
    if (refs.has(component.ref)) blockers.push(`Duplicate component reference: ${component.ref}`);
    refs.add(component.ref);
    if (component.courtyard.length < 3) blockers.push(`Component ${component.ref} has no valid courtyard polygon.`);
  }
  if (blockers.length > 0) {
    return {
      status: 'NO_FEASIBLE_PLACEMENT',
      placements: [],
      metrics: computeMetrics([], components, nets, board.outline.length >= 3 ? board : { ...board, outline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }),
      blockers,
      warnings,
      iterations: 0,
      seed,
      requiresHumanApproval: true,
      nativeWritePerformed: false,
    };
  }

  const initialized = initializeMissing(
    components, board, nets,
    options.maxInitialPlacementCandidates ?? 25000,
    grid,
  );
  const placements = initialized.placements;
  const initiallyPlaced = placements.filter((item) =>
    item.component.x !== undefined && item.component.y !== undefined);
  for (let index = 0; index < initiallyPlaced.length; index++) {
    const item = initiallyPlaced[index]!;
    const others = initiallyPlaced.filter((candidate) => candidate.component.ref !== item.component.ref);
    if (!legalPlacement(item, others, board)) {
      blockers.push(`Existing placement for ${item.component.ref} violates board, keepout, or component-clearance geometry.`);
    }
  }
  if (initialized.unplaced.length > 0) {
    blockers.push(`Unable to find legal initial locations for: ${initialized.unplaced.join(', ')}`);
  }

  let best = placements.map((item) => ({ ...item }));
  let bestMetrics = computeMetrics(best, components, nets, board);
  let current = best.map((item) => ({ ...item }));
  let currentMetrics = bestMetrics;
  const random = makeRandom(seed);
  const movable = current.filter((item) => !item.component.fixed);
  if (movable.length > 0 && iterations > 0 && initialized.unplaced.length === 0) {
    const startTemperature = options.initialTemperature ?? 8;
    const coolingRate = options.coolingRate ?? 0.9992;
    for (let step = 0; step < iterations; step++) {
      const selected = choose(movable, random);
      const index = current.findIndex((item) => item.component.ref === selected.component.ref);
      const before = current[index]!;
      const moveScale = Math.max(grid, 5 * (1 - step / iterations));
      const nextRotation = random() < 0.12 ? choose([...ROTATIONS], random) : before.rotationDeg;
      const candidate: InternalPlacement = {
        ...before,
        x: snap(before.x + (random() - 0.5) * moveScale * 2, grid),
        y: snap(before.y + (random() - 0.5) * moveScale * 2, grid),
        rotationDeg: nextRotation,
      };
      const others = current.filter((item) => item.component.ref !== candidate.component.ref);
      if (!legalPlacement(candidate, others, board)) continue;
      const trial = [...current];
      trial[index] = candidate;
      const trialMetrics = computeMetrics(trial, components, nets, board);
      const temperature = startTemperature * Math.pow(coolingRate, step);
      const delta = trialMetrics.objective - currentMetrics.objective;
      if (delta < 0 || random() < Math.exp(-delta / Math.max(temperature, 0.0001))) {
        current = trial;
        currentMetrics = trialMetrics;
        if (trialMetrics.objective < bestMetrics.objective) {
          best = trial.map((item) => ({ ...item }));
          bestMetrics = trialMetrics;
        }
      }
    }
  } else if (movable.length === 0) {
    warnings.push('All components are fixed; optimizer returned the validated existing placement.');
  }

  if (nets.some((net) => net.pins.some((pin) => !refs.has(pin.ref)))) {
    warnings.push('Some net pins reference components not present in the placement input; those pins were ignored.');
  }
  warnings.push('Routing-pressure index is a normalized placement heuristic, not a predicted via count or routing-success probability.');
  if (nets.some((net) => net.pins.length > 2)) {
    warnings.push('HPWL is a placement proxy only; multi-terminal nets need detailed route/congestion analysis.');
  }
  if (initialized.unplaced.length > 0) {
    warnings.push('Partial result is not suitable for routing until every component has a legal location.');
  }
  const status = blockers.length > 0 && initialized.unplaced.length === 0
    ? 'NO_FEASIBLE_PLACEMENT'
    : initialized.unplaced.length > 0
      ? 'PARTIAL'
      : 'PREVIEW_READY';

  return {
    status,
    placements: best.map((item) => ({
      ref: item.component.ref,
      x: item.x,
      y: item.y,
      rotationDeg: item.rotationDeg,
      fixed: Boolean(item.component.fixed),
    })),
    metrics: bestMetrics,
    blockers,
    warnings,
    iterations,
    seed,
    requiresHumanApproval: true,
    nativeWritePerformed: false,
  };
}
