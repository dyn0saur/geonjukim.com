import {
  defineScenario,
  type ConnectorNode,
  type PanelNode,
  type PortDefinition,
} from "./model";

const CONNECTOR_HEIGHT = 86;

function connectorWidth(text: string) {
  return Math.max(210, text.length * 23 + 64);
}

function connector({
  id,
  text,
  x,
  y,
  ports,
}: {
  id: string;
  text: string;
  x: number;
  y: number;
  ports: readonly PortDefinition[];
}): ConnectorNode {
  return {
    id,
    kind: "connector",
    text,
    ariaLabel: `${text} 연결 컴포넌트`,
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
      y: 1561,
      ports: bidirectionalConnectorPorts,
    }),
    connector({
      id: "architectural-design",
      text: "Architectural Design",
      x: 2430,
      y: 1993,
      ports: [{ id: "out", side: "out", offset: 0.5 }],
    }),
    {
      id: "deconstruct",
      kind: "processor",
      title: "DECONSTRUCT REF. SURFACE",
      icon: "/assets/hana-hq/icons/deconstruct-ref-surface.png",
      ariaLabel: "Deconstruct Ref. Surface 주요 컴포넌트",
      position: { x: 3150, y: 1270 },
      size: { width: 950, height: 1000 },
      ports: [
        { id: "ref-srf", side: "in", offset: 0.33, label: "Ref. SRF", required: true },
        {
          id: "architectural-design",
          side: "in",
          offset: 0.75,
          label: "Architectural Design",
          required: true,
        },
        { id: "wood-panel", side: "out", offset: 0.14, label: "Wood Panel" },
        { id: "wood-block", side: "out", offset: 0.32, label: "Wood Block" },
        { id: "corner-reveal", side: "out", offset: 0.5, label: "Corner Reveal" },
        { id: "base-board", side: "out", offset: 0.68, label: "Base Board" },
        { id: "t-bar-system", side: "out", offset: 0.86, label: "T-Bar System" },
      ],
    },
    connector({
      id: "wood-panel",
      text: "Wood Panel",
      x: 4350,
      y: 1367,
      ports: bidirectionalConnectorPorts,
    }),
    connector({
      id: "wood-block",
      text: "Wood Block",
      x: 4350,
      y: 1547,
      ports: bidirectionalConnectorPorts,
    }),
    connector({
      id: "corner-reveal",
      text: "Corner Reveal",
      x: 4350,
      y: 1727,
      ports: bidirectionalConnectorPorts,
    }),
    connector({
      id: "base-board",
      text: "Base Board",
      x: 4350,
      y: 1907,
      ports: bidirectionalConnectorPorts,
    }),
    connector({
      id: "t-bar-system",
      text: "T-Bar System",
      x: 4350,
      y: 2087,
      ports: bidirectionalConnectorPorts,
    }),
    {
      id: "fabrication",
      kind: "processor",
      title: "FABRICATION & CONSTRUCTION REQUIREMENTS",
      icon: "/assets/hana-hq/icons/fabrication-requirements.png",
      ariaLabel: "Fabrication and Construction Requirements 주요 컴포넌트",
      position: { x: 5450, y: 1170 },
      size: { width: 1000, height: 1050 },
      ports: [
        { id: "wood-panel", side: "in", offset: 0.5, label: "Wood Panel", required: true },
        { id: "finish-method", side: "out", offset: 0.13, label: "Finish Method" },
        {
          id: "fabrication-method",
          side: "out",
          offset: 0.29,
          label: "Fabrication Method",
        },
        {
          id: "panel-thickness",
          side: "out",
          offset: 0.42,
          label: "Panel Thickness(mm)",
        },
        { id: "panel-width", side: "out", offset: 0.58, label: "Panel Width(mm)" },
        { id: "joint-width", side: "out", offset: 0.74, label: "Joint Width(mm)" },
        { id: "max-length", side: "out", offset: 0.9, label: "Max Length(mm)" },
      ],
    },
    panel({
      id: "finish-method",
      value: "Wood veneer application",
      ariaLabel: "Finish Method 패널: Wood veneer application",
      x: 6750,
      y: 1246,
      width: 1100,
      height: 120,
    }),
    panel({
      id: "fabrication-method",
      value: "Laminated timber fabrication followed by steam bending",
      ariaLabel: "Fabrication Method 설명 패널",
      x: 6750,
      y: 1389,
      width: 1350,
      height: 170,
    }),
    panel({
      id: "panel-thickness",
      value: "20",
      ariaLabel: "Panel Thickness 20 millimeters 패널",
      x: 7350,
      y: 1554,
      width: 270,
      height: 110,
      hasOutput: true,
    }),
    panel({
      id: "panel-width",
      value: "200",
      ariaLabel: "Panel Width 200 millimeters 패널",
      x: 7350,
      y: 1724,
      width: 270,
      height: 110,
      hasOutput: true,
    }),
    panel({
      id: "joint-width",
      value: "6",
      ariaLabel: "Joint Width 6 millimeters 패널",
      x: 7350,
      y: 1894,
      width: 270,
      height: 110,
      hasOutput: true,
    }),
    panel({
      id: "max-length",
      value: "2400",
      ariaLabel: "Max Length 2400 millimeters 패널",
      x: 7350,
      y: 2038,
      width: 270,
      height: 110,
      hasOutput: true,
    }),
    {
      id: "construct",
      kind: "processor",
      title: "CONSTRUCT WOOD PANEL 3D",
      icon: "/assets/hana-hq/icons/construct-wood-panel.png",
      ariaLabel: "Construct Wood Panel 3D 주요 컴포넌트",
      position: { x: 8350, y: 1320 },
      size: { width: 950, height: 850 },
      ports: [
        { id: "wood-panel", side: "in", offset: 0.1, label: "Wood Panel", required: true },
        {
          id: "panel-thickness",
          side: "in",
          offset: 0.34,
          label: "Panel Thickness(mm)",
          required: true,
        },
        {
          id: "panel-width",
          side: "in",
          offset: 0.54,
          label: "Panel Width(mm)",
          required: true,
        },
        {
          id: "joint-width",
          side: "in",
          offset: 0.74,
          label: "Joint Width(mm)",
          required: true,
        },
        {
          id: "max-length",
          side: "in",
          offset: 0.91,
          label: "Max Length(mm)",
          required: true,
        },
        { id: "model", side: "out", offset: 0.5, label: "3D Model" },
      ],
    },
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
    {
      id: "generate-drawings",
      kind: "processor",
      title: "GENERATE 2D DRAWINGS",
      icon: "/assets/hana-hq/icons/generate-2d-drawings.png",
      ariaLabel: "Generate 2D Drawings 주요 컴포넌트",
      position: { x: 12500, y: 1400 },
      size: { width: 850, height: 690 },
      ports: [
        { id: "model", side: "in", offset: 0.5, label: "3D Model", required: true },
        { id: "drawing", side: "out", offset: 0.5, label: "2D Drawing" },
      ],
    },
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
      id: "wood-panel-to-fabrication",
      from: { nodeId: "wood-panel", portId: "out" },
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
      from: { nodeId: "wood-panel", portId: "out" },
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
