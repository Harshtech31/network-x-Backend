const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const imageProcessingService = require('../services/imageProcessingService');
const { checkLambdaConfiguration, checkLambdaStatus } = require('../config/lambda');

const router = express.Router();

// Image processing validation middleware
const imageProcessingValidation = [
  body('s3Key')
    .isLength({ min: 1 })
    .withMessage('S3 key is required'),
  body('bucketName')
    .isLength({ min: 1 })
    .withMessage('Bucket name is required')
];

// POST /api/lambda/process-image - Process uploaded image
router.post('/process-image', authenticateToken, imageProcessingValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { s3Key, bucketName, options = {} } = req.body;
    const userId = req.user.id;

    const result = await imageProcessingService.processUploadedImage(
      s3Key,
      bucketName,
      userId,
      options
    );

    res.json(result);

  } catch (error) {
    console.error('Image processing error:', error);
    res.status(500).json({
      error: 'Failed to process image',
      message: error.message
    });
  }
});

// POST /api/lambda/process-profile-image - Process profile image
router.post('/process-profile-image', authenticateToken, imageProcessingValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { s3Key, bucketName } = req.body;
    const userId = req.user.id;

    const result = await imageProcessingService.processProfileImage(
      s3Key,
      bucketName,
      userId
    );

    res.json(result);

  } catch (error) {
    console.error('Profile image processing error:', error);
    res.status(500).json({
      error: 'Failed to process profile image',
      message: error.message
    });
  }
});

// POST /api/lambda/process-post-image - Process post image
router.post('/process-post-image', authenticateToken, imageProcessingValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { s3Key, bucketName } = req.body;
    const userId = req.user.id;

    const result = await imageProcessingService.processPostImage(
      s3Key,
      bucketName,
      userId
    );

    res.json(result);

  } catch (error) {
    console.error('Post image processing error:', error);
    res.status(500).json({
      error: 'Failed to process post image',
      message: error.message
    });
  }
});

// POST /api/lambda/generate-thumbnails - Generate image thumbnails
router.post('/generate-thumbnails', authenticateToken, imageProcessingValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { s3Key, bucketName, sizes = [] } = req.body;

    const result = await imageProcessingService.generateImageThumbnails(
      s3Key,
      bucketName,
      sizes
    );

    res.json(result);

  } catch (error) {
    console.error('Thumbnail generation error:', error);
    res.status(500).json({
      error: 'Failed to generate thumbnails',
      message: error.message
    });
  }
});

// POST /api/lambda/optimize-image - Optimize image for web
router.post('/optimize-image', authenticateToken, imageProcessingValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { s3Key, bucketName, options = {} } = req.body;

    const result = await imageProcessingService.optimizeImageForWeb(
      s3Key,
      bucketName,
      options
    );

    res.json(result);

  } catch (error) {
    console.error('Image optimization error:', error);
    res.status(500).json({
      error: 'Failed to optimize image',
      message: error.message
    });
  }
});

// POST /api/lambda/analyze-image - Analyze image metadata
router.post('/analyze-image', authenticateToken, imageProcessingValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { s3Key, bucketName } = req.body;

    const result = await imageProcessingService.analyzeImage(s3Key, bucketName);

    res.json(result);

  } catch (error) {
    console.error('Image analysis error:', error);
    res.status(500).json({
      error: 'Failed to analyze image',
      message: error.message
    });
  }
});

// POST /api/lambda/moderate-image - Moderate image content
router.post('/moderate-image', authenticateToken, imageProcessingValidation, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation Error',
        details: errors.array()
      });
    }

    const { s3Key, bucketName } = req.body;
    const userId = req.user.id;

    const result = await imageProcessingService.moderateImageContent(
      s3Key,
      bucketName,
      userId
    );

    res.json(result);

  } catch (error) {
    console.error('Image moderation error:', error);
    res.status(500).json({
      error: 'Failed to moderate image',
      message: error.message
    });
  }
});

// GET /api/lambda/processing-status/:processingId - Get processing job status
router.get('/processing-status/:processingId', authenticateToken, async (req, res) => {
  try {
    const { processingId } = req.params;

    const result = await imageProcessingService.getProcessingStatus(processingId);

    if (!result.found) {
      return res.status(404).json({
        error: 'Processing job not found'
      });
    }

    res.json(result);

  } catch (error) {
    console.error('Get processing status error:', error);
    res.status(500).json({
      error: 'Failed to get processing status',
      message: error.message
    });
  }
});

// GET /api/lambda/config - Check Lambda configuration (admin only)
router.get('/config', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const isConfigured = await checkLambdaConfiguration();

    const functionChecks = await Promise.allSettled([
      checkLambdaStatus('networkx-image-processor'),
      checkLambdaStatus('networkx-thumbnail-generator'),
      checkLambdaStatus('networkx-content-moderator')
    ]);

    const functions = {
      imageProcessor: functionChecks[0].status === 'fulfilled' ? functionChecks[0].value : { exists: false },
      thumbnailGenerator: functionChecks[1].status === 'fulfilled' ? functionChecks[1].value : { exists: false },
      contentModerator: functionChecks[2].status === 'fulfilled' ? functionChecks[2].value : { exists: false }
    };

    res.json({
      configured: isConfigured,
      functions,
      environment: {
        imageProcessorFunction: process.env.LAMBDA_IMAGE_PROCESSOR_FUNCTION || 'not configured',
        thumbnailGeneratorFunction: process.env.LAMBDA_THUMBNAIL_GENERATOR_FUNCTION || 'not configured',
        contentModeratorFunction: process.env.LAMBDA_CONTENT_MODERATOR_FUNCTION || 'not configured'
      }
    });

  } catch (error) {
    console.error('Lambda config check error:', error);
    res.status(500).json({
      error: 'Failed to check Lambda configuration',
      message: error.message
    });
  }
});

// POST /api/lambda/cleanup - Clean up old processing jobs (admin only)
router.post('/cleanup', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { daysOld = 7 } = req.body;

    const result = await imageProcessingService.cleanupOldProcessingJobs(daysOld);

    res.json(result);

  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({
      error: 'Failed to cleanup old jobs',
      message: error.message
    });
  }
});

module.exports = router;
