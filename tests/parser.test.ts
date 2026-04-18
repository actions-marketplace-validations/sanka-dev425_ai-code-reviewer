import { describe, expect, it } from "vitest";
import { parseDiff } from "../src/parser.js";

const MULTI_CHUNK_DIFF = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,4 +1,5 @@
 import { a } from "./a";
+import { b } from "./b";
 
 export function sum(x: number, y: number): number {
   return x + y;
@@ -20,3 +21,6 @@ export function sum(x: number, y: number): number {
 }
 
 export default sum;
+const doubled = sum(2, 2) * 2;
+const tripled = sum(3, 3) * 3;
+console.log(doubled + tripled);
`;

const BINARY_DIFF = `diff --git a/assets/logo.png b/assets/logo.png
Binary files a/assets/logo.png and b/assets/logo.png differ
`;

const ADDED_VS_CONTEXT_DIFF = `diff --git a/src/server.ts b/src/server.ts
index 3333333..4444444 100644
--- a/src/server.ts
+++ b/src/server.ts
@@ -10,4 +10,6 @@ const app = express();
 app.use(express.json());
 
+app.use(cors());
+app.use(helmet());
 app.get("/health", (_req, res) => res.send("ok"));
`;

describe("parseDiff", () => {
  it("returns correct line numbers for multi-chunk diffs", () => {
    const result = parseDiff(MULTI_CHUNK_DIFF);

    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe("src/example.ts");
    expect(result[0].chunks).toHaveLength(2);

    const firstChunkAdded = result[0].chunks[0].lines.filter((line) => line.type === "add");
    expect(firstChunkAdded).toHaveLength(1);
    expect(firstChunkAdded[0].lineNumber).toBe(2);

    const secondChunkAdded = result[0].chunks[1].lines.filter((line) => line.type === "add");
    expect(secondChunkAdded).toHaveLength(3);
    expect(secondChunkAdded[0].lineNumber).toBe(24);
    expect(secondChunkAdded[2].lineNumber).toBe(26);
  });

  it("skips binary files", () => {
    const result = parseDiff(BINARY_DIFF);
    expect(result).toHaveLength(0);
  });

  it("correctly identifies added vs context lines", () => {
    const result = parseDiff(ADDED_VS_CONTEXT_DIFF);

    expect(result).toHaveLength(1);
    const lines = result[0].chunks.flatMap((chunk) => chunk.lines);

    const added = lines.filter((line) => line.type === "add");
    const context = lines.filter((line) => line.type === "context");

    expect(added).toHaveLength(2);
    expect(added[0].content).toBe("app.use(cors());");
    expect(added[1].content).toBe("app.use(helmet());");
    expect(context.length).toBeGreaterThan(0);
  });
});
