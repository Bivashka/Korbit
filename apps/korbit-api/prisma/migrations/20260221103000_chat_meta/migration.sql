-- AlterTable
ALTER TABLE "Chat"
ADD COLUMN     "title" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "username" TEXT,
ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ownerId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Chat_username_key" ON "Chat"("username");

-- CreateIndex
CREATE INDEX "Chat_ownerId_idx" ON "Chat"("ownerId");
