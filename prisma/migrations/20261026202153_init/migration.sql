-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "brand" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "presetId" TEXT,
    "settings" JSONB,
    "settingsSnapshot" JSONB,
    "totalImages" INTEGER NOT NULL DEFAULT 0,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "approvedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "aiCallsUsed" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostCents" INTEGER,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Batch_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "Preset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BatchImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "originalKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "originalWidth" INTEGER NOT NULL,
    "originalHeight" INTEGER NOT NULL,
    "originalSizeKb" INTEGER NOT NULL,
    "originalMime" TEXT NOT NULL,
    "aiIntermediateKey" TEXT,
    "aiSettingsHash" TEXT,
    "editedKey" TEXT,
    "outputFilename" TEXT,
    "outputWidth" INTEGER,
    "outputHeight" INTEGER,
    "outputSizeKb" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" DATETIME,
    "availableAt" DATETIME,
    "jobKind" TEXT NOT NULL DEFAULT 'FULL',
    "perImageInstruction" TEXT,
    "useOriginal" BOOLEAN NOT NULL DEFAULT false,
    "qcScore" INTEGER,
    "qcIssues" TEXT,
    "qcVerdict" TEXT,
    "styleCode" TEXT,
    "colorName" TEXT,
    "viewAngle" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BatchImage_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImageVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "imageId" TEXT NOT NULL,
    "aiIntermediateKey" TEXT,
    "aiSettingsHash" TEXT,
    "editedKey" TEXT NOT NULL,
    "outputWidth" INTEGER,
    "outputHeight" INTEGER,
    "outputSizeKb" INTEGER,
    "instruction" TEXT,
    "qcScore" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImageVersion_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "BatchImage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Preset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'CUSTOM',
    "settings" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "exampleKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityLog_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "defaultPresetId" TEXT,
    "maxConcurrentAiCalls" INTEGER NOT NULL DEFAULT 3,
    "maxRetries" INTEGER NOT NULL DEFAULT 2,
    "autoQcEnabled" BOOLEAN NOT NULL DEFAULT true,
    "qcThreshold" INTEGER NOT NULL DEFAULT 70,
    "brandList" TEXT NOT NULL DEFAULT '["Chelsea Crew","Amie Rafa","Other"]',
    "defaultNamingPattern" TEXT NOT NULL DEFAULT '{style}_{color}_{view}',
    "watermarkLibrary" TEXT NOT NULL DEFAULT '[]'
);

-- CreateIndex
CREATE INDEX "Batch_status_idx" ON "Batch"("status");

-- CreateIndex
CREATE INDEX "Batch_createdAt_idx" ON "Batch"("createdAt");

-- CreateIndex
CREATE INDEX "BatchImage_batchId_sortOrder_idx" ON "BatchImage"("batchId", "sortOrder");

-- CreateIndex
CREATE INDEX "BatchImage_status_lockedAt_idx" ON "BatchImage"("status", "lockedAt");

-- CreateIndex
CREATE INDEX "ImageVersion_imageId_idx" ON "ImageVersion"("imageId");

-- CreateIndex
CREATE UNIQUE INDEX "Preset_name_key" ON "Preset"("name");

-- CreateIndex
CREATE INDEX "ActivityLog_batchId_idx" ON "ActivityLog"("batchId");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");
