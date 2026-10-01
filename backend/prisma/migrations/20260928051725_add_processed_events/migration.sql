-- CreateTable
CREATE TABLE "processed_events" (
    "eventId" TEXT NOT NULL,
    "consumer" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("eventId","consumer")
);

-- CreateIndex
CREATE INDEX "processed_events_consumer_processedAt_idx" ON "processed_events"("consumer", "processedAt");
