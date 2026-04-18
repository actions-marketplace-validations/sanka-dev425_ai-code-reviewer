export interface DiffLine {
  lineNumber: number;
  content: string;
  type: "add" | "context" | "del";
}

export interface Chunk {
  newStart: number;
  lines: DiffLine[];
}

export interface ParsedFile {
  filename: string;
  language: string;
  additions: number;
  deletions: number;
  chunks: Chunk[];
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".cs": "csharp",
  ".c": "c",
  ".h": "c",
  ".hpp": "cpp",
  ".cpp": "cpp",
  ".php": "php",
  ".rb": "ruby",
  ".sql": "sql",
  ".html": "html",
  ".css": "css",
  ".scss": "scss",
  ".json": "json",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".sh": "bash",
};

function detectLanguage(filename: string): string {
  const lower = filename.toLowerCase();

  if (lower.endsWith("/dockerfile") || lower === "dockerfile") {
    return "dockerfile";
  }

  if (lower.endsWith("/makefile") || lower === "makefile") {
    return "makefile";
  }

  const extensionIndex = lower.lastIndexOf(".");
  if (extensionIndex === -1) {
    return "unknown";
  }

  const extension = lower.slice(extensionIndex);
  return LANGUAGE_BY_EXTENSION[extension] ?? "unknown";
}

function isBinaryDiff(fileBlock: string): boolean {
  return (
    fileBlock.includes("Binary files") ||
    fileBlock.includes("GIT binary patch") ||
    fileBlock.includes("literal ")
  );
}

function parseChunkHeader(line: string): number | null {
  const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (!match) {
    return null;
  }

  const startValue = match[1];
  if (typeof startValue !== "string") {
    return null;
  }

  return Number.parseInt(startValue, 10);
}

export function parseDiff(rawDiff: string): ParsedFile[] {
  const normalizedDiff = rawDiff.replace(/\r\n/g, "\n");
  if (!normalizedDiff.trim()) {
    return [];
  }

  const fileBlocks = normalizedDiff
    .split(/^diff --git /m)
    .filter((block) => block.trim().length > 0)
    .map((block) => `diff --git ${block}`);

  const parsedFiles: ParsedFile[] = [];

  for (const fileBlock of fileBlocks) {
    if (isBinaryDiff(fileBlock) || fileBlock.includes("\n+++ /dev/null")) {
      continue;
    }

    const headerMatch = /^diff --git a\/(.+?) b\/(.+)$/m.exec(fileBlock);
    if (!headerMatch) {
      continue;
    }

    const filename = headerMatch[2];
    if (typeof filename !== "string" || filename.length === 0) {
      continue;
    }

    const language = detectLanguage(filename);

    const chunks: Chunk[] = [];
    let currentChunk: Chunk | null = null;
    let currentNewLine = 0;
    let additions = 0;
    let deletions = 0;

    const lines = fileBlock.split("\n");
    for (const line of lines) {
      const newStart = parseChunkHeader(line);
      if (newStart !== null) {
        if (currentChunk && currentChunk.lines.length > 0) {
          chunks.push(currentChunk);
        }

        currentChunk = {
          newStart,
          lines: [],
        };
        currentNewLine = newStart;
        continue;
      }

      if (!currentChunk) {
        continue;
      }

      if (
        line.startsWith("\\ No newline at end of file") ||
        line.startsWith("+++") ||
        line.startsWith("---")
      ) {
        continue;
      }

      const prefix = line.charAt(0);
      const content = line.slice(1);

      if (prefix === "+") {
        currentChunk.lines.push({
          lineNumber: currentNewLine,
          content,
          type: "add",
        });
        additions += 1;
        currentNewLine += 1;
        continue;
      }

      if (prefix === "-") {
        currentChunk.lines.push({
          lineNumber: currentNewLine,
          content,
          type: "del",
        });
        deletions += 1;
        continue;
      }

      if (prefix === " ") {
        currentChunk.lines.push({
          lineNumber: currentNewLine,
          content,
          type: "context",
        });
        currentNewLine += 1;
      }
    }

    if (currentChunk && currentChunk.lines.length > 0) {
      chunks.push(currentChunk);
    }

    const hasAddedLines = chunks.some((chunk) => chunk.lines.some((entry) => entry.type === "add"));

    if (!hasAddedLines) {
      continue;
    }

    parsedFiles.push({
      filename,
      language,
      additions,
      deletions,
      chunks,
    });
  }

  return parsedFiles;
}

export function getAddedLines(file: ParsedFile): DiffLine[] {
  return file.chunks.flatMap((chunk) => chunk.lines.filter((line) => line.type === "add"));
}
