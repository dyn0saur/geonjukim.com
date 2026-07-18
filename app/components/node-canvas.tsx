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
import { HANA_HQ_SCENARIO } from "../canvas/hana-hq";
import type {
  CanvasNode,
  ConnectionDefinition,
  ConnectionEndpoint,
  Point,
  PortDefinition,
  ViewerNode,
} from "../canvas/model";

type Positions = Record<string, Point>;
type Guide = { x?: number; y?: number; kind?: "edge" | "port" };
type ConnectionAction = "add" | "remove";

type Interaction =
  | { type: "idle" }
  | {
      type: "pan";
      pointerId: number;
      startClient: Point;
      startPan: Point;
    }
  | {
      type: "move";
      pointerId: number;
      nodeId: string;
      startClient: Point;
      startPosition: Point;
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

const INITIAL_POSITIONS = Object.fromEntries(
  SCENARIO.nodes.map((node) => [node.id, node.position]),
) as Positions;

const INITIAL_CONNECTION_IDS = new Set(
  SCENARIO.connections
    .filter((connection) => connection.initiallyConnected)
    .map((connection) => connection.id),
);

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function endpointKey(endpoint: ConnectionEndpoint) {
  return `${endpoint.nodeId}.${endpoint.portId}`;
}

function bezierPath(from: Point, to: Point) {
  const direction = to.x >= from.x ? 1 : -1;
  const reach = Math.max(110, Math.abs(to.x - from.x) * 0.46);
  return `M ${from.x} ${from.y} C ${from.x + reach * direction} ${from.y}, ${to.x - reach * direction} ${to.y}, ${to.x} ${to.y}`;
}

function portPoint(
  endpoint: ConnectionEndpoint,
  positions: Positions,
  nodesById: ReadonlyMap<string, CanvasNode>,
): Point {
  const node = nodesById.get(endpoint.nodeId);
  const port = node?.ports.find((candidate) => candidate.id === endpoint.portId);
  if (!node || !port) return { x: 0, y: 0 };

  const position = positions[node.id] ?? node.position;
  return {
    x: position.x + (port.side === "out" ? node.size.width : 0),
    y: position.y + node.size.height * port.offset,
  };
}

function getSnap(
  movingNode: CanvasNode,
  raw: Point,
  positions: Positions,
  threshold: number,
) {
  const result = { ...raw };
  let bestX: { delta: number; guide: number } | undefined;
  let bestY:
    | { delta: number; guide: number; kind: "edge" | "port" }
    | undefined;

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
    if (other.id === movingNode.id) continue;
    const otherPosition = positions[other.id] ?? other.position;

    const movingLeft = raw.x;
    const movingCenterX = raw.x + movingNode.size.width / 2;
    const movingRight = raw.x + movingNode.size.width;
    const otherLeft = otherPosition.x;
    const otherCenterX = otherPosition.x + other.size.width / 2;
    const otherRight = otherPosition.x + other.size.width;

    considerX(otherLeft - movingLeft, otherLeft);
    considerX(otherCenterX - movingCenterX, otherCenterX);
    considerX(otherRight - movingRight, otherRight);
    considerX(otherLeft - movingRight, otherLeft);
    considerX(otherRight - movingLeft, otherRight);

    const movingTop = raw.y;
    const movingCenterY = raw.y + movingNode.size.height / 2;
    const movingBottom = raw.y + movingNode.size.height;
    const otherTop = otherPosition.y;
    const otherCenterY = otherPosition.y + other.size.height / 2;
    const otherBottom = otherPosition.y + other.size.height;

    considerY(otherTop - movingTop, otherTop);
    considerY(otherCenterY - movingCenterY, otherCenterY);
    considerY(otherBottom - movingBottom, otherBottom);
    considerY(otherTop - movingBottom, otherTop);
    considerY(otherBottom - movingTop, otherBottom);

    for (const movingPort of movingNode.ports) {
      const movingPortY = raw.y + movingNode.size.height * movingPort.offset;
      for (const otherPort of other.ports) {
        const otherPortY =
          otherPosition.y + other.size.height * otherPort.offset;
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
  nodesById: ReadonlyMap<string, CanvasNode>,
) {
  let closest:
    | { connection: ConnectionDefinition; target: Point; distance: number }
    | undefined;

  for (const connection of candidates) {
    const target = portPoint(connection.to, positions, nodesById);
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
  const nodesById = useMemo(
    () => new Map(SCENARIO.nodes.map((node) => [node.id, node])),
    [],
  );
  const [positions, setPositions] = useState<Positions>(INITIAL_POSITIONS);
  const [activeConnectionIds, setActiveConnectionIds] = useState(
    () => new Set(INITIAL_CONNECTION_IDS),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [pan, setPan] = useState<Point>({ x: 64, y: 80 });
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<Interaction["type"]>("idle");
  const [guide, setGuide] = useState<Guide>({});
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

  const connectedPortKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const connection of SCENARIO.connections) {
      if (!activeConnectionIds.has(connection.id)) continue;
      keys.add(endpointKey(connection.from));
      keys.add(endpointKey(connection.to));
    }
    return keys;
  }, [activeConnectionIds]);

  const activeConnections = SCENARIO.connections.filter((connection) =>
    activeConnectionIds.has(connection.id),
  );

  const mutableConnections = SCENARIO.connections.filter(
    (connection) => connection.mutable,
  );
  const completedSteps = mutableConnections.filter((connection) =>
    activeConnectionIds.has(connection.id),
  ).length;

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
      // Pointer capture may fail when the gesture ends between frames.
    }
  };

  const releasePointer = (pointerId: number) => {
    try {
      canvasRef.current?.releasePointerCapture(pointerId);
    } catch {
      // The browser may already have released this pointer.
    }
  };

  const beginMove = (nodeId: string, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const node = nodesById.get(nodeId);
    if (!node) return;

    setSelectedNodeId(nodeId);
    interactionRef.current = {
      type: "move",
      pointerId: event.pointerId,
      nodeId,
      startClient: { x: event.clientX, y: event.clientY },
      startPosition: positions[nodeId] ?? node.position,
    };
    setMode("move");
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

    const start = portPoint(from, positions, nodesById);
    interactionRef.current = {
      type: "connect",
      pointerId: event.pointerId,
      from,
      current: start,
      action,
    };
    setSelectedNodeId(nodeId);
    setMode("connect");
    setConnectingFromPoint(start);
    setConnectingPoint(start);
    setConnectionAction(action);
    capturePointer(event.pointerId);
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button === 0 && event.target === event.currentTarget) {
      setSelectedNodeId(null);
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

    if (interaction.type === "move") {
      const movingNode = nodesById.get(interaction.nodeId);
      if (!movingNode) return;
      const raw = {
        x:
          interaction.startPosition.x +
          (event.clientX - interaction.startClient.x) / scale,
        y:
          interaction.startPosition.y +
          (event.clientY - interaction.startClient.y) / scale,
      };
      const snapped = getSnap(
        movingNode,
        raw,
        positions,
        SNAP_SCREEN_DISTANCE / scale,
      );
      setPositions((current) => ({
        ...current,
        [interaction.nodeId]: snapped.position,
      }));
      setGuide(snapped.guide);
      return;
    }

    const current = screenToWorld(event.clientX, event.clientY);
    interactionRef.current = { ...interaction, current };
    setConnectingPoint(current);
    const closest = closestCandidate(
      getConnectionCandidates(interaction),
      current,
      positions,
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

    if (interaction.type === "connect") {
      const end = screenToWorld(event.clientX, event.clientY);
      const closest = closestCandidate(
        getConnectionCandidates(interaction),
        end,
        positions,
        nodesById,
      );
      if (closest && closest.distance <= 30 / scale) {
        setActiveConnectionIds((current) => {
          const next = new Set(current);
          if (interaction.action === "add") {
            next.add(closest.connection.id);
          } else {
            next.delete(closest.connection.id);
          }
          return next;
        });
      }
    }

    releasePointer(event.pointerId);
    interactionRef.current = { type: "idle" };
    setMode("idle");
    setGuide({});
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

  const worldStyle: CSSProperties = {
    width: SCENARIO.world.width,
    height: SCENARIO.world.height,
    transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`,
  };

  const gridStyle = {
    backgroundSize: `${GRID_WIDTH * scale}px ${GRID_HEIGHT * scale}px`,
    backgroundPosition: `${pan.x}px ${pan.y}px`,
    "--grid-line": `${Math.max(0.15, scale)}px`,
  } as CSSProperties;

  const connectionGeometry = activeConnections.map((connection) => ({
    connection,
    from: portPoint(connection.from, positions, nodesById),
    to: portPoint(connection.to, positions, nodesById),
  }));

  return (
    <main
      ref={canvasRef}
      className={`node-canvas is-${mode}`}
      style={gridStyle}
      role="application"
      aria-label={SCENARIO.ariaLabel}
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
              const selectedAtFrom = selectedNodeId === connection.from.nodeId;
              const selectedAtTo = selectedNodeId === connection.to.nodeId;
              if (!selectedAtFrom && !selectedAtTo) return null;
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
            const isSelected =
              selectedNodeId === connection.from.nodeId ||
              selectedNodeId === connection.to.nodeId;
            return (
              <path
                key={connection.id}
                className="wire"
                d={bezierPath(from, to)}
                style={
                  isSelected
                    ? { stroke: `url(#selected-${connection.id})` }
                    : undefined
                }
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
              y2="6000"
            />
          )}
          {guide.y !== undefined && (
            <line
              className={`snap-guide ${guide.kind === "port" ? "is-port-guide" : ""}`}
              x1="-4000"
              x2="16000"
              y1={guide.y}
              y2={guide.y}
            />
          )}
        </svg>

        {SCENARIO.nodes.map((node) => {
          const missingInputs = node.ports.filter(
            (port) =>
              port.side === "in" &&
              port.required &&
              !connectedPortKeys.has(endpointKey({ nodeId: node.id, portId: port.id })),
          );
          const viewerReady =
            node.kind === "viewer" &&
            Boolean(
              node.readyWhen?.length &&
                node.readyWhen.every((id) => activeConnectionIds.has(id)),
            );

          return (
            <CanvasNodeView
              key={node.id}
              node={node}
              position={positions[node.id] ?? node.position}
              selected={selectedNodeId === node.id}
              connectedPortKeys={connectedPortKeys}
              missingInputs={missingInputs}
              viewerReady={viewerReady}
              targetConnectionId={targetConnectionId}
              connectionAction={connectionAction}
              onMove={beginMove}
              onConnect={beginConnection}
            />
          );
        })}
      </div>

      <aside className="canvas-status" aria-live="polite">
        <span>{Math.round(zoom * 100)}%</span>
        <span aria-hidden="true">·</span>
        <span>연결 단계 {completedSteps}/{mutableConnections.length}</span>
        <span aria-hidden="true">·</span>
        <span>우클릭 드래그: 이동</span>
        <span aria-hidden="true">·</span>
        <span>휠: 확대/축소</span>
        <span aria-hidden="true">·</span>
        <span>Ctrl+드래그: 연결 삭제</span>
      </aside>
    </main>
  );
}

function CanvasNodeView({
  node,
  position,
  selected,
  connectedPortKeys,
  missingInputs,
  viewerReady,
  targetConnectionId,
  connectionAction,
  onMove,
  onConnect,
}: {
  node: CanvasNode;
  position: Point;
  selected: boolean;
  connectedPortKeys: ReadonlySet<string>;
  missingInputs: readonly PortDefinition[];
  viewerReady: boolean;
  targetConnectionId: string | null;
  connectionAction: ConnectionAction | null;
  onMove: (nodeId: string, event: ReactPointerEvent) => void;
  onConnect: (
    nodeId: string,
    portId: string,
    event: ReactPointerEvent,
  ) => void;
}) {
  const style: CSSProperties = {
    left: position.x,
    top: position.y,
    width: node.size.width,
    height: node.size.height,
  };
  const warning = missingInputs.length > 0;

  if (node.kind === "scribble") {
    return (
      <section
        className={`canvas-node scribble-node ${selected ? "is-selected" : ""}`}
        style={style}
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
    node.kind === "processor" && warning ? "is-warning" : "",
    node.kind === "processor" && !warning ? "is-normal" : "",
    node.kind === "viewer" && viewerReady ? "is-ready" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      className={nodeClassName}
      style={style}
      aria-label={node.ariaLabel}
      onPointerDown={(event) => onMove(node.id, event)}
    >
      {node.kind === "processor" && (
        <>
          <div className="bifocal-label">{node.title}</div>
          <Image
            className="processor-icon"
            src={node.icon}
            alt=""
            width={260}
            height={260}
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
          {warning && (
            <button
              className="warning-indicator"
              type="button"
              aria-label={`경고: ${missingInputs.map((port) => port.label).join(", ")} 입력이 필요합니다`}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <span className="warning-mark" aria-hidden="true">!</span>
              <span className="warning-tooltip" role="tooltip">
                {missingInputs.map((port) => port.label).join(", ")} 입력이 필요합니다
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
        <ViewerContent node={node} ready={viewerReady} />
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
      <span className={`viewer-state ${ready ? "is-ready" : ""}`} aria-hidden="true">
        {ready ? "✓" : "!"}
      </span>
      <span className="viewer-message">
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
