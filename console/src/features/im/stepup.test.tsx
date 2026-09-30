/* M01-S10-W1 — the step-up panel: fixture mode never has a step-up open, so it always asks; live waits for the route. */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiModeProvider } from "@/lib/data/api";
import { StepUp } from "./stepup";

const noop = () => {};
describe("StepUp", () => {
  it("asks for a fresh Zoho sign-in before a reveal (fixture)", () => {
    const html = renderToStaticMarkup(<ApiModeProvider fixtures><StepUp action="reveal" onOpen={noop} onCancel={noop} /></ApiModeProvider>);
    expect(html).toContain("Confirm it is you.");
    expect(html).toContain("fresh sign-in code before it is shown");
    expect(html).toContain("Confirm with Zoho");
  });
  it("names the release", () => {
    const html = renderToStaticMarkup(<ApiModeProvider fixtures><StepUp action="release" onOpen={noop} onCancel={noop} /></ApiModeProvider>);
    expect(html).toContain("before the reservation is released");
  });
  it("draws nothing when not asking; live shows one quiet line while the route answers", () => {
    expect(renderToStaticMarkup(<ApiModeProvider fixtures><StepUp action={null} onOpen={noop} onCancel={noop} /></ApiModeProvider>)).toBe("");
    expect(renderToStaticMarkup(<ApiModeProvider fixtures={false}><StepUp action="reveal" onOpen={noop} onCancel={noop} /></ApiModeProvider>)).toContain("Checking your sign-in");
  });
});
