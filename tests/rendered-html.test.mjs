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

test("server-renders the node canvas prototype", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Node Canvas — Geonju Kim<\/title>/i);
  assert.match(html, /Grasshopper 스타일 포트폴리오 인터랙션 프로토타입/);
  assert.match(html, />5<\/span>/);
  assert.match(html, />3<\/span>/);
  assert.match(html, /A가 입력되지 않았습니다/);
  assert.match(html, /우클릭 드래그: 이동/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
