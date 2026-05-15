-- Allow tasks to exist without an engagement (personal tasks for any role)
ALTER TABLE tasks ALTER COLUMN engagement_id DROP NOT NULL;

-- Recreate select policy to allow personal tasks (no engagement)
DROP POLICY "tasks_select" ON tasks;
CREATE POLICY "tasks_select" ON tasks
  FOR SELECT USING (
    (engagement_id IS NULL AND created_by = auth.uid())
    OR (
      engagement_id IS NOT NULL
      AND is_engagement_member(engagement_id)
      AND (operator_visible = true OR is_engagement_builder(engagement_id))
    )
  );

-- Recreate operator insert policy to allow personal tasks
DROP POLICY "tasks_insert_operator" ON tasks;
CREATE POLICY "tasks_insert_operator" ON tasks
  FOR INSERT WITH CHECK (
    source = 'operator_request'
    AND created_by = auth.uid()
    AND (
      engagement_id IS NULL
      OR is_engagement_operator(engagement_id)
    )
  );

-- Recreate builder insert policy to allow personal tasks
DROP POLICY "tasks_insert_builder" ON tasks;
CREATE POLICY "tasks_insert_builder" ON tasks
  FOR INSERT WITH CHECK (
    source = 'builder_added'
    AND created_by = auth.uid()
    AND (
      engagement_id IS NULL
      OR is_engagement_builder(engagement_id)
    )
  );

-- Recreate delete policy to handle null engagement_id
DROP POLICY "tasks_delete" ON tasks;
CREATE POLICY "tasks_delete" ON tasks
  FOR DELETE USING (
    (engagement_id IS NULL AND created_by = auth.uid())
    OR (engagement_id IS NOT NULL AND is_engagement_member(engagement_id))
  );
