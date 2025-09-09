const AWS = require('aws-sdk');

// Configure AWS Lambda
const lambda = new AWS.Lambda({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

/**
 * Invoke Lambda function for image processing
 * @param {string} functionName - Lambda function name
 * @param {Object} payload - Function payload
 * @returns {Promise<Object>} Lambda response
 */
const invokeLambdaFunction = async (functionName, payload) => {
  const params = {
    FunctionName: functionName,
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify(payload)
  };

  try {
    const result = await lambda.invoke(params).promise();
    const response = JSON.parse(result.Payload);
    
    if (result.StatusCode === 200) {
      console.log(`Lambda function ${functionName} executed successfully`);
      return response;
    } else {
      throw new Error(`Lambda function failed with status ${result.StatusCode}`);
    }
  } catch (error) {
    console.error(`Lambda invocation error for ${functionName}:`, error);
    throw error;
  }
};

/**
 * Process image with Lambda function
 * @param {string} s3Key - S3 object key
 * @param {string} bucketName - S3 bucket name
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Processing result
 */
const processImage = async (s3Key, bucketName, options = {}) => {
  const payload = {
    s3Key,
    bucketName,
    operations: options.operations || ['resize', 'optimize'],
    sizes: options.sizes || [
      { name: 'thumbnail', width: 150, height: 150 },
      { name: 'medium', width: 500, height: 500 },
      { name: 'large', width: 1200, height: 1200 }
    ],
    quality: options.quality || 85,
    format: options.format || 'webp'
  };

  return await invokeLambdaFunction(
    process.env.LAMBDA_IMAGE_PROCESSOR_FUNCTION || 'networkx-image-processor',
    payload
  );
};

/**
 * Generate image thumbnails
 * @param {string} s3Key - S3 object key
 * @param {string} bucketName - S3 bucket name
 * @param {Array} sizes - Thumbnail sizes
 * @returns {Promise<Object>} Thumbnail generation result
 */
const generateThumbnails = async (s3Key, bucketName, sizes = []) => {
  const defaultSizes = [
    { name: 'small', width: 100, height: 100 },
    { name: 'medium', width: 300, height: 300 },
    { name: 'large', width: 600, height: 600 }
  ];

  const payload = {
    s3Key,
    bucketName,
    operation: 'thumbnail',
    sizes: sizes.length > 0 ? sizes : defaultSizes
  };

  return await invokeLambdaFunction(
    process.env.LAMBDA_THUMBNAIL_GENERATOR_FUNCTION || 'networkx-thumbnail-generator',
    payload
  );
};

/**
 * Optimize image for web
 * @param {string} s3Key - S3 object key
 * @param {string} bucketName - S3 bucket name
 * @param {Object} options - Optimization options
 * @returns {Promise<Object>} Optimization result
 */
const optimizeImage = async (s3Key, bucketName, options = {}) => {
  const payload = {
    s3Key,
    bucketName,
    operation: 'optimize',
    quality: options.quality || 80,
    format: options.format || 'webp',
    progressive: options.progressive !== false,
    stripMetadata: options.stripMetadata !== false
  };

  return await invokeLambdaFunction(
    process.env.LAMBDA_IMAGE_OPTIMIZER_FUNCTION || 'networkx-image-optimizer',
    payload
  );
};

/**
 * Extract image metadata
 * @param {string} s3Key - S3 object key
 * @param {string} bucketName - S3 bucket name
 * @returns {Promise<Object>} Image metadata
 */
const extractImageMetadata = async (s3Key, bucketName) => {
  const payload = {
    s3Key,
    bucketName,
    operation: 'metadata'
  };

  return await invokeLambdaFunction(
    process.env.LAMBDA_METADATA_EXTRACTOR_FUNCTION || 'networkx-metadata-extractor',
    payload
  );
};

/**
 * Detect inappropriate content in image
 * @param {string} s3Key - S3 object key
 * @param {string} bucketName - S3 bucket name
 * @returns {Promise<Object>} Content moderation result
 */
const moderateImage = async (s3Key, bucketName) => {
  const payload = {
    s3Key,
    bucketName,
    operation: 'moderation',
    minConfidence: 80
  };

  return await invokeLambdaFunction(
    process.env.LAMBDA_CONTENT_MODERATOR_FUNCTION || 'networkx-content-moderator',
    payload
  );
};

/**
 * Generate image variants (different formats and sizes)
 * @param {string} s3Key - S3 object key
 * @param {string} bucketName - S3 bucket name
 * @param {Array} variants - Variant configurations
 * @returns {Promise<Object>} Variant generation result
 */
const generateImageVariants = async (s3Key, bucketName, variants = []) => {
  const defaultVariants = [
    { name: 'webp_small', format: 'webp', width: 400, quality: 80 },
    { name: 'webp_medium', format: 'webp', width: 800, quality: 85 },
    { name: 'jpg_small', format: 'jpeg', width: 400, quality: 75 },
    { name: 'jpg_medium', format: 'jpeg', width: 800, quality: 80 }
  ];

  const payload = {
    s3Key,
    bucketName,
    operation: 'variants',
    variants: variants.length > 0 ? variants : defaultVariants
  };

  return await invokeLambdaFunction(
    process.env.LAMBDA_VARIANT_GENERATOR_FUNCTION || 'networkx-variant-generator',
    payload
  );
};

/**
 * Batch process multiple images
 * @param {Array} images - Array of image objects with s3Key and bucketName
 * @param {string} operation - Processing operation
 * @param {Object} options - Processing options
 * @returns {Promise<Array>} Batch processing results
 */
const batchProcessImages = async (images, operation = 'optimize', options = {}) => {
  const payload = {
    images,
    operation,
    options,
    batchSize: options.batchSize || 10
  };

  return await invokeLambdaFunction(
    process.env.LAMBDA_BATCH_PROCESSOR_FUNCTION || 'networkx-batch-processor',
    payload
  );
};

/**
 * Check Lambda function status
 * @param {string} functionName - Lambda function name
 * @returns {Promise<Object>} Function status
 */
const checkLambdaStatus = async (functionName) => {
  const params = {
    FunctionName: functionName
  };

  try {
    const result = await lambda.getFunction(params).promise();
    return {
      exists: true,
      state: result.Configuration.State,
      lastModified: result.Configuration.LastModified,
      runtime: result.Configuration.Runtime,
      timeout: result.Configuration.Timeout,
      memorySize: result.Configuration.MemorySize
    };
  } catch (error) {
    if (error.code === 'ResourceNotFoundException') {
      return { exists: false };
    }
    throw error;
  }
};

/**
 * Check if Lambda is properly configured
 * @returns {Promise<boolean>} Configuration status
 */
const checkLambdaConfiguration = async () => {
  try {
    await lambda.listFunctions({ MaxItems: 1 }).promise();
    console.log('Lambda configuration is valid');
    return true;
  } catch (error) {
    console.error('Lambda configuration error:', error);
    return false;
  }
};

/**
 * Process image with fallback to local processing
 * @param {string} s3Key - S3 object key
 * @param {string} bucketName - S3 bucket name
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Processing result
 */
const processImageWithFallback = async (s3Key, bucketName, options = {}) => {
  try {
    // Try Lambda processing first
    return await processImage(s3Key, bucketName, options);
  } catch (error) {
    console.warn('Lambda processing failed, using fallback:', error.message);
    
    // Fallback to basic processing (return original with metadata)
    return {
      success: true,
      processed: false,
      fallback: true,
      original: {
        s3Key,
        bucketName,
        url: `https://${bucketName}.s3.amazonaws.com/${s3Key}`
      },
      message: 'Lambda processing unavailable, using original image'
    };
  }
};

// Lambda function templates for deployment
const LAMBDA_TEMPLATES = {
  IMAGE_PROCESSOR: {
    functionName: 'networkx-image-processor',
    runtime: 'nodejs18.x',
    handler: 'index.handler',
    timeout: 60,
    memorySize: 1024,
    description: 'Process images for Network-X application'
  },
  
  THUMBNAIL_GENERATOR: {
    functionName: 'networkx-thumbnail-generator',
    runtime: 'nodejs18.x',
    handler: 'index.handler',
    timeout: 30,
    memorySize: 512,
    description: 'Generate thumbnails for Network-X images'
  },
  
  CONTENT_MODERATOR: {
    functionName: 'networkx-content-moderator',
    runtime: 'nodejs18.x',
    handler: 'index.handler',
    timeout: 30,
    memorySize: 256,
    description: 'Moderate image content for Network-X'
  }
};

module.exports = {
  invokeLambdaFunction,
  processImage,
  generateThumbnails,
  optimizeImage,
  extractImageMetadata,
  moderateImage,
  generateImageVariants,
  batchProcessImages,
  checkLambdaStatus,
  checkLambdaConfiguration,
  processImageWithFallback,
  LAMBDA_TEMPLATES
};
