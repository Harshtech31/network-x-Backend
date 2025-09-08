const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { uploadMiddleware, deleteFile } = require('../config/aws');
const User = require('../models/mongodb/User');

const router = express.Router();

// POST /api/upload/profile-image - Upload profile image
router.post('/profile-image', authenticateToken, uploadMiddleware.profileImage, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        error: 'No file uploaded',
        message: 'Please select an image file'
      });
    }

    const imageUrl = req.file.location;

    // Optionally update user's profile image in database
    if (req.body.updateProfile === 'true') {
      const user = await User.findById(req.user.id);
      if (user) {
        // Delete old profile image if exists
        if (user.profileImage) {
          await deleteFile(user.profileImage);
        }
        
        user.profileImage = imageUrl;
        await user.save();
      }
    }

    res.json({
      message: 'Profile image uploaded successfully',
      imageUrl,
      fileSize: req.file.size,
      fileName: req.file.key
    });

  } catch (error) {
    console.error('Profile image upload error:', error);
    res.status(500).json({ 
      error: 'Upload failed',
      message: 'Failed to upload profile image'
    });
  }
});

// POST /api/upload/media - Upload multiple media files (images/videos)
router.post('/media', authenticateToken, uploadMiddleware.postMedia, async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ 
        error: 'No files uploaded',
        message: 'Please select at least one media file'
      });
    }

    const uploadedFiles = req.files.map(file => ({
      url: file.location,
      type: file.mimetype.startsWith('image/') ? 'image' : 'video',
      size: file.size,
      fileName: file.key,
      originalName: file.originalname
    }));

    res.json({
      message: 'Media files uploaded successfully',
      files: uploadedFiles,
      count: uploadedFiles.length
    });

  } catch (error) {
    console.error('Media upload error:', error);
    res.status(500).json({ 
      error: 'Upload failed',
      message: 'Failed to upload media files'
    });
  }
});

// DELETE /api/upload/file - Delete a file from S3
router.delete('/file', authenticateToken, async (req, res) => {
  try {
    const { fileUrl } = req.body;

    if (!fileUrl) {
      return res.status(400).json({ 
        error: 'File URL required',
        message: 'Please provide the file URL to delete'
      });
    }

    const deleted = await deleteFile(fileUrl);

    if (deleted) {
      res.json({
        message: 'File deleted successfully'
      });
    } else {
      res.status(500).json({
        error: 'Delete failed',
        message: 'Failed to delete file'
      });
    }

  } catch (error) {
    console.error('File deletion error:', error);
    res.status(500).json({ 
      error: 'Delete failed',
      message: 'Failed to delete file'
    });
  }
});

module.exports = router;
