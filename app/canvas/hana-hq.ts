import {
  defineScenario,
  type ConnectorNode,
  type PanelNode,
  type PortDefinition,
  type ProcessorNode,
} from "./model";

const CONNECTOR_HEIGHT = 86;
const PROCESSOR_HORIZONTAL_PADDING = 55;
const PROCESSOR_COLUMN_GAP = 76;
const PROCESSOR_ICON_SIZE = 170;
const PROCESSOR_VERTICAL_PADDING = 120;
const PROCESSOR_ROW_GAP = 150;

type ProcessorPortSpec = Omit<PortDefinition, "offset"> & { row: number };

function estimatedLabelWidth(label: string | undefined) {
  if (!label) return 0;
  return [...label].reduce((width, character) => {
    if (character === " ") return width + 9;
    if (/[ilI.,()]/.test(character)) return width + 10;
    if (/[MW]/.test(character)) return width + 25;
    return width + 18;
  }, 16);
}

function processor({
  id,
  title,
  icon,
  ariaLabel,
  x,
  y,
  rowCount,
  ports,
}: {
  id: string;
  title: string;
  icon: string;
  ariaLabel: string;
  x: number;
  y: number;
  rowCount: number;
  ports: readonly ProcessorPortSpec[];
}): ProcessorNode {
  const inputWidth = Math.max(
    180,
    ...ports
      .filter((port) => port.side === "in")
      .map((port) => estimatedLabelWidth(port.label)),
  );
  const outputWidth = Math.max(
    180,
    ...ports
      .filter((port) => port.side === "out")
      .map((port) => estimatedLabelWidth(port.label)),
  );
  const inputLeft = PROCESSOR_HORIZONTAL_PADDING;
  const iconCenter =
    inputLeft + inputWidth + PROCESSOR_COLUMN_GAP + PROCESSOR_ICON_SIZE / 2;
  const outputLeft =
    iconCenter + PROCESSOR_ICON_SIZE / 2 + PROCESSOR_COLUMN_GAP;
  const width = outputLeft + outputWidth + PROCESSOR_HORIZONTAL_PADDING;
  const height = Math.max(
    290,
    PROCESSOR_VERTICAL_PADDING * 2 + (rowCount - 1) * PROCESSOR_ROW_GAP,
  );

  return {
    id,
    kind: "processor",
    title,
    icon,
    ariaLabel,
    position: { x, y },
    size: { width, height },
    layout: {
      inputLeft,
      inputWidth,
      iconCenter,
      iconSize: PROCESSOR_ICON_SIZE,
      outputLeft,
      outputWidth,
    },
    ports: ports.map(({ row, ...port }) => ({
      ...port,
      offset:
        rowCount === 1
          ? 0.5
          : (PROCESSOR_VERTICAL_PADDING + row * PROCESSOR_ROW_GAP) / height,
    })),
  };
}

function connectorWidth(text: string) {
  return Math.max(210, text.length * 23 + 64);
}

function connector({
  id,
  text,
  x,
  y,
  ports,
  ariaLabel,
}: {
  id: string;
  text: string;
  x: number;
  y: number;
  ports: readonly PortDefinition[];
  ariaLabel?: string;
}): ConnectorNode {
  return {
    id,
    kind: "connector",
    text,
    ariaLabel: ariaLabel ?? `${text} 연결 컴포넌트`,
    position: { x, y },
    size: { width: connectorWidth(text), height: CONNECTOR_HEIGHT },
    ports,
  };
}

function panel({
  id,
  value,
  ariaLabel,
  x,
  y,
  width,
  height,
  hasOutput = false,
}: {
  id: string;
  value: string;
  ariaLabel: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasOutput?: boolean;
}): PanelNode {
  return {
    id,
    kind: "panel",
    value,
    ariaLabel,
    position: { x, y },
    size: { width, height },
    ports: [
      { id: "in", side: "in", offset: 0.5 },
      ...(hasOutput
        ? ([{ id: "out", side: "out", offset: 0.5 }] as const)
        : []),
    ],
  };
}

const bidirectionalConnectorPorts = [
  { id: "in", side: "in", offset: 0.5 },
  { id: "out", side: "out", offset: 0.5 },
] as const;

export const HANA_HQ_SCENARIO = defineScenario({
  id: "hana-hq",
  ariaLabel: "HANA HQ Grasshopper 스타일 프로젝트 캔버스",
  world: { width: 16400, height: 3600 },
  initialFocus: { x: 0, y: 1250 },
  nodes: [
    {
      id: "hana-title",
      kind: "scribble",
      text: "HANA HQ",
      ariaLabel: "HANA HQ 프로젝트 제목",
      position: { x: 180, y: 170 },
      size: { width: 1100, height: 220 },
      ports: [],
    },
    {
      id: "ref-viewer",
      kind: "viewer",
      viewerType: "model",
      caption: "REFERENCE SURFACE",
      emptyMessage: "RHINO MODEL PLACEHOLDER",
      ariaLabel: "비어 있는 Ref. Surface 모델 뷰어",
      position: { x: 180, y: 900 },
      size: { width: 1800, height: 1800 },
      ports: [{ id: "model", side: "out", offset: 0.5 }],
    },
    connector({
      id: "ref-srf",
      text: "Ref. SRF",
      x: 2250,
      y: 1497,
      ports: bidirectionalConnectorPorts,
    }),
    connector({
      id: "architectural-design",
      text: "Architectural Design",
      x: 2430,
      y: 1872,
      ports: [{ id: "out", side: "out", offset: 0.5 }],
    }),
    processor({
      id: "deconstruct",
      title: "DECONSTRUCT REF. SURFACE",
      icon: "/assets/hana-hq/icons/deconstruct-ref-surface.png",
      ariaLabel: "Deconstruct Ref. Surface 주요 컴포넌트",
      x: 3150,
      y: 1270,
      rowCount: 5,
      ports: [
        { id: "ref-srf", side: "in", row: 1, label: "Ref. SRF", required: true },
        {
          id: "architectural-design",
          side: "in",
          row: 3.5,
          label: "Architectural Design",
          required: true,
        },
        { id: "wood-panel", side: "out", row: 0, label: "Wood Panel" },
        { id: "wood-block", side: "out", row: 1, label: "Wood Block" },
        { id: "corner-reveal", side: "out", row: 2, label: "Corner Reveal" },
        { id: "base-board", side: "out", row: 3, label: "Base Board" },
        { id: "t-bar-system", side: "out", row: 4, label: "T-Bar System" },
      ],
    }),
    connector({
      id: "wood-panel",
      text: "Wood Panel",
      x: 4350,
      y: 1347,
      ports: bidirectionalConnectorPorts,
    }),
    connector({
      id: "wood-panel-construct-branch",
      text: "Wood Panel",
      x: 5050,
      y: 1347,
      ports: bidirectionalConnectorPorts,
      ariaLabel: "Wood Panel Construct 분기 연결 컴포넌트",
    }),
    connector({
      id: "wood-panel-fabrication-branch",
      text: "Wood Panel",
      x: 5050,
      y: 1622,
      ports: bidirectionalConnectorPorts,
      ariaLabel: "Wood Panel Fabrication 분기 연결 컴포넌트",
    }),
    connector({
      id: "wood-block",
      text: "Wood Block",
      x: 4350,
      y: 1497,
      ports: bidirectionalConnectorPorts,
    }),
    connector({
      id: "corner-reveal",
      text: "Corner Reveal",
      x: 4350,
      y: 1647,
      ports: bidirectionalConnectorPorts,
    }),
    connector({
      id: "base-board",
      text: "Base Board",
      x: 4350,
      y: 1797,
      ports: bidirectionalConnectorPorts,
    }),
    connector({
      id: "t-bar-system",
      text: "T-Bar System",
      x: 4350,
      y: 1947,
      ports: bidirectionalConnectorPorts,
    }),
    processor({
      id: "fabrication",
      title: "FABRICATION & CONSTRUCTION REQUIREMENTS",
      icon: "/assets/hana-hq/icons/fabrication-requirements.png",
      ariaLabel: "Fabrication and Construction Requirements 주요 컴포넌트",
      x: 5700,
      y: 1170,
      rowCount: 6,
      ports: [
        { id: "wood-panel", side: "in", row: 2.5, label: "Wood Panel", required: true },
        { id: "finish-method", side: "out", row: 0, label: "Finish Method" },
        {
          id: "fabrication-method",
          side: "out",
          row: 1,
          label: "Fabrication Method",
        },
        {
          id: "panel-thickness",
          side: "out",
          row: 2,
          label: "Panel Thickness(mm)",
        },
        { id: "panel-width", side: "out", row: 3, label: "Panel Width(mm)" },
        { id: "joint-width", side: "out", row: 4, label: "Joint Width(mm)" },
        { id: "max-length", side: "out", row: 5, label: "Max Length(mm)" },
      ],
    }),
    panel({
      id: "finish-method",
      value: "Wood veneer application",
      ariaLabel: "Finish Method 패널: Wood veneer application",
      x: 6900,
      y: 1230,
      width: 1100,
      height: 120,
    }),
    panel({
      id: "fabrication-method",
      value: "Laminated timber fabrication followed by steam bending",
      ariaLabel: "Fabrication Method 설명 패널",
      x: 6900,
      y: 1355,
      width: 1350,
      height: 170,
    }),
    panel({
      id: "panel-thickness",
      value: "20",
      ariaLabel: "Panel Thickness 20 millimeters 패널",
      x: 7400,
      y: 1535,
      width: 270,
      height: 110,
      hasOutput: true,
    }),
    panel({
      id: "panel-width",
      value: "200",
      ariaLabel: "Panel Width 200 millimeters 패널",
      x: 7400,
      y: 1685,
      width: 270,
      height: 110,
      hasOutput: true,
    }),
    panel({
      id: "joint-width",
      value: "6",
      ariaLabel: "Joint Width 6 millimeters 패널",
      x: 7400,
      y: 1835,
      width: 270,
      height: 110,
      hasOutput: true,
    }),
    panel({
      id: "max-length",
      value: "2400",
      ariaLabel: "Max Length 2400 millimeters 패널",
      x: 7400,
      y: 1985,
      width: 270,
      height: 110,
      hasOutput: true,
    }),
    processor({
      id: "construct",
      title: "CONSTRUCT WOOD PANEL 3D",
      icon: "/assets/hana-hq/icons/construct-wood-panel.png",
      ariaLabel: "Construct Wood Panel 3D 주요 컴포넌트",
      x: 8350,
      y: 1320,
      rowCount: 5,
      ports: [
        { id: "wood-panel", side: "in", row: 0, label: "Wood Panel", required: true },
        {
          id: "panel-thickness",
          side: "in",
          row: 1,
          label: "Panel Thickness(mm)",
          required: true,
        },
        {
          id: "panel-width",
          side: "in",
          row: 2,
          label: "Panel Width(mm)",
          required: true,
        },
        {
          id: "joint-width",
          side: "in",
          row: 3,
          label: "Joint Width(mm)",
          required: true,
        },
        {
          id: "max-length",
          side: "in",
          row: 4,
          label: "Max Length(mm)",
          required: true,
        },
        { id: "model", side: "out", row: 2, label: "3D Model" },
      ],
    }),
    {
      id: "model-viewer",
      kind: "viewer",
      viewerType: "model",
      caption: "3D MODEL",
      emptyMessage: "AWAITING 3D MODEL",
      readyMessage: "3D MODEL LINKED",
      readyWhen: ["construct-to-model-viewer"],
      ariaLabel: "비어 있는 3D Model 뷰어",
      position: { x: 9700, y: 895 },
      size: { width: 1700, height: 1700 },
      ports: [
        { id: "in", side: "in", offset: 0.5 },
        { id: "out", side: "out", offset: 0.5 },
      ],
    },
    connector({
      id: "model-reference",
      text: "3D Model",
      x: 11650,
      y: 1702,
      ports: bidirectionalConnectorPorts,
    }),
    processor({
      id: "generate-drawings",
      title: "GENERATE 2D DRAWINGS",
      icon: "/assets/hana-hq/icons/generate-2d-drawings.png",
      ariaLabel: "Generate 2D Drawings 주요 컴포넌트",
      x: 12500,
      y: 1600,
      rowCount: 1,
      ports: [
        { id: "model", side: "in", row: 0, label: "3D Model", required: true },
        { id: "drawing", side: "out", row: 0, label: "2D Drawing" },
      ],
    }),
    {
      id: "drawing-viewer",
      kind: "viewer",
      viewerType: "image",
      caption: "2D DRAWING",
      emptyMessage: "AWAITING 3D MODEL INPUT",
      readyMessage: "2D DRAWING READY",
      readyWhen: ["model-reference-to-generate"],
      ariaLabel: "비어 있는 2D Drawing 이미지 뷰어",
      position: { x: 14150, y: 845 },
      size: { width: 1800, height: 1800 },
      ports: [{ id: "in", side: "in", offset: 0.5 }],
    },
  ],
  connections: [
    {
      id: "ref-viewer-to-reference",
      from: { nodeId: "ref-viewer", portId: "model" },
      to: { nodeId: "ref-srf", portId: "in" },
      initiallyConnected: true,
    },
    {
      id: "reference-to-deconstruct",
      from: { nodeId: "ref-srf", portId: "out" },
      to: { nodeId: "deconstruct", portId: "ref-srf" },
      initiallyConnected: false,
      mutable: true,
    },
    {
      id: "architecture-to-deconstruct",
      from: { nodeId: "architectural-design", portId: "out" },
      to: { nodeId: "deconstruct", portId: "architectural-design" },
      initiallyConnected: true,
    },
    ...[
      "wood-panel",
      "wood-block",
      "corner-reveal",
      "base-board",
      "t-bar-system",
    ].map((id) => ({
      id: `deconstruct-to-${id}`,
      from: { nodeId: "deconstruct", portId: id },
      to: { nodeId: id, portId: "in" },
      initiallyConnected: true,
    })),
    {
      id: "wood-panel-to-construct-branch",
      from: { nodeId: "wood-panel", portId: "out" },
      to: { nodeId: "wood-panel-construct-branch", portId: "in" },
      initiallyConnected: true,
    },
    {
      id: "wood-panel-to-fabrication-branch",
      from: { nodeId: "wood-panel", portId: "out" },
      to: { nodeId: "wood-panel-fabrication-branch", portId: "in" },
      initiallyConnected: true,
    },
    {
      id: "wood-panel-fabrication-branch-to-fabrication",
      from: { nodeId: "wood-panel-fabrication-branch", portId: "out" },
      to: { nodeId: "fabrication", portId: "wood-panel" },
      initiallyConnected: true,
    },
    ...[
      "finish-method",
      "fabrication-method",
      "panel-thickness",
      "panel-width",
      "joint-width",
      "max-length",
    ].map((id) => ({
      id: `fabrication-to-${id}`,
      from: { nodeId: "fabrication", portId: id },
      to: { nodeId: id, portId: "in" },
      initiallyConnected: true,
    })),
    {
      id: "wood-panel-to-construct",
      from: { nodeId: "wood-panel-construct-branch", portId: "out" },
      to: { nodeId: "construct", portId: "wood-panel" },
      initiallyConnected: false,
      mutable: true,
    },
    ...["panel-thickness", "panel-width", "joint-width", "max-length"].map(
      (id) => ({
        id: `${id}-to-construct`,
        from: { nodeId: id, portId: "out" },
        to: { nodeId: "construct", portId: id },
        initiallyConnected: true,
      }),
    ),
    {
      id: "construct-to-model-viewer",
      from: { nodeId: "construct", portId: "model" },
      to: { nodeId: "model-viewer", portId: "in" },
      initiallyConnected: false,
      mutable: true,
    },
    {
      id: "model-viewer-to-reference",
      from: { nodeId: "model-viewer", portId: "out" },
      to: { nodeId: "model-reference", portId: "in" },
      initiallyConnected: true,
    },
    {
      id: "model-reference-to-generate",
      from: { nodeId: "model-reference", portId: "out" },
      to: { nodeId: "generate-drawings", portId: "model" },
      initiallyConnected: false,
      mutable: true,
    },
    {
      id: "generate-to-drawing-viewer",
      from: { nodeId: "generate-drawings", portId: "drawing" },
      to: { nodeId: "drawing-viewer", portId: "in" },
      initiallyConnected: true,
    },
  ],
});
