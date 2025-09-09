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

// GET /api/users/profile/:userId - Get specific user profile
router.get('/profile/:userId', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('firstName lastName username profileImage department year skills interests rating isVerified bio location');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ error: 'Failed to get user profile' });
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

// POST /api/users/follow/:userId - Follow/unfollow user
router.post('/follow/:userId', authenticateToken, async (req, res) => {
  try {
    const targetUserId = req.params.userId;
    const currentUserId = req.user.id;
    
    if (targetUserId === currentUserId) {
      return res.status(400).json({ error: 'Cannot follow yourself' });
    }
    
    const targetUser = await User.findById(targetUserId);
    const currentUser = await User.findById(currentUserId);
    
    if (!targetUser || !currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const isFollowing = currentUser.following.includes(targetUserId);
    
    if (isFollowing) {
      // Unfollow
      currentUser.following.pull(targetUserId);
      targetUser.followers.pull(currentUserId);
    } else {
      // Follow
      currentUser.following.push(targetUserId);
      targetUser.followers.push(currentUserId);
    }
    
    await Promise.all([currentUser.save(), targetUser.save()]);
    
    res.json({
      message: isFollowing ? 'Unfollowed successfully' : 'Followed successfully',
      isFollowing: !isFollowing
    });
  } catch (error) {
    console.error('Follow/unfollow error:', error);
    res.status(500).json({ error: 'Failed to follow/unfollow user' });
  }
});

// GET /api/users/followers/:userId - Get user followers
router.get('/followers/:userId', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .populate('followers', 'firstName lastName username profileImage')
      .select('followers');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ followers: user.followers });
  } catch (error) {
    console.error('Get followers error:', error);
    res.status(500).json({ error: 'Failed to get followers' });
  }
});

// GET /api/users/following/:userId - Get user following
router.get('/following/:userId', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .populate('following', 'firstName lastName username profileImage')
      .select('following');
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ following: user.following });
  } catch (error) {
    console.error('Get following error:', error);
    res.status(500).json({ error: 'Failed to get following' });
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
