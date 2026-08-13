import { describe, expect, it } from "bun:test";
import { createSequenceClock } from "./sequence-clock";

function recorder() {
  const log: string[] = [];
  return {
    log,
    ev: (at: number, name: string) => ({ at, run: () => log.push(name) }),
    reset: () => log.push("reset"),
    stop: () => log.push("stop"),
  };
}

describe("createSequenceClock", () => {
  it("fires events in order as time crosses them", () => {
    const r = recorder();
    const c = createSequenceClock({ events: [r.ev(100, "a"), r.ev(300, "b")], totalDuration: 1000 });
    c.advanceTo(50);
    expect(r.log).toEqual([]);
    c.advanceTo(100);
    expect(r.log).toEqual(["a"]);
    c.advanceTo(500);
    expect(r.log).toEqual(["a", "b"]);
  });

  it("is deterministic: same seek sequence, same events", () => {
    const runs = [0, 1].map(() => {
      const r = recorder();
      const c = createSequenceClock({ events: [r.ev(10, "a"), r.ev(20, "b"), r.ev(30, "c")], totalDuration: 40, loop: true, onReset: r.reset });
      for (let t = 0; t <= 100; t += 7) c.advanceTo(t);
      return r.log.join(",");
    });
    expect(runs[0]).toBe(runs[1]);
  });

  it("wraps loops firing remaining events and resetting", () => {
    const r = recorder();
    const c = createSequenceClock({ events: [r.ev(10, "a"), r.ev(90, "b")], totalDuration: 100, loop: true, onReset: r.reset });
    c.advanceTo(250); // two full wraps + 50ms
    expect(r.log).toEqual(["a", "b", "reset", "a", "b", "reset", "a"]);
    expect(c.elapsed()).toBe(50);
  });

  it("stops at the end without loop", () => {
    const r = recorder();
    const c = createSequenceClock({ events: [r.ev(10, "a")], totalDuration: 100, loop: false, onStop: r.stop });
    c.advanceTo(500);
    expect(r.log).toEqual(["a", "stop"]);
    expect(c.stopped()).toBe(true);
    c.advanceTo(600); // no-op once stopped
    expect(r.log).toEqual(["a", "stop"]);
  });

  it("seeking backward resets and replays", () => {
    const r = recorder();
    const c = createSequenceClock({ events: [r.ev(10, "a"), r.ev(50, "b")], totalDuration: 100, onReset: r.reset });
    c.advanceTo(60);
    c.advanceTo(20);
    expect(r.log).toEqual(["a", "b", "reset", "a"]);
    expect(c.elapsed()).toBe(20);
  });

  it("advanceBy accumulates like live playback", () => {
    const r = recorder();
    const c = createSequenceClock({ events: [r.ev(30, "a")], totalDuration: 100 });
    c.advanceBy(16);
    c.advanceBy(16);
    expect(r.log).toEqual(["a"]);
    expect(c.elapsed()).toBe(32);
  });
});
