// Fails when the agent's legacy build (Windows 7, 8 and 8.1) imports something Windows 7 does
// not have. Windows refuses to start a program with even one missing import, before any of its
// code runs, so this is the cheapest place to catch it: a dependency update that quietly starts
// using a newer Windows API otherwise only shows up on a member's machine.
//
// Usage: node check-win7-imports.mjs <path-to-exe>
//
// The list is of what is known to be missing on Windows 7 SP1; it is not a full Windows 7 export
// table. See Tauri-App-Extension/PLAN-windows-7-legacy-build.md, "Import audit".
import fs from "node:fs";

/** DLLs Windows 7 does not have at all (or, for the C runtime, has only after an optional update). */
const MISSING_DLLS = [
  /^api-ms-win-core-synch-l1-2-0\.dll$/i, // WaitOnAddress: Rust std without the win7 target
  /^api-ms-win-core-winrt-/i, // WinRT
  /^api-ms-win-crt-/i, // the C runtime as a separate DLL: link it statically (+crt-static)
  /^vcruntime140(_1)?\.dll$/i,
  /^combase\.dll$/i, // Windows 8
  /^bcryptprimitives\.dll$/i, // ProcessPrng
  /^shcore\.dll$/i, // Windows 8.1
];
/** Functions that are missing even though their DLL exists on Windows 7. */
const MISSING_FUNCTIONS = new Set([
  "EventSetInformation", // optional WebView2 ETW API: resolve it at runtime on Windows 7
  "GetSystemTimePreciseAsFileTime",
  "WaitOnAddress",
  "WakeByAddressAll",
  "WakeByAddressSingle",
  "ProcessPrng",
  "RoGetActivationFactory",
  "CoIncrementMTAUsage",
  "GetDpiForWindow",
  "GetDpiForMonitor",
  "SetProcessDpiAwarenessContext",
  "SetThreadDescription",
  "CreateFile2",
  "CopyFile2",
]);
function importsOf(file) {
  const buf = fs.readFileSync(file);
  const pe = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(pe) !== 0x4550) throw new Error(`${file} is not a Windows program`);
  const sectionCount = buf.readUInt16LE(pe + 6);
  const optionalSize = buf.readUInt16LE(pe + 20);
  const optional = pe + 24;
  const is64 = buf.readUInt16LE(optional) === 0x20b;
  const directories = optional + (is64 ? 112 : 96);
  const sections = [];
  for (let i = 0; i < sectionCount; i += 1) {
    const at = optional + optionalSize + i * 40;
    sections.push({ va: buf.readUInt32LE(at + 12), size: Math.max(buf.readUInt32LE(at + 8), buf.readUInt32LE(at + 16)), raw: buf.readUInt32LE(at + 20) });
  }
  const offset = (rva) => {
    const section = sections.find((s) => rva >= s.va && rva < s.va + s.size);
    return section ? rva - section.va + section.raw : null;
  };
  const text = (rva) => {
    const start = offset(rva);
    let end = start;
    while (buf[end] !== 0) end += 1;
    return buf.toString("latin1", start, end);
  };
  const names = (rva) => {
    const out = [];
    let at = offset(rva);
    if (at === null) return out;
    for (;;) {
      const value = is64 ? buf.readBigUInt64LE(at) : BigInt(buf.readUInt32LE(at));
      if (value === 0n) break;
      const byOrdinal = value & (is64 ? 1n << 63n : 1n << 31n);
      out.push(byOrdinal ? `#${Number(value & 0xffffn)}` : text(Number(value & 0x7fffffffn) + 2));
      at += is64 ? 8 : 4;
    }
    return out;
  };
  const result = {};
  const add = (dll, functions) => (result[dll.toLowerCase()] = [...(result[dll.toLowerCase()] ?? []), ...functions]);
  // Normal imports (data directory 1), then delay-loaded ones (13), which also fail on first use.
  let entry = offset(buf.readUInt32LE(directories + 8));
  for (; entry !== null && buf.readUInt32LE(entry + 12); entry += 20) {
    add(text(buf.readUInt32LE(entry + 12)), names(buf.readUInt32LE(entry) || buf.readUInt32LE(entry + 16)));
  }
  const delayed = buf.readUInt32LE(directories + 13 * 8);
  let delay = delayed ? offset(delayed) : null;
  for (; delay !== null && buf.readUInt32LE(delay + 4); delay += 32) {
    add(text(buf.readUInt32LE(delay + 4)), names(buf.readUInt32LE(delay + 16)));
  }
  return { is64, dlls: result };
}

const file = process.argv[2];
if (!file) {
  console.error("Usage: node check-win7-imports.mjs <exe>");
  process.exit(2);
}
const { is64, dlls } = importsOf(file);
const failures = [];
for (const [dll, functions] of Object.entries(dlls)) {
  if (MISSING_DLLS.some((pattern) => pattern.test(dll))) failures.push(`${dll} (${functions.join(", ")})`);
  for (const name of functions) {
    if (MISSING_FUNCTIONS.has(name)) failures.push(`${dll}!${name}`);
  }
}
const count = Object.values(dlls).reduce((sum, functions) => sum + functions.length, 0);
console.log(`${file}: ${is64 ? "64" : "32"}-bit, ${Object.keys(dlls).length} DLLs, ${count} imported functions.`);
if (failures.length) {
  for (const failure of failures) console.error(`::error::Imports something Windows 7 does not have: ${failure}`);
  process.exit(1);
}
console.log("No import that Windows 7 lacks.");
