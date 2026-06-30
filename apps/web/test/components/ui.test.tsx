import { render, screen } from "@testing-library/react"
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
})
