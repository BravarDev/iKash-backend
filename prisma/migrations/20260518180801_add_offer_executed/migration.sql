-- CreateEnum
CREATE TYPE "kyc_status" AS ENUM ('pending', 'approved', 'rejected', 'not_started', 'in_progress', 'in_review', 'expired', 'kyc_expired', 'abandoned', 'resubmitted');

-- CreateEnum
CREATE TYPE "offer_type" AS ENUM ('buy', 'sell');

-- CreateEnum
CREATE TYPE "offer_status" AS ENUM ('active', 'paused', 'closed');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('created', 'locked', 'released', 'cancelled', 'expired', 'disputed');

-- CreateEnum
CREATE TYPE "escrow_status" AS ENUM ('pending', 'initialized', 'funded', 'fiat_sent', 'released', 'disputed', 'resolved');

-- CreateEnum
CREATE TYPE "payment_provider_type" AS ENUM ('MOBILE', 'PLATFORM', 'BANK');

-- CreateTable
CREATE TABLE "app_user" (
    "user_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "public_key" TEXT NOT NULL,
    "alias" TEXT,
    "kyc_status" "kyc_status" NOT NULL DEFAULT 'pending',
    "kyc_updated_at" TIMESTAMPTZ(6),
    "total_volume" DECIMAL(20,7) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_nonce" TEXT,
    "email" TEXT,
    "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "pending_account_info" BOOLEAN NOT NULL DEFAULT true,
    "preferred_currency" TEXT,
    "bio" TEXT,
    "security_updates" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "paymentmethod" (
    "payment_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_details" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "paymentmethod_pkey" PRIMARY KEY ("payment_id")
);

-- CreateTable
CREATE TABLE "offer" (
    "offer_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "creator_id" UUID NOT NULL,
    "type" "offer_type" NOT NULL,
    "asset_code" TEXT NOT NULL,
    "price" DECIMAL(20,7) NOT NULL,
    "min_amount" DECIMAL(20,7) NOT NULL,
    "max_amount" DECIMAL(20,7) NOT NULL,
    "status" "offer_status" NOT NULL DEFAULT 'active',
    "executed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "offer_pkey" PRIMARY KEY ("offer_id")
);

-- CreateTable
CREATE TABLE "order" (
    "order_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "offer_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "asset_amount" DECIMAL(20,7) NOT NULL,
    "fiat_amount" DECIMAL(20,7) NOT NULL,
    "order_status" "order_status" NOT NULL DEFAULT 'created',
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "order_pkey" PRIMARY KEY ("order_id")
);

-- CreateTable
CREATE TABLE "escrowonchain" (
    "escrow_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "tx_hash_lock" TEXT,
    "tx_hash_release" TEXT,
    "amount" DECIMAL(20,7),
    "buyer_address" TEXT,
    "contract_id" TEXT,
    "escrow_status" "escrow_status" NOT NULL DEFAULT 'pending',
    "seller_address" TEXT,

    CONSTRAINT "escrowonchain_pkey" PRIMARY KEY ("escrow_id")
);

-- CreateTable
CREATE TABLE "chatmessage" (
    "message_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chatmessage_pkey" PRIMARY KEY ("message_id")
);

-- CreateTable
CREATE TABLE "payment_method" (
    "payment_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "type" "payment_provider_type" NOT NULL,
    "account_identifier" TEXT NOT NULL,
    "beneficiary_name" TEXT,
    "identification_number" TEXT,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_method_pkey" PRIMARY KEY ("payment_id")
);

-- CreateTable
CREATE TABLE "payment_provider" (
    "provider_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "type" "payment_provider_type" NOT NULL,
    "country_code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_provider_pkey" PRIMARY KEY ("provider_id")
);

-- CreateTable
CREATE TABLE "_OfferPaymentMethods" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_OfferPaymentMethods_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_OfferLegacyPaymentMethods" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_OfferLegacyPaymentMethods_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_public_key_key" ON "app_user"("public_key");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_alias_key" ON "app_user"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "escrowonchain_order_id_key" ON "escrowonchain"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "escrowonchain_contract_id_key" ON "escrowonchain"("contract_id");

-- CreateIndex
CREATE INDEX "idx_payment_method_is_active" ON "payment_method"("is_active");

-- CreateIndex
CREATE INDEX "idx_payment_method_provider_id" ON "payment_method"("provider_id");

-- CreateIndex
CREATE INDEX "idx_payment_method_type" ON "payment_method"("type");

-- CreateIndex
CREATE INDEX "idx_payment_method_user_id" ON "payment_method"("user_id");

-- CreateIndex
CREATE INDEX "idx_payment_provider_country_code" ON "payment_provider"("country_code");

-- CreateIndex
CREATE INDEX "idx_payment_provider_is_active" ON "payment_provider"("is_active");

-- CreateIndex
CREATE INDEX "idx_payment_provider_type" ON "payment_provider"("type");

-- CreateIndex
CREATE UNIQUE INDEX "payment_provider_name_country_type_unique" ON "payment_provider"("name", "country_code", "type");

-- CreateIndex
CREATE INDEX "_OfferPaymentMethods_B_index" ON "_OfferPaymentMethods"("B");

-- CreateIndex
CREATE INDEX "_OfferLegacyPaymentMethods_B_index" ON "_OfferLegacyPaymentMethods"("B");

-- AddForeignKey
ALTER TABLE "paymentmethod" ADD CONSTRAINT "paymentmethod_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "offer" ADD CONSTRAINT "offer_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "app_user"("user_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "app_user"("user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offer"("offer_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "app_user"("user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "escrowonchain" ADD CONSTRAINT "escrowonchain_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("order_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chatmessage" ADD CONSTRAINT "chatmessage_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("order_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chatmessage" ADD CONSTRAINT "chatmessage_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "app_user"("user_id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_method" ADD CONSTRAINT "payment_method_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "payment_provider"("provider_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_method" ADD CONSTRAINT "payment_method_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "_OfferPaymentMethods" ADD CONSTRAINT "_OfferPaymentMethods_A_fkey" FOREIGN KEY ("A") REFERENCES "offer"("offer_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OfferPaymentMethods" ADD CONSTRAINT "_OfferPaymentMethods_B_fkey" FOREIGN KEY ("B") REFERENCES "payment_method"("payment_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OfferLegacyPaymentMethods" ADD CONSTRAINT "_OfferLegacyPaymentMethods_A_fkey" FOREIGN KEY ("A") REFERENCES "offer"("offer_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_OfferLegacyPaymentMethods" ADD CONSTRAINT "_OfferLegacyPaymentMethods_B_fkey" FOREIGN KEY ("B") REFERENCES "paymentmethod"("payment_id") ON DELETE CASCADE ON UPDATE CASCADE;
