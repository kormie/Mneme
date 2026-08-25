import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { KERNEL_PATH, loadKernel, type KernelIR } from "../src/kernel.js";

function fixture(name: string, mutate: (kernel: KernelIR) => void): string {
  const directory = mkdtempSync(join(tmpdir(), `kernel-${name}-`));
  const path = join(directory, "kernel.json");
  cpSync(KERNEL_PATH, path);
  const kernel = loadKernel(path);
  mutate(kernel);
  writeFileSync(path, `${JSON.stringify(kernel, null, 2)}\n`);
  return path;
}

describe("kernel IR runtime validation", () => {
  it("returns the canonical pack deeply equal to the previous JSON.parse shape", () => {
    const parsed: unknown = JSON.parse(readFileSync(KERNEL_PATH, "utf8"));
    expect(parsed).toEqual(loadKernel());
  });

  it("rejects an edge naming a missing port and names its path", () => {
    const path = fixture("missing-port", (kernel) => {
      Reflect.set(kernel.graphs[0]!.edges[0]!, "fromPort", "not-a-port");
    });
    expect(() => loadKernel(path)).toThrow(/graphs\[0\]\.edges\[0\]\.fromPort/);
  });

  it("rejects a missing declared port field instead of defaulting it", () => {
    const path = fixture("missing-port-field", (kernel) => {
      Reflect.deleteProperty(kernel.graphs[0]!.nodes[0]!.ports[0]!, "dir");
    });
    expect(() => loadKernel(path)).toThrow(/graphs\[0\]\.nodes\[0\]\.ports\[0\]\.dir/);
  });

  it("rejects fields outside the declared mirror", () => {
    const path = fixture("unknown-field", (kernel) => {
      Reflect.set(kernel.graphs[0]!.nodes[0]!, "extra", true);
    });
    expect(() => loadKernel(path)).toThrow(/graphs\[0\]\.nodes\[0\]\.extra/);
  });

  it("rejects a non-string guard and names its path", () => {
    const path = fixture("guard", (kernel) => {
      Reflect.set(kernel.graphs[0]!.edges[0]!, "guard", 42);
    });
    expect(() => loadKernel(path)).toThrow(/graphs\[0\]\.edges\[0\]\.guard/);
  });

  it("rejects an edge naming an unknown node and names its path", () => {
    const path = fixture("unknown-node", (kernel) => {
      Reflect.set(kernel.graphs[0]!.edges[0]!, "to", "not-a-node");
    });
    expect(() => loadKernel(path)).toThrow(/graphs\[0\]\.edges\[0\]\.to/);
  });

  it("rejects a non-number fuel value and names its path", () => {
    const path = fixture("fuel", (kernel) => {
      Reflect.set(kernel.graphs[1]!.fuel, "w8", "four");
    });
    expect(() => loadKernel(path)).toThrow(/graphs\[1\]\.fuel\.w8/);
  });

  it("leaves guard grammar to the scheduler", () => {
    const path = fixture("guard-grammar", (kernel) => {
      Reflect.set(kernel.graphs[0]!.edges[0]!, "guard", "not scheduler grammar");
    });
    expect(loadKernel(path).graphs[0]!.edges[0]!.guard).toBe("not scheduler grammar");
  });
});
