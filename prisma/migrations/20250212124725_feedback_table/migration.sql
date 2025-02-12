-- CreateTable
CREATE TABLE "Feedback" (
    "id" SERIAL NOT NULL,
    "rating" INTEGER NOT NULL,
    "feedback" TEXT,
    "afterUse" BOOLEAN NOT NULL DEFAULT false,
    "ip" TEXT,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);
