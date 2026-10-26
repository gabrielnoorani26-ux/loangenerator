import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const FIXTURES = [
  "CC2045_black_side.jpg",
  "CC2045_black_front.jpg",
  "AR1001_tan_pair.png",
  "CC3000_white_top_transparent.png",
].map((f) => path.resolve("fixtures", f));

test("upload → settings → process (mock AI) → approve → export", async ({ page }, testInfo) => {
  // Dashboard empty state → create batch
  await page.goto("/");
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await page.getByTestId("new-batch").first().click();
  await page.waitForURL(/\/batches\/.+\/upload/);

  // Upload
  await page.getByTestId("file-input").setInputFiles(FIXTURES);
  await expect(page.locator("[data-testid=image-grid] img")).toHaveCount(4);
  await page.getByRole("button", { name: /Smart fill/ }).click();
  await expect(page.getByText("CC2045 · black · side")).toBeVisible();
  await page.getByTestId("continue-settings").click();

  // Settings: default preset (AI white background) is loaded; preview renders
  await page.waitForURL(/\/settings$/);
  await expect(page.getByTestId("before-after")).toBeVisible();
  await expect(page.getByTestId("cost-bar")).toContainText("4 AI calls");
  await expect(page.getByTestId("example-filename")).toHaveText("CC2045_black_side.jpg");
  await page.getByTestId("start-processing").click();
  await page.getByTestId("confirm-start").click();

  // Processing → auto-navigates to Review on completion
  await page.waitForURL(/\/processing$/);
  await expect(page.getByTestId("processing-grid")).toBeVisible();
  await page.waitForURL(/\/review$/, { timeout: 120_000 });

  // Review: approve all via bulk action
  await expect(page.getByTestId("review-card")).toHaveCount(4);
  await page.getByLabel("Select all visible").click();
  await page.getByTestId("bulk-bar").getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("region", { name: /Notifications/ }).getByText("Approved 4")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Approved/ })).toContainText("4");

  // Detail modal + keyboard
  await page.getByTestId("review-card").first().getByRole("button").first().click();
  await expect(page.getByText("Automated QC")).toBeVisible();
  await page.keyboard.press("Escape");

  // Export approved, grouped by style, with manifest
  await page.getByTestId("open-export").click();
  await page.getByLabel("Grouping").click();
  await page.getByRole("option", { name: "Style code" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("download-export").click();
  const download = await downloadPromise;
  const zipPath = testInfo.outputPath("export.zip");
  await download.saveAs(zipPath);
  await expect(page.getByRole("button", { name: "Mark batch complete" })).toBeVisible();
  await page.getByRole("button", { name: "Mark batch complete" }).click();

  const listing = execFileSync("unzip", ["-Z1", zipPath]).toString().trim().split("\n").sort();
  expect(listing).toEqual([
    "AR1001/AR1001_tan_pair.jpg",
    "CC2045/CC2045_black_front.jpg",
    "CC2045/CC2045_black_side.jpg",
    "CC3000/CC3000_white_transparent_top.jpg",
    "manifest.csv",
  ]);
  const manifest = execFileSync("unzip", ["-p", zipPath, "manifest.csv"]).toString();
  expect(manifest.split("\r\n")[0]).toBe(
    "output_filename,original_filename,style_code,color,view_angle,width,height,size_kb,qc_score,status",
  );
  expect(manifest).toContain("CC2045_black_side.jpg,CC2045_black_side.jpg,CC2045,black,SIDE,2000,2000");
  expect(fs.statSync(zipPath).size).toBeGreaterThan(10_000);

  // Dashboard shows the completed batch
  await page.goto("/");
  await expect(page.getByTestId("batch-card")).toContainText("Complete");
});
