import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("should show the latest release note when rendered", () => {
    render(<App />);

    expect(screen.getByText("0.1.0")).toBeInTheDocument();
    expect(screen.getByText(/First deploy/)).toBeInTheDocument();
  });

  it("should count a deploy when the button is clicked", () => {
    render(<App />);
    const button = screen.getByRole("button");

    fireEvent.click(button);

    expect(button).toHaveTextContent("deployed 1 times");
  });
});
