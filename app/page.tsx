"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

type NodeId = "five" | "three" | "add" | "result";
type Point = { x: number; y: number };
type Positions = Record<NodeId, Point>;
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
      nodeId: NodeId;
      startClient: Point;
      startPosition: Point;
    }
  | {
      type: "connect";
      pointerId: number;
      from: Point;
      current: Point;
      action: ConnectionAction;
    };

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const GRID_WIDTH = 15 * 40;
const GRID_HEIGHT = 5 * 40;
const SNAP_SCREEN_DISTANCE = 9;

const NODE_SPECS: Record<
  NodeId,
  { width: number; height: number; portFractions: number[] }
> = {
  five: { width: 220, height: 132, portFractions: [0.5] },
  three: { width: 220, height: 132, portFractions: [0.5] },
  add: { width: 470, height: 315, portFractions: [0.32, 0.72, 0.5] },
  result: { width: 460, height: 132, portFractions: [0.5] },
};

const INITIAL_POSITIONS: Positions = {
  five: { x: 140, y: 220 },
  three: { x: 140, y: 640 },
  add: { x: 800, y: 350 },
  result: { x: 1540, y: 440 },
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function bezierPath(from: Point, to: Point) {
  const direction = to.x >= from.x ? 1 : -1;
  const reach = Math.max(110, Math.abs(to.x - from.x) * 0.46);
  return `M ${from.x} ${from.y} C ${from.x + reach * direction} ${from.y}, ${to.x - reach * direction} ${to.y}, ${to.x} ${to.y}`;
}

function portPoint(
  nodeId: NodeId,
  side: "in" | "out",
  position: Point,
  portIndex = 0,
) {
  const spec = NODE_SPECS[nodeId];
  const fraction = spec.portFractions[portIndex] ?? 0.5;
  return {
    x: position.x + (side === "out" ? spec.width : 0),
    y: position.y + spec.height * fraction,
  };
}

function getSnap(
  nodeId: NodeId,
  raw: Point,
  positions: Positions,
  threshold: number,
) {
  const moving = NODE_SPECS[nodeId];
  const result = { ...raw };
  let bestX: { delta: number; guide: number } | null = null;
  let bestY: { delta: number; guide: number; kind: "edge" | "port" } | null =
    null;

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

  for (const otherId of Object.keys(positions) as NodeId[]) {
    if (otherId === nodeId) continue;

    const otherPosition = positions[otherId];
    const other = NODE_SPECS[otherId];
    const movingLeft = raw.x;
    const movingCenterX = raw.x + moving.width / 2;
    const movingRight = raw.x + moving.width;
    const otherLeft = otherPosition.x;
    const otherCenterX = otherPosition.x + other.width / 2;
    const otherRight = otherPosition.x + other.width;

    considerX(otherLeft - movingLeft, otherLeft);
    considerX(otherCenterX - movingCenterX, otherCenterX);
    considerX(otherRight - movingRight, otherRight);
    considerX(otherLeft - movingRight, otherLeft);
    considerX(otherRight - movingLeft, otherRight);

    const movingTop = raw.y;
    const movingCenterY = raw.y + moving.height / 2;
    const movingBottom = raw.y + moving.height;
    const otherTop = otherPosition.y;
    const otherCenterY = otherPosition.y + other.height / 2;
    const otherBottom = otherPosition.y + other.height;

    considerY(otherTop - movingTop, otherTop);
    considerY(otherCenterY - movingCenterY, otherCenterY);
    considerY(otherBottom - movingBottom, otherBottom);
    considerY(otherTop - movingBottom, otherTop);
    considerY(otherBottom - movingTop, otherBottom);

    const movingPorts = moving.portFractions.map(
      (fraction) => raw.y + moving.height * fraction,
    );
    const otherPorts = other.portFractions.map(
      (fraction) => otherPosition.y + other.height * fraction,
    );

    for (const movingPort of movingPorts) {
      for (const otherPort of otherPorts) {
        considerY(otherPort - movingPort, otherPort, "port");
      }
    }
  }

  const guide: Guide = {};
  const resolvedBestX = bestX as { delta: number; guide: number } | null;
  const resolvedBestY = bestY as {
    delta: number;
    guide: number;
    kind: "edge" | "port";
  } | null;

  if (resolvedBestX) {
    result.x += resolvedBestX.delta;
    guide.x = resolvedBestX.guide;
  }
  if (resolvedBestY) {
    result.y += resolvedBestY.delta;
    guide.y = resolvedBestY.guide;
    guide.kind = resolvedBestY.kind;
  }

  return { position: result, guide };
}

export default function Home() {
  const canvasRef = useRef<HTMLElement>(null);
  const interactionRef = useRef<Interaction>({ type: "idle" });
  const centeredRef = useRef(false);
  const [positions, setPositions] = useState<Positions>(INITIAL_POSITIONS);
  const [pan, setPan] = useState<Point>({ x: 64, y: 80 });
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<Interaction["type"]>("idle");
  const [guide, setGuide] = useState<Guide>({});
  const [connectingPoint, setConnectingPoint] = useState<Point | null>(null);
  const [targetActive, setTargetActive] = useState(false);
  const [connectionAction, setConnectionAction] =
    useState<ConnectionAction | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);

  const scale = zoom / MAX_ZOOM;

  useEffect(() => {
    if (centeredRef.current) return;
    centeredRef.current = true;
    const graphWidth =
      INITIAL_POSITIONS.result.x + NODE_SPECS.result.width - INITIAL_POSITIONS.five.x;
    const graphHeight =
      INITIAL_POSITIONS.three.y + NODE_SPECS.three.height - INITIAL_POSITIONS.five.y;
    setPan({
      x: (window.innerWidth - graphWidth * scale) / 2 - INITIAL_POSITIONS.five.x * scale,
      y: (window.innerHeight - graphHeight * scale) / 2 - INITIAL_POSITIONS.five.y * scale,
    });
  }, [scale]);

  const wirePoints = useMemo(() => {
    return {
      threeOut: portPoint("three", "out", positions.three),
      addA: portPoint("add", "in", positions.add, 0),
      addB: portPoint("add", "in", positions.add, 1),
      addOut: portPoint("add", "out", positions.add, 2),
      resultIn: portPoint("result", "in", positions.result),
      fiveOut: portPoint("five", "out", positions.five),
    };
  }, [positions]);

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
      // Pointer capture can fail when a gesture ends between frames.
    }
  };

  const releasePointer = (pointerId: number) => {
    try {
      canvasRef.current?.releasePointerCapture(pointerId);
    } catch {
      // The browser may already have released it.
    }
  };

  const beginMove = (nodeId: NodeId, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = {
      type: "move",
      pointerId: event.pointerId,
      nodeId,
      startClient: { x: event.clientX, y: event.clientY },
      startPosition: positions[nodeId],
    };
    setMode("move");
    capturePointer(event.pointerId);
  };

  const beginConnection = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const action: ConnectionAction = event.ctrlKey ? "remove" : "add";
    if ((action === "add" && isCompleted) || (action === "remove" && !isCompleted)) {
      return;
    }
    const start = wirePoints.fiveOut;
    interactionRef.current = {
      type: "connect",
      pointerId: event.pointerId,
      from: start,
      current: start,
      action,
    };
    setMode("connect");
    setConnectingPoint(start);
    setConnectionAction(action);
    capturePointer(event.pointerId);
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
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
      const raw = {
        x:
          interaction.startPosition.x +
          (event.clientX - interaction.startClient.x) / scale,
        y:
          interaction.startPosition.y +
          (event.clientY - interaction.startClient.y) / scale,
      };
      const snapped = getSnap(
        interaction.nodeId,
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
    setTargetActive(
      distance(current, wirePoints.addA) <= 24 / scale,
    );
  };

  const finishInteraction = (event: ReactPointerEvent<HTMLElement>) => {
    const interaction = interactionRef.current;
    if (interaction.type === "idle" || interaction.pointerId !== event.pointerId) {
      return;
    }

    if (interaction.type === "connect") {
      const end = screenToWorld(event.clientX, event.clientY);
      if (distance(end, wirePoints.addA) <= 28 / scale) {
        setIsCompleted(interaction.action === "add");
      }
    }

    releasePointer(event.pointerId);
    interactionRef.current = { type: "idle" };
    setMode("idle");
    setGuide({});
    setConnectingPoint(null);
    setTargetActive(false);
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
    const oldScale = scale;
    const worldAtPointer = {
      x: (pointer.x - pan.x) / oldScale,
      y: (pointer.y - pan.y) / oldScale,
    };
    const nextZoom = clamp(zoom * Math.exp(-event.deltaY * 0.0014), MIN_ZOOM, MAX_ZOOM);
    const nextScale = nextZoom / MAX_ZOOM;

    setZoom(nextZoom);
    setPan({
      x: pointer.x - worldAtPointer.x * nextScale,
      y: pointer.y - worldAtPointer.y * nextScale,
    });
  };

  const worldStyle = {
    transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`,
  };

  const gridStyle = {
    backgroundSize: `${GRID_WIDTH * scale}px ${GRID_HEIGHT * scale}px`,
    backgroundPosition: `${pan.x}px ${pan.y}px`,
    "--grid-line": `${Math.max(0.15, scale)}px`,
  } as React.CSSProperties;

  return (
    <main
      ref={canvasRef}
      className={`node-canvas is-${mode}`}
      style={gridStyle}
      role="application"
      aria-label="Grasshopper 스타일 포트폴리오 인터랙션 프로토타입"
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishInteraction}
      onPointerCancel={finishInteraction}
      onWheel={handleWheel}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="world" style={worldStyle}>
        <svg className="wire-layer" width="2600" height="1600" aria-hidden="true">
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
          </defs>

          <path
            className="wire"
            d={bezierPath(wirePoints.threeOut, wirePoints.addB)}
          />
          <path
            className="wire"
            d={bezierPath(wirePoints.addOut, wirePoints.resultIn)}
          />
          {isCompleted && (
            <path
              className="wire"
              d={bezierPath(wirePoints.fiveOut, wirePoints.addA)}
            />
          )}
          {connectingPoint && (
            <path
              className={`wire wire-preview ${connectionAction === "remove" ? "is-removal" : ""}`}
              d={bezierPath(wirePoints.fiveOut, connectingPoint)}
              markerEnd="url(#connection-arrow)"
            />
          )}

          {guide.x !== undefined && (
            <line
              className="snap-guide"
              x1={guide.x}
              x2={guide.x}
              y1="-4000"
              y2="4000"
            />
          )}
          {guide.y !== undefined && (
            <line
              className={`snap-guide ${guide.kind === "port" ? "is-port-guide" : ""}`}
              x1="-4000"
              x2="4000"
              y1={guide.y}
              y2={guide.y}
            />
          )}
        </svg>

        <PanelNode
          id="five"
          value="5"
          position={positions.five}
          onMove={beginMove}
          connectedOutput={isCompleted}
          outputProps={{
            onPointerDown: beginConnection,
            "aria-label": isCompleted
              ? "5 패널 출력, Ctrl을 누른 채 A 입력으로 드래그하여 연결 삭제"
              : "5 패널 출력, A 입력으로 드래그하여 연결",
          }}
        />
        <PanelNode
          id="three"
          value="3"
          position={positions.three}
          onMove={beginMove}
          connectedOutput
        />
        <AddNode
          position={positions.add}
          warning={!isCompleted}
          targetActive={targetActive}
          connectionAction={connectionAction}
          onMove={beginMove}
        />
        <PanelNode
          id="result"
          value={isCompleted ? "8" : "3"}
          position={positions.result}
          onMove={beginMove}
          connectedInput
        />
      </div>

      <aside className="canvas-status" aria-live="polite">
        <span>{Math.round(zoom * 100)}%</span>
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

function PanelNode({
  id,
  value,
  position,
  onMove,
  connectedInput = false,
  connectedOutput = false,
  outputProps,
}: {
  id: NodeId;
  value: string;
  position: Point;
  onMove: (nodeId: NodeId, event: ReactPointerEvent) => void;
  connectedInput?: boolean;
  connectedOutput?: boolean;
  outputProps?: React.ButtonHTMLAttributes<HTMLButtonElement>;
}) {
  return (
    <section
      className="node panel-node"
      style={{
        left: position.x,
        top: position.y,
        width: NODE_SPECS[id].width,
        height: NODE_SPECS[id].height,
      }}
      aria-label={`${value} 패널`}
      onPointerDown={(event) => onMove(id, event)}
    >
      <Port side="in" connected={connectedInput} aria-label={`${value} 패널 입력`} />
      <span className="panel-value">{value}</span>
      <Port
        side="out"
        connected={connectedOutput}
        {...outputProps}
      />
    </section>
  );
}

function AddNode({
  position,
  warning,
  targetActive,
  connectionAction,
  onMove,
}: {
  position: Point;
  warning: boolean;
  targetActive: boolean;
  connectionAction: ConnectionAction | null;
  onMove: (nodeId: NodeId, event: ReactPointerEvent) => void;
}) {
  return (
    <section
      className={`node add-node ${warning ? "is-warning" : "is-normal"}`}
      style={{
        left: position.x,
        top: position.y,
        width: NODE_SPECS.add.width,
        height: NODE_SPECS.add.height,
      }}
      aria-label={warning ? "A 입력이 누락된 더하기 컴포넌트" : "완료된 더하기 컴포넌트"}
      onPointerDown={(event) => onMove("add", event)}
    >
      <div className="add-label add-label-a">A</div>
      <div className="add-label add-label-b">B</div>
      <div className="add-label add-label-r">R</div>
      <div className="add-icon" aria-hidden="true">+</div>
      <Port
        side="in"
        className={`port-a ${targetActive ? "is-target" : ""} ${
          targetActive && connectionAction === "remove" ? "is-disconnect-target" : ""
        }`}
        connected={!warning}
        aria-label="더하기 컴포넌트 A 입력"
      />
      <Port
        side="in"
        className="port-b"
        connected
        aria-label="더하기 컴포넌트 B 입력"
      />
      <Port side="out" connected className="port-r" aria-label="더하기 컴포넌트 결과 출력" />
      {warning && (
        <button
          className="warning-indicator"
          type="button"
          aria-label="경고: A가 입력되지 않았습니다"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="warning-dot" aria-hidden="true" />
          <span className="warning-tooltip" role="tooltip">
            A가 입력되지 않았습니다
          </span>
        </button>
      )}
    </section>
  );
}

function Port({
  side,
  connected = false,
  className = "",
  ...buttonProps
}: {
  side: "in" | "out";
  connected?: boolean;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`port port-${side} ${connected ? "is-connected" : ""} ${className}`}
      {...buttonProps}
      onPointerDown={(event) => {
        event.stopPropagation();
        buttonProps.onPointerDown?.(event);
      }}
    />
  );
}
