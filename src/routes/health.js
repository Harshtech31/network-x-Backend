const express = require('express');
const mongoose = require('mongoose');
const { getRedisClient } = require('../config/redis');
const AWS = require('aws-sdk');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Basic health check (public)
router.get('/', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Detailed system health (admin only)
router.get('/detailed', authenticateToken, requireAdmin, async (req, res) => {
  const healthChecks = {
    timestamp: new Date().toISOString(),
    status: 'OK',
    services: {},
    system: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version
    }
  };

  let overallStatus = 'OK';

  // MongoDB Health Check
  try {
    const mongoState = mongoose.connection.readyState;
    const mongoStates = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };
    
    healthChecks.services.mongodb = {
      status: mongoState === 1 ? 'OK' : 'ERROR',
      state: mongoStates[mongoState],
      host: mongoose.connection.host,
      name: mongoose.connection.name
    };

    if (mongoState !== 1) overallStatus = 'ERROR';
  } catch (error) {
    healthChecks.services.mongodb = {
      status: 'ERROR',
      error: error.message
    };
    overallStatus = 'ERROR';
  }

  // Redis Health Check
  try {
    const redisClient = getRedisClient();
    const redisPing = await redisClient.ping();
    
    healthChecks.services.redis = {
      status: redisPing === 'PONG' ? 'OK' : 'ERROR',
      response: redisPing,
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    };

    if (redisPing !== 'PONG') overallStatus = 'WARNING';
  } catch (error) {
    healthChecks.services.redis = {
      status: 'ERROR',
      error: error.message
    };
    overallStatus = 'WARNING'; // Redis is not critical for basic functionality
  }

  // AWS Services Health Check
  try {
    // S3 Health Check
    const s3 = new AWS.S3();
    await s3.headBucket({ Bucket: process.env.AWS_S3_BUCKET }).promise();
    
    healthChecks.services.s3 = {
      status: 'OK',
      bucket: process.env.AWS_S3_BUCKET,
      region: process.env.AWS_REGION
    };
  } catch (error) {
    healthChecks.services.s3 = {
      status: 'ERROR',
      error: error.message
    };
    overallStatus = 'WARNING';
  }

  try {
    // DynamoDB Health Check
    const dynamodb = new AWS.DynamoDB();
    const tables = await dynamodb.listTables({ Limit: 1 }).promise();
    
    healthChecks.services.dynamodb = {
      status: 'OK',
      tablesCount: tables.TableNames.length,
      region: process.env.AWS_REGION
    };
  } catch (error) {
    healthChecks.services.dynamodb = {
      status: 'ERROR',
      error: error.message
    };
    overallStatus = 'ERROR';
  }

  // Check critical environment variables
  const requiredEnvVars = [
    'JWT_SECRET',
    'MONGODB_URI',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_S3_BUCKET'
  ];

  const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  healthChecks.configuration = {
    status: missingEnvVars.length === 0 ? 'OK' : 'ERROR',
    missingVariables: missingEnvVars
  };

  if (missingEnvVars.length > 0) overallStatus = 'ERROR';

  healthChecks.status = overallStatus;
  
  const statusCode = overallStatus === 'OK' ? 200 : overallStatus === 'WARNING' ? 200 : 503;
  res.status(statusCode).json(healthChecks);
});

// Database connectivity test
router.get('/db', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Test MongoDB
    const mongoStart = Date.now();
    await mongoose.connection.db.admin().ping();
    const mongoLatency = Date.now() - mongoStart;

    // Test Redis
    const redisStart = Date.now();
    const redisClient = getRedisClient();
    await redisClient.ping();
    const redisLatency = Date.now() - redisStart;

    // Test DynamoDB
    const dynamoStart = Date.now();
    const dynamodb = new AWS.DynamoDB();
    await dynamodb.listTables({ Limit: 1 }).promise();
    const dynamoLatency = Date.now() - dynamoStart;

    res.json({
      status: 'OK',
      databases: {
        mongodb: {
          status: 'connected',
          latency: `${mongoLatency}ms`,
          collections: (await mongoose.connection.db.listCollections().toArray()).length
        },
        redis: {
          status: 'connected',
          latency: `${redisLatency}ms`
        },
        dynamodb: {
          status: 'connected',
          latency: `${dynamoLatency}ms`
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'ERROR',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Performance metrics
router.get('/metrics', authenticateToken, requireAdmin, (req, res) => {
  const metrics = {
    timestamp: new Date().toISOString(),
    process: {
      pid: process.pid,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      version: process.version,
      platform: process.platform,
      arch: process.arch
    },
    system: {
      loadavg: require('os').loadavg(),
      totalmem: require('os').totalmem(),
      freemem: require('os').freemem(),
      cpus: require('os').cpus().length
    }
  };

  res.json(metrics);
});

// Service status endpoint
router.get('/services', authenticateToken, requireAdmin, async (req, res) => {
  const services = {};

  // Check each service independently
  const serviceChecks = [
    {
      name: 'mongodb',
      check: async () => {
        const state = mongoose.connection.readyState;
        return { connected: state === 1, state };
      }
    },
    {
      name: 'redis',
      check: async () => {
        try {
          const redisClient = getRedisClient();
          const result = await redisClient.ping();
          return { connected: result === 'PONG', response: result };
        } catch (error) {
          return { connected: false, error: error.message };
        }
      }
    },
    {
      name: 's3',
      check: async () => {
        try {
          const s3 = new AWS.S3();
          await s3.headBucket({ Bucket: process.env.AWS_S3_BUCKET }).promise();
          return { connected: true, bucket: process.env.AWS_S3_BUCKET };
        } catch (error) {
          return { connected: false, error: error.message };
        }
      }
    },
    {
      name: 'dynamodb',
      check: async () => {
        try {
          const dynamodb = new AWS.DynamoDB();
          const result = await dynamodb.listTables({ Limit: 1 }).promise();
          return { connected: true, tables: result.TableNames.length };
        } catch (error) {
          return { connected: false, error: error.message };
        }
      }
    },
    {
      name: 'ses',
      check: async () => {
        try {
          const ses = new AWS.SES();
          await ses.getSendQuota().promise();
          return { connected: true, service: 'email' };
        } catch (error) {
          return { connected: false, error: error.message };
        }
      }
    },
    {
      name: 'sns',
      check: async () => {
        try {
          const sns = new AWS.SNS();
          await sns.listTopics({ NextToken: null }).promise();
          return { connected: true, service: 'push_notifications' };
        } catch (error) {
          return { connected: false, error: error.message };
        }
      }
    }
  ];

  // Run all checks in parallel
  const results = await Promise.allSettled(
    serviceChecks.map(async ({ name, check }) => {
      try {
        const result = await check();
        return { name, ...result };
      } catch (error) {
        return { name, connected: false, error: error.message };
      }
    })
  );

  // Process results
  results.forEach(result => {
    if (result.status === 'fulfilled') {
      const { name, ...serviceData } = result.value;
      services[name] = serviceData;
    } else {
      services[result.reason?.name || 'unknown'] = {
        connected: false,
        error: result.reason?.message || 'Unknown error'
      };
    }
  });

  const connectedServices = Object.values(services).filter(s => s.connected).length;
  const totalServices = Object.keys(services).length;

  res.json({
    status: connectedServices === totalServices ? 'OK' : 'PARTIAL',
    services,
    summary: {
      connected: connectedServices,
      total: totalServices,
      percentage: Math.round((connectedServices / totalServices) * 100)
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
