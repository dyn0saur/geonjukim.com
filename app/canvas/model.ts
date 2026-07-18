export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type PortSide = "in" | "out";
export type NodeKind =
  | "scribble"
  | "processor"
  | "connector"
  | "panel"
  | "viewer";

export type PortDefinition = {
  id: string;
  side: PortSide;
  offset: number;
  label?: string;
  required?: boolean;
};

type BaseNode<TKind extends NodeKind> = {
  id: string;
  kind: TKind;
  position: Point;
  size: Size;
  ariaLabel: string;
  ports: readonly PortDefinition[];
};

export type ScribbleNode = BaseNode<"scribble"> & {
  text: string;
};

export type ProcessorNode = BaseNode<"processor"> & {
  title: string;
  icon: string;
};

export type ConnectorNode = BaseNode<"connector"> & {
  text: string;
};

export type PanelNode = BaseNode<"panel"> & {
  value: string;
};

export type ViewerNode = BaseNode<"viewer"> & {
  viewerType: "model" | "image";
  caption: string;
  emptyMessage: string;
  readyMessage?: string;
  readyWhen?: readonly string[];
};

export type CanvasNode =
  | ScribbleNode
  | ProcessorNode
  | ConnectorNode
  | PanelNode
  | ViewerNode;

export type ConnectionEndpoint = {
  nodeId: string;
  portId: string;
};

export type ConnectionDefinition = {
  id: string;
  from: ConnectionEndpoint;
  to: ConnectionEndpoint;
  initiallyConnected: boolean;
  mutable?: boolean;
};

export type CanvasScenario = {
  id: string;
  ariaLabel: string;
  world: Size;
  initialFocus: Point;
  nodes: readonly CanvasNode[];
  connections: readonly ConnectionDefinition[];
};

function endpointKey(endpoint: ConnectionEndpoint) {
  return `${endpoint.nodeId}.${endpoint.portId}`;
}

export function defineScenario(scenario: CanvasScenario): CanvasScenario {
  const nodes = new Map<string, CanvasNode>();
  const connectionIds = new Set<string>();
  const occupiedInputs = new Set<string>();

  for (const node of scenario.nodes) {
    if (nodes.has(node.id)) {
      throw new Error(`Duplicate canvas node id: ${node.id}`);
    }

    const portIds = new Set<string>();
    for (const port of node.ports) {
      if (portIds.has(port.id)) {
        throw new Error(`Duplicate port id: ${node.id}.${port.id}`);
      }
      if (port.offset < 0 || port.offset > 1) {
        throw new Error(`Port offset must be between 0 and 1: ${node.id}.${port.id}`);
      }
      portIds.add(port.id);
    }

    nodes.set(node.id, node);
  }

  for (const connection of scenario.connections) {
    if (connectionIds.has(connection.id)) {
      throw new Error(`Duplicate connection id: ${connection.id}`);
    }
    connectionIds.add(connection.id);

    const fromNode = nodes.get(connection.from.nodeId);
    const toNode = nodes.get(connection.to.nodeId);
    const fromPort = fromNode?.ports.find(
      (port) => port.id === connection.from.portId,
    );
    const toPort = toNode?.ports.find((port) => port.id === connection.to.portId);

    if (!fromNode || !fromPort || fromPort.side !== "out") {
      throw new Error(`Invalid connection source: ${endpointKey(connection.from)}`);
    }
    if (!toNode || !toPort || toPort.side !== "in") {
      throw new Error(`Invalid connection target: ${endpointKey(connection.to)}`);
    }

    const targetKey = endpointKey(connection.to);
    if (occupiedInputs.has(targetKey)) {
      throw new Error(`Input has more than one connection: ${targetKey}`);
    }
    occupiedInputs.add(targetKey);
  }

  for (const node of scenario.nodes) {
    if (node.kind !== "viewer") continue;
    for (const connectionId of node.readyWhen ?? []) {
      if (!connectionIds.has(connectionId)) {
        throw new Error(
          `Viewer ${node.id} references unknown connection: ${connectionId}`,
        );
      }
    }
  }

  return scenario;
}
