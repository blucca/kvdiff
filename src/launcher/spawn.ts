import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { extname, join } from "node:path";

export interface RunWrappedOptions {
  command: string[];
  proxyUrl: string;
  sessionId: string;
  env?: NodeJS.ProcessEnv;
}

export function buildProxyEnv(
  proxyUrl: string,
  sessionId: string,
  baseEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const cleanUrl = proxyUrl.replace(/\/+$/, "");
  return {
    ...baseEnv,
    ANTHROPIC_BASE_URL: cleanUrl,
    OPENAI_BASE_URL: `${cleanUrl}/v1`,
    OPENAI_API_BASE: `${cleanUrl}/v1`,
    GOOGLE_GEMINI_BASE_URL: cleanUrl,
    GEMINI_API_BASE_URL: cleanUrl,
    KVDIFF_SESSION_ID: sessionId,
  };
}

function isFile(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

function resolveWindowsBinary(bin: string, env: NodeJS.ProcessEnv): string {
  const pathExts = (env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean);

  if (bin.includes("\\") || bin.includes("/")) {
    if (isFile(bin)) return bin;
    for (const ext of pathExts) {
      if (isFile(`${bin}${ext}`)) return `${bin}${ext}`;
    }
    return bin;
  }

  const pathDirs = (env.PATH || env.Path || "").split(";").filter(Boolean);
  const hasExt = extname(bin) !== "";
  for (const dir of pathDirs) {
    if (hasExt) {
      const candidate = join(dir, bin);
      if (isFile(candidate)) return candidate;
    } else {
      for (const ext of pathExts) {
        const candidate = join(dir, `${bin}${ext}`);
        if (isFile(candidate)) return candidate;
      }
    }
  }
  return bin;
}

function quoteCmdArg(arg: string): string {
  if (!/[\s"&|<>^%!]/.test(arg) && arg.length > 0) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

export function runWrappedCommand(opts: RunWrappedOptions): Promise<number> {
  if (opts.command.length === 0) {
    return Promise.resolve(1);
  }

  const [rawBin, ...args] = opts.command;
  const env = buildProxyEnv(opts.proxyUrl, opts.sessionId, opts.env);

  let spawnBin = rawBin;
  let spawnArgs = args;
  let windowsVerbatimArguments = false;

  if (process.platform === "win32") {
    const resolved = resolveWindowsBinary(rawBin, env);
    if (/\.(?:cmd|bat)$/i.test(resolved)) {
      // Invoke cmd.exe explicitly with proper quoting so .cmd/.bat shims work safely on Node 24
      spawnBin = env.ComSpec || "cmd.exe";
      const cmdLine = [quoteCmdArg(resolved), ...args.map(quoteCmdArg)].join(" ");
      spawnArgs = ["/d", "/s", "/c", `"${cmdLine}"`];
      windowsVerbatimArguments = true;
    } else {
      spawnBin = resolved;
    }
  }

  return new Promise((resolveExit, reject) => {
    const child = spawn(spawnBin, spawnArgs, {
      stdio: "inherit",
      env,
      shell: false,
      windowsVerbatimArguments,
    });

    const forwardSigInt = () => child.kill("SIGINT");
    const forwardSigTerm = () => child.kill("SIGTERM");
    process.on("SIGINT", forwardSigInt);
    process.on("SIGTERM", forwardSigTerm);

    const cleanup = () => {
      process.off("SIGINT", forwardSigInt);
      process.off("SIGTERM", forwardSigTerm);
    };

    child.on("error", (err) => {
      cleanup();
      reject(err);
    });

    child.on("exit", (code, signal) => {
      cleanup();
      if (typeof code === "number") {
        resolveExit(code);
      } else if (signal) {
        resolveExit(130);
      } else {
        resolveExit(0);
      }
    });
  });
}
