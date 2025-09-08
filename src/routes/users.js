const express = require('express');
const User = require('../models/mongodb/User');
const { authenticateToken } = require('../middleware/auth');
const { uploadMiddleware } = require('../config/aws');

const router = express.Router();

// GET /api/users/profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user.toJSON());
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

// PUT /api/users/profile
router.put('/profile', authenticateToken, uploadMiddleware.profileImage, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update profile fields
    const updateFields = { ...req.body };
    
    // If profile image was uploaded, add the URL
    if (req.file) {
      updateFields.profileImage = req.file.location;
    }

    // Update user
    Object.assign(user, updateFields);
    await user.save();

    res.json({
      message: 'Profile updated successfully',
      user: user.toJSON()
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// GET /api/users/search
router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { q, department, year, skills, limit = 20, page = 1 } = req.query;
    
    const query = {};
    if (q) {
      query.$text = { $search: q };
    }
    if (department) {
      query.department = department;
    }
    if (year) {
      query.year = parseInt(year);
    }
    if (skills) {
      query.skills = { $in: skills.split(',') };
    }
    
    query.isActive = true;
    query._id = { $ne: req.user.id }; // Exclude current user

    const users = await User.find(query)
      .select('firstName lastName username profileImage department year skills interests rating isVerified')
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .sort({ rating: -1, createdAt: -1 });

    const total = await User.countDocuments(query);

    res.json({
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('User search error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

module.exports = router;
