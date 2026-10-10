-- The store now prices in Indian rupees (INR, amounts in paise).
-- Existing rows keep their currency; demo data is converted by `pnpm db:seed`.
ALTER TABLE "services" ALTER COLUMN "currency" SET DEFAULT 'INR';
