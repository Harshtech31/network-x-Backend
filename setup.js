#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

const log = (message, color = 'reset') => {
  console.log(`${colors[color]}${message}${colors.reset}`);
};

const logStep = (step, message) => {
  log(`${colors.bold}[${step}]${colors.reset} ${message}`, 'blue');
};

const logSuccess = (message) => {
  log(`✅ ${message}`, 'green');
};

const logError = (message) => {
  log(`❌ ${message}`, 'red');
};

const logWarning = (message) => {
  log(`⚠️  ${message}`, 'yellow');
};

async function checkPrerequisites() {
  logStep('1/8', 'Checking Prerequisites');
  
  try {
    // Check Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    if (majorVersion < 16) {
      logError(`Node.js version ${nodeVersion} is not supported. Please upgrade to Node.js 16 or higher.`);
      process.exit(1);
    }
    logSuccess(`Node.js version ${nodeVersion} ✓`);

    // Check npm
    execSync('npm --version', { stdio: 'pipe' });
    logSuccess('npm is available ✓');

    // Check if .env exists
    try {
      await fs.access('.env');
      logSuccess('.env file exists ✓');
    } catch (error) {
      logWarning('.env file not found. Please create one using .env.example as template.');
    }

  } catch (error) {
    logError(`Prerequisites check failed: ${error.message}`);
    process.exit(1);
  }
}

async function installDependencies() {
  logStep('2/8', 'Installing Dependencies');
  
  try {
    log('Installing production dependencies...');
    execSync('npm install', { stdio: 'inherit' });
    logSuccess('Dependencies installed successfully ✓');
  } catch (error) {
    logError(`Failed to install dependencies: ${error.message}`);
    process.exit(1);
  }
}

async function validateEnvironment() {
  logStep('3/8', 'Validating Environment Configuration');
  
  const requiredVars = [
    'MONGODB_URI',
    'JWT_SECRET',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_S3_BUCKET'
  ];

  const missingVars = [];
  
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    logWarning(`Missing environment variables: ${missingVars.join(', ')}`);
    logWarning('Please update your .env file with the required variables.');
  } else {
    logSuccess('All required environment variables are set ✓');
  }
}

async function testDatabaseConnection() {
  logStep('4/8', 'Testing Database Connections');
  
  try {
    // Test MongoDB connection
    const mongoose = require('mongoose');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/networkx-test', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000
    });
    logSuccess('MongoDB connection successful ✓');
    await mongoose.connection.close();

    // Test Redis connection (optional)
    if (process.env.REDIS_HOST) {
      try {
        const redis = require('redis');
        const client = redis.createClient({
          host: process.env.REDIS_HOST,
          port: process.env.REDIS_PORT || 6379,
          password: process.env.REDIS_PASSWORD,
          connectTimeout: 5000
        });
        await client.connect();
        await client.ping();
        logSuccess('Redis connection successful ✓');
        await client.quit();
      } catch (error) {
        logWarning(`Redis connection failed: ${error.message}`);
      }
    }

  } catch (error) {
    logError(`Database connection failed: ${error.message}`);
    logWarning('Please check your database configuration in .env file');
  }
}

async function testAWSServices() {
  logStep('5/8', 'Testing AWS Services');
  
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    logWarning('AWS credentials not configured. Skipping AWS tests.');
    return;
  }

  try {
    const AWS = require('aws-sdk');
    AWS.config.update({
      region: process.env.AWS_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    });

    // Test S3
    if (process.env.AWS_S3_BUCKET) {
      try {
        const s3 = new AWS.S3();
        await s3.headBucket({ Bucket: process.env.AWS_S3_BUCKET }).promise();
        logSuccess('S3 bucket access successful ✓');
      } catch (error) {
        logWarning(`S3 access failed: ${error.message}`);
      }
    }

    // Test DynamoDB
    try {
      const dynamodb = new AWS.DynamoDB();
      await dynamodb.listTables({ Limit: 1 }).promise();
      logSuccess('DynamoDB access successful ✓');
    } catch (error) {
      logWarning(`DynamoDB access failed: ${error.message}`);
    }

  } catch (error) {
    logWarning(`AWS services test failed: ${error.message}`);
  }
}

async function initializeDynamoDB() {
  logStep('6/8', 'Initializing DynamoDB Tables');
  
  if (!process.env.AWS_ACCESS_KEY_ID) {
    logWarning('AWS credentials not configured. Skipping DynamoDB initialization.');
    return;
  }

  try {
    const { initializeDynamoDB } = require('./src/scripts/init-dynamodb');
    await initializeDynamoDB();
    logSuccess('DynamoDB tables initialized successfully ✓');
  } catch (error) {
    logWarning(`DynamoDB initialization failed: ${error.message}`);
    logWarning('You can run this manually later: node src/scripts/init-dynamodb.js create');
  }
}

async function runTests() {
  logStep('7/8', 'Running Tests');
  
  try {
    execSync('npm test', { stdio: 'inherit' });
    logSuccess('All tests passed ✓');
  } catch (error) {
    logWarning('Some tests failed. Check the output above for details.');
  }
}

async function finalizeSetup() {
  logStep('8/8', 'Finalizing Setup');
  
  // Create necessary directories
  const directories = [
    'storage',
    'storage/uploads',
    'storage/backups',
    'logs'
  ];

  for (const dir of directories) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  }

  logSuccess('Directory structure created ✓');
  
  // Create a simple health check script
  const healthCheckScript = `#!/usr/bin/env node
const http = require('http');

const options = {
  hostname: 'localhost',
  port: process.env.PORT || 5000,
  path: '/health',
  method: 'GET'
};

const req = http.request(options, (res) => {
  console.log(\`Health check status: \${res.statusCode}\`);
  if (res.statusCode === 200) {
    console.log('✅ Server is healthy');
    process.exit(0);
  } else {
    console.log('❌ Server is not healthy');
    process.exit(1);
  }
});

req.on('error', (error) => {
  console.log(\`❌ Health check failed: \${error.message}\`);
  process.exit(1);
});

req.end();
`;

  await fs.writeFile('health-check.js', healthCheckScript);
  logSuccess('Health check script created ✓');
}

async function main() {
  log('\n🚀 Network-X Backend Setup\n', 'bold');
  
  try {
    await checkPrerequisites();
    await installDependencies();
    await validateEnvironment();
    await testDatabaseConnection();
    await testAWSServices();
    await initializeDynamoDB();
    await runTests();
    await finalizeSetup();
    
    log('\n🎉 Setup completed successfully!\n', 'green');
    log('Next steps:', 'bold');
    log('1. Review your .env configuration');
    log('2. Start the server: npm start');
    log('3. Check health: node health-check.js');
    log('4. View API docs: http://localhost:5000/health');
    
  } catch (error) {
    logError(`Setup failed: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
