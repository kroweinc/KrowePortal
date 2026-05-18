-- Make operator_id nullable so an engagement can exist before the operator accepts
ALTER TABLE engagements ALTER COLUMN operator_id DROP NOT NULL;

-- Invitations: one per engagement, used to onboard operators via invitation link
CREATE TABLE invitations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  token         text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'expired')),
  created_by    uuid NOT NULL REFERENCES profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at   timestamptz
);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- Builders can create invitations for their own engagements
CREATE POLICY "invitations_insert" ON invitations
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM engagements
      WHERE id = engagement_id AND builder_id = auth.uid()
    )
  );

-- Builders can read invitations for their own engagements
CREATE POLICY "invitations_select" ON invitations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM engagements
      WHERE id = engagement_id AND builder_id = auth.uid()
    )
  );

-- Token lookup for the accept flow is done server-side via service role (no RLS needed)
