import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the HANA HQ project canvas", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>HANA HQ — Geonju Kim<\/title>/i);
  assert.match(html, /HANA HQ Grasshopper 스타일 프로젝트 캔버스/);
  assert.match(html, />HANA HQ<\/section>/);
  assert.match(html, /DECONSTRUCT REF\. SURFACE/);
  assert.match(html, /FABRICATION (?:&|&amp;) CONSTRUCTION REQUIREMENTS/);
  assert.match(html, /CONSTRUCT WOOD PANEL 3D/);
  assert.match(html, /GENERATE 2D DRAWINGS/);
  assert.match(html, /Wood veneer application/);
  assert.match(html, /Laminated timber fabrication followed by steam bending/);
  assert.match(html, /Wood Panel Construct 분기 연결 컴포넌트/);
  assert.match(html, /Wood Panel Fabrication 분기 연결 컴포넌트/);
  assert.match(
    html,
    /data-node-id="wood-panel"[^>]*data-data-valid="false"/,
  );
  assert.match(
    html,
    /data-node-id="fabrication"[^>]*data-data-valid="false"/,
  );
  assert.match(
    html,
    /data-node-id="architectural-design"[^>]*data-data-valid="true"/,
  );
  assert.match(html, /Ref\. SRF input is required\./);
  assert.match(html, /Wood Panel has no valid upstream data\./);
  assert.doesNotMatch(html, /입력이 필요합니다|유효한 데이터가 없습니다|경고:/);
  assert.match(html, /AWAITING 3D MODEL/);
  assert.doesNotMatch(html, /연결 단계/);
  assert.match(html, /좌클릭 드래그: 영역 선택/);
  assert.match(html, /우클릭 드래그: 이동/);
  assert.match(html, /Ctrl\+Z\/Y: 실행 취소\/다시 실행/);
  assert.match(html, /Alt\+좌클릭 드래그: 캔버스 확장/);
  assert.match(html, /south-east 모서리에서 크기 조절/);
  assert.match(html, /deconstruct-ref-surface\.png/);
  assert.match(html, /fabrication-requirements\.png/);
  assert.match(html, /construct-wood-panel\.png/);
  assert.match(html, /generate-2d-drawings\.png/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
