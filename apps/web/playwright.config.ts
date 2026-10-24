import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.spec.ts",
  globalSetup: "./e2e/preparar.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://localhost:8099", locale: "pt-BR", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", grepInvert: /@celular/, use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 768 } } },
    // Governança no celular: depende do estado deixado pelo roteiro da recepção (um quarto sujo).
    { name: "celular", grep: /@celular/, dependencies: ["desktop"], use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  ],
});
