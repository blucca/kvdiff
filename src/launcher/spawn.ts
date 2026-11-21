import { spawn } from "node:child_process";

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

export function runWrappedCommand(opts: RunWrappedOptions): Promise<number> {
  if (opts.command.length === 0) {
    return Promise.resolve(1);
  }

  const [bin, ...args] = opts.command;
  const env = buildProxyEnv(opts.proxyUrl, opts.sessionId, opts.env);
  const needsWindowsShell =
    process.platform === "win32" &&
    !/\.(?:exe|com)$/i.test(bin) &&
    !bin.includes("\\") &&
    !bin.includes("/");

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: "inherit",
      env,
      shell: needsWindowsShell,
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
        resolve(code);
      } else if (signal) {
        resolve(130);
      } else {
        resolve(0);
      }
    });
  });
}
