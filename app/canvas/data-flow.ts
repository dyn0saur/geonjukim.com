import type {
  CanvasNode,
  CanvasScenario,
  ConnectionDefinition,
  PortDefinition,
} from "./model";

export type InputDataIssue = {
  port: PortDefinition;
  reason: "missing" | "invalid-upstream";
};

export type CanvasDataFlow = {
  validNodeIds: ReadonlySet<string>;
  validConnectionIds: ReadonlySet<string>;
  inputIssuesByNodeId: ReadonlyMap<string, readonly InputDataIssue[]>;
};

function endpointKey(nodeId: string, portId: string) {
  return `${nodeId}.${portId}`;
}

export function evaluateDataFlow(
  scenario: CanvasScenario,
  activeConnectionIds: ReadonlySet<string>,
): CanvasDataFlow {
  const nodesById = new Map(scenario.nodes.map((node) => [node.id, node]));
  const activeIncomingByPort = new Map<string, ConnectionDefinition>();
  for (const connection of scenario.connections) {
    if (!activeConnectionIds.has(connection.id)) continue;
    activeIncomingByPort.set(
      endpointKey(connection.to.nodeId, connection.to.portId),
      connection,
    );
  }

  const validityByNodeId = new Map<string, boolean>();
  const resolvingNodeIds = new Set<string>();

  const resolveNodeValidity = (nodeId: string): boolean => {
    const cached = validityByNodeId.get(nodeId);
    if (cached !== undefined) return cached;
    if (resolvingNodeIds.has(nodeId)) return false;

    const node = nodesById.get(nodeId);
    if (!node) return false;
    resolvingNodeIds.add(nodeId);
    const inputPorts = node.ports.filter((port) => port.side === "in");
    const dependentInputs = dependentInputPorts(node, inputPorts);
    const valid = dependentInputs.every((port) => {
      const incoming = activeIncomingByPort.get(endpointKey(node.id, port.id));
      return incoming ? resolveNodeValidity(incoming.from.nodeId) : false;
    });
    resolvingNodeIds.delete(nodeId);
    validityByNodeId.set(nodeId, valid);
    return valid;
  };

  for (const node of scenario.nodes) resolveNodeValidity(node.id);

  const validNodeIds = new Set(
    scenario.nodes
      .filter((node) => validityByNodeId.get(node.id))
      .map((node) => node.id),
  );
  const validConnectionIds = new Set(
    scenario.connections
      .filter(
        (connection) =>
          activeConnectionIds.has(connection.id) &&
          validNodeIds.has(connection.from.nodeId),
      )
      .map((connection) => connection.id),
  );
  const inputIssuesByNodeId = new Map<string, readonly InputDataIssue[]>();
  for (const node of scenario.nodes) {
    if (node.kind !== "processor") continue;
    const issues = node.ports
      .filter((port) => port.side === "in" && port.required)
      .flatMap((port): InputDataIssue[] => {
        const incoming = activeIncomingByPort.get(endpointKey(node.id, port.id));
        if (!incoming) return [{ port, reason: "missing" }];
        return validNodeIds.has(incoming.from.nodeId)
          ? []
          : [{ port, reason: "invalid-upstream" }];
      });
    if (issues.length) inputIssuesByNodeId.set(node.id, issues);
  }

  return { validNodeIds, validConnectionIds, inputIssuesByNodeId };
}

function dependentInputPorts(
  node: CanvasNode,
  inputPorts: readonly PortDefinition[],
) {
  return node.kind === "processor"
    ? inputPorts.filter((port) => port.required)
    : inputPorts;
}
