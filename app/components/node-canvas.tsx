"use client";

import Image from "next/image";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  evaluateDataFlow,
  type InputDataIssue,
} from "../canvas/data-flow";
import { HANA_HQ_SCENARIO } from "../canvas/hana-hq";
import type {
  CanvasNode,
  ConnectionDefinition,
  ConnectionEndpoint,
  Point,
  PortDefinition,
  Size,
  ViewerNode,
} from "../canvas/model";

type Positions = Record<string, Point>;
type Sizes = Record<string, Size>;
type Guide = { x?: number; y?: number; kind?: "edge" | "port" };
type ConnectionAction = "add" | "remove";
type ResizeCorner = "north-west" | "north-east" | "south-west" | "south-east";
type Fence = { start: Point; current: Point };
type SeparationGuide = { anchorX: number; currentX: number; anchorY: number };
type CanvasDocument = {
  positions: Positions;
  sizes: Sizes;
  activeConnectionIds: Set<string>;
};

type Interaction =
  | { type: "idle" }
  | {
      type: "pan";
      pointerId: number;
      startClient: Point;
      startPan: Point;
    }
  | {
      type: "fence";
      pointerId: number;
      startClient: Point;
      start: Point;
      current: Point;
    }
  | {
      type: "move";
      pointerId: number;
      primaryNodeId: string;
      nodeIds: readonly string[];
      startClient: Point;
      startPositions: Positions;
      startDocument: CanvasDocument;
    }
  | {
      type: "separate";
      pointerId: number;
      startClient: Point;
      anchorX: number;
      leftNodeIds: readonly string[];
      rightNodeIds: readonly string[];
      startPositions: Positions;
      startDocument: CanvasDocument;
    }
  | {
      type: "resize";
      pointerId: number;
      nodeId: string;
      corner: ResizeCorner;
      startClient: Point;
      startPosition: Point;
      startSize: Size;
      startDocument: CanvasDocument;
    }
  | {
      type: "connect";
      pointerId: number;
      from: ConnectionEndpoint;
      current: Point;
      action: ConnectionAction;
    };

const SCENARIO = HANA_HQ_SCENARIO;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const GRID_WIDTH = 15 * 40;
const GRID_HEIGHT = 5 * 40;
const SNAP_SCREEN_DISTANCE = 9;
const MIN_VIEWER_SIZE = 420;
const BEZIER_X_RATIO = 0.5;
const BEZIER_Y_RATIO = 0.75;
const CONTENT_FADE_START_ZOOM = 1;
const CONTENT_HIDDEN_ZOOM = 0.7;
const HISTORY_LIMIT = 100;

const INITIAL_POSITIONS = Object.fromEntries(
  SCENARIO.nodes.map((node) => [node.id, node.position]),
) as Positions;

const INITIAL_SIZES = Object.fromEntries(
  SCENARIO.nodes.map((node) => [node.id, node.size]),
) as Sizes;

const INITIAL_CONNECTION_IDS = new Set(
  SCENARIO.connections
    .filter((connection) => connection.initiallyConnected)
    .map((connection) => connection.id),
);

const INITIAL_DOCUMENT: CanvasDocument = {
  positions: INITIAL_POSITIONS,
  sizes: INITIAL_SIZES,
  activeConnectionIds: INITIAL_CONNECTION_IDS,
};

const RESIZE_CORNERS: readonly ResizeCorner[] = [
  "north-west",
  "north-east",
  "south-west",
  "south-east",
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function endpointKey(endpoint: ConnectionEndpoint) {
  return `${endpoint.nodeId}.${endpoint.portId}`;
}

function canvasDocumentsEqual(a: CanvasDocument, b: CanvasDocument) {
  if (a.activeConnectionIds.size !== b.activeConnectionIds.size) return false;
  for (const id of a.activeConnectionIds) {
    if (!b.activeConnectionIds.has(id)) return false;
  }

  for (const node of SCENARIO.nodes) {
    const aPosition = a.positions[node.id];
    const bPosition = b.positions[node.id];
    const aSize = a.sizes[node.id];
    const bSize = b.sizes[node.id];
    if (
      aPosition.x !== bPosition.x ||
      aPosition.y !== bPosition.y ||
      aSize.width !== bSize.width ||
      aSize.height !== bSize.height
    ) {
      return false;
    }
  }

  return true;
}

function bezierPath(from: Point, to: Point) {
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const controlX = from.x + deltaX * BEZIER_X_RATIO;
  const firstControlY = from.y + deltaY * (1 - BEZIER_Y_RATIO);
  const secondControlY = from.y + deltaY * BEZIER_Y_RATIO;
  return `M ${from.x} ${from.y} C ${controlX} ${firstControlY}, ${controlX} ${secondControlY}, ${to.x} ${to.y}`;
}

function normalizeFence(fence: Fence) {
  return {
    left: Math.min(fence.start.x, fence.current.x),
    top: Math.min(fence.start.y, fence.current.y),
    right: Math.max(fence.start.x, fence.current.x),
    bottom: Math.max(fence.start.y, fence.current.y),
  };
}

function intersectsFence(
  fence: ReturnType<typeof normalizeFence>,
  position: Point,
  size: Size,
) {
  return (
    position.x <= fence.right &&
    position.x + size.width >= fence.left &&
    position.y <= fence.bottom &&
    position.y + size.height >= fence.top
  );
}

function portPoint(
  endpoint: ConnectionEndpoint,
  positions: Positions,
  sizes: Sizes,
  nodesById: ReadonlyMap<string, CanvasNode>,
): Point {
  const node = nodesById.get(endpoint.nodeId);
  const port = node?.ports.find((candidate) => candidate.id === endpoint.portId);
  if (!node || !port) return { x: 0, y: 0 };

  const position = positions[node.id] ?? node.position;
  const size = sizes[node.id] ?? node.size;
  return {
    x: position.x + (port.side === "out" ? size.width : 0),
    y: position.y + size.height * port.offset,
  };
}

function getSnap(
  movingNode: CanvasNode,
  movingSize: Size,
  raw: Point,
  positions: Positions,
  sizes: Sizes,
  threshold: number,
  excludedNodeIds: ReadonlySet<string>,
) {
  const result = { ...raw };
  let bestX: { delta: number; guide: number } | undefined;
  let bestY: { delta: number; guide: number; kind: "edge" | "port" } | undefined;

  const considerX = (delta: number, guide: number) => {
    if (
      Math.abs(delta) <= threshold &&
      (!bestX || Math.abs(delta) < Math.abs(bestX.delta))
    ) {
      bestX = { delta, guide };
    }
  };

  const considerY = (
    delta: number,
    guide: number,
    kind: "edge" | "port" = "edge",
  ) => {
    if (
      Math.abs(delta) <= threshold &&
      (!bestY || Math.abs(delta) < Math.abs(bestY.delta))
    ) {
      bestY = { delta, guide, kind };
    }
  };

  for (const other of SCENARIO.nodes) {
    if (excludedNodeIds.has(other.id)) continue;
    const otherPosition = positions[other.id] ?? other.position;
    const otherSize = sizes[other.id] ?? other.size;

    const movingLeft = raw.x;
    const movingCenterX = raw.x + movingSize.width / 2;
    const movingRight = raw.x + movingSize.width;
    const otherLeft = otherPosition.x;
    const otherCenterX = otherPosition.x + otherSize.width / 2;
    const otherRight = otherPosition.x + otherSize.width;

    considerX(otherLeft - movingLeft, otherLeft);
    considerX(otherCenterX - movingCenterX, otherCenterX);
    considerX(otherRight - movingRight, otherRight);
    considerX(otherLeft - movingRight, otherLeft);
    considerX(otherRight - movingLeft, otherRight);

    const movingTop = raw.y;
    const movingCenterY = raw.y + movingSize.height / 2;
    const movingBottom = raw.y + movingSize.height;
    const otherTop = otherPosition.y;
    const otherCenterY = otherPosition.y + otherSize.height / 2;
    const otherBottom = otherPosition.y + otherSize.height;

    considerY(otherTop - movingTop, otherTop);
    considerY(otherCenterY - movingCenterY, otherCenterY);
    considerY(otherBottom - movingBottom, otherBottom);
    considerY(otherTop - movingBottom, otherTop);
    considerY(otherBottom - movingTop, otherBottom);

    for (const movingPort of movingNode.ports) {
      const movingPortY = raw.y + movingSize.height * movingPort.offset;
      for (const otherPort of other.ports) {
        const otherPortY = otherPosition.y + otherSize.height * otherPort.offset;
        considerY(otherPortY - movingPortY, otherPortY, "port");
      }
    }
  }

  const guide: Guide = {};
  if (bestX) {
    result.x += bestX.delta;
    guide.x = bestX.guide;
  }
  if (bestY) {
    result.y += bestY.delta;
    guide.y = bestY.guide;
    guide.kind = bestY.kind;
  }

  return { position: result, guide };
}

function closestCandidate(
  candidates: readonly ConnectionDefinition[],
  current: Point,
  positions: Positions,
  sizes: Sizes,
  nodesById: ReadonlyMap<string, CanvasNode>,
) {
  let closest:
    | { connection: ConnectionDefinition; target: Point; distance: number }
    | undefined;

  for (const connection of candidates) {
    const target = portPoint(connection.to, positions, sizes, nodesById);
    const targetDistance = distance(current, target);
    if (!closest || targetDistance < closest.distance) {
      closest = { connection, target, distance: targetDistance };
    }
  }

  return closest;
}

export default function NodeCanvas() {
  const canvasRef = useRef<HTMLElement>(null);
  const interactionRef = useRef<Interaction>({ type: "idle" });
  const positionedRef = useRef(false);
  const pastDocumentsRef = useRef<CanvasDocument[]>([]);
  const futureDocumentsRef = useRef<CanvasDocument[]>([]);
  const documentRef = useRef<CanvasDocument>(INITIAL_DOCUMENT);
  const nodesById = useMemo(
    () => new Map(SCENARIO.nodes.map((node) => [node.id, node])),
    [],
  );
  const [canvasDocument, setCanvasDocument] =
    useState<CanvasDocument>(INITIAL_DOCUMENT);
  const { positions, sizes, activeConnectionIds } = canvasDocument;
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [pan, setPan] = useState<Point>({ x: 64, y: 80 });
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<Interaction["type"]>("idle");
  const [guide, setGuide] = useState<Guide>({});
  const [fence, setFence] = useState<Fence | null>(null);
  const [separation, setSeparation] = useState<SeparationGuide | null>(null);
  const [connectingFromPoint, setConnectingFromPoint] = useState<Point | null>(
    null,
  );
  const [connectingPoint, setConnectingPoint] = useState<Point | null>(null);
  const [targetConnectionId, setTargetConnectionId] = useState<string | null>(
    null,
  );
  const [connectionAction, setConnectionAction] =
    useState<ConnectionAction | null>(null);

  const scale = zoom / MAX_ZOOM;

  useEffect(() => {
    if (positionedRef.current) return;
    positionedRef.current = true;
    setPan({
      x: 54 - SCENARIO.initialFocus.x * scale,
      y: window.innerHeight / 2 - SCENARIO.initialFocus.y * scale,
    });
  }, [scale]);

  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }

      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const wantsUndo = modifier && key === "z" && !event.shiftKey;
      const wantsRedo =
        modifier && (key === "y" || (key === "z" && event.shiftKey));
      if (!wantsUndo && !wantsRedo) return;

      event.preventDefault();
      const interaction = interactionRef.current;
      if (interaction.type !== "idle") {
        try {
          canvasRef.current?.releasePointerCapture(interaction.pointerId);
        } catch {
          // The browser may already have released this pointer.
        }
      }
      interactionRef.current = { type: "idle" };
      setMode("idle");
      setGuide({});
      setFence(null);
      setSeparation(null);
      setConnectingFromPoint(null);
      setConnectingPoint(null);
      setTargetConnectionId(null);
      setConnectionAction(null);

      const source = wantsUndo ? pastDocumentsRef : futureDocumentsRef;
      const destination = wantsUndo ? futureDocumentsRef : pastDocumentsRef;
      const restored = source.current.at(-1);
      if (!restored) return;

      source.current = source.current.slice(0, -1);
      destination.current = [
        ...destination.current,
        documentRef.current,
      ].slice(-HISTORY_LIMIT);
      documentRef.current = restored;
      setCanvasDocument(restored);
    };

    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, []);

  const recordHistory = (before: CanvasDocument, after: CanvasDocument) => {
    if (canvasDocumentsEqual(before, after)) return false;
    pastDocumentsRef.current = [...pastDocumentsRef.current, before].slice(
      -HISTORY_LIMIT,
    );
    futureDocumentsRef.current = [];
    return true;
  };

  const updateCanvasDocument = (
    update: (current: CanvasDocument) => CanvasDocument,
  ) => {
    setCanvasDocument((current) => {
      const next = update(current);
      documentRef.current = next;
      return next;
    });
  };

  const connectedPortKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const connection of SCENARIO.connections) {
      if (!activeConnectionIds.has(connection.id)) continue;
      keys.add(endpointKey(connection.from));
      keys.add(endpointKey(connection.to));
    }
    return keys;
  }, [activeConnectionIds]);

  const dataFlow = useMemo(
    () => evaluateDataFlow(SCENARIO, activeConnectionIds),
    [activeConnectionIds],
  );

  const activeConnections = SCENARIO.connections.filter((connection) =>
    activeConnectionIds.has(connection.id),
  );

  const mutableConnections = SCENARIO.connections.filter(
    (connection) => connection.mutable,
  );

  const screenToWorld = (clientX: number, clientY: number): Point => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    return {
      x: (clientX - (bounds?.left ?? 0) - pan.x) / scale,
      y: (clientY - (bounds?.top ?? 0) - pan.y) / scale,
    };
  };

  const capturePointer = (pointerId: number) => {
    try {
      canvasRef.current?.setPointerCapture(pointerId);
    } catch {
      // Pointer capture may fail when a gesture ends between frames.
    }
  };

  const releasePointer = (pointerId: number) => {
    try {
      canvasRef.current?.releasePointerCapture(pointerId);
    } catch {
      // The browser may already have released this pointer.
    }
  };

  const beginSeparation = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || !event.altKey) return;
    event.preventDefault();
    event.stopPropagation();

    const anchor = screenToWorld(event.clientX, event.clientY);
    const leftNodeIds: string[] = [];
    const rightNodeIds: string[] = [];
    for (const node of SCENARIO.nodes) {
      const position = positions[node.id] ?? node.position;
      const size = sizes[node.id] ?? node.size;
      if (position.x + size.width <= anchor.x) {
        leftNodeIds.push(node.id);
      } else if (position.x >= anchor.x) {
        rightNodeIds.push(node.id);
      }
    }

    interactionRef.current = {
      type: "separate",
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      anchorX: anchor.x,
      leftNodeIds,
      rightNodeIds,
      startPositions: positions,
      startDocument: documentRef.current,
    };
    setSeparation({ anchorX: anchor.x, currentX: anchor.x, anchorY: anchor.y });
    setMode("separate");
    capturePointer(event.pointerId);
  };

  const beginMove = (nodeId: string, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const node = nodesById.get(nodeId);
    if (!node) return;

    const nodeIds = selectedNodeIds.has(nodeId)
      ? [...selectedNodeIds]
      : [nodeId];
    if (!selectedNodeIds.has(nodeId)) {
      setSelectedNodeIds(new Set([nodeId]));
    }

    const startPositions = Object.fromEntries(
      nodeIds.map((id) => {
        const selectedNode = nodesById.get(id);
        return [id, positions[id] ?? selectedNode?.position ?? { x: 0, y: 0 }];
      }),
    ) as Positions;

    interactionRef.current = {
      type: "move",
      pointerId: event.pointerId,
      primaryNodeId: nodeId,
      nodeIds,
      startClient: { x: event.clientX, y: event.clientY },
      startPositions,
      startDocument: documentRef.current,
    };
    setMode("move");
    capturePointer(event.pointerId);
  };

  const beginResize = (
    nodeId: string,
    corner: ResizeCorner,
    event: ReactPointerEvent,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const node = nodesById.get(nodeId);
    if (!node || node.kind !== "viewer") return;

    setSelectedNodeIds(new Set([nodeId]));
    interactionRef.current = {
      type: "resize",
      pointerId: event.pointerId,
      nodeId,
      corner,
      startClient: { x: event.clientX, y: event.clientY },
      startPosition: positions[nodeId] ?? node.position,
      startSize: sizes[nodeId] ?? node.size,
      startDocument: documentRef.current,
    };
    setMode("resize");
    capturePointer(event.pointerId);
  };

  const beginConnection = (
    nodeId: string,
    portId: string,
    event: ReactPointerEvent,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const from = { nodeId, portId };
    const action: ConnectionAction = event.ctrlKey ? "remove" : "add";
    const hasCandidate = mutableConnections.some((connection) => {
      const matchesSource =
        connection.from.nodeId === nodeId && connection.from.portId === portId;
      const isConnected = activeConnectionIds.has(connection.id);
      return matchesSource && (action === "remove" ? isConnected : !isConnected);
    });
    if (!hasCandidate) return;

    const start = portPoint(from, positions, sizes, nodesById);
    interactionRef.current = {
      type: "connect",
      pointerId: event.pointerId,
      from,
      current: start,
      action,
    };
    setSelectedNodeIds(new Set([nodeId]));
    setMode("connect");
    setConnectingFromPoint(start);
    setConnectingPoint(start);
    setConnectionAction(action);
    capturePointer(event.pointerId);
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button === 0 && event.target === event.currentTarget) {
      event.preventDefault();
      const start = screenToWorld(event.clientX, event.clientY);
      interactionRef.current = {
        type: "fence",
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        start,
        current: start,
      };
      setSelectedNodeIds(new Set());
      setFence({ start, current: start });
      setMode("fence");
      capturePointer(event.pointerId);
      return;
    }
    if (event.button !== 2) return;

    event.preventDefault();
    interactionRef.current = {
      type: "pan",
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      startPan: pan,
    };
    setMode("pan");
    capturePointer(event.pointerId);
  };

  const getConnectionCandidates = (
    interaction: Extract<Interaction, { type: "connect" }>,
  ) =>
    mutableConnections.filter((connection) => {
      const matchesSource =
        connection.from.nodeId === interaction.from.nodeId &&
        connection.from.portId === interaction.from.portId;
      const isConnected = activeConnectionIds.has(connection.id);
      return (
        matchesSource &&
        (interaction.action === "remove" ? isConnected : !isConnected)
      );
    });

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current;
    if (interaction.type === "idle" || interaction.pointerId !== event.pointerId) {
      return;
    }

    if (interaction.type === "pan") {
      setPan({
        x: interaction.startPan.x + event.clientX - interaction.startClient.x,
        y: interaction.startPan.y + event.clientY - interaction.startClient.y,
      });
      return;
    }

    if (interaction.type === "fence") {
      const current = screenToWorld(event.clientX, event.clientY);
      const nextFence = { start: interaction.start, current };
      interactionRef.current = { ...interaction, current };
      setFence(nextFence);
      const normalized = normalizeFence(nextFence);
      setSelectedNodeIds(
        new Set(
          SCENARIO.nodes
            .filter((node) =>
              intersectsFence(
                normalized,
                positions[node.id] ?? node.position,
                sizes[node.id] ?? node.size,
              ),
            )
            .map((node) => node.id),
        ),
      );
      return;
    }

    if (interaction.type === "separate") {
      const deltaX = (event.clientX - interaction.startClient.x) / scale;
      const movingNodeIds =
        deltaX >= 0 ? interaction.rightNodeIds : interaction.leftNodeIds;
      const nextPositions = { ...interaction.startPositions };
      for (const nodeId of movingNodeIds) {
        const start = interaction.startPositions[nodeId];
        nextPositions[nodeId] = { x: start.x + deltaX, y: start.y };
      }
      updateCanvasDocument((current) => ({
        ...current,
        positions: nextPositions,
      }));
      setSeparation((current) =>
        current
          ? { ...current, currentX: interaction.anchorX + deltaX }
          : current,
      );
      return;
    }

    if (interaction.type === "move") {
      const movingNode = nodesById.get(interaction.primaryNodeId);
      if (!movingNode) return;
      const startPosition = interaction.startPositions[interaction.primaryNodeId];
      const movingSize = sizes[interaction.primaryNodeId] ?? movingNode.size;
      const raw = {
        x: startPosition.x + (event.clientX - interaction.startClient.x) / scale,
        y: startPosition.y + (event.clientY - interaction.startClient.y) / scale,
      };
      const excludedNodeIds = new Set(interaction.nodeIds);
      const snapped = getSnap(
        movingNode,
        movingSize,
        raw,
        positions,
        sizes,
        SNAP_SCREEN_DISTANCE / scale,
        excludedNodeIds,
      );
      const delta = {
        x: snapped.position.x - startPosition.x,
        y: snapped.position.y - startPosition.y,
      };
      updateCanvasDocument((current) => {
        const nextPositions = { ...current.positions };
        for (const nodeId of interaction.nodeIds) {
          const start = interaction.startPositions[nodeId];
          nextPositions[nodeId] = {
            x: start.x + delta.x,
            y: start.y + delta.y,
          };
        }
        return { ...current, positions: nextPositions };
      });
      setGuide(snapped.guide);
      return;
    }

    if (interaction.type === "resize") {
      const delta = {
        x: (event.clientX - interaction.startClient.x) / scale,
        y: (event.clientY - interaction.startClient.y) / scale,
      };
      const west = interaction.corner.endsWith("west");
      const north = interaction.corner.startsWith("north");
      const width = clamp(
        interaction.startSize.width + (west ? -delta.x : delta.x),
        MIN_VIEWER_SIZE,
        SCENARIO.world.width,
      );
      const height = clamp(
        interaction.startSize.height + (north ? -delta.y : delta.y),
        MIN_VIEWER_SIZE,
        SCENARIO.world.height,
      );
      updateCanvasDocument((current) => ({
        ...current,
        sizes: {
          ...current.sizes,
          [interaction.nodeId]: { width, height },
        },
        positions: {
          ...current.positions,
          [interaction.nodeId]: {
            x: west
              ? interaction.startPosition.x + interaction.startSize.width - width
              : interaction.startPosition.x,
            y: north
              ? interaction.startPosition.y + interaction.startSize.height - height
              : interaction.startPosition.y,
          },
        },
      }));
      return;
    }

    const current = screenToWorld(event.clientX, event.clientY);
    interactionRef.current = { ...interaction, current };
    setConnectingPoint(current);
    const closest = closestCandidate(
      getConnectionCandidates(interaction),
      current,
      positions,
      sizes,
      nodesById,
    );
    setTargetConnectionId(
      closest && closest.distance <= 26 / scale ? closest.connection.id : null,
    );
  };

  const finishInteraction = (event: ReactPointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current;
    if (interaction.type === "idle" || interaction.pointerId !== event.pointerId) {
      return;
    }

    if (
      interaction.type === "fence" &&
      distance(interaction.startClient, { x: event.clientX, y: event.clientY }) < 4
    ) {
      setSelectedNodeIds(new Set());
    }

    if (
      interaction.type === "move" ||
      interaction.type === "resize" ||
      interaction.type === "separate"
    ) {
      recordHistory(interaction.startDocument, documentRef.current);
    }

    if (interaction.type === "connect") {
      const end = screenToWorld(event.clientX, event.clientY);
      const closest = closestCandidate(
        getConnectionCandidates(interaction),
        end,
        positions,
        sizes,
        nodesById,
      );
      if (closest && closest.distance <= 30 / scale) {
        const before = documentRef.current;
        const nextConnectionIds = new Set(before.activeConnectionIds);
        if (interaction.action === "add") {
          nextConnectionIds.add(closest.connection.id);
        } else {
          nextConnectionIds.delete(closest.connection.id);
        }
        const after = {
          ...before,
          activeConnectionIds: nextConnectionIds,
        };
        if (recordHistory(before, after)) {
          documentRef.current = after;
          setCanvasDocument(after);
        }
      }
    }

    releasePointer(event.pointerId);
    interactionRef.current = { type: "idle" };
    setMode("idle");
    setGuide({});
    setFence(null);
    setSeparation(null);
    setConnectingFromPoint(null);
    setConnectingPoint(null);
    setTargetConnectionId(null);
    setConnectionAction(null);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLElement>) => {
    event.preventDefault();
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;

    const pointer = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    const worldAtPointer = {
      x: (pointer.x - pan.x) / scale,
      y: (pointer.y - pan.y) / scale,
    };
    const nextZoom = clamp(
      zoom * Math.exp(-event.deltaY * 0.0014),
      MIN_ZOOM,
      MAX_ZOOM,
    );
    const nextScale = nextZoom / MAX_ZOOM;

    setZoom(nextZoom);
    setPan({
      x: pointer.x - worldAtPointer.x * nextScale,
      y: pointer.y - worldAtPointer.y * nextScale,
    });
  };

  const contentOpacity = clamp(
    (zoom - CONTENT_HIDDEN_ZOOM) /
      (CONTENT_FADE_START_ZOOM - CONTENT_HIDDEN_ZOOM),
    0,
    1,
  );

  const worldStyle = {
    width: SCENARIO.world.width,
    height: SCENARIO.world.height,
    transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`,
    "--world-css-pixel": `${1 / scale}px`,
    "--canvas-content-opacity": contentOpacity,
  } as CSSProperties;

  const gridStyle = {
    backgroundSize: `${GRID_WIDTH * scale}px ${GRID_HEIGHT * scale}px`,
    backgroundPosition: `${pan.x}px ${pan.y}px`,
    "--grid-line": `${Math.max(0.15, scale)}px`,
  } as CSSProperties;

  const connectionGeometry = activeConnections.map((connection) => ({
    connection,
    from: portPoint(connection.from, positions, sizes, nodesById),
    to: portPoint(connection.to, positions, sizes, nodesById),
  }));
  const normalizedFence = fence ? normalizeFence(fence) : null;
  const separationDirection =
    separation && separation.currentX < separation.anchorX ? "left" : "right";
  const separationLeft = separation
    ? Math.min(separation.anchorX, separation.currentX)
    : 0;
  const separationWidth = separation
    ? Math.abs(separation.currentX - separation.anchorX)
    : 0;

  return (
    <main
      ref={canvasRef}
      className={`node-canvas is-${mode}`}
      style={gridStyle}
      role="application"
      aria-label={SCENARIO.ariaLabel}
      onPointerDownCapture={beginSeparation}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishInteraction}
      onPointerCancel={finishInteraction}
      onWheel={handleWheel}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="world" style={worldStyle}>
        <svg
          className="wire-layer"
          width={SCENARIO.world.width}
          height={SCENARIO.world.height}
          aria-hidden="true"
        >
          <defs>
            <marker
              id="connection-arrow"
              markerWidth="42"
              markerHeight="32"
              refX="32"
              refY="16"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path d="M 0 0 L 42 16 L 0 32 z" fill="#101010" />
            </marker>
            <marker
              id="removal-arrow"
              markerWidth="42"
              markerHeight="32"
              refX="32"
              refY="16"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path d="M 0 0 L 42 16 L 0 32 z" fill="#9d1c1c" />
            </marker>
            {connectionGeometry.map(({ connection, from, to }) => {
              const selectedAtFrom = selectedNodeIds.has(connection.from.nodeId);
              const selectedAtTo = selectedNodeIds.has(connection.to.nodeId);
              if (selectedAtFrom === selectedAtTo) return null;
              const start = selectedAtFrom ? from : to;
              const end = selectedAtFrom ? to : from;
              return (
                <linearGradient
                  key={connection.id}
                  id={`selected-${connection.id}`}
                  gradientUnits="userSpaceOnUse"
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                >
                  <stop offset="0%" stopColor="#86db36" />
                  <stop offset="58%" stopColor="#101010" />
                  <stop offset="100%" stopColor="#101010" />
                </linearGradient>
              );
            })}
          </defs>

          {connectionGeometry.map(({ connection, from, to }) => {
            const selectedAtFrom = selectedNodeIds.has(connection.from.nodeId);
            const selectedAtTo = selectedNodeIds.has(connection.to.nodeId);
            const stroke =
              selectedAtFrom && selectedAtTo
                ? "#86db36"
                : selectedAtFrom || selectedAtTo
                  ? `url(#selected-${connection.id})`
                  : undefined;
            return (
              <path
                key={connection.id}
                className="wire"
                data-connection-id={connection.id}
                d={bezierPath(from, to)}
                style={stroke ? { stroke } : undefined}
              />
            );
          })}

          {connectingPoint && connectingFromPoint && (
            <path
              className={`wire wire-preview ${connectionAction === "remove" ? "is-removal" : ""}`}
              d={bezierPath(connectingFromPoint, connectingPoint)}
              markerEnd={
                connectionAction === "remove"
                  ? "url(#removal-arrow)"
                  : "url(#connection-arrow)"
              }
            />
          )}

          {guide.x !== undefined && (
            <line
              className="snap-guide"
              x1={guide.x}
              x2={guide.x}
              y1="-4000"
              y2="7000"
            />
          )}
          {guide.y !== undefined && (
            <line
              className={`snap-guide ${guide.kind === "port" ? "is-port-guide" : ""}`}
              x1="-4000"
              x2="20000"
              y1={guide.y}
              y2={guide.y}
            />
          )}
        </svg>

        {SCENARIO.nodes.map((node) => {
          const inputIssues = dataFlow.inputIssuesByNodeId.get(node.id) ?? [];
          const dataValid = dataFlow.validNodeIds.has(node.id);
          const viewerReady =
            node.kind === "viewer" &&
            Boolean(
              node.readyWhen?.length &&
                node.readyWhen.every((id) =>
                  dataFlow.validConnectionIds.has(id),
                ),
            );

          return (
            <CanvasNodeView
              key={node.id}
              node={node}
              position={positions[node.id] ?? node.position}
              size={sizes[node.id] ?? node.size}
              selected={selectedNodeIds.has(node.id)}
              connectedPortKeys={connectedPortKeys}
              inputIssues={inputIssues}
              dataValid={dataValid}
              viewerReady={viewerReady}
              targetConnectionId={targetConnectionId}
              connectionAction={connectionAction}
              onMove={beginMove}
              onConnect={beginConnection}
              onResize={beginResize}
            />
          );
        })}

        {normalizedFence && (
          <div
            className="selection-fence"
            style={{
              left: normalizedFence.left,
              top: normalizedFence.top,
              width: normalizedFence.right - normalizedFence.left,
              height: normalizedFence.bottom - normalizedFence.top,
            }}
            aria-hidden="true"
          />
        )}

        {separation && (
          <div
            className={`canvas-separation is-${separationDirection}`}
            data-separation-direction={separationDirection}
            style={{
              left: separationLeft,
              top: 0,
              width: separationWidth,
              height: SCENARIO.world.height,
            }}
            aria-hidden="true"
          >
            <span
              className="canvas-separation-arrow"
              style={{ top: separation.anchorY }}
            >
              {separationDirection === "right" ? "→" : "←"}
            </span>
          </div>
        )}
      </div>

      <aside className="canvas-status" aria-live="polite">
        <span>{Math.round(zoom * 100)}%</span>
        <span aria-hidden="true">·</span>
        <span>좌클릭 드래그: 영역 선택</span>
        <span aria-hidden="true">·</span>
        <span>우클릭 드래그: 이동</span>
        <span aria-hidden="true">·</span>
        <span>휠: 확대/축소</span>
        <span aria-hidden="true">·</span>
        <span>Ctrl+드래그: 연결 삭제</span>
        <span aria-hidden="true">·</span>
        <span>Ctrl+Z/Y: 실행 취소/다시 실행</span>
        <span aria-hidden="true">·</span>
        <span>Alt+좌클릭 드래그: 캔버스 확장</span>
      </aside>
    </main>
  );
}

function CanvasNodeView({
  node,
  position,
  size,
  selected,
  connectedPortKeys,
  inputIssues,
  dataValid,
  viewerReady,
  targetConnectionId,
  connectionAction,
  onMove,
  onConnect,
  onResize,
}: {
  node: CanvasNode;
  position: Point;
  size: Size;
  selected: boolean;
  connectedPortKeys: ReadonlySet<string>;
  inputIssues: readonly InputDataIssue[];
  dataValid: boolean;
  viewerReady: boolean;
  targetConnectionId: string | null;
  connectionAction: ConnectionAction | null;
  onMove: (nodeId: string, event: ReactPointerEvent) => void;
  onConnect: (
    nodeId: string,
    portId: string,
    event: ReactPointerEvent,
  ) => void;
  onResize: (
    nodeId: string,
    corner: ResizeCorner,
    event: ReactPointerEvent,
  ) => void;
}) {
  const style = {
    left: position.x,
    top: position.y,
    width: size.width,
    height: size.height,
    ...(node.kind === "processor"
      ? {
          "--processor-input-left": `${node.layout.inputLeft}px`,
          "--processor-input-width": `${node.layout.inputWidth}px`,
          "--processor-icon-center": `${node.layout.iconCenter}px`,
          "--processor-icon-size": `${node.layout.iconSize}px`,
          "--processor-output-left": `${node.layout.outputLeft}px`,
          "--processor-output-width": `${node.layout.outputWidth}px`,
        }
      : {}),
  } as CSSProperties;
  const warning =
    !dataValid && (node.kind === "processor" || node.kind === "connector");
  const warningDescription = inputIssues
    .map(({ port, reason }) =>
      reason === "missing"
        ? `${port.label ?? port.id} 입력이 필요합니다`
        : `${port.label ?? port.id}에 유효한 데이터가 없습니다`,
    )
    .join(", ");

  if (node.kind === "scribble") {
    return (
      <section
        className={`canvas-node scribble-node ${selected ? "is-selected" : ""}`}
        style={style}
        data-node-id={node.id}
        data-data-valid={dataValid}
        aria-label={node.ariaLabel}
        onPointerDown={(event) => onMove(node.id, event)}
      >
        {node.text}
      </section>
    );
  }

  const nodeClassName = [
    "canvas-node",
    "component-node",
    `${node.kind}-node`,
    selected ? "is-selected" : "",
    warning ? "is-warning" : "",
    !warning ? "is-normal" : "",
    node.kind === "viewer" && viewerReady ? "is-ready" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      className={nodeClassName}
      style={style}
      data-node-id={node.id}
      data-data-valid={dataValid}
      aria-label={`${node.ariaLabel}${warning ? ", 데이터 경고" : ""}`}
      onPointerDown={(event) => onMove(node.id, event)}
    >
      {node.kind === "processor" && (
        <>
          <div className="bifocal-label">{node.title}</div>
          <Image
            className="processor-icon"
            src={node.icon}
            alt=""
            width={256}
            height={256}
            draggable={false}
            priority
            unoptimized
          />
          {node.ports.map((port) =>
            port.label ? (
              <span
                key={port.id}
                className={`processor-port-label is-${port.side}`}
                style={{ top: `${port.offset * 100}%` }}
              >
                {port.label}
              </span>
            ) : null,
          )}
          {warning && warningDescription && (
            <button
              className="warning-indicator"
              type="button"
              aria-label={`경고: ${warningDescription}`}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <span className="warning-tooltip" role="tooltip">
                {warningDescription}
              </span>
            </button>
          )}
        </>
      )}

      {node.kind === "connector" && (
        <span className="connector-value">{node.text}</span>
      )}

      {node.kind === "panel" && (
        <span className={`panel-value ${node.value.length > 18 ? "is-long" : ""}`}>
          {node.value}
        </span>
      )}

      {node.kind === "viewer" && (
        <>
          <ViewerContent node={node} ready={viewerReady} />
          {RESIZE_CORNERS.map((corner) => (
            <button
              key={corner}
              type="button"
              className={`viewer-resize-handle is-${corner}`}
              aria-label={`${node.ariaLabel} ${corner} 모서리에서 크기 조절`}
              onPointerDown={(event) => onResize(node.id, corner, event)}
            />
          ))}
        </>
      )}

      {node.ports.map((port) => {
        const key = endpointKey({ nodeId: node.id, portId: port.id });
        const targetConnection = targetConnectionId
          ? SCENARIO.connections.find(
              (connection) => connection.id === targetConnectionId,
            )
          : undefined;
        const isTarget = targetConnection
          ? endpointKey(targetConnection.to) === key
          : false;
        return (
          <Port
            key={port.id}
            nodeId={node.id}
            nodeLabel={node.ariaLabel}
            port={port}
            connected={connectedPortKeys.has(key)}
            target={isTarget}
            removalTarget={isTarget && connectionAction === "remove"}
            onConnect={onConnect}
          />
        );
      })}
    </section>
  );
}

function ViewerContent({ node, ready }: { node: ViewerNode; ready: boolean }) {
  return (
    <div className="viewer-frame">
      <span className="viewer-tool" aria-hidden="true">
        {node.viewerType === "model" ? "◇" : "⌗"}
      </span>
      <span className="viewer-caption">{node.caption}</span>
      {!ready && <span className="viewer-alert" aria-hidden="true" />}
      <span className={`viewer-message ${ready ? "is-ready" : ""}`}>
        {ready ? node.readyMessage : node.emptyMessage}
      </span>
    </div>
  );
}

function Port({
  nodeId,
  nodeLabel,
  port,
  connected,
  target,
  removalTarget,
  onConnect,
}: {
  nodeId: string;
  nodeLabel: string;
  port: PortDefinition;
  connected: boolean;
  target: boolean;
  removalTarget: boolean;
  onConnect: (
    nodeId: string,
    portId: string,
    event: ReactPointerEvent,
  ) => void;
}) {
  return (
    <button
      type="button"
      className={[
        "port",
        `port-${port.side}`,
        connected ? "is-connected" : "",
        target ? "is-target" : "",
        removalTarget ? "is-disconnect-target" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ top: `${port.offset * 100}%` }}
      aria-label={`${nodeLabel} ${port.label ?? port.id} ${port.side === "out" ? "출력" : "입력"}`}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (port.side === "out") {
          onConnect(nodeId, port.id, event);
        }
      }}
    />
  );
}
