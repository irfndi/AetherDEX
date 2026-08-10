import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { RangeSelector } from "../../src/components/RangeSelector"

describe("RangeSelector", () => {
  it("centers the tick window around a negative current tick", () => {
    render(<RangeSelector currentTick={-100} tickSpacing={10} lowerTick={0} upperTick={0} onChange={vi.fn()} />)
    // minimum = floor(-100/10)*10 - 240 = -340; maximum = -340 + 480 = 140
    expect(screen.getByLabelText("Lower tick range handle").getAttribute("min")).toBe("-340")
    expect(screen.getByLabelText("Lower tick range handle").getAttribute("max")).toBe("130")
    expect(screen.getByLabelText("Upper tick range handle").getAttribute("min")).toBe("-330")
    expect(screen.getByLabelText("Upper tick range handle").getAttribute("max")).toBe("140")
  })

  it("re-orders inverted props so lower < upper and both stay inside the window", () => {
    render(<RangeSelector currentTick={0} tickSpacing={60} lowerTick={100000} upperTick={-100000} onChange={vi.fn()} />)
    // window = [-1440, 1440]; lower clamps to maximum - spacing = 1380, upper to maximum = 1440
    expect(screen.getByText("Lower 1380")).toBeDefined()
    expect(screen.getByText("Upper 1440")).toBeDefined()
  })

  it("caps the lower handle at upper - spacing and floors the upper at lower + spacing", () => {
    const onChange = vi.fn()
    render(<RangeSelector currentTick={0} tickSpacing={60} lowerTick={0} upperTick={60} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText("Lower tick range handle"), { target: { value: "9999" } })
    expect(onChange).toHaveBeenLastCalledWith({ lowerTick: 0, upperTick: 60 })

    fireEvent.change(screen.getByLabelText("Upper tick range handle"), { target: { value: "-9999" } })
    expect(onChange).toHaveBeenLastCalledWith({ lowerTick: 0, upperTick: 60 })
  })

  it("normalizes raw liquidity values relative to the tallest bar", () => {
    const { container } = render(
      <RangeSelector
        currentTick={0}
        tickSpacing={60}
        lowerTick={0}
        upperTick={60}
        liquidityDistribution={[1e18, 2e18, 1e18]}
        onChange={vi.fn()}
      />,
    )
    const bars = container.querySelectorAll('[aria-label="Pool liquidity depth"] > span')
    expect(bars).toHaveLength(3)
    expect(bars[0]?.getAttribute("style")).toContain("height: 50%")
    expect(bars[1]?.getAttribute("style")).toContain("height: 100%")
  })

  it("aligns the selection overlay with the input track insets at the window edges", () => {
    const { container } = render(
      <RangeSelector currentTick={0} tickSpacing={60} lowerTick={-1440} upperTick={1440} onChange={vi.fn()} />,
    )
    const wrapper = container.querySelector('[aria-hidden="true"]')
    expect(wrapper?.className).toContain("inset-x-2")
    const bar = wrapper?.querySelector("div")
    expect(bar?.getAttribute("style")).toContain("margin-left: 0%")
    expect(bar?.getAttribute("style")).toContain("margin-right: 0%")
  })
})
