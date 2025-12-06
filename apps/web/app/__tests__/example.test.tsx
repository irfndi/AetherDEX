import { describe, expect, it } from "vitest";

describe("Example", () => {
  it("basic math works", () => {
    expect(2 + 2).toBe(4);
  });

  it("string concatenation works", () => {
    expect("Hello" + " " + "World").toBe("Hello World");
  });

  it("array operations work", () => {
    const arr = [1, 2, 3];
    expect(arr.length).toBe(3);
    expect(arr.includes(2)).toBe(true);
  });
});
