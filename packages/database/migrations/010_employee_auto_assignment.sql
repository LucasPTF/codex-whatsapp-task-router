ALTER TABLE employees ADD COLUMN auto_assign INTEGER NOT NULL DEFAULT 1
  CHECK(auto_assign IN (0,1));
