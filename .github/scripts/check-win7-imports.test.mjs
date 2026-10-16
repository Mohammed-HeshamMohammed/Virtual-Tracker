import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// Minimal PE fixtures exercise the actual CLI, including its exit status.
function program({ is64, delayed, name }) {
  const buf = Buffer.alloc(0x600);
  const rva = (offset) => offset - 0x200 + 0x1000;
  buf.writeUInt16LE(0x5a4d, 0);
  buf.writeUInt32LE(0x80, 0x3c);
  buf.writeUInt32LE(0x4550, 0x80);
  buf.writeUInt16LE(is64 ? 0x8664 : 0x14c, 0x84);
  buf.writeUInt16LE(1, 0x86);
  const optional = 0x98;
  const optionalSize = is64 ? 240 : 224;
  buf.writeUInt16LE(optionalSize, 0x94);
  buf.writeUInt16LE(is64 ? 0x20b : 0x10b, optional);
  const directories = optional + (is64 ? 112 : 96);
  const section = optional + optionalSize;
  buf.writeUInt32LE(0x400, section + 8);
  buf.writeUInt32LE(0x1000, section + 12);
  buf.writeUInt32LE(0x400, section + 16);
  buf.writeUInt32LE(0x200, section + 20);
  buf.writeUInt32LE(rva(0x200), directories + (delayed ? 13 : 1) * 8);
  if (delayed) {
    buf.writeUInt32LE(1, 0x200); // delay descriptor contains RVAs
    buf.writeUInt32LE(rva(0x280), 0x204);
    buf.writeUInt32LE(rva(0x300), 0x210);
  } else {
    buf.writeUInt32LE(rva(0x300), 0x200);
    buf.writeUInt32LE(rva(0x280), 0x20c);
    buf.writeUInt32LE(rva(0x300), 0x210);
  }
  buf.write("ADVAPI32.dll\0", 0x280, "latin1");
  if (is64) buf.writeBigUInt64LE(BigInt(rva(0x380)), 0x300);
  else buf.writeUInt32LE(rva(0x380), 0x300);
  buf.write(`${name}\0`, 0x382, "latin1");
  return buf;
}

for (const is64 of [false, true]) {
  for (const delayed of [false, true]) {
    for (const name of ["EventSetInformation", "EventRegister"]) {
      test(`${is64 ? 64 : 32}-bit ${delayed ? "delayed" : "normal"} ${name}`, () => {
        const directory = mkdtempSync(join(tmpdir(), "win7-imports-"));
        try {
          const file = join(directory, "agent.exe");
          writeFileSync(file, program({ is64, delayed, name }));
          const result = spawnSync(process.execPath, [fileURLToPath(new URL("./check-win7-imports.mjs", import.meta.url)), file], { encoding: "utf8" });
          const rejected = name === "EventSetInformation";
          assert.equal(result.status, rejected ? 1 : 0, result.stdout + result.stderr);
          if (rejected) {
            assert.match(result.stderr, /advapi32\.dll!EventSetInformation/);
            assert.doesNotMatch(result.stdout, /No import that Windows 7 lacks/);
          }
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      });
    }
  }
}
