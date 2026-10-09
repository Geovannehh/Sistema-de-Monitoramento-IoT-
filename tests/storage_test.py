from pathlib import Path
import sqlite3
import unittest

ROOT = Path(__file__).resolve().parents[1]

class StorageTest(unittest.TestCase):
    def test_revision_prevents_stale_overwrite_and_seed_reset(self):
        db = sqlite3.connect(':memory:')
        db.executescript((ROOT / 'drizzle/0000_tearful_fixer.sql').read_text())
        insert = 'INSERT OR IGNORE INTO fleet_demo(id,revision,payload) VALUES(?,?,?)'
        db.execute(insert, ('main',0,'original'))
        db.execute(insert, ('main',0,'reset'))
        update = 'UPDATE fleet_demo SET payload=?,revision=revision+1 WHERE id=? AND revision=?'
        self.assertEqual(db.execute(update, ('saved','main',0)).rowcount, 1)
        self.assertEqual(db.execute(update, ('stale','main',0)).rowcount, 0)
        self.assertEqual(db.execute('SELECT revision,payload FROM fleet_demo').fetchone(), (1,'saved'))
        db.close()

if __name__ == '__main__': unittest.main()
