const mongoose = require('mongoose');
const AWS = require('aws-sdk');
require('dotenv').config();

// Test MongoDB Connection
async function testMongoDB() {
  try {
    console.log('🔍 Testing MongoDB connection...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB connected successfully!');
    
    // Test creating a test document
    const testSchema = new mongoose.Schema({ test: String });
    const TestModel = mongoose.model('Test', testSchema);
    
    const testDoc = new TestModel({ test: 'connection-test' });
    await testDoc.save();
    console.log('✅ MongoDB write test successful!');
    
    await TestModel.deleteOne({ test: 'connection-test' });
    console.log('✅ MongoDB delete test successful!');
    
    await mongoose.disconnect();
    console.log('✅ MongoDB disconnected cleanly');
    
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    return false;
  }
  return true;
}

// Test AWS S3 Connection
async function testAWS() {
  try {
    console.log('\n🔍 Testing AWS S3 connection...');
    
    // Configure AWS
    AWS.config.update({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION
    });
    
    const s3 = new AWS.S3();
    
    // Test bucket access
    const bucketParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME
    };
    
    await s3.headBucket(bucketParams).promise();
    console.log('✅ AWS S3 bucket access successful!');
    
    // Test file upload
    const testParams = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: 'test/connection-test.txt',
      Body: 'This is a connection test file',
      ContentType: 'text/plain'
    };
    
    const uploadResult = await s3.upload(testParams).promise();
    console.log('✅ AWS S3 file upload successful!');
    console.log('📁 Test file URL:', uploadResult.Location);
    
    // Clean up test file
    await s3.deleteObject({
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: 'test/connection-test.txt'
    }).promise();
    console.log('✅ AWS S3 file deletion successful!');
    
  } catch (error) {
    console.error('❌ AWS S3 connection failed:', error.message);
    return false;
  }
  return true;
}

// Test Environment Variables
function testEnvironment() {
  console.log('\n🔍 Testing environment variables...');
  
  const requiredVars = [
    'MONGODB_URI',
    'JWT_SECRET'
  ];
  
  const optionalVars = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION',
    'AWS_S3_BUCKET_NAME'
  ];
  
  const missing = requiredVars.filter(varName => !process.env[varName]);
  const missingOptional = optionalVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    return false;
  }
  
  console.log('✅ All required environment variables are set!');
  
  if (missingOptional.length > 0) {
    console.warn('⚠️ Missing optional AWS variables:', missingOptional.join(', '));
    console.warn('   AWS S3 tests will be skipped');
  }
  
  return true;
}

// Run all tests
async function runTests() {
  console.log('🚀 Starting Network-X Backend Setup Tests\n');
  
  const envTest = testEnvironment();
  if (!envTest) {
    console.log('\n❌ Environment test failed. Please check your .env file.');
    process.exit(1);
  }
  
  const mongoTest = await testMongoDB();
  
  let awsTest = true;
  const hasAWSVars = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY;
  
  if (hasAWSVars) {
    awsTest = await testAWS();
  } else {
    console.log('\n⚠️ Skipping AWS tests - credentials not configured');
  }
  
  console.log('\n📊 Test Results:');
  console.log(`Environment Variables: ${envTest ? '✅' : '❌'}`);
  console.log(`MongoDB Connection: ${mongoTest ? '✅' : '❌'}`);
  console.log(`AWS S3 Connection: ${hasAWSVars ? (awsTest ? '✅' : '❌') : '⚠️ Skipped'}`);
  
  if (envTest && mongoTest) {
    console.log('\n🎉 MongoDB setup is working! Your backend is ready for authentication!');
    console.log('\n📝 Next steps:');
    console.log('1. Configure AWS credentials for file uploads (optional)');
    console.log('2. Run "npm start" to start the server');
    console.log('3. Test authentication endpoints with Postman or curl');
  } else {
    console.log('\n❌ Some tests failed. Please check the errors above.');
    process.exit(1);
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n👋 Shutting down gracefully...');
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
  process.exit(0);
});

runTests().catch(console.error);
