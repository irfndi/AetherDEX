import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { Button } from "../../src/components/ui/Button"
import { Card, CardActions, CardBody, CardTitle } from "../../src/components/ui/Card"
import { Input } from "../../src/components/ui/Input"
import { Stat } from "../../src/components/ui/Stat"

describe("Button", () => {
  it("renders with children text", () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole("button", { name: "Click me" })).toBeDefined()
  })

  it("applies variant class", () => {
    render(<Button variant="secondary">Secondary</Button>)
    const btn = screen.getByRole("button")
    expect(btn.className).toContain("btn-secondary")
  })

  it("applies size class", () => {
    render(<Button size="lg">Large</Button>)
    const btn = screen.getByRole("button")
    expect(btn.className).toContain("btn-lg")
  })

  it("applies fullWidth class", () => {
    render(<Button fullWidth>Full</Button>)
    const btn = screen.getByRole("button")
    expect(btn.className).toContain("w-full")
  })

  it("shows loading spinner when loading", () => {
    render(<Button loading>Loading</Button>)
    const btn = screen.getByRole("button")
    expect(btn.className).toContain("loading")
    expect(btn).toBeDisabled()
  })

  it("renders a single loading indicator and marks the button busy", () => {
    const { container } = render(<Button loading>Loading</Button>)
    const btn = screen.getByRole("button")
    expect(container.querySelectorAll(".loading")).toHaveLength(1)
    expect(btn).toHaveAttribute("aria-busy", "true")
    expect(btn).toBeDisabled()
  })

  it("composes caller className without clobbering base classes", () => {
    render(<Button className="custom-extra">Composed</Button>)
    const btn = screen.getByRole("button")
    expect(btn.className).toContain("btn")
    expect(btn.className).toContain("btn-primary")
    expect(btn.className).toContain("custom-extra")
  })

  it("is disabled when disabled prop is true", () => {
    render(<Button disabled>Disabled</Button>)
    expect(screen.getByRole("button")).toBeDisabled()
  })

  it("calls onClick when clicked", async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Click</Button>)
    screen.getByRole("button").click()
    expect(onClick).toHaveBeenCalledOnce()
  })

  it("emits default variant and size classes", () => {
    render(<Button>Default</Button>)
    expect(screen.getByRole("button").className).toContain("btn btn-primary btn-md")
  })

  it("defaults to type=button and honors an explicit type", () => {
    const { rerender } = render(<Button>Click</Button>)
    expect(screen.getByRole("button")).toHaveAttribute("type", "button")
    rerender(<Button type="submit">Submit</Button>)
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit")
  })

  it("does not fire onClick while loading", () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Loading
      </Button>,
    )
    screen.getByRole("button").click()
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe("Card", () => {
  it("renders children", () => {
    render(
      <Card>
        <p>Content</p>
      </Card>,
    )
    expect(screen.getByText("Content")).toBeDefined()
  })

  it("applies bordered class by default", () => {
    const { container } = render(<Card>Bordered</Card>)
    expect((container.firstElementChild as HTMLElement)?.className).toContain("border")
  })

  it("removes border when bordered=false", () => {
    const { container } = render(<Card bordered={false}>No border</Card>)
    expect((container.firstElementChild as HTMLElement)?.className).not.toContain("border border-base-300")
  })

  it("applies compact variant", () => {
    const { container } = render(<Card variant="compact">Compact</Card>)
    expect((container.firstElementChild as HTMLElement)?.className).toContain("card-compact")
  })

  it("emits base classes and merges className with rest passthrough", () => {
    const { container } = render(
      <Card bordered={false} variant="compact" className="custom" data-testid="card">
        Merged
      </Card>,
    )
    const card = container.firstElementChild as HTMLElement
    expect(card.className).toBe("card bg-base-200 card-compact custom")
    expect(card).toHaveAttribute("data-testid", "card")
  })

  it("default variant emits no compact or bordered-variant classes", () => {
    const { container } = render(<Card>Default</Card>)
    const className = (container.firstElementChild as HTMLElement)?.className
    expect(className).not.toContain("card-compact")
  })

  it("bordered variant forces the border even when bordered=false", () => {
    const { container } = render(
      <Card variant="bordered" bordered={false}>
        Forced border
      </Card>,
    )
    expect((container.firstElementChild as HTMLElement)?.className).toContain("border border-base-300")
  })
})

describe("CardBody", () => {
  it("renders children with card-body class", () => {
    const { container } = render(
      <CardBody>
        <span>Body</span>
      </CardBody>,
    )
    expect((container.firstElementChild as HTMLElement)?.className).toContain("card-body")
    expect(screen.getByText("Body")).toBeDefined()
  })
})

describe("CardTitle", () => {
  it("renders as h2 with card-title class", () => {
    render(<CardTitle>Title</CardTitle>)
    const h2 = screen.getByRole("heading", { name: "Title" })
    expect(h2.tagName).toBe("H2")
    expect(h2.className).toContain("card-title")
  })
})

describe("CardActions", () => {
  it("renders children with justify-end", () => {
    const { container } = render(
      <CardActions>
        <button type="button">OK</button>
      </CardActions>,
    )
    expect((container.firstElementChild as HTMLElement)?.className).toContain("justify-end")
  })
})

describe("Input", () => {
  it("renders input element", () => {
    render(<Input placeholder="Enter..." />)
    expect(screen.getByPlaceholderText("Enter...")).toBeDefined()
  })

  it("renders label when provided", () => {
    render(<Input label="Email" placeholder="email" />)
    expect(screen.getByLabelText("Email")).toBeDefined()
  })

  it("shows error message when provided", () => {
    render(<Input error="Required" placeholder="field" />)
    expect(screen.getByText("Required")).toBeDefined()
    const input = screen.getByPlaceholderText("field")
    expect(input.className).toContain("input-error")
  })

  it("does not render label when not provided", () => {
    const { container } = render(<Input placeholder="no-label" />)
    expect(container.querySelector("label")).toBeNull()
  })

  it("keeps the generated id stable across re-renders", () => {
    const { rerender } = render(<Input placeholder="field" />)
    const firstId = screen.getByPlaceholderText("field").id
    rerender(<Input placeholder="other" />)
    expect(screen.getByPlaceholderText("other").id).toBe(firstId)
  })

  it("generates distinct ids for id-less inputs", () => {
    render(
      <div>
        <Input placeholder="a" />
        <Input placeholder="b" />
      </div>,
    )
    expect(screen.getByPlaceholderText("a").id).not.toBe(screen.getByPlaceholderText("b").id)
  })

  it("passes an explicit id through", () => {
    render(<Input id="my-input" placeholder="field" />)
    expect(screen.getByPlaceholderText("field").id).toBe("my-input")
  })

  it("exposes error state to assistive technology", () => {
    render(<Input error="Required" placeholder="field" />)
    const input = screen.getByPlaceholderText("field")
    expect(input).toHaveAttribute("aria-invalid", "true")
    const errorId = input.getAttribute("aria-describedby")
    expect(errorId).toBeDefined()
    expect(document.getElementById(errorId ?? "")?.textContent).toBe("Required")
  })

  it("merges caller className with base classes", () => {
    render(<Input className="extra" placeholder="field" />)
    const input = screen.getByPlaceholderText("field")
    expect(input.className).toContain("input")
    expect(input.className).toContain("extra")
  })

  it("forwards native input props", () => {
    const onChange = vi.fn()
    render(<Input type="number" placeholder="field" onChange={onChange} />)
    const input = screen.getByPlaceholderText("field")
    expect(input).toHaveAttribute("type", "number")
    fireEvent.change(input, { target: { value: "1.5" } })
    expect(onChange).toHaveBeenCalled()
  })
})

describe("Stat", () => {
  it("renders label and value", () => {
    render(<Stat label="TVL" value="$1.2M" />)
    expect(screen.getByText("TVL")).toBeDefined()
    expect(screen.getByText("$1.2M")).toBeDefined()
  })

  it("renders description when provided", () => {
    render(<Stat label="Vol" value="$500K" desc="24h" />)
    expect(screen.getByText("24h")).toBeDefined()
  })

  it("applies trend-up color", () => {
    const { container } = render(<Stat label="P" value="100" trend="up" />)
    const valueEl = container.querySelector(".stat-value")
    expect(valueEl?.className).toContain("text-success")
  })

  it("applies trend-down color", () => {
    const { container } = render(<Stat label="P" value="100" trend="down" />)
    const valueEl = container.querySelector(".stat-value")
    expect(valueEl?.className).toContain("text-error")
  })

  it("does not render desc when not provided", () => {
    const { container } = render(<Stat label="X" value="1" />)
    expect(container.querySelector(".stat-desc")).toBeNull()
  })

  it("renders no trend class or announcement without a trend", () => {
    const { container } = render(<Stat label="X" value="1" />)
    const valueEl = container.querySelector(".stat-value")
    expect(valueEl?.className).not.toContain("text-success")
    expect(valueEl?.className).not.toContain("text-error")
    expect(container.textContent).not.toContain("Trending")
  })

  it("groups label and value with an accessible name", () => {
    render(<Stat label="TVL" value="$1.2M" />)
    expect(screen.getByRole("group", { name: "TVL" })).toBeDefined()
  })

  it("announces trend with non-color text", () => {
    const { container } = render(<Stat label="TVL" value="$1.2M" trend="down" />)
    expect(container.querySelector(".sr-only")?.textContent).toBe("Trending down")
  })
})
