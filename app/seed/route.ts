import bcrypt from 'bcrypt';
import postgres from 'postgres';
import { invoices, customers, revenue, users } from '../lib/placeholder-data';

async function seedUsers(sql: ReturnType<typeof postgres>) {
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL
    );
  `;

  const insertedUsers = await Promise.all(
    users.map(async (user) => {
      const hashedPassword = await bcrypt.hash(user.password, 10);
      return sql`
        INSERT INTO users (id, name, email, password)
        VALUES (${user.id}, ${user.name}, ${user.email}, ${hashedPassword})
        ON CONFLICT (id) DO NOTHING;
      `;
    }),
  );

  return insertedUsers;
}

async function seedInvoices(sql: ReturnType<typeof postgres>) {
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;

  await sql`
    CREATE TABLE IF NOT EXISTS invoices (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      customer_id UUID NOT NULL,
      amount INT NOT NULL,
      status VARCHAR(255) NOT NULL,
      date DATE NOT NULL
    );
  `;

  const insertedInvoices = await Promise.all(
    invoices.map(
      (invoice) => sql`
        INSERT INTO invoices (customer_id, amount, status, date)
        VALUES (${invoice.customer_id}, ${invoice.amount}, ${invoice.status}, ${invoice.date})
        ON CONFLICT (id) DO NOTHING;
      `,
    ),
  );

  return insertedInvoices;
}

async function seedCustomers(sql: ReturnType<typeof postgres>) {
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;

  await sql`
    CREATE TABLE IF NOT EXISTS customers (
      id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      image_url VARCHAR(255) NOT NULL
    );
  `;

  const insertedCustomers = await Promise.all(
    customers.map(
      (customer) => sql`
        INSERT INTO customers (id, name, email, image_url)
        VALUES (${customer.id}, ${customer.name}, ${customer.email}, ${customer.image_url})
        ON CONFLICT (id) DO NOTHING;
      `,
    ),
  );

  return insertedCustomers;
}

async function seedRevenue(sql: ReturnType<typeof postgres>) {
  await sql`
    CREATE TABLE IF NOT EXISTS revenue (
      month VARCHAR(4) NOT NULL UNIQUE,
      revenue INT NOT NULL
    );
  `;

  const insertedRevenue = await Promise.all(
    revenue.map(
      (rev) => sql`
        INSERT INTO revenue (month, revenue)
        VALUES (${rev.month}, ${rev.revenue})
        ON CONFLICT (month) DO NOTHING;
      `,
    ),
  );

  return insertedRevenue;
}

export async function GET() {
  try {
    // Check if POSTGRES_URL is set
    if (!process.env.POSTGRES_URL) {
      return Response.json(
        {
          error: {
            message:
              'POSTGRES_URL environment variable is not set. Please set it in your .env file.',
            code: 'MISSING_ENV_VAR',
          },
        },
        { status: 500 },
      );
    }

    // Create database connection
    // Use SSL only if POSTGRES_URL includes SSL connection string (typically for cloud databases)
    const useSSL = process.env.POSTGRES_URL.includes('sslmode=require') || 
                   process.env.POSTGRES_URL.includes('ssl=true') ||
                   process.env.POSTGRES_URL.includes('amazonaws.com') ||
                   process.env.POSTGRES_URL.includes('neon.tech') ||
                   process.env.POSTGRES_URL.includes('vercel-storage.com');
    
    let sql: ReturnType<typeof postgres>;
    try {
      sql = postgres(process.env.POSTGRES_URL, useSSL ? { ssl: 'require' } : {});
    } catch (connectionError: any) {
      return Response.json(
        {
          error: {
            message: 'Failed to create database connection. Please check your POSTGRES_URL.',
            code: connectionError.code || 'CONNECTION_ERROR',
            details: connectionError.message,
          },
        },
        { status: 500 },
      );
    }

    try {
      const result = await sql.begin((sql) => [
        seedUsers(sql),
        seedCustomers(sql),
        seedInvoices(sql),
        seedRevenue(sql),
      ]);

      // Close the connection
      await sql.end();

      return Response.json({ message: 'Database seeded successfully' });
    } catch (dbError: any) {
      // Close the connection on error
      await sql.end().catch(() => {});

      // Extract error information
      const errorCode = dbError?.code || dbError?.errno || '';
      const errorMessage = dbError?.message || String(dbError) || 'Database error occurred';
      let errorString = '';
      try {
        errorString = JSON.stringify(dbError);
      } catch {
        errorString = String(dbError);
      }

      // Handle specific connection errors
      if (errorCode === 'ECONNREFUSED' || 
          errorMessage.includes('ECONNREFUSED') || 
          errorString.includes('ECONNREFUSED')) {
        return Response.json(
          {
            error: {
              message:
                'Unable to connect to the database. Please make sure your database is running and the POSTGRES_URL is correct. Common issues: 1) Database server is not running, 2) Wrong host/port in POSTGRES_URL, 3) Firewall blocking the connection.',
              code: 'ECONNREFUSED',
            },
          },
          { status: 500 },
        );
      }

      // Handle SSL errors
      if (errorMessage.includes('SSL') || errorCode === '28000' || errorString.includes('SSL')) {
        return Response.json(
          {
            error: {
              message:
                'SSL connection error. If you are using a local database, try removing SSL requirements from your connection string.',
              code: 'SSL_ERROR',
            },
          },
          { status: 500 },
        );
      }

      // Handle authentication errors
      if (errorCode === '28P01' || errorMessage.includes('password') || errorMessage.includes('authentication')) {
        return Response.json(
          {
            error: {
              message: 'Database authentication failed. Please check your POSTGRES_URL credentials.',
              code: 'AUTH_ERROR',
            },
          },
          { status: 500 },
        );
      }

      // Handle other database errors
      return Response.json(
        {
          error: {
            message: errorMessage,
            code: errorCode || 'DATABASE_ERROR',
          },
        },
        { status: 500 },
      );
    }
  } catch (error: any) {
    return Response.json(
      {
        error: {
          message: error.message || 'An unexpected error occurred',
          code: error.code || 'UNKNOWN_ERROR',
        },
      },
      { status: 500 },
    );
  }
}
