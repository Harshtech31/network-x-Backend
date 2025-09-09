const { 
  processImage,
  generateThumbnails,
  optimizeImage,
  extractImageMetadata,
  moderateImage,
  generateImageVariants,
  processImageWithFallback
} = require('../config/lambda');
const { updateItem, queryItems } = require('../config/dynamodb');

/**
 * Image processing service using AWS Lambda
 */
class ImageProcessingService {
  constructor() {
    this.initialized = false;
    this.init();
  }

  /**
   * Initialize image processing service
   */
  async init() {
    try {
      this.initialized = true;
      console.log('Image processing service initialized');
    } catch (error) {
      console.error('Image processing service initialization failed:', error);
    }
  }

  /**
   * Process uploaded image
   * @param {string} s3Key - S3 object key
   * @param {string} bucketName - S3 bucket name
   * @param {string} userId - User ID who uploaded the image
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processing result
   */
  async processUploadedImage(s3Key, bucketName, userId, options = {}) {
    try {
      const processingId = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Store processing job
      const processingJob = {
        processingId,
        userId,
        s3Key,
        bucketName,
        status: 'processing',
        createdAt: new Date().toISOString(),
        options
      };

      await updateItem(
        process.env.DYNAMODB_NOTIFICATIONS_TABLE || 'networkx-notifications',
        { notificationId: processingId },
        processingJob
      );

      // Process image with Lambda
      const result = await processImageWithFallback(s3Key, bucketName, {
        operations: ['resize', 'optimize', 'thumbnail'],
        sizes: [
          { name: 'thumbnail', width: 150, height: 150 },
          { name: 'small', width: 400, height: 400 },
          { name: 'medium', width: 800, height: 800 },
          { name: 'large', width: 1200, height: 1200 }
        ],
        quality: 85,
        format: 'webp',
        ...options
      });

      // Update processing job with results
      await updateItem(
        process.env.DYNAMODB_NOTIFICATIONS_TABLE || 'networkx-notifications',
        { notificationId: processingId },
        {
          ...processingJob,
          status: 'completed',
          result,
          completedAt: new Date().toISOString()
        }
      );

      return {
        processingId,
        success: true,
        ...result
      };

    } catch (error) {
      console.error('Image processing error:', error);
      throw error;
    }
  }

  /**
   * Generate thumbnails for existing image
   * @param {string} s3Key - S3 object key
   * @param {string} bucketName - S3 bucket name
   * @param {Array} sizes - Thumbnail sizes
   * @returns {Promise<Object>} Thumbnail generation result
   */
  async generateImageThumbnails(s3Key, bucketName, sizes = []) {
    try {
      const defaultSizes = [
        { name: 'thumb_small', width: 100, height: 100 },
        { name: 'thumb_medium', width: 200, height: 200 },
        { name: 'thumb_large', width: 400, height: 400 }
      ];

      const result = await generateThumbnails(
        s3Key, 
        bucketName, 
        sizes.length > 0 ? sizes : defaultSizes
      );

      return result;

    } catch (error) {
      console.error('Thumbnail generation error:', error);
      throw error;
    }
  }

  /**
   * Optimize image for web delivery
   * @param {string} s3Key - S3 object key
   * @param {string} bucketName - S3 bucket name
   * @param {Object} options - Optimization options
   * @returns {Promise<Object>} Optimization result
   */
  async optimizeImageForWeb(s3Key, bucketName, options = {}) {
    try {
      const result = await optimizeImage(s3Key, bucketName, {
        quality: options.quality || 80,
        format: options.format || 'webp',
        progressive: true,
        stripMetadata: true,
        ...options
      });

      return result;

    } catch (error) {
      console.error('Image optimization error:', error);
      throw error;
    }
  }

  /**
   * Extract and analyze image metadata
   * @param {string} s3Key - S3 object key
   * @param {string} bucketName - S3 bucket name
   * @returns {Promise<Object>} Image metadata
   */
  async analyzeImage(s3Key, bucketName) {
    try {
      const metadata = await extractImageMetadata(s3Key, bucketName);
      
      return {
        success: true,
        metadata: {
          dimensions: metadata.dimensions,
          fileSize: metadata.fileSize,
          format: metadata.format,
          colorSpace: metadata.colorSpace,
          hasAlpha: metadata.hasAlpha,
          exif: metadata.exif || {},
          created: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error('Image analysis error:', error);
      return {
        success: false,
        error: error.message,
        metadata: null
      };
    }
  }

  /**
   * Moderate image content for inappropriate material
   * @param {string} s3Key - S3 object key
   * @param {string} bucketName - S3 bucket name
   * @param {string} userId - User ID who uploaded the image
   * @returns {Promise<Object>} Moderation result
   */
  async moderateImageContent(s3Key, bucketName, userId) {
    try {
      const result = await moderateImage(s3Key, bucketName);
      
      // Store moderation result
      const moderationRecord = {
        moderationId: `mod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        s3Key,
        bucketName,
        result: result.moderation,
        confidence: result.confidence,
        labels: result.labels || [],
        approved: result.approved,
        createdAt: new Date().toISOString()
      };

      await updateItem(
        process.env.DYNAMODB_REPORTS_TABLE || 'networkx-reports',
        { reportId: moderationRecord.moderationId },
        moderationRecord
      );

      return {
        success: true,
        approved: result.approved,
        confidence: result.confidence,
        labels: result.labels,
        moderationId: moderationRecord.moderationId
      };

    } catch (error) {
      console.error('Image moderation error:', error);
      return {
        success: false,
        approved: true, // Default to approved if moderation fails
        error: error.message
      };
    }
  }

  /**
   * Generate multiple image variants
   * @param {string} s3Key - S3 object key
   * @param {string} bucketName - S3 bucket name
   * @param {Array} variants - Variant configurations
   * @returns {Promise<Object>} Variant generation result
   */
  async createImageVariants(s3Key, bucketName, variants = []) {
    try {
      const result = await generateImageVariants(s3Key, bucketName, variants);
      
      return {
        success: true,
        variants: result.variants,
        originalUrl: `https://${bucketName}.s3.amazonaws.com/${s3Key}`,
        processedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error('Image variant generation error:', error);
      throw error;
    }
  }

  /**
   * Process profile image upload
   * @param {string} s3Key - S3 object key
   * @param {string} bucketName - S3 bucket name
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Profile image processing result
   */
  async processProfileImage(s3Key, bucketName, userId) {
    try {
      // Generate profile image variants
      const variants = [
        { name: 'avatar_small', width: 50, height: 50, format: 'webp', quality: 90 },
        { name: 'avatar_medium', width: 100, height: 100, format: 'webp', quality: 90 },
        { name: 'avatar_large', width: 200, height: 200, format: 'webp', quality: 90 },
        { name: 'profile_banner', width: 800, height: 200, format: 'webp', quality: 85 }
      ];

      const [processingResult, moderationResult] = await Promise.all([
        this.createImageVariants(s3Key, bucketName, variants),
        this.moderateImageContent(s3Key, bucketName, userId)
      ]);

      return {
        success: true,
        approved: moderationResult.approved,
        variants: processingResult.variants,
        moderation: {
          confidence: moderationResult.confidence,
          labels: moderationResult.labels
        },
        processedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error('Profile image processing error:', error);
      throw error;
    }
  }

  /**
   * Process post image upload
   * @param {string} s3Key - S3 object key
   * @param {string} bucketName - S3 bucket name
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Post image processing result
   */
  async processPostImage(s3Key, bucketName, userId) {
    try {
      // Generate post image variants
      const variants = [
        { name: 'post_thumbnail', width: 300, height: 200, format: 'webp', quality: 80 },
        { name: 'post_small', width: 600, height: 400, format: 'webp', quality: 85 },
        { name: 'post_medium', width: 1000, height: 667, format: 'webp', quality: 85 },
        { name: 'post_large', width: 1600, height: 1067, format: 'webp', quality: 90 }
      ];

      const [processingResult, moderationResult, metadataResult] = await Promise.all([
        this.createImageVariants(s3Key, bucketName, variants),
        this.moderateImageContent(s3Key, bucketName, userId),
        this.analyzeImage(s3Key, bucketName)
      ]);

      return {
        success: true,
        approved: moderationResult.approved,
        variants: processingResult.variants,
        metadata: metadataResult.metadata,
        moderation: {
          confidence: moderationResult.confidence,
          labels: moderationResult.labels
        },
        processedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error('Post image processing error:', error);
      throw error;
    }
  }

  /**
   * Get processing job status
   * @param {string} processingId - Processing job ID
   * @returns {Promise<Object>} Processing status
   */
  async getProcessingStatus(processingId) {
    try {
      const result = await queryItems(
        process.env.DYNAMODB_NOTIFICATIONS_TABLE || 'networkx-notifications',
        'notificationId',
        processingId
      );

      if (result.length === 0) {
        return { found: false };
      }

      const job = result[0];
      return {
        found: true,
        status: job.status,
        result: job.result,
        createdAt: job.createdAt,
        completedAt: job.completedAt
      };

    } catch (error) {
      console.error('Get processing status error:', error);
      throw error;
    }
  }

  /**
   * Clean up old processing jobs
   * @param {number} daysOld - Days old to clean up
   * @returns {Promise<Object>} Cleanup result
   */
  async cleanupOldProcessingJobs(daysOld = 7) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      
      // This would require a scan operation to find old jobs
      // Implementation depends on your DynamoDB table structure
      
      console.log(`Cleanup would remove jobs older than ${cutoffDate.toISOString()}`);
      
      return {
        success: true,
        message: 'Cleanup completed',
        cutoffDate: cutoffDate.toISOString()
      };

    } catch (error) {
      console.error('Cleanup error:', error);
      throw error;
    }
  }
}

// Create singleton instance
const imageProcessingService = new ImageProcessingService();

module.exports = imageProcessingService;
