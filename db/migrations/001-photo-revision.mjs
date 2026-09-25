// Additive migration: never reconstruct check-ins or overwrite visitor data.
export async function applyPhotoRevision(connection) {
  const columns = async () => (await connection.execute("SELECT DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT, COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'checkins' AND COLUMN_NAME = 'photo_revision'"))[0]
  if (!(await columns()).length) {
    try {
      await connection.query("ALTER TABLE checkins ADD COLUMN photo_revision VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'initial' AFTER photo_path")
    } catch (error) {
      // Another explicit migration process may have added this exact column first.
      if (error.code !== 'ER_DUP_FIELDNAME') throw error
    }
  }
  const [column] = await columns()
  if (!column || column.DATA_TYPE !== 'varchar' || Number(column.CHARACTER_MAXIMUM_LENGTH) !== 36 || column.IS_NULLABLE !== 'NO' || column.COLUMN_DEFAULT !== 'initial' || column.COLLATION_NAME !== 'ascii_bin') {
    throw new Error('Unexpected checkins.photo_revision definition; inspect without rebuilding visitor records')
  }
}
