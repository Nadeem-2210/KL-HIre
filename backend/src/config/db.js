const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const dns = require('dns');

let mongod = null;

const connectDB = async () => {
  // Set DNS servers to prevent querySrv ECONNREFUSED issues on some networks
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  } catch (dnsErr) {
    console.warn('Unable to set DNS servers:', dnsErr.message);
  }

  let uri = process.env.MONGO_URI;

  // If using default localhost URI, try real MongoDB first, fall back to in-memory
  const useRealMongo = uri && !uri.includes('localhost') && !uri.includes('127.0.0.1');

  if (!useRealMongo) {
    try {
      // Attempt real local MongoDB first (quick timeout)
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2000 });
      console.log('✅ MongoDB connected (local)');
      return;
    } catch {
      // Fall through to in-memory
    }

    console.log('⚡ Local MongoDB not found — starting persistent local MongoDB server...');
    const fs = require('fs');
    const path = require('path');
    const dbPath = path.resolve(process.cwd(), 'data/db');
    if (!fs.existsSync(dbPath)) {
      fs.mkdirSync(dbPath, { recursive: true });
    }

    try {
      mongod = await MongoMemoryServer.create({
        instance: {
          dbPath: dbPath,
          storageEngine: 'wiredTiger'
        }
      });
      uri = mongod.getUri();
      console.log(`✅ Persistent local MongoDB started at: ${uri}`);
      console.log(`📂 Data directory: ${dbPath}`);
    } catch (err) {
      console.warn('⚠️ Failed to initialize persistent storage, falling back to ephemeral memory:', err.message);
      mongod = await MongoMemoryServer.create();
      uri = mongod.getUri();
      console.log(`✅ Ephemeral In-memory MongoDB started at: ${uri}`);
    }
  }

  try {
    await mongoose.connect(uri);
    console.log(`✅ MongoDB connected: ${mongoose.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB connection error: ${error.message}`);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  if (mongod) await mongod.stop();
  process.exit(0);
});

module.exports = connectDB;

