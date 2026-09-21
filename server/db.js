import mysql from 'mysql2/promise'

export function databaseSettings(env = process.env) {
  return {
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD
  }
}

export function hasDatabaseSettings(settings) {
  return Boolean(settings.host && settings.database && settings.user && Number.isInteger(settings.port) && settings.port > 0)
}

export function createDatabasePool(settings) {
  return mysql.createPool({
    ...settings,
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4'
  })
}

export async function checkDatabaseConnection(pool) {
  const connection = await pool.getConnection()
  try {
    await connection.query('SELECT 1')
  } finally {
    connection.release()
  }
}
