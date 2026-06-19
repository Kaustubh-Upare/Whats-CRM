-- Make bc_retailers.whatsapp_number uniquely indexed so ON CONFLICT
-- clauses work and the same phone number can never appear twice.
--
-- First, ensure no existing duplicates (defensive — shouldn't happen
-- in normal usage, but a partial cleanup is safer than failing the
-- migration on an existing unique-index creation).
DELETE FROM bc_retailers a USING bc_retailers b
WHERE a.id > b.id AND a.whatsapp_number = b.whatsapp_number;

CREATE UNIQUE INDEX IF NOT EXISTS bc_retailers_whatsapp_number_key
    ON bc_retailers (whatsapp_number);