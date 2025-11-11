-- This is an invalid SQL file that should cause an import error
-- It contains syntax errors and invalid SQL commands

INVALID SQL SYNTAX HERE;
CREATE TABL users (  -- Intentional typo: TABL instead of TABLE
    id INT PRIMARY KEY
);

-- Missing semicolon
INSERT INTO nonexistent_table VALUES (1, 2, 3)

-- Invalid syntax
SELECT * FROM WHERE;

-- Unclosed string
INSERT INTO test VALUES ('unclosed string

-- Invalid command
RANDOM_COMMAND that does not exist;
