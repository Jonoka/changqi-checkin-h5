import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import mysql from 'mysql2/promise'
import { databaseSettings, hasDatabaseSettings } from '../server/db.js'

const settings = databaseSettings()
if (!hasDatabaseSettings(settings)) throw new Error('DB_HOST, DB_PORT, DB_NAME and DB_USER are required')

const connection = await mysql.createConnection({ ...settings, multipleStatements: true })
try {
  const schema = await fs.readFile(path.resolve('db/schema.sql'), 'utf8')
  await connection.query(schema)
  const [rows] = await connection.query('SHOW TABLES')
  console.log(`schema applied: ${rows.length} tables in ${settings.database}`)
} finally {
  await connection.end()
}
